// Teste 3 do A1: o contrato entre o motor e o modelo. Duas pontas.
//
// Ida: o motor pede structured output com um json_schema que exige TODOS os
// campos que ele depois lê. Um campo que sai do `required` sem sair do parse é
// exatamente o tipo de erro que só aparece em produção, numa conversa real.
//
// Volta: com uma resposta bem formada, o motor devolve `{resposta,
// transferirParaAtendente}`; com uma resposta cortada no meio, ele repete uma
// vez com folga de tokens e, se ainda vier cortada, falha com erro que aponta a
// causa em vez de estourar um SyntaxError no parse.

import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso } from './apoio/http-falso.mts';

const CONTATO = 'aaaaaaaa-0000-4000-8000-00000000000f';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-00000000000f';

// Os campos que o motor lê do JSON. A lista está aqui, escrita à mão, de
// propósito: se alguém tirar um campo do schema, o teste quebra em vez de a
// conversa quebrar.
const CAMPOS_OBRIGATORIOS = [
  'resposta',
  'transferir_para_atendente',
  'questionario_completo',
  'respostas',
  'resultado',
  'itens_vendidos',
  'agendamento_data',
  'agendamento_hora',
  'agendamento_servico',
  'agendamento_remarcacao',
  'atualizacao_perfil',
];

function respostaCompleta(extra: Record<string, unknown> = {}) {
  return {
    resposta: 'Atendemos das 9h às 18h, sim!',
    transferir_para_atendente: false,
    questionario_completo: false,
    respostas: [],
    resultado: 'nenhum',
    itens_vendidos: [],
    agendamento_data: '',
    agendamento_hora: '',
    agendamento_servico: '',
    agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
    ...extra,
  };
}

let banco: Banco;
let supabaseClient: unknown;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Joana', telefone: '5511900000010', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-00000000000f', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto: 'Vocês atendem que horas?', read: false, camp: false,
    created_at: new Date().toISOString(),
  });
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

async function chamarMotor() {
  const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
  // O client falso não é o SupabaseClient tipado; o cast é o preço de dublar o
  // banco, e vale só dentro do teste.
  return gerarRespostaIA(supabaseClient as never, ORG_A, CONVERSA);
}

test('pede structured output com todos os campos que depois lê', async () => {
  const http = instalarHttpFalso([{ json: respostaCompleta() }]);
  try {
    await chamarMotor();

    assert.equal(http.chamadasAnthropic.length, 1);
    const corpo = http.chamadasAnthropic[0].corpo as {
      output_config?: { format?: { type?: string; schema?: { required?: string[]; properties?: Record<string, unknown>; additionalProperties?: boolean } } };
      max_tokens?: number;
      system?: string;
    };
    const formato = corpo.output_config?.format;
    assert.equal(formato?.type, 'json_schema', 'o motor deixou de pedir structured output');
    assert.deepEqual([...(formato?.schema?.required ?? [])].sort(), [...CAMPOS_OBRIGATORIOS].sort());
    assert.equal(formato?.schema?.additionalProperties, false);
    for (const campo of CAMPOS_OBRIGATORIOS) {
      assert.ok(formato?.schema?.properties?.[campo], `campo ${campo} declarado como obrigatório mas sem propriedade`);
    }
    assert.equal(corpo.max_tokens, 400, 'o teto de tokens da primeira tentativa mudou');
    assert.match(String(corpo.system), /Formato da resposta/);
  } finally {
    http.restaurar();
  }
});

test('devolve resposta e transferência a partir do JSON do modelo', async () => {
  const http = instalarHttpFalso([{ json: respostaCompleta() }]);
  try {
    const resultado = await chamarMotor();
    assert.deepEqual(resultado, { resposta: 'Atendemos das 9h às 18h, sim!', transferirParaAtendente: false });
  } finally {
    http.restaurar();
  }
});

test('propaga a transferência para atendente quando o modelo pede', async () => {
  const http = instalarHttpFalso([{ json: respostaCompleta({ transferir_para_atendente: true, resposta: 'Vou chamar alguém.' }) }]);
  try {
    const resultado = await chamarMotor();
    assert.equal(resultado.transferirParaAtendente, true);
    assert.equal(resultado.resposta, 'Vou chamar alguém.');
  } finally {
    http.restaurar();
  }
});

test('resposta cortada por limite de tokens é repetida uma vez, com folga', async () => {
  const http = instalarHttpFalso([
    { json: respostaCompleta(), stopReason: 'max_tokens' },
    { json: respostaCompleta({ resposta: 'Agora coube inteira.' }) },
  ]);
  try {
    const resultado = await chamarMotor();
    assert.equal(resultado.resposta, 'Agora coube inteira.');
    assert.equal(http.chamadasAnthropic.length, 2, 'devia ter repetido exatamente uma vez');
    assert.equal((http.chamadasAnthropic[1].corpo as { max_tokens: number }).max_tokens, 1024);
  } finally {
    http.restaurar();
  }
});

test('corte no meio de uma ferramenta repete com folga de 4096, porque a lista grande não cabe em 1024', async () => {
  const http = instalarHttpFalso([
    { ferramentas: [{ nome: 'confirmar_itens', entrada: {} }], stopReason: 'max_tokens' },
    { json: respostaCompleta({ resposta: 'Coube a lista inteira.' }) },
  ]);
  try {
    const resultado = await chamarMotor();
    assert.equal(resultado.resposta, 'Coube a lista inteira.');
    assert.equal((http.chamadasAnthropic[1].corpo as { max_tokens: number }).max_tokens, 4096);
  } finally {
    http.restaurar();
  }
});

test('cortada duas vezes, falha com erro que diz a causa', async () => {
  const http = instalarHttpFalso([
    { json: respostaCompleta(), stopReason: 'max_tokens' },
    { json: respostaCompleta(), stopReason: 'max_tokens' },
  ]);
  try {
    await assert.rejects(() => chamarMotor(), /truncada pelo limite de tokens/);
  } finally {
    http.restaurar();
  }
});

test('grava o uso de tokens de cada chamada em ai_usage', async () => {
  const antes = banco.ai_usage.length;
  const http = instalarHttpFalso([
    { json: respostaCompleta(), stopReason: 'max_tokens' },
    { json: respostaCompleta() },
  ]);
  try {
    await chamarMotor();
    const novos = banco.ai_usage.slice(antes);
    assert.equal(novos.length, 2, 'a repetição por truncamento também custa e precisa aparecer no custo');
    assert.equal(novos[0].origem, 'motor');
    assert.equal(novos[0].conversation_id, CONVERSA);
    assert.equal(novos[0].organization_id, ORG_A);
  } finally {
    http.restaurar();
  }
});

// C6, item 1: o motor deixou de fazer uma chamada só e passou a conversar com
// o modelo em voltas, executando ferramentas no meio.
//
// É o único item de todo o plano que mexe no coração do Wappia Atendimento,
// então o teste mais importante deste arquivo não é sobre ferramenta nenhuma:
// é o que prova que o número de atendimento manda uma requisição SEM o campo
// `tools` e continua custando uma chamada por resposta. Os demais testes do
// bloco A, passando sem alteração, são a outra metade dessa prova.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { SEPARAR_FORMULARIO_DAS_FERRAMENTAS } from '@/lib/agente/interruptor-duas-fases';

// **Por que as contagens do roteiro de vendas somam `FASE_2` (27/09).** Com as
// duas fases ligadas, toda resposta de vendas faz uma chamada a mais no fim: o
// serializador, que transforma o texto da fase 1 no formulário (ver
// `interruptor-duas-fases.ts`). Ela é uma requisição à Anthropic e uma linha
// de `ai_usage` de verdade, então entra nas duas contagens. As voltas do laço
// continuam as mesmas. Atualização autorizada pelo Leonardo em 27/09 só para
// testes que contam chamadas.
const FASE_2 = SEPARAR_FORMULARIO_DAS_FERRAMENTAS ? 1 : 0;

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDEDOR-LACO';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000000c6';
const CLIENTE = '5500900000077';

let banco: Banco;
let http: HttpFalso;
let tarefasPendentes: (() => Promise<void> | void)[] = [];

/** O que a ferramenta falsa recebeu, na ordem. */
let chamadasDaFerramenta: Record<string, unknown>[] = [];
/** O que ela responde. `null` faz ela estourar. */
let respostaDaFerramenta: string | null = 'CA50 3/8 (10.0 MM) — R$ 29,80 a barra';

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 11 90000-0077', papel: 'vendedor', member_id: null, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendedor-laco', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor João, da Distribuidora Exemplo.',
    tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });

  // O registro de ferramentas de verdade ainda devolve lista vazia para todo
  // roteiro (a primeira ferramenta real é a do catálogo, no item 2). Aqui ele
  // é trocado por uma ferramenta de mentira, porque o que este arquivo testa é
  // o LAÇO — não o que cada ferramenta faz.
  mock.module('@/lib/agente/ferramentas', {
    namedExports: {
      ferramentasDoRoteiro: (roteiro: string) => roteiro !== 'vendas' ? [] : [{
        definicao: {
          name: 'consultar_catalogo',
          description: 'Consulta o catálogo da empresa.',
          input_schema: {
            type: 'object', properties: { assunto: { type: 'string' } },
            required: ['assunto'], additionalProperties: false,
          },
        },
        executar: async (entrada: Record<string, unknown>) => {
          chamadasDaFerramenta.push(entrada);
          if (respostaDaFerramenta === null) throw new Error('sistema fora do ar');
          return respostaDaFerramenta;
        },
      }],
    },
  });
});

beforeEach(() => {
  banco.contacts.length = 0;
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.ai_usage.length = 0;
  chamadasDaFerramenta = [];
  respostaDaFerramenta = 'CA50 3/8 (10.0 MM) — R$ 29,80 a barra';
  tarefasPendentes = [];
});

depois(() => http?.restaurar());

async function entregar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  // Número de vendas responde pela fila (C6, item 4): o webhook grava e sai,
  // e a resposta é gerada no que o `after()` adiou. Drenar aqui deixa os dois
  // roteiros com o mesmo resultado observável.
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  return resposta;
}

function corpoDaChamada(i: number) {
  return http.chamadasAnthropic[i]?.corpo as {
    tools?: { name: string }[];
    tool_choice?: { type: string };
    messages?: { role: string; content: unknown }[];
  };
}

/** Instala o dublê de HTTP com uma fila de respostas da Anthropic. */
function comRespostas(respostas: RespostaAnthropic[]) {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
}

const PEDE_FERRAMENTA: RespostaAnthropic = {
  ferramentas: [{ nome: 'consultar_catalogo', entrada: { assunto: 'vergalhão' } }],
};
const RESPONDE: RespostaAnthropic = {
  json: {
    resposta: 'Temos sim! A barra de 3/8 sai por R$ 29,80.',
    transferir_para_atendente: false, questionario_completo: false, respostas: [],
    resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
    agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
};

describe('roteiro de atendimento: a requisição não muda', () => {
  test('não manda o campo tools, e continua sendo uma chamada por resposta', async () => {
    comRespostas([RESPONDE]);
    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'Bom dia' }));

    assert.equal(http.chamadasAnthropic.length, 1, 'uma chamada só, como sempre foi');
    const corpo = corpoDaChamada(0);
    assert.equal('tools' in corpo, false, 'o campo tools não pode existir na requisição do atendimento');
    assert.equal('tool_choice' in corpo, false);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
  });

  test('o custo do atendimento não sobe: uma linha de ai_usage por resposta', async () => {
    comRespostas([RESPONDE]);
    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'Bom dia' }));

    const doMotor = banco.ai_usage.filter(u => u.origem === 'motor');
    assert.equal(doMotor.length, 1, 'uma volta, uma linha');
  });
});

describe('roteiro de vendas: resposta cortada pelo limite de tokens', () => {
  test('repete com folga de 4096, porque o corte pode ter sido no meio da lista de itens', async () => {
    comRespostas([{ ...RESPONDE, stopReason: 'max_tokens' }, RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'tem vergalhão de 3/8?',
    }));

    assert.equal((http.chamadasAnthropic[1].corpo as { max_tokens: number }).max_tokens, 4096);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length > 0, true, 'o cliente recebeu resposta');
  });
});

describe('roteiro de vendas: o laço roda', () => {
  test('o modelo pede a ferramenta, ela roda, e o resultado volta para ele', async () => {
    comRespostas([PEDE_FERRAMENTA, RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'tem vergalhão de 3/8?',
    }));

    assert.equal(http.chamadasAnthropic.length, 2 + FASE_2, 'duas voltas: o pedido e a resposta (mais a fase 2)');
    assert.deepEqual(chamadasDaFerramenta, [{ assunto: 'vergalhão' }], 'a ferramenta rodou com o que o modelo mandou');

    // A primeira volta leva as ferramentas; a segunda leva o resultado delas.
    assert.deepEqual(corpoDaChamada(0).tools?.map(t => t.name), ['consultar_catalogo']);
    const segunda = corpoDaChamada(1).messages ?? [];
    const ultima = segunda[segunda.length - 1];
    assert.equal(ultima.role, 'user');
    const blocos = ultima.content as { type: string; content: string; is_error?: boolean }[];
    assert.equal(blocos[0].type, 'tool_result');
    assert.equal(blocos[0].content, 'CA50 3/8 (10.0 MM) — R$ 29,80 a barra');

    // E o cliente recebe a resposta do fim do laço, não o resultado cru.
    const daIA = banco.messages.filter(m => m.autor === 'ia');
    assert.equal(daIA.length, 1);
    assert.match(String(daIA[0].texto), /29,80/);
    assert.equal(http.chamadasWhatsApp.length, 1);
  });

  test('toda volta do laço entra no ai_usage', async () => {
    comRespostas([PEDE_FERRAMENTA, PEDE_FERRAMENTA, RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'tem vergalhão?',
    }));

    assert.equal(http.chamadasAnthropic.length, 3 + FASE_2);
    assert.equal(banco.ai_usage.filter(u => u.origem === 'motor').length, 3 + FASE_2,
      'três voltas, três linhas — senão o custo do Vendas ficaria invisível');
  });

  test('ferramenta que estoura não derruba a conversa', async () => {
    respostaDaFerramenta = null;
    comRespostas([PEDE_FERRAMENTA, RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'tem vergalhão?',
    }));

    const segunda = corpoDaChamada(1).messages ?? [];
    const blocos = segunda[segunda.length - 1].content as { is_error?: boolean; content: string }[];
    assert.equal(blocos[0].is_error, true, 'o modelo precisa saber que a consulta falhou');
    assert.match(blocos[0].content, /Não invente o resultado/);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1, 'e o cliente é respondido mesmo assim');
  });

  test('ferramenta que não existe volta como erro, sem derrubar nada', async () => {
    comRespostas([{ ferramentas: [{ nome: 'ferramenta_inventada', entrada: {} }] }, RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'oi',
    }));

    const segunda = corpoDaChamada(1).messages ?? [];
    const blocos = segunda[segunda.length - 1].content as { is_error?: boolean; content: string }[];
    assert.equal(blocos[0].is_error, true);
    assert.equal(chamadasDaFerramenta.length, 0);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
  });
});

describe('o teto de voltas', () => {
  test('modelo que pede ferramenta sem parar é cortado, e o cliente é respondido', async () => {
    // Vinte pedidos na fila: só o teto impede o laço de consumir todos.
    comRespostas([...Array(20).fill(PEDE_FERRAMENTA), RESPONDE]);
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'tem vergalhão?',
    }));

    // 6 voltas com ferramenta + 1 volta final sem ferramenta (+ a fase 2).
    assert.equal(http.chamadasAnthropic.length, 7 + FASE_2);
    assert.equal(chamadasDaFerramenta.length, 6);

    // A última volta proíbe ferramenta — é o que obriga o modelo a falar.
    const ultima = corpoDaChamada(6);
    assert.deepEqual(ultima.tool_choice, { type: 'none' });
    assert.ok(ultima.tools?.length, 'as ferramentas continuam declaradas; o que muda é a permissão de usá-las');

    assert.equal(banco.ai_usage.filter(u => u.origem === 'motor').length, 7 + FASE_2);

    // E o cliente não fica no vácuo por causa do teto.
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
    assert.equal(http.chamadasWhatsApp.length, 1);
  });
});

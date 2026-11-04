// Onde a IA vai só até o cadastro (Distribuidora Exemplo), ela responde em texto puro, sem o
// formulário estruturado.
//
// O caso: em 21/09 as 5 mensagens reais do Leonardo depois do deploy deram erro
// 500 na Anthropic e caíram todas no resgate, que não tem ferramentas e por isso
// perguntava o produto em vez de consultar o CNPJ. A bancada de 20/09
// (`test/bancada/erro-500-formato-e-ferramentas.mts`) já tinha medido a causa: o
// formulário junto com as ferramentas estoura em ~1/3 dos pedidos; cada um
// sozinho, 0 em 60. Na Distribuidora Exemplo o formulário não carregava nada que o motor use.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { FERRAMENTAS_ATE_O_CADASTRO, ORGS_COM_CONSERTOS_DO_CADASTRO, ORGS_SO_ATE_O_CADASTRO } from '@/lib/agente/so-ate-o-cadastro';

const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000000f3';
const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000f3';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000f3';

let banco: Banco;
let supabaseClient: unknown;
let http: HttpFalso;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: 'PHONE-NUMBER-ID-F3',
    telefone: '+55 73 90000-0013', papel: 'vendedor', member_id: null, ativo: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendas-f3', organization_id: ORG_A, ativo: true,
    prompt: 'Peça o CPF ou CNPJ primeiro.', tom: 'direto', limitacoes: null, info_adicional: null,
    sucessos: null, fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  ORGS_SO_ATE_O_CADASTRO.delete(ORG_A);
  for (const t of ['contacts', 'conversations', 'messages', 'contact_history', 'ai_usage']) banco[t].length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Joana', telefone: '5500900000093', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, wa_number_id: WA_NUMBER_VENDEDOR,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-0000000000f3', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto: 'quero um orçamento', read: false, camp: false, created_at: new Date().toISOString(),
  });
});

depois(() => {
  ORGS_SO_ATE_O_CADASTRO.delete(ORG_A);
  http?.restaurar();
});

async function responder(respostas: RespostaAnthropic[]) {
  http = instalarHttpFalso(respostas);
  try {
    const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
    return await gerarRespostaIA(supabaseClient as never, ORG_A, CONVERSA);
  } finally {
    http.restaurar();
  }
}

function corpo(i: number): Record<string, unknown> {
  return http.chamadasAnthropic[i].corpo as Record<string, unknown>;
}

describe('vendas que vai só até o cadastro', () => {
  test('pede com as ferramentas e sem o formulário', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    await responder([{ texto: 'Qual é o seu CPF ou CNPJ?' }]);

    assert.equal('output_config' in corpo(0), false, 'formulário + ferramentas é o que dá o erro 500');
    assert.ok(Array.isArray(corpo(0).tools), 'as ferramentas de consultar e cadastrar continuam');
  });

  test('não manda o modelo responder em JSON', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    await responder([{ texto: 'Qual é o seu CPF ou CNPJ?' }]);

    assert.doesNotMatch(String(corpo(0).system), /Responda em JSON/);
  });

  test('o texto do modelo é a mensagem que vai ao cliente', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    const r = await responder([{ texto: 'Qual é o seu CPF ou CNPJ?' }]);

    assert.equal(r.resposta, 'Qual é o seu CPF ou CNPJ?');
  });

  test('a consulta ao cadastro continua passando pelo laço de ferramentas', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    await responder([
      { ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12345678000190' } }] },
      { texto: 'Achei aqui: ACME. É esse mesmo?' },
    ]);

    assert.equal(http.chamadasAnthropic.length, 2, 'a volta com o resultado da ferramenta aconteceu');
  });

  // **Mudança de 28/09, autorizada pelo Leonardo ao ligar as duas fases.** Até
  // então o teste lia a chamada 0. Com as duas fases (`interruptor-duas-fases.ts`),
  // a chamada 0 é o laço SEM o formulário, e o formulário vai numa chamada
  // separada no fim, a do serializador. O que o teste protege continua igual:
  // fora da lista "até o cadastro", a resposta de vendas ainda passa pelo
  // formulário. Ele só deixou de exigir que seja na primeira chamada.
  test('vendas fora da lista continua com o formulário', async () => {
    await responder([]);

    const comFormulario = http.chamadasAnthropic.filter(c => 'output_config' in (c.corpo as Record<string, unknown>));
    assert.equal(comFormulario.length, 1, 'uma chamada da resposta leva o formulário');
  });
});

// 01/10: a Distribuidora Exemplo saiu da trava do produto e ficou só com os consertos do
// cadastro (`ORGS_COM_CONSERTOS_DO_CADASTRO`). O texto puro tem que continuar,
// agora com as ferramentas de produto, preço e orçamento na mesa.
describe('vendas só com os consertos do cadastro', () => {
  test('responde em texto puro com todas as ferramentas de vendas', async () => {
    ORGS_COM_CONSERTOS_DO_CADASTRO.add(ORG_A);
    try {
      await responder([{ texto: 'Qual é o seu CPF ou CNPJ?' }]);
      const nomes = (corpo(0).tools as { name: string }[]).map(t => t.name);

      assert.equal('output_config' in corpo(0), false, 'formulário + ferramentas é o que dá o erro 500');
      assert.ok(nomes.length > FERRAMENTAS_ATE_O_CADASTRO.length, `vieram só ${nomes.join(', ')}`);
    } finally {
      ORGS_COM_CONSERTOS_DO_CADASTRO.delete(ORG_A);
    }
  });
});

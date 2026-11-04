// C3, segunda metade: no Wappia Vendas a fala do vendedor NÃO desliga a IA.
//
// A diferença é de produto, não uma regra a mais. No Atendimento a IA
// substitui o atendente: quando um humano responde, ela se cala, senão diria a
// mesma coisa duas vezes. No Vendas ela não substitui ninguém — ela faz o
// cadastro e o rascunho do orçamento, trabalho que o vendedor não vai fazer
// pelo celular. Se a mensagem dele desligasse a IA, uma frase sobre outro
// assunto (ou mandada sem querer) pararia o orçamento no meio.
//
// Decisão do Leonardo em 2026-09-13. O que o teste protege é exatamente a
// convivência das duas regras: o mesmo código, dois comportamentos, escolhidos
// pelo roteiro do número.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { ehDoSerializador, instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDEDOR';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000000c';
const CLIENTE = '5500900000088';

let banco: Banco;
let http: HttpFalso;
let enquantoOModeloPensa: (() => Promise<void>) | null = null;
/** Tarefas que o webhook adiou com `after()` quando a fila está ligada. */
let tarefasPendentes: (() => Promise<void> | void)[] = [];

function payloadDeEco(opcoes: { phoneNumberId: string; paraOCliente: string; texto: string }): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA-ID',
      changes: [{
        field: 'smb_message_echoes',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '5511999999999', phone_number_id: opcoes.phoneNumberId },
          message_echoes: [{
            from: '5511999999999',
            to: opcoes.paraOCliente,
            id: `wamid.eco.${Math.random().toString(36).slice(2)}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: opcoes.texto },
          }],
        },
      }],
    }],
  });
}

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  // Com a fila ligada, a resposta sai depois do request da Meta — é a janela em
  // que o eco do vendedor chega ANTES de a IA montar o histórico.
  process.env.WEBHOOK_FILA_ORGS = ORG_A;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  // Um número de vendedor ao lado do de atendimento da mesma empresa, com
  // roteiro próprio — é assim que o bloco A deixou preparado.
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 11 90000-0009', papel: 'vendedor', member_id: null, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendedor', organization_id: ORG_A, ativo: true,
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
  http = instalarHttpFalso();

  const fetchDoFalso = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.includes('api.anthropic.com') && enquantoOModeloPensa) {
      const acao = enquantoOModeloPensa;
      enquantoOModeloPensa = null;
      await acao();
    }
    return fetchDoFalso(entrada, init);
  }) as typeof fetch;
});

beforeEach(() => {
  banco.contacts.length = 0;
  banco.conversations.length = 0;
  banco.messages.length = 0;
  http.chamadasAnthropic.length = 0;
  http.chamadasWhatsApp.length = 0;
  enquantoOModeloPensa = null;
  tarefasPendentes = [];
});

depois(() => {
  http.restaurar();
  delete process.env.WEBHOOK_FILA_ORGS;
});

/** Roda o que a fila adiou, inclusive o que for agendado no meio. */
async function rodarFila() {
  while (tarefasPendentes.length) {
    await tarefasPendentes.shift()!();
  }
}

async function entregar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

/** O que foi mandado à Anthropic na última chamada DA CONVERSA. Com as duas
 *  fases ligadas, a última de todas é o serializador, que não leva o histórico
 *  nem o system da conversa (ver `interruptor-duas-fases.ts`). Mudança de
 *  27/09, autorizada pelo Leonardo para os testes que leem a última requisição. */
function ultimaChamadaAoModelo() {
  return http.chamadasAnthropic.filter(c => !ehDoSerializador(c)).at(-1)?.corpo as {
    system?: string;
    messages?: { role: string; content: string }[];
  };
}

describe('número de vendedor (roteiro de vendas)', () => {
  test('a IA responde mesmo com o vendedor tendo respondido enquanto ela pensava', async () => {
    enquantoOModeloPensa = async () => {
      await entregar(payloadDeEco({
        phoneNumberId: NUMERO_VENDEDOR, paraOCliente: CLIENTE, texto: 'Opa, tudo bem? Já te chamo',
      }));
    };

    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'Preciso de 20 barras de 6 metros',
    }));
    await rodarFila();

    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1, 'a resposta da IA foi gravada');
    assert.equal(http.chamadasWhatsApp.length, 1, 'e foi enviada ao cliente');
  });

  test('com o vendedor tendo falado por último, a IA responde e sabe o que ele disse', async () => {
    // O cliente escreve, e o vendedor responde pelo celular antes de a fila
    // chegar na vez da IA: quando ela monta o histórico, a última fala é dele.
    await entregar(payloadDeMensagem({
      phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE, texto: 'Bom dia, quero um orçamento',
    }));
    await entregar(payloadDeEco({
      phoneNumberId: NUMERO_VENDEDOR, paraOCliente: CLIENTE, texto: 'Bom dia! Estou em reunião',
    }));
    await rodarFila();

    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1, 'a IA respondeu mesmo assim');

    const chamada = ultimaChamadaAoModelo();
    // A fala do vendedor não pode ser a última da conversa mandada ao modelo —
    // a Anthropic recusa conversa terminando no assistente.
    assert.equal(chamada.messages?.[chamada.messages.length - 1]?.role, 'user');
    // Mas ela precisa chegar de algum jeito, senão a IA repete o que ele disse.
    assert.match(chamada.system ?? '', /O vendedor já escreveu ao cliente/);
    assert.match(chamada.system ?? '', /Estou em reunião/);
  });

  test('o número de atendimento da mesma empresa continua se calando', async () => {
    // A mesma organização, o outro número: a regra antiga vale sem mudança.
    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'Quanto custa?' }));
    await entregar(payloadDeEco({
      phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Oi! Já respondo',
    }));
    await rodarFila();

    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 0, 'a IA do atendimento não responde por cima');
    assert.equal(http.chamadasWhatsApp.length, 0);
  });
});

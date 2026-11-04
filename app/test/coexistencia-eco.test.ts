// C3: coexistência — o que o vendedor manda pelo celular dele.
//
// Com o número em coexistência o aplicativo continua no telefone do vendedor, e
// tudo que ele digita por lá chega no webhook pelo campo `smb_message_echoes`.
// Antes disto o código ignorava esse campo, e o resultado seria o cliente
// recebendo duas respostas do mesmo número: a do vendedor e, segundos depois, a
// da IA respondendo por cima.
//
// Decisão do Leonardo (2026-09-13): **o eco não desliga a IA**. Ela segue
// atendendo; o que evita o atropelo é a regra que o motor já tinha — não
// responder quando a conversa termina numa fala da casa. Estes testes provam as
// duas metades: o eco vira mensagem na conversa certa, e o eco nunca faz a IA
// falar.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, WA_NUMBER_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const CLIENTE = '5500900000077';

let banco: Banco;
let http: HttpFalso;
/** Roda uma vez, no instante em que a chamada à Anthropic sai — é assim que se
 *  simula "o vendedor respondeu pelo celular enquanto o modelo pensava". */
let enquantoOModeloPensa: (() => Promise<void>) | null = null;

/** Payload do webhook `smb_message_echoes`, no formato da doc da Meta. */
function payloadDeEco(opcoes: { phoneNumberId: string; paraOCliente: string; texto: string; wamid?: string }): string {
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
            id: opcoes.wamid ?? `wamid.eco.${Math.random().toString(36).slice(2)}`,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: opcoes.texto },
          }],
        },
      }],
    }],
  });
}

/** Payload de um campo que a coexistência traz e que ainda não importamos. */
function payloadDeCampo(field: string): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA-ID',
      changes: [{ field, value: { metadata: { phone_number_id: NUMERO_A } } }],
    }],
  });
}

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
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
});

depois(() => http.restaurar());

async function entregar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

describe('eco do vendedor', () => {
  test('vira mensagem da casa na conversa, sem chamar a IA', async () => {
    const resposta = await entregar(payloadDeEco({
      phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Bom dia! Já te mando o orçamento.',
    }));

    assert.equal(resposta.status, 200);
    assert.equal(banco.messages.length, 1);
    assert.equal(banco.messages[0].autor, 'humano');
    assert.equal(banco.messages[0].texto, 'Bom dia! Já te mando o orçamento.');
    // O que não pode acontecer de jeito nenhum: o eco fazer a IA falar.
    assert.equal(http.chamadasAnthropic.length, 0);
    assert.equal(http.chamadasWhatsApp.length, 0);
  });

  test('cai na mesma conversa da mensagem do cliente, não numa nova', async () => {
    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'Oi, tem o perfil 20x20?' }));
    await entregar(payloadDeEco({ phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Tenho sim!' }));

    assert.equal(banco.conversations.length, 1);
    const daConversa = banco.messages.filter(m => m.conversation_id === banco.conversations[0].id);
    assert.deepEqual(daConversa.map(m => m.autor), ['cliente', 'ia', 'humano']);
  });

  test('vendedor puxando conversa cria o contato e a conversa', async () => {
    await entregar(payloadDeEco({ phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Oi! Aqui é o João da Distribuidora Exemplo.' }));

    assert.equal(banco.contacts.length, 1);
    assert.equal(banco.contacts[0].telefone, CLIENTE);
    assert.equal(banco.conversations.length, 1);
    assert.equal(banco.conversations[0].wa_number_id, WA_NUMBER_A);
  });

  test('a Meta reenviando o mesmo eco não duplica a mensagem', async () => {
    const corpo = payloadDeEco({
      phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Segue o valor', wamid: 'wamid.eco.fixo',
    });
    await entregar(corpo);
    await entregar(corpo);

    assert.equal(banco.messages.filter(m => m.autor === 'humano').length, 1);
  });

  test('eco de número que não é de ninguém não cria nada', async () => {
    await entregar(payloadDeEco({
      phoneNumberId: 'PHONE-NUMBER-ID-QUE-NAO-EXISTE', paraOCliente: CLIENTE, texto: 'oi',
    }));

    assert.equal(banco.messages.length, 0);
    assert.equal(banco.contacts.length, 0);
  });

  test('a IA continua atendendo depois de o vendedor ter respondido', async () => {
    // A decisão do Leonardo: nada de desligar a IA, porque religar exigiria uma
    // regra nova. A mensagem seguinte do cliente é respondida normalmente.
    await entregar(payloadDeEco({ phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Já te respondo' }));
    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'E o prazo de entrega?' }));

    assert.equal(http.chamadasAnthropic.length, 1);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
  });

  test('vendedor respondendo enquanto o modelo pensa faz a resposta da IA ser descartada', async () => {
    // O caso que o cliente sentiria: duas respostas diferentes do mesmo número
    // com segundos de diferença. A resposta da IA já nasceu velha, então é
    // jogada fora — nem grava, nem envia.
    enquantoOModeloPensa = async () => {
      await entregar(payloadDeEco({ phoneNumberId: NUMERO_A, paraOCliente: CLIENTE, texto: 'Custa R$ 120, posso fechar?' }));
    };

    await entregar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto: 'Quanto custa?' }));

    assert.equal(http.chamadasAnthropic.length, 1, 'o modelo foi chamado');
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 0, 'a resposta da IA não foi gravada');
    assert.equal(http.chamadasWhatsApp.length, 0, 'nada foi enviado ao cliente');
    assert.deepEqual(banco.messages.map(m => m.autor), ['cliente', 'humano']);
  });

  test('os campos de histórico e de contatos são aceitos sem quebrar nada', async () => {
    for (const campo of ['history', 'smb_app_state_sync']) {
      const resposta = await entregar(payloadDeCampo(campo));
      assert.equal(resposta.status, 200, `campo ${campo}`);
    }
    assert.equal(banco.messages.length, 0);
  });
});

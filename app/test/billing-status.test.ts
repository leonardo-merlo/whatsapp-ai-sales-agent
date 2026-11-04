// Status de pagamento por número (migration 20260922000001).
//
// O que está em jogo: não existe webhook de billing da Meta — o único sinal
// de cartão recusado é o erro síncrono no envio (131042/131044). O que os
// testes provam, e que não dá para conferir olhando: (1) esse erro passa a
// marcar o número e avisar pelo sino, em vez de morrer num console.error;
// (2) o mesmo problema não gera notificação duplicada a cada mensagem que
// continuar falhando; (3) o número se limpa sozinho no primeiro envio que
// passar, e a notificação pendente se resolve junto.

import { describe, test, before, beforeEach, after as depois } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

let banco: Banco;
let http: HttpFalso;
/** Quando definido, a próxima chamada de envio à Graph API devolve este erro
 *  em vez do sucesso padrão do dublê. */
let proximoErro: { code: number; message: string } | null = null;

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN-DA-WAPPIA';
  banco = cenarioBase();
  banco.vault = [];
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();

  // O dublê de HTTP sempre responde sucesso no envio; aqui ele é envolvido
  // para simular a Meta recusando por código, que é o caminho que este item
  // exercita.
  const interceptado = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.includes('graph.facebook.com') && url.endsWith('/messages') && proximoErro) {
      const erro = proximoErro;
      proximoErro = null;
      return new Response(JSON.stringify({ error: erro }), { status: 400, headers: { 'content-type': 'application/json' } });
    }
    return interceptado(entrada, init);
  }) as typeof fetch;
});

beforeEach(() => {
  proximoErro = null;
  banco.notificacoes = [];
  banco.wa_numbers.forEach(n => { n.billing_status = 'ok'; n.billing_atualizado_em = null; });
  http.chamadasWhatsApp.length = 0;
});

depois(() => http.restaurar());

describe('falha de pagamento no envio', () => {
  test('131042 marca o número e cria uma notificação', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    proximoErro = { code: 131042, message: 'Business eligibility payment issue' };
    await assert.rejects(() => sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A));

    const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_A);
    assert.equal(numero?.billing_status, 'pagamento_falhou');

    const notifs = banco.notificacoes.filter(n => n.tipo === 'numero_pagamento_falhou');
    assert.equal(notifs.length, 1);
    assert.equal(notifs[0].organization_id, ORG_A);
    assert.equal(notifs[0].status, 'pendente');
  });

  test('código não relacionado a pagamento não mexe no status', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    proximoErro = { code: 132001, message: 'Template does not exist' };
    await assert.rejects(() => sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A));

    const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_A);
    assert.equal(numero?.billing_status, 'ok');
    assert.equal(banco.notificacoes.length, 0);
  });

  test('falha repetida não duplica a notificação', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    proximoErro = { code: 131042, message: 'Business eligibility payment issue' };
    await assert.rejects(() => sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A));
    proximoErro = { code: 131044, message: 'No valid payment method' };
    await assert.rejects(() => sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A));

    assert.equal(banco.notificacoes.filter(n => n.tipo === 'numero_pagamento_falhou').length, 1);
  });

  test('o próximo envio que passar limpa o status e resolve a notificação', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    proximoErro = { code: 131042, message: 'Business eligibility payment issue' };
    await assert.rejects(() => sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A));

    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi de novo', NUMERO_A);

    const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_A);
    assert.equal(numero?.billing_status, 'ok');

    const notif = banco.notificacoes.find(n => n.tipo === 'numero_pagamento_falhou');
    assert.equal(notif?.status, 'resolvida');
  });

  test('número que nunca teve problema: envio bem-sucedido não grava nada a mais', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A);

    assert.equal(banco.notificacoes.length, 0);
    const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_A);
    assert.equal(numero?.billing_status, 'ok');
  });
});

// Teste 1 do A1: a autenticação do webhook é a assinatura HMAC. Endpoint
// público — se isto afrouxar, qualquer um manda mensagem em nome de qualquer
// cliente. O corpo válido vai vazio de propósito: o que está sob teste aqui é
// só o portão da assinatura, não o que acontece depois dele.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { assinar, cenarioBase, INDICES_UNICOS, requisicaoDoWebhook, SEGREDO_DO_APP } from './apoio/cenario.mts';
import { criarSupabaseFalso } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'token-de-verificacao';
  const supabase = criarSupabaseFalso(cenarioBase(), INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

const corpoVazio = JSON.stringify({ object: 'whatsapp_business_account', entry: [] });

test('recusa com 401 quando a assinatura não confere', async () => {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const resposta = await POST(requisicaoDoWebhook(corpoVazio, assinar(corpoVazio, 'segredo-errado')));
  assert.equal(resposta.status, 401);
});

test('recusa com 401 quando não vem assinatura nenhuma', async () => {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const resposta = await POST(requisicaoDoWebhook(corpoVazio, null));
  assert.equal(resposta.status, 401);
});

test('recusa com 401 quando o corpo foi alterado depois de assinado', async () => {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const assinatura = assinar(corpoVazio);
  const corpoAdulterado = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'outro' }] });
  const resposta = await POST(requisicaoDoWebhook(corpoAdulterado, assinatura));
  assert.equal(resposta.status, 401);
});

test('aceita com 200 quando a assinatura confere', async () => {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const resposta = await POST(requisicaoDoWebhook(corpoVazio, assinar(corpoVazio)));
  assert.equal(resposta.status, 200);
});

test('o handshake GET só devolve o challenge com o verify token certo', async () => {
  const { GET } = await import('@/app/api/webhooks/whatsapp/route');
  const url = 'https://www.wappia.com.br/api/webhooks/whatsapp';

  const ok = await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=token-de-verificacao&hub.challenge=1234`));
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '1234');

  const negado = await GET(new Request(`${url}?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1234`));
  assert.equal(negado.status, 403);
});

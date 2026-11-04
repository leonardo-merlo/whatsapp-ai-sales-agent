// A varredura de mensagem sem resposta: a rede de segurança da fila.
//
// Com a fila ligada, o webhook grava a mensagem do cliente, responde 200 e deixa
// a resposta para o `after()`. Se o worker morre nesse intervalo, a mensagem
// fica gravada e ninguém responde. A varredura roda a cada 2 minutos e procura
// exatamente isso: conversa em modo `ia` cuja última mensagem é do cliente, entre
// 3 e 30 minutos atrás.
//
// Metade dos testes prova que ela responde; a outra metade, que ela NÃO fala
// quando não devia — porque uma coisa que manda WhatsApp sozinha em segundo
// plano erra do jeito mais visível possível.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, NUMERO_B, ORG_A, ORG_B, WA_NUMBER_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const SEGREDO_DO_CRON = 'segredo-de-teste-do-cron';
const MINUTO = 60 * 1000;

let banco: Banco;
let http: HttpFalso;
let tarefasPendentes: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  process.env.CRON_SECRET = SEGREDO_DO_CRON;
  process.env.WEBHOOK_FILA_ORGS = ORG_A;

  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
  http = instalarHttpFalso();
});

depois(() => {
  http.restaurar();
  delete process.env.WEBHOOK_FILA_ORGS;
  delete process.env.CRON_SECRET;
});

beforeEach(() => { tarefasPendentes = []; });

async function varrer(segredo: string | null = SEGREDO_DO_CRON) {
  const { GET } = await import('@/app/api/cron/responder-pendentes/route');
  const headers: Record<string, string> = {};
  if (segredo !== null) headers.authorization = `Bearer ${segredo}`;
  return GET(new Request('https://www.wappia.com.br/api/cron/responder-pendentes', { headers }));
}

/** Uma conversa com uma mensagem de cliente de `minutosAtras`, gravada direto
 *  no banco — o estado que o webhook deixa quando a resposta se perde. */
function semearConversa(opcoes: {
  telefone: string;
  minutosAtras: number;
  orgId?: string;
  waNumberId?: string | null;
  modo?: 'ia' | 'humano';
  comWamid?: boolean;
}): string {
  const orgId = opcoes.orgId ?? ORG_A;
  const contatoId = randomUUID();
  const conversaId = randomUUID();
  const quando = new Date(Date.now() - opcoes.minutosAtras * MINUTO).toISOString();
  banco.contacts.push({ id: contatoId, organization_id: orgId, nome: 'Cliente Parado', telefone: opcoes.telefone, origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: conversaId, organization_id: orgId, contact_id: contatoId, assunto: 'WhatsApp', status: 'aberta',
    modo: opcoes.modo ?? 'ia', atendente_id: null, wa_number_id: opcoes.waNumberId === undefined ? WA_NUMBER_A : opcoes.waNumberId,
    updated_at: quando,
  });
  banco.messages.push({
    id: randomUUID(), organization_id: orgId, conversation_id: conversaId, autor: 'cliente', texto: 'Oi, alguém?',
    read: false, wamid: opcoes.comWamid === false ? null : `wamid.${randomUUID()}`, created_at: quando,
  });
  return conversaId;
}

const autoresDa = (conversaId: string) =>
  banco.messages.filter(m => m.conversation_id === conversaId).map(m => m.autor);

const enviosPara = (telefone: string) =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { to?: string } | null)?.to === telefone);

describe('responde o que ficou sem resposta', () => {
  test('responde a mensagem que o worker derrubado deixou para trás', async () => {
    const { POST } = await import('@/app/api/webhooks/whatsapp/route');
    const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: '5511900000061', texto: 'Tem horário amanhã?' });
    await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
    tarefasPendentes = []; // o worker caiu antes de responder

    const conversa = banco.conversations.find(c => c.contact_id === banco.contacts.find(x => x.telefone === '5511900000061')?.id)!;
    const mensagem = banco.messages.find(m => m.conversation_id === conversa.id)!;
    mensagem.created_at = new Date(Date.now() - 5 * MINUTO).toISOString();

    await varrer();

    assert.deepEqual(autoresDa(conversa.id as string), ['cliente', 'ia']);
    assert.equal(enviosPara('5511900000061').length, 1, 'a resposta não foi enviada pelo WhatsApp');
  });

  test('a resposta sai pelo número por onde a conversa entrou', async () => {
    semearConversa({ telefone: '5511900000062', minutosAtras: 5 });
    await varrer();
    assert.ok(enviosPara('5511900000062')[0]?.url.includes(`/${NUMERO_A}/messages`));
  });

  test('conversa sem número carimbado usa o número da organização', async () => {
    semearConversa({ telefone: '5511900000063', minutosAtras: 5, orgId: ORG_B, waNumberId: null });
    await varrer();
    assert.ok(enviosPara('5511900000063')[0]?.url.includes(`/${NUMERO_B}/messages`));
  });

  test('rodar de novo não responde duas vezes', async () => {
    const conversaId = semearConversa({ telefone: '5511900000064', minutosAtras: 5 });
    await varrer();
    await varrer();
    assert.deepEqual(autoresDa(conversaId), ['cliente', 'ia']);
  });
});

describe('não fala quando não deve', () => {
  test('deixa em paz a mensagem com menos de 3 minutos, que o webhook ainda pode estar respondendo', async () => {
    const conversaId = semearConversa({ telefone: '5511900000071', minutosAtras: 1 });
    await varrer();
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });

  test('não responde mensagem de mais de 30 minutos', async () => {
    const conversaId = semearConversa({ telefone: '5511900000072', minutosAtras: 45 });
    await varrer();
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });

  test('não fala por cima de um atendente que assumiu a conversa', async () => {
    const conversaId = semearConversa({ telefone: '5511900000073', minutosAtras: 5, modo: 'humano' });
    await varrer();
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });

  test('ignora mensagem de cliente que não veio do WhatsApp (sem wamid)', async () => {
    const conversaId = semearConversa({ telefone: '5511900000074', minutosAtras: 5, comWamid: false });
    await varrer();
    assert.equal(enviosPara('5511900000074').length, 0, 'mandou WhatsApp para uma mensagem de semente');
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });

  test('quando o cliente acabou de escrever de novo, deixa a resposta para o webhook', async () => {
    const conversaId = semearConversa({ telefone: '5511900000075', minutosAtras: 10 });
    banco.messages.push({
      id: randomUUID(), organization_id: ORG_A, conversation_id: conversaId, autor: 'cliente', texto: 'e aí?',
      read: false, wamid: `wamid.${randomUUID()}`, created_at: new Date(Date.now() - 30 * 1000).toISOString(),
    });
    await varrer();
    assert.deepEqual(autoresDa(conversaId), ['cliente', 'cliente']);
  });

  test('para de pagar o modelo quando as tentativas pagas já falharam', async () => {
    const conversaId = semearConversa({ telefone: '5511900000076', minutosAtras: 10 });
    for (let i = 0; i < 4; i++) {
      banco.ai_usage.push({
        id: randomUUID(), organization_id: ORG_A, conversation_id: conversaId, origem: 'motor',
        created_at: new Date(Date.now() - (8 - i) * MINUTO).toISOString(),
      });
    }
    const chamadasAntes = http.chamadasAnthropic.length;
    await varrer();
    assert.equal(http.chamadasAnthropic.length, chamadasAntes);
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });

  test('sem o segredo do cron, 401 e nada roda', async () => {
    const conversaId = semearConversa({ telefone: '5511900000077', minutosAtras: 5 });
    const resposta = await varrer('segredo-errado');
    assert.equal(resposta.status, 401);
    assert.deepEqual(autoresDa(conversaId), ['cliente']);
  });
});

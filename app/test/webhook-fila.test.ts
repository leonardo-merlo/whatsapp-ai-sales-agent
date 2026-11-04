// Fase 4 (item A4): a fila entre o webhook e o motor.
//
// Hoje a chamada ao Claude acontece dentro do request que a Meta enviou, e a
// Meta reenvia se demorar. Com a fila, o webhook grava a mensagem e responde
// 200 na hora; a resposta é gerada depois, pelo `after()` do Next.
//
// O teste principal desta fase é o outro arquivo: com a chave desligada, tudo
// continua igual (os 31 testes das fases 1 a 3 rodam com ela desligada). Aqui
// fica o que só acontece com ela ligada.
//
// O `after()` do Next é substituído por uma fila em memória que o teste roda
// quando quer — é a única forma de provar que a resposta do webhook sai ANTES
// de o modelo ser chamado.

import { test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, NUMERO_B, ORG_A, ORG_B,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

let banco: Banco;
let http: HttpFalso;
/** O que o `after()` recebeu e ainda não rodou. */
let tarefasPendentes: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  // Ligada só para a org A. A org B fica de fora de propósito: é a prova de que
  // a chave é por organização, não global.
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
});

beforeEach(() => { tarefasPendentes = []; });

async function rodarFila() {
  const tarefas = tarefasPendentes;
  tarefasPendentes = [];
  for (const tarefa of tarefas) await tarefa();
}

async function enviar(phoneNumberId: string, telefone: string, texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId, telefone, texto });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

const mensagensDe = (telefone: string) => {
  const contato = banco.contacts.find(c => c.telefone === telefone);
  const conversa = banco.conversations.find(c => c.contact_id === contato?.id);
  return banco.messages.filter(m => m.conversation_id === conversa?.id);
};

test('com a fila ligada, o 200 sai antes de o modelo ser chamado', async () => {
  const chamadasAntes = http.chamadasAnthropic.length;

  const resposta = await enviar(NUMERO_A, '5511900000051', 'Bom dia!');
  assert.equal(resposta.status, 200);

  // Neste ponto a Meta já recebeu o 200 e não vai reenviar.
  assert.deepEqual(mensagensDe('5511900000051').map(m => m.autor), ['cliente'],
    'a resposta da IA foi gerada dentro do request — a fila não desviou nada');
  assert.equal(http.chamadasAnthropic.length, chamadasAntes, 'o modelo foi chamado dentro do request');
  assert.equal(tarefasPendentes.length, 1, 'nada foi agendado para depois da resposta');

  await rodarFila();

  assert.deepEqual(mensagensDe('5511900000051').map(m => m.autor), ['cliente', 'ia']);
  assert.equal(http.chamadasAnthropic.length, chamadasAntes + 1);
  assert.ok(http.chamadasWhatsApp.at(-1)!.url.includes(`/${NUMERO_A}/messages`));
});

test('derrubar o worker perde a resposta, não a mensagem do cliente', async () => {
  await enviar(NUMERO_A, '5511900000052', 'Alguém aí?');
  // A tarefa é jogada fora sem rodar — é o worker caindo.
  tarefasPendentes = [];

  const mensagens = mensagensDe('5511900000052');
  assert.deepEqual(mensagens.map(m => m.autor), ['cliente'],
    'a mensagem do cliente tem que estar gravada mesmo sem ninguém ter respondido');
  assert.equal(mensagens[0].texto, 'Alguém aí?');
});

// Até 2026-09-10 este teste esperava TRÊS respostas. Mudou por decisão do
// Leonardo (agrupamento de mensagens seguidas, dúvida 16 do progresso do bloco
// A): mensagens que chegam antes de a IA responder recebem uma resposta só.
test('três mensagens que chegam antes da resposta recebem uma resposta só, sem duplicata', async () => {
  await enviar(NUMERO_A, '5511900000053', 'primeira');
  await enviar(NUMERO_A, '5511900000053', 'segunda');
  await enviar(NUMERO_A, '5511900000053', 'terceira');

  assert.equal(tarefasPendentes.length, 3);
  await rodarFila();

  const autores = mensagensDe('5511900000053').map(m => m.autor);
  assert.deepEqual(autores, ['cliente', 'cliente', 'cliente', 'ia']);
  assert.equal(mensagensDe('5511900000053').filter(m => m.autor === 'cliente').map(m => m.texto).join('|'),
    'primeira|segunda|terceira');
});

test('a chave é por organização: a org de fora continua respondendo dentro do request', async () => {
  const chamadasAntes = http.chamadasAnthropic.length;

  const resposta = await enviar(NUMERO_B, '5511900000054', 'Oi, tem em estoque?');
  assert.equal(resposta.status, 200);

  assert.equal(tarefasPendentes.length, 0, 'a org B não está na lista e não devia usar a fila');
  assert.deepEqual(mensagensDe('5511900000054').map(m => m.autor), ['cliente', 'ia']);
  assert.equal(http.chamadasAnthropic.length, chamadasAntes + 1);
});

test('a chave lê a lista da variável de ambiente e nada mais', async () => {
  const { orgUsaFila } = await import('@/lib/agente/fila');

  delete process.env.WEBHOOK_FILA_ORGS;
  assert.equal(orgUsaFila(ORG_A), false, 'sem a variável, a fila tem que estar desligada para todos');

  process.env.WEBHOOK_FILA_ORGS = '';
  assert.equal(orgUsaFila(ORG_A), false);

  process.env.WEBHOOK_FILA_ORGS = ` ${ORG_B} , ${ORG_A} `;
  assert.equal(orgUsaFila(ORG_A), true, 'espaço em volta do id não podia derrubar a chave');
  assert.equal(orgUsaFila(ORG_B), true);
  assert.equal(orgUsaFila('11111111-0000-0000-0000-000000000000'), false);

  process.env.WEBHOOK_FILA_ORGS = '*';
  assert.equal(orgUsaFila('qualquer-org'), true, 'o curinga liga para todas');

  process.env.WEBHOOK_FILA_ORGS = ORG_A;
});

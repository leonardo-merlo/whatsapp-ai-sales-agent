// Fase 2 (item A0): a Meta reenvia o webhook quando demora a receber o 200, e
// o mesmo payload chega duas vezes. Sem o `wamid` gravado e sem índice único,
// isso vira mensagem repetida na conversa e — o que dói — uma SEGUNDA resposta
// da IA para o mesmo texto do cliente, cobrada em tokens e entregue no WhatsApp
// dele.
//
// O teste manda o mesmo payload assinado duas vezes e cobra: a primeira faz
// tudo, a segunda não faz nada e ainda responde 200 (responder erro faria a
// Meta reenviar de novo, em loop).

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const TELEFONE = '5511900000021';
const WAMID_REENVIADO = 'wamid.HBgNNTUxMTkwMDAwMDAyMRUCABIYFjNFQjA=';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

async function enviar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

const daOrgA = () => banco.messages.filter(m => m.organization_id === ORG_A);

test('o reenvio do mesmo payload não gera segunda mensagem nem segunda resposta', async () => {
  const corpo = payloadDeMensagem({
    phoneNumberId: NUMERO_A,
    telefone: TELEFONE,
    texto: 'Bom dia, queria um orçamento.',
    wamid: WAMID_REENVIADO,
  });

  const primeira = await enviar(corpo);
  assert.equal(primeira.status, 200);
  assert.deepEqual(daOrgA().map(m => m.autor), ['cliente', 'ia']);
  assert.equal(http.chamadasAnthropic.length, 1);
  assert.equal(http.chamadasWhatsApp.length, 1);

  // Byte a byte o mesmo corpo, como a Meta reenvia.
  const segunda = await enviar(corpo);
  assert.equal(segunda.status, 200, 'erro aqui faz a Meta reenviar de novo, em loop');

  assert.deepEqual(daOrgA().map(m => m.autor), ['cliente', 'ia'], 'a mensagem repetida entrou na conversa');
  assert.equal(http.chamadasAnthropic.length, 1, 'chamou o modelo de novo — resposta duplicada e token gasto à toa');
  assert.equal(http.chamadasWhatsApp.length, 1, 'o cliente recebeu duas respostas para a mesma mensagem');
});

test('o wamid da Meta fica gravado na mensagem do cliente', () => {
  const doCliente = daOrgA().find(m => m.autor === 'cliente');
  assert.equal(doCliente?.wamid, WAMID_REENVIADO);
});

test('mensagens que não vêm do WhatsApp ficam com wamid nulo e não colidem', () => {
  // O índice é parcial: sem isso, a segunda resposta da IA numa conversa
  // esbarraria na primeira e a IA ficaria muda depois da primeira mensagem.
  const semWamid = daOrgA().filter(m => m.autor !== 'cliente');
  assert.ok(semWamid.length > 0);
  for (const m of semWamid) assert.equal(m.wamid ?? null, null);
});

test('mensagem seguinte, com wamid diferente, é processada normalmente', async () => {
  const corpo = payloadDeMensagem({
    phoneNumberId: NUMERO_A,
    telefone: TELEFONE,
    texto: 'E vocês entregam?',
  });
  await enviar(corpo);

  assert.deepEqual(daOrgA().map(m => m.autor), ['cliente', 'ia', 'cliente', 'ia']);
  assert.equal(http.chamadasAnthropic.length, 2);
});

test('o mesmo wamid chegando para OUTRA org é processado — o índice é por organização', async () => {
  // Enquanto não existe índice único em phone_number_id (fase 3), duas orgs
  // podem acabar com o mesmo número. Um índice global no wamid faria a mensagem
  // da segunda org sumir sem aviso; por org, cada uma processa a sua.
  const { NUMERO_B, ORG_B } = await import('./apoio/cenario.mts');
  const corpo = payloadDeMensagem({
    phoneNumberId: NUMERO_B,
    telefone: TELEFONE,
    texto: 'Bom dia, queria um orçamento.',
    wamid: WAMID_REENVIADO,
  });
  await enviar(corpo);

  const daOrgB = banco.messages.filter(m => m.organization_id === ORG_B);
  assert.deepEqual(daOrgB.map(m => m.autor), ['cliente', 'ia']);
});

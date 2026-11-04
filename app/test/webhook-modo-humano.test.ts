// Teste 4 do A1: quando uma pessoa assume a conversa (`modo = 'humano'`), a IA
// cala a boca. É a garantia de que o atendente não é atropelado pelo robô no
// meio de um atendimento delicado — e é o mesmo interruptor que a transferência
// por gatilho aciona.
//
// O teste checa os dois lados: a mensagem do cliente CONTINUA sendo gravada
// (senão o atendente não vê o que o cliente escreveu), e nada mais acontece —
// nem chamada ao modelo, nem resposta gravada, nem envio pelo WhatsApp.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const CONTATO = 'aaaaaaaa-0000-4000-8000-000000000001';
const CONVERSA_HUMANO = 'bbbbbbbb-0000-4000-8000-000000000001';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Cliente Antigo', telefone: '5511900000009', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA_HUMANO,
    organization_id: ORG_A,
    contact_id: CONTATO,
    assunto: 'WhatsApp',
    status: 'aberta',
    modo: 'humano',
    atendente_id: null,
    updated_at: new Date().toISOString(),
  });

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

async function enviar(texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: '5511900000009', texto });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

test('em modo humano a mensagem do cliente é gravada e a IA não responde', async () => {
  const resposta = await enviar('Preciso falar com alguém de verdade, por favor.');
  assert.equal(resposta.status, 200);

  const mensagens = banco.messages.filter(m => m.conversation_id === CONVERSA_HUMANO);
  assert.equal(mensagens.length, 1, 'devia haver só a mensagem do cliente');
  assert.equal(mensagens[0].autor, 'cliente');
  assert.equal(mensagens[0].texto, 'Preciso falar com alguém de verdade, por favor.');

  assert.equal(http.chamadasAnthropic.length, 0, 'a IA foi chamada — e cada chamada dessas custa tokens');
  assert.equal(http.chamadasWhatsApp.length, 0, 'o robô respondeu por cima do atendente');
});

test('em modo humano não abre conversa nova nem muda o modo da existente', async () => {
  await enviar('Alguém aí?');

  const conversas = banco.conversations.filter(c => c.organization_id === ORG_A);
  assert.equal(conversas.length, 1, 'abriu conversa paralela');
  assert.equal(conversas[0].modo, 'humano', 'o modo voltou para ia sozinho');
  assert.equal(http.chamadasAnthropic.length, 0);
});

test('a mesma conversa em modo ia responde — o teste acima não passa por acidente', async () => {
  banco.conversations[0].modo = 'ia';
  await enviar('E agora, responde?');

  const respostas = banco.messages.filter(m => m.conversation_id === CONVERSA_HUMANO && m.autor === 'ia');
  assert.equal(respostas.length, 1);
  assert.equal(http.chamadasAnthropic.length, 1);
  assert.equal(http.chamadasWhatsApp.length, 1);
});

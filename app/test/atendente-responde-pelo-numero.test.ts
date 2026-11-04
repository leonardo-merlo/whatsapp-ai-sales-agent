// Fase 3, metade B: quando o atendente humano responde pelo painel, a mensagem
// sai pelo número por onde a conversa entrou — não por "o número da empresa".
//
// É o caminho mais fácil de errar dos dois: no webhook o número está ali no
// payload, mas aqui a única pista é o que ficou gravado em `conversations`.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const USUARIO = 'ffffffff-0000-4000-8000-000000000001';
const MEMBRO = 'eeeeeeee-0000-4000-8000-000000000009';
const CONTATO = 'aaaaaaaa-0000-4000-8000-000000000009';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDEDOR';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000000c';

const CONVERSA_DO_VENDEDOR = 'bbbbbbbb-0000-4000-8000-000000000009';
const CONVERSA_SEM_NUMERO = 'bbbbbbbb-0000-4000-8000-00000000000a';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 11 90000-0003', papel: 'vendedor', member_id: null, ativo: true,
  });
  banco.organization_members.push({
    id: MEMBRO, organization_id: ORG_A, user_id: USUARIO, role: 'admin', nome: 'Atendente', ativo: true,
  });
  banco.contacts.push({
    id: CONTATO, organization_id: ORG_A, nome: 'Cliente do João', telefone: '5511900000041', origem: 'whatsapp',
  });
  banco.conversations.push(
    {
      id: CONVERSA_DO_VENDEDOR, organization_id: ORG_A, contact_id: CONTATO,
      assunto: 'WhatsApp', status: 'aberta', modo: 'humano', atendente_id: null,
      wa_number_id: WA_NUMBER_VENDEDOR,
    },
    {
      id: CONVERSA_SEM_NUMERO, organization_id: ORG_A, contact_id: CONTATO,
      assunto: 'WhatsApp', status: 'aberta', modo: 'humano', atendente_id: null,
      wa_number_id: null,
    },
  );

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS, { id: USUARIO });
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => supabase.client } });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

async function responder(conversationId: string, texto: string) {
  const { POST } = await import('@/app/api/conversas/enviar/route');
  return POST(new Request('https://www.wappia.com.br/api/conversas/enviar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId, texto }),
  }));
}

test('a resposta do atendente sai pelo número da conversa, não pelo da empresa', async () => {
  const resposta = await responder(CONVERSA_DO_VENDEDOR, 'Oi! Já preparei seu orçamento.');
  assert.equal(resposta.status, 200);

  const envio = http.chamadasWhatsApp.at(-1);
  assert.ok(envio, 'nada foi enviado');
  assert.ok(envio.url.includes(`/${NUMERO_VENDEDOR}/messages`),
    `saiu por ${envio.url} — o cliente recebeu resposta por um número que ele nunca procurou`);
  assert.equal((envio.corpo as { to: string }).to, '5511900000041');

  const gravada = banco.messages.filter(m => m.conversation_id === CONVERSA_DO_VENDEDOR);
  assert.equal(gravada.length, 1);
  assert.equal(gravada[0].autor, 'humano');
});

test('conversa sem número gravado cai no comportamento antigo: o número da organização', async () => {
  const resposta = await responder(CONVERSA_SEM_NUMERO, 'Oi, tudo bem?');
  assert.equal(resposta.status, 200);

  const envio = http.chamadasWhatsApp.at(-1);
  assert.ok(envio!.url.includes(`/${NUMERO_A}/messages`), `saiu por ${envio!.url}`);
});

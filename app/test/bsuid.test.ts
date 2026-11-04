// BSUID: o cliente que escreve sem que a Meta mande o telefone.
//
// Com os nomes de usuário do WhatsApp, o webhook pode chegar só com o BSUID
// (`from_user_id` / `contacts[].user_id`): cliente com nome de usuário que não
// falou com aquele número da empresa nos últimos 30 dias. Antes, o webhook
// descartava essa mensagem sem aviso. Aqui fica provado que ela é atendida, que
// a resposta volta pelo BSUID, e que quem tem telefone continua igual.

import { describe, test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, requisicaoDoWebhook, SEGREDO_DO_APP } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const USUARIO = 'ffffffff-0000-4000-8000-0000000000b1';
const MEMBRO = 'eeeeeeee-0000-4000-8000-0000000000b1';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.organization_members.push({ id: MEMBRO, organization_id: ORG_A, user_id: USUARIO, role: 'admin', nome: 'Atendente', ativo: true });
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS, { id: USUARIO });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

/** Mensagem de texto com o que a Meta mandar de identidade: telefone, BSUID, os dois ou nenhum. */
function payload(quem: { telefone?: string; bsuid?: string; nome?: string; usuario?: string }, texto: string): string {
  const profile: Record<string, string> = {};
  if (quem.nome) profile.name = quem.nome;
  if (quem.usuario) profile.username = quem.usuario;
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA-ID', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5511999999999', phone_number_id: NUMERO_A },
      contacts: [{ profile, ...(quem.telefone ? { wa_id: quem.telefone } : {}), ...(quem.bsuid ? { user_id: quem.bsuid } : {}) }],
      messages: [{
        ...(quem.telefone ? { from: quem.telefone } : {}), ...(quem.bsuid ? { from_user_id: quem.bsuid } : {}),
        id: `wamid.${randomUUID()}`, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto },
      }],
    } }] }],
  });
}

async function postar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

const contatosCom = (filtro: (c: Record<string, unknown>) => boolean) => banco.contacts.filter(filtro);
const mensagensDoContato = (contatoId: unknown) => {
  const conversa = banco.conversations.find(c => c.contact_id === contatoId);
  return banco.messages.filter(m => m.conversation_id === conversa?.id);
};
const ultimoEnvio = () => http.chamadasWhatsApp.at(-1)?.corpo as { to?: string; recipient?: string } | undefined;

describe('cliente sem telefone, só com BSUID', () => {
  test('a mensagem não some: vira contato, conversa e resposta da IA', async () => {
    await postar(payload({ bsuid: 'BR.1000000000000000001', nome: 'Marina' }, 'Oi, vocês abrem sábado?'));
    const [contato] = contatosCom(c => c.wa_user_id === 'BR.1000000000000000001');
    assert.equal(contato?.telefone, null);
    assert.deepEqual(mensagensDoContato(contato?.id).map(m => m.autor), ['cliente', 'ia']);
  });

  test('a resposta volta pelo BSUID, no campo recipient', async () => {
    await postar(payload({ bsuid: 'BR.1000000000000000002' }, 'Bom dia'));
    assert.equal(ultimoEnvio()?.recipient, 'BR.1000000000000000002');
    assert.equal('to' in (ultimoEnvio() ?? {}), false, 'mandou um to vazio junto');
  });

  test('o nome de usuário vira o nome do contato quando não vem nome de perfil', async () => {
    await postar(payload({ bsuid: 'BR.1000000000000000003', usuario: 'joao.obras' }, 'Oi'));
    const [contato] = contatosCom(c => c.wa_user_id === 'BR.1000000000000000003');
    assert.deepEqual([contato?.nome, contato?.wa_username], ['joao.obras', 'joao.obras']);
  });

  test('quem escreveu só com BSUID e depois aparece com telefone continua sendo um contato só', async () => {
    await postar(payload({ bsuid: 'BR.1000000000000000004', nome: 'Paulo' }, 'primeira'));
    await postar(payload({ bsuid: 'BR.1000000000000000004', telefone: '5511900000201', nome: 'Paulo' }, 'segunda'));
    const doBsuid = contatosCom(c => c.wa_user_id === 'BR.1000000000000000004');
    assert.equal(doBsuid.length, 1);
    assert.equal(doBsuid[0].telefone, '5511900000201');
    assert.deepEqual(mensagensDoContato(doBsuid[0].id).filter(m => m.autor === 'cliente').map(m => m.texto), ['primeira', 'segunda']);
  });

  test('sem telefone e sem BSUID, a mensagem é ignorada e a Meta recebe 200 mesmo assim', async () => {
    const antes = banco.contacts.length;
    const resposta = await postar(payload({ nome: 'Ninguém' }, 'oi'));
    assert.equal(resposta.status, 200);
    assert.equal(banco.contacts.length, antes);
  });
});

describe('cliente com telefone continua igual', () => {
  test('a resposta vai pelo telefone (to), mesmo quando o BSUID vem junto', async () => {
    await postar(payload({ telefone: '5511900000202', bsuid: 'BR.1000000000000000005' }, 'Oi'));
    assert.equal(ultimoEnvio()?.to, '5511900000202');
    assert.equal('recipient' in (ultimoEnvio() ?? {}), false);
  });

  test('o contato que já existia pelo telefone ganha o BSUID, sem duplicar', async () => {
    banco.contacts.push({ id: randomUUID(), organization_id: ORG_A, nome: 'Cliente Antigo', telefone: '5511900000203', origem: 'manual', perfil: null });
    await postar(payload({ telefone: '5511900000203', bsuid: 'BR.1000000000000000006' }, 'Oi de novo'));
    const doTelefone = contatosCom(c => c.telefone === '5511900000203');
    assert.equal(doTelefone.length, 1);
    assert.equal(doTelefone[0].wa_user_id, 'BR.1000000000000000006');
  });

  test('um webhook sem telefone não apaga o telefone de quem já tem', async () => {
    banco.contacts.push({
      id: randomUUID(), organization_id: ORG_A, nome: 'Cliente Conhecido', telefone: '5511900000204',
      wa_user_id: 'BR.1000000000000000007', origem: 'whatsapp', perfil: null,
    });
    await postar(payload({ bsuid: 'BR.1000000000000000007' }, 'voltei'));
    const [contato] = contatosCom(c => c.wa_user_id === 'BR.1000000000000000007');
    assert.equal(contato.telefone, '5511900000204');
    assert.equal(ultimoEnvio()?.to, '5511900000204', 'tendo telefone, a resposta devia sair por ele');
  });
});

test('o atendente consegue responder um contato que só tem BSUID', async () => {
  await postar(payload({ bsuid: 'BR.1000000000000000008', nome: 'Carla' }, 'Quero falar com alguém'));
  const [contato] = contatosCom(c => c.wa_user_id === 'BR.1000000000000000008');
  const conversa = banco.conversations.find(c => c.contact_id === contato.id)!;
  conversa.modo = 'humano';

  const { POST } = await import('@/app/api/conversas/enviar/route');
  const resposta = await POST(new Request('https://www.wappia.com.br/api/conversas/enviar', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ conversationId: conversa.id, texto: 'Oi Carla, aqui é a atendente.' }),
  }));
  assert.equal(resposta.status, 200);
  assert.equal(ultimoEnvio()?.recipient, 'BR.1000000000000000008');
});

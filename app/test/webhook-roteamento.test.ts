// Teste 2 do A1: a mensagem cai na organização dona do `phone_number_id` do
// payload, e só nela, criando contato e conversa. É a única autorização que
// este endpoint tem — o `organization_id` nunca vem de fora. Se o roteamento
// escorregar, uma org lê a conversa de outra.
//
// O caminho roda inteiro, do POST até o envio pela Graph API, com as duas APIs
// externas interceptadas no limite HTTP.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, NUMERO_B, ORG_A, ORG_B,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco, type Linha } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso([
    { json: respostaDaIa('Oi! Aqui é a Clínica A, como posso ajudar?') },
    { json: respostaDaIa('Oi! Aqui é a Loja B.') },
  ]);
});

after(() => http.restaurar());

function respostaDaIa(texto: string) {
  return {
    resposta: texto,
    transferir_para_atendente: false,
    questionario_completo: false,
    respostas: [],
    resultado: 'nenhum',
    itens_vendidos: [],
    agendamento_data: '',
    agendamento_hora: '',
    agendamento_servico: '',
    agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  };
}

async function enviar(phoneNumberId: string, telefone: string, texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId, telefone, texto });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

const daOrg = (linhas: Linha[], orgId: string) => linhas.filter(l => l.organization_id === orgId);

test('a mensagem cria contato e conversa na org dona do número, e só nela', async () => {
  const resposta = await enviar(NUMERO_A, '5511900000001', 'Bom dia, vocês atendem hoje?');
  assert.equal(resposta.status, 200);

  const contatos = daOrg(banco.contacts, ORG_A);
  assert.equal(contatos.length, 1, 'devia existir exatamente 1 contato na org A');
  assert.equal(contatos[0].telefone, '5511900000001');

  const conversas = daOrg(banco.conversations, ORG_A);
  assert.equal(conversas.length, 1);
  assert.equal(conversas[0].contact_id, contatos[0].id);
  assert.equal(conversas[0].status, 'aberta');
  assert.equal(conversas[0].modo, 'ia');

  const mensagens = daOrg(banco.messages, ORG_A);
  assert.deepEqual(mensagens.map(m => m.autor), ['cliente', 'ia']);
  assert.equal(mensagens[0].texto, 'Bom dia, vocês atendem hoje?');
  assert.equal(mensagens[1].texto, 'Oi! Aqui é a Clínica A, como posso ajudar?');

  assert.equal(daOrg(banco.contacts, ORG_B).length, 0, 'a org B não podia ter recebido nada');
  assert.equal(daOrg(banco.conversations, ORG_B).length, 0);
  assert.equal(daOrg(banco.messages, ORG_B).length, 0);
});

test('a resposta sai pelo número que recebeu a mensagem', async () => {
  const envio = http.chamadasWhatsApp.at(-1);
  assert.ok(envio, 'nenhum envio pela Graph API');
  assert.ok(envio.url.includes(`/${NUMERO_A}/messages`), `envio saiu por ${envio.url}`);
  assert.equal((envio.corpo as { to: string }).to, '5511900000001');
  assert.equal((envio.corpo as { text: { body: string } }).text.body, 'Oi! Aqui é a Clínica A, como posso ajudar?');
});

test('o mesmo telefone falando com a outra org abre um contato separado', async () => {
  const resposta = await enviar(NUMERO_B, '5511900000001', 'Oi, tem em estoque?');
  assert.equal(resposta.status, 200);

  assert.equal(daOrg(banco.contacts, ORG_A).length, 1, 'a org A não podia ganhar contato novo');
  const contatosB = daOrg(banco.contacts, ORG_B);
  assert.equal(contatosB.length, 1);
  assert.equal(contatosB[0].telefone, '5511900000001');
  assert.equal(daOrg(banco.conversations, ORG_B).length, 1);
});

test('número desconhecido não cria nada e ainda responde 200', async () => {
  const antes = {
    contatos: banco.contacts.length,
    conversas: banco.conversations.length,
    mensagens: banco.messages.length,
  };
  const resposta = await enviar('PHONE-NUMBER-ID-QUE-NAO-EXISTE', '5511900000002', 'oi');
  assert.equal(resposta.status, 200, 'responder != 200 faz a Meta reenviar em loop');
  assert.equal(banco.contacts.length, antes.contatos);
  assert.equal(banco.conversations.length, antes.conversas);
  assert.equal(banco.messages.length, antes.mensagens);
});

test('a segunda mensagem do mesmo contato continua na mesma conversa', async () => {
  const conversasAntes = daOrg(banco.conversations, ORG_A).length;
  await enviar(NUMERO_A, '5511900000001', 'e quanto custa?');

  assert.equal(daOrg(banco.conversations, ORG_A).length, conversasAntes, 'abriu conversa nova em vez de continuar');
  assert.equal(daOrg(banco.contacts, ORG_A).length, 1, 'duplicou o contato');
  assert.equal(daOrg(banco.messages, ORG_A).filter(m => m.autor === 'cliente').length, 2);
});

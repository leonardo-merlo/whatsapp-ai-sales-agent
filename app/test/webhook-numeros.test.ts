// Fase 3 (itens A2 e A2b): a empresa deixa de ter UM número.
//
// O erro que estes testes existem para impedir tem nome: o cliente escreve para
// o vendedor João e recebe a resposta pelo número do Pedro. Ele acontece quando
// o número de saída é deduzido pela organização — que é como o código fazia
// antes desta fase, porque só havia uma resposta possível.
//
// Cobre as duas metades: a tabela `wa_numbers` roteando a entrada (com a coluna
// antiga como reserva) e o número de saída passado explicitamente.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, WA_NUMBER_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco, type Linha } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

// Segundo número da MESMA organização: o vendedor.
const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDEDOR';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000000c';
const MEMBRO_VENDEDOR = 'eeeeeeee-0000-4000-8000-000000000001';

// Número desligado, e número de uma org que ainda não passou pelo backfill.
const NUMERO_DESLIGADO = 'PHONE-NUMBER-ID-DESLIGADO';
const ORG_SO_NA_COLUNA_ANTIGA = '33333333-3333-4333-8333-333333333333';
const NUMERO_SO_NA_COLUNA_ANTIGA = 'PHONE-NUMBER-ID-LEGADO';

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.organization_members.push({
    id: MEMBRO_VENDEDOR, organization_id: ORG_A, user_id: null, role: 'atendente',
    nome: 'João Vendedor', codigo_erp: 'V-001', telefone_whatsapp: '5511988887777', ativo: true,
  });
  banco.wa_numbers.push(
    { id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR, telefone: '+55 11 90000-0003', papel: 'vendedor', member_id: MEMBRO_VENDEDOR, ativo: true },
    { id: 'dddddddd-0000-4000-8000-00000000000d', organization_id: ORG_A, phone_number_id: NUMERO_DESLIGADO, telefone: null, papel: 'vendedor', member_id: null, ativo: false },
  );
  // Org que existe só com a coluna antiga preenchida, sem linha em wa_numbers:
  // é o estado de quem ainda não passou pelo backfill.
  banco.organizations.push({
    id: ORG_SO_NA_COLUNA_ANTIGA, nome: 'Padaria Legado', nome_fantasia: 'Padaria Legado',
    descricao: null, endereco: null, telefone: null, wa_phone_number_id: NUMERO_SO_NA_COLUNA_ANTIGA,
  });
  banco.ai_agent_config.push({
    id: 'cfg-legado', organization_id: ORG_SO_NA_COLUNA_ANTIGA, ativo: true,
    prompt: 'Você é o atendente da Padaria Legado.', tom: 'simpatico',
    limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: null, roteiro: 'atendimento',
  });

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

async function enviar(phoneNumberId: string, telefone: string, texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId, telefone, texto });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

const conversaDe = (telefone: string): Linha => {
  const contato = banco.contacts.find(c => c.telefone === telefone);
  const conversa = banco.conversations.find(c => c.contact_id === contato?.id);
  assert.ok(conversa, `sem conversa para ${telefone}`);
  return conversa;
};

test('a conversa guarda por qual número ela entrou', async () => {
  await enviar(NUMERO_A, '5511900000031', 'Bom dia!');
  assert.equal(conversaDe('5511900000031').wa_number_id, WA_NUMBER_A);
  assert.equal(conversaDe('5511900000031').organization_id, ORG_A);
});

test('dois números da mesma empresa: cada cliente recebe pelo número que ele procurou', async () => {
  await enviar(NUMERO_VENDEDOR, '5511900000032', 'Oi João, preciso de um orçamento.');

  const conversa = conversaDe('5511900000032');
  assert.equal(conversa.organization_id, ORG_A, 'o número do vendedor é da mesma empresa');
  assert.equal(conversa.wa_number_id, WA_NUMBER_VENDEDOR);

  const envios = http.chamadasWhatsApp;
  assert.ok(envios.at(-1)!.url.includes(`/${NUMERO_VENDEDOR}/messages`),
    `a resposta saiu por ${envios.at(-1)!.url} — o cliente do vendedor recebeu pelo número errado`);
  assert.equal((envios.at(-1)!.corpo as { to: string }).to, '5511900000032');

  // E o primeiro cliente, do número de atendimento, continua no número dele.
  assert.ok(envios.at(-2)!.url.includes(`/${NUMERO_A}/messages`));
});

test('número desligado não roteia mensagem nenhuma', async () => {
  const antes = banco.messages.length;
  const resposta = await enviar(NUMERO_DESLIGADO, '5511900000033', 'oi');
  assert.equal(resposta.status, 200);
  assert.equal(banco.messages.length, antes, 'número com ativo=false não podia atender');
});

test('reserva: org que só tem a coluna antiga continua atendendo', async () => {
  await enviar(NUMERO_SO_NA_COLUNA_ANTIGA, '5511900000034', 'Tem pão?');

  const conversa = conversaDe('5511900000034');
  assert.equal(conversa.organization_id, ORG_SO_NA_COLUNA_ANTIGA);
  assert.equal(conversa.wa_number_id ?? null, null, 'sem linha em wa_numbers, o número da conversa fica vazio');
  // Sem número explícito, o envio cai no comportamento antigo: o da organização.
  assert.ok(http.chamadasWhatsApp.at(-1)!.url.includes(`/${NUMERO_SO_NA_COLUNA_ANTIGA}/messages`));
});

test('conversa aberta antes da migration é carimbada com o número na mensagem seguinte', async () => {
  const conversaAntiga = {
    id: 'bbbbbbbb-0000-4000-8000-0000000000aa',
    organization_id: ORG_A,
    contact_id: 'aaaaaaaa-0000-4000-8000-0000000000aa',
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
    wa_number_id: null,
    updated_at: new Date().toISOString(),
  };
  banco.contacts.push({ id: conversaAntiga.contact_id, organization_id: ORG_A, nome: 'Cliente Antigo', telefone: '5511900000035', origem: 'whatsapp', perfil: null });
  banco.conversations.push(conversaAntiga);

  await enviar(NUMERO_A, '5511900000035', 'voltei');

  assert.equal(conversaAntiga.wa_number_id, WA_NUMBER_A);
  assert.equal(banco.conversations.filter(c => c.contact_id === conversaAntiga.contact_id).length, 1,
    'carimbar não podia abrir conversa nova');
});

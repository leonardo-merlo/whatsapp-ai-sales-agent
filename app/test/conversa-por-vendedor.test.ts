// Decisão do Leonardo em 2026-09-10: quando o mesmo cliente conversa com dois
// vendedores ao mesmo tempo, a IA de cada vendedor só enxerga o que aconteceu
// NAQUELA conversa. Nada do que o cliente disse ao Pedro pode chegar à IA do
// João — nem as mensagens, nem os resumos, nem a ficha do cliente.
//
// Os testes olham o corpo da requisição que vai para a Anthropic: é ali, e só
// ali, que dá para provar o que a IA leu.

import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';

const NUMERO_JOAO = 'PHONE-NUMBER-ID-JOAO';
const NUMERO_PEDRO = 'PHONE-NUMBER-ID-PEDRO';
const WA_JOAO = 'dddddddd-0000-4000-8000-0000000000f1';
const WA_PEDRO = 'dddddddd-0000-4000-8000-0000000000f2';

const CLIENTE = '5511900000071';
const CONTATO = 'aaaaaaaa-0000-4000-8000-000000000071';

let banco: Banco;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.wa_numbers.push(
    { id: WA_JOAO, organization_id: ORG_A, phone_number_id: NUMERO_JOAO, telefone: null, papel: 'vendedor', member_id: null, ativo: true },
    { id: WA_PEDRO, organization_id: ORG_A, phone_number_id: NUMERO_PEDRO, telefone: null, papel: 'vendedor', member_id: null, ativo: true },
  );
  // O cliente já existe, com ficha e com dois resumos: um de uma conversa com
  // o Pedro e um antigo, de antes da separação por número.
  banco.contacts.push({
    id: CONTATO, organization_id: ORG_A, nome: 'Construtora Silva', telefone: CLIENTE, origem: 'whatsapp',
    perfil: {
      preferencias: ['entrega pela manhã'],
      dadosChave: [{ rotulo: 'CNPJ', valor: '12.345.678/0001-90' }],
      ultimoInteresse: 'vergalhão CA-50 com o Pedro',
      observacoes: '',
      atualizadoEm: null,
    },
  });
  banco.contact_history.push(
    { id: 'h-pedro', organization_id: ORG_A, contact_id: CONTATO, canal: 'IA', resumo: 'RESUMO-DA-CONVERSA-COM-O-PEDRO', data: '2026-09-09T12:00:00Z', wa_number_id: WA_PEDRO },
    { id: 'h-antigo', organization_id: ORG_A, contact_id: CONTATO, canal: 'IA', resumo: 'RESUMO-ANTIGO-SEM-NUMERO', data: '2026-08-01T12:00:00Z', wa_number_id: null },
  );

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

/** Manda a mensagem pelo webhook e devolve o que a IA recebeu (system + histórico). */
async function enviarELerOQueAIaViu(phoneNumberId: string, texto: string, respostas: RespostaAnthropic[] = []) {
  const http = instalarHttpFalso(respostas);
  try {
    const { POST } = await import('@/app/api/webhooks/whatsapp/route');
    const corpo = payloadDeMensagem({ phoneNumberId, telefone: CLIENTE, texto });
    const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
    assert.equal(resposta.status, 200);
    const chamada = http.chamadasAnthropic.at(-1);
    assert.ok(chamada, 'a IA não foi chamada');
    const { system, messages } = chamada.corpo as { system: string; messages: { content: string }[] };
    return { system, historico: messages.map(m => m.content).join('\n') };
  } finally {
    http.restaurar();
  }
}

const conversasDoCliente = () => banco.conversations.filter(c => c.contact_id === CONTATO);

test('o mesmo cliente falando com dois vendedores tem duas conversas, uma em cada número', async () => {
  await enviarELerOQueAIaViu(NUMERO_JOAO, 'João, quero 2 toneladas de perfil U.');
  await enviarELerOQueAIaViu(NUMERO_PEDRO, 'Pedro, e aquele vergalhão?');

  const conversas = conversasDoCliente();
  assert.equal(conversas.length, 2, 'as duas conversas foram juntadas numa só');
  assert.deepEqual(conversas.map(c => c.wa_number_id).sort(), [WA_JOAO, WA_PEDRO].sort());
});

test('a IA do João não lê as mensagens que o cliente mandou ao Pedro', async () => {
  const { historico } = await enviarELerOQueAIaViu(NUMERO_JOAO, 'E o prazo de entrega?');
  assert.match(historico, /perfil U/, 'a IA do João perdeu a própria conversa');
  assert.match(historico, /prazo de entrega/);
  assert.doesNotMatch(historico, /vergalhão/, 'a mensagem ao Pedro vazou para a IA do João');
});

test('e a do Pedro não lê as do João', async () => {
  const { historico } = await enviarELerOQueAIaViu(NUMERO_PEDRO, 'Pode ser CA-50.');
  assert.match(historico, /vergalhão/);
  assert.doesNotMatch(historico, /perfil U|prazo de entrega/, 'a conversa com o João vazou para a IA do Pedro');
});

test('o resumo de uma conversa com o Pedro não aparece para a IA do João', async () => {
  const { system } = await enviarELerOQueAIaViu(NUMERO_JOAO, 'Obrigado!');
  assert.doesNotMatch(system, /RESUMO-DA-CONVERSA-COM-O-PEDRO/, 'o resumo do Pedro vazou para a IA do João');
  // O resumo antigo, de antes da separação, continua valendo para todos.
  assert.match(system, /RESUMO-ANTIGO-SEM-NUMERO/);
});

test('no número de vendedor a ficha do cliente não entra no prompt', async () => {
  const { system } = await enviarELerOQueAIaViu(NUMERO_JOAO, 'Até mais.');
  assert.doesNotMatch(system, /Perfil do cliente:/);
  assert.doesNotMatch(system, /vergalhão CA-50 com o Pedro/, 'o último interesse do cliente com o Pedro vazou para a IA do João');
  // O nome não é segredo de ninguém: a IA continua sabendo com quem fala.
  assert.match(system, /Construtora Silva/);
});

test('no número de atendimento da empresa a ficha continua entrando — o Wappia Atendimento não muda', async () => {
  const { system } = await enviarELerOQueAIaViu(NUMERO_A, 'Bom dia, vocês abrem sábado?');
  assert.match(system, /Perfil do cliente:/);
  assert.match(system, /entrega pela manhã/);
});

test('esconder a ficha do prompt não apaga o que ela já sabia', async () => {
  // A IA do João descobre uma preferência nova. O merge da ficha precisa
  // somar, não substituir — mesmo com a ficha fora do prompt deste número.
  await enviarELerOQueAIaViu(NUMERO_JOAO, 'Prefiro boleto.', [{
    json: {
      resposta: 'Anotado!', transferir_para_atendente: false, questionario_completo: false, respostas: [],
      resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '', agendamento_servico: '',
      agendamento_remarcacao: false,
      atualizacao_perfil: { preferencias: ['pagamento por boleto'], dados_chave: [], ultimo_interesse: '', observacoes: '' },
    },
  }]);

  const perfil = banco.contacts.find(c => c.id === CONTATO)?.perfil as { preferencias: string[]; dadosChave: { rotulo: string }[] };
  assert.ok(perfil.preferencias.includes('pagamento por boleto'), 'a preferência nova não foi gravada');
  assert.ok(perfil.preferencias.includes('entrega pela manhã'), 'a preferência antiga foi apagada');
  assert.equal(perfil.dadosChave[0]?.rotulo, 'CNPJ', 'o CNPJ sumiu da ficha');
});

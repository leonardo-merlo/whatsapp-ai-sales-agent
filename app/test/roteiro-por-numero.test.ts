// Fase 5 (item A3): o roteiro deixa de ser um por empresa.
//
// `ai_agent_config` tinha `UNIQUE (organization_id)`. Agora a linha com
// `wa_number_id` nulo é a da empresa toda e cada número pode ter a sua. A regra
// que estes testes cobrem: **o número manda quando tem linha própria; senão
// vale a da empresa** — que é, palavra por palavra, o comportamento de hoje.

import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, WA_NUMBER_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { ehDoSerializador, instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDEDOR';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000000c';
const NUMERO_DESLIGADO_NO_ROTEIRO = 'PHONE-NUMBER-ID-ROTEIRO-INATIVO';
const WA_NUMBER_ROTEIRO_INATIVO = 'dddddddd-0000-4000-8000-00000000000e';

const PROMPT_DA_EMPRESA = 'Você é o atendente virtual da Clínica A.';
const PROMPT_DO_VENDEDOR = 'Você é o assistente do vendedor João e nunca fecha negócio sozinho.';

let banco: Banco;
let http: HttpFalso;
let supabaseClient: unknown;
// **Mudou em 2026-09-13 (C6):** número com roteiro 'vendas' passou a usar a
// fila SEMPRE, porque uma resposta de vendas soma chamadas ao sistema do
// cliente e não cabe no tempo que a Meta espera antes de reenviar o webhook.
// Nenhuma asserção deste arquivo mudou — o que mudou foi o andaime: o teste
// precisa rodar o que o `after()` adiou antes de conferir o resultado.
const tarefasPendentes: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';

  banco = cenarioBase();
  banco.wa_numbers.push(
    { id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR, telefone: null, papel: 'vendedor', member_id: null, ativo: true },
    { id: WA_NUMBER_ROTEIRO_INATIVO, organization_id: ORG_A, phone_number_id: NUMERO_DESLIGADO_NO_ROTEIRO, telefone: null, papel: 'vendedor', member_id: null, ativo: true },
  );
  // Roteiro próprio do número do vendedor: prompt diferente e roteiro 'vendas'.
  banco.ai_agent_config.push({
    id: 'cfg-vendedor', organization_id: ORG_A, wa_number_id: WA_NUMBER_VENDEDOR,
    ativo: true, roteiro: 'vendas', prompt: PROMPT_DO_VENDEDOR, tom: 'direto',
    limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
  });
  // Número com roteiro próprio DESLIGADO, enquanto o da empresa está ligado.
  banco.ai_agent_config.push({
    id: 'cfg-inativo', organization_id: ORG_A, wa_number_id: WA_NUMBER_ROTEIRO_INATIVO,
    ativo: false, roteiro: 'vendas', prompt: 'não deveria ser usado', tom: 'direto',
    limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
  });

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
  http = instalarHttpFalso();
});

after(() => http.restaurar());

async function enviar(phoneNumberId: string, telefone: string, texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId, telefone, texto });
  const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  // O número de atendimento responde dentro do request (nada é adiado); o de
  // vendas responde pela fila. Drenar aqui deixa os dois caminhos com o mesmo
  // resultado observável, que é o que as asserções abaixo conferem.
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  return resposta;
}

// A última requisição DA CONVERSA: com as duas fases ligadas, a última de todas
// num número de vendas é o serializador, que não leva o roteiro (ver
// `interruptor-duas-fases.ts`). Mudança de 27/09, autorizada pelo Leonardo para
// os testes que leem a última requisição.
const ultimoSystemPrompt = () => String(
  (http.chamadasAnthropic.filter(c => !ehDoSerializador(c)).at(-1)?.corpo as { system?: string })?.system ?? '',
);

test('o número sem roteiro próprio usa o da empresa — o comportamento de hoje', async () => {
  await enviar(NUMERO_A, '5511900000061', 'Bom dia!');
  assert.ok(ultimoSystemPrompt().includes(PROMPT_DA_EMPRESA), 'o prompt da empresa não entrou');
  assert.ok(!ultimoSystemPrompt().includes(PROMPT_DO_VENDEDOR));
});

test('o número com roteiro próprio usa o dele, não o da empresa', async () => {
  await enviar(NUMERO_VENDEDOR, '5511900000062', 'Preciso de um orçamento.');
  const prompt = ultimoSystemPrompt();
  assert.ok(prompt.includes(PROMPT_DO_VENDEDOR), 'o roteiro do número do vendedor não entrou');
  assert.ok(!prompt.includes(PROMPT_DA_EMPRESA), 'o prompt da empresa vazou para o número do vendedor');
});

test('o roteiro do número não muda o da empresa: o outro número continua igual', async () => {
  await enviar(NUMERO_A, '5511900000063', 'Vocês atendem sábado?');
  assert.ok(ultimoSystemPrompt().includes(PROMPT_DA_EMPRESA));
  assert.ok(!ultimoSystemPrompt().includes(PROMPT_DO_VENDEDOR));
});

test('roteiro do número desligado cala a IA naquele número, e só nele', async () => {
  const chamadasAntes = http.chamadasAnthropic.length;
  await enviar(NUMERO_DESLIGADO_NO_ROTEIRO, '5511900000064', 'oi');

  assert.equal(http.chamadasAnthropic.length, chamadasAntes,
    'o número tem roteiro próprio desligado — a IA não podia responder');
  const contato = banco.contacts.find(c => c.telefone === '5511900000064');
  const conversa = banco.conversations.find(c => c.contact_id === contato?.id);
  assert.deepEqual(
    banco.messages.filter(m => m.conversation_id === conversa?.id).map(m => m.autor),
    ['cliente'],
    'a mensagem do cliente continua sendo gravada, mesmo com a IA calada',
  );

  // E o número de atendimento da mesma empresa segue respondendo.
  await enviar(NUMERO_A, '5511900000065', 'e vocês entregam?');
  assert.equal(http.chamadasAnthropic.length, chamadasAntes + 1);
});

test('sem número, a resolução cai na configuração da empresa — é o caso do simulador', async () => {
  const { buscarConfigDoAgente } = await import('@/lib/agente/config-do-numero');

  const semNumero = await buscarConfigDoAgente(supabaseClient as never, ORG_A, null);
  assert.equal(semNumero?.prompt, PROMPT_DA_EMPRESA);
  assert.equal(semNumero?.wa_number_id ?? null, null);

  const comNumeroSemRoteiro = await buscarConfigDoAgente(supabaseClient as never, ORG_A, WA_NUMBER_A);
  assert.equal(comNumeroSemRoteiro?.prompt, PROMPT_DA_EMPRESA, 'número sem roteiro próprio tinha que cair no da empresa');

  const comRoteiro = await buscarConfigDoAgente(supabaseClient as never, ORG_A, WA_NUMBER_VENDEDOR);
  assert.equal(comRoteiro?.prompt, PROMPT_DO_VENDEDOR);
  assert.equal(comRoteiro?.roteiro, 'vendas');
});

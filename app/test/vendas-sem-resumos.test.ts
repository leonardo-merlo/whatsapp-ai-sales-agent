// O resumo do atendimento anterior não entra no prompt de quem vai só até o
// cadastro (Distribuidora Exemplo).
//
// O caso: em 21/09, 11:26, o cliente escreveu "quero um orçamento" e a IA
// perguntou "qual produto?", em vez de pedir o CPF/CNPJ como a instrução do
// painel manda. A bancada `test/bancada/primeira-resposta-vendas.mts` isolou a
// causa: o resumo da conversa da manhã ("solicitou dois orçamentos... vendedor
// deveria retornar com valores") estava no prompt. Com ele, 4 de 6 respostas
// saíram erradas; sem ele, 11 de 11 saíram certas. Numa empresa em que cada
// orçamento começa pelo documento, o resumo de um orçamento anterior é
// exatamente o que faz o modelo achar que o documento já foi resolvido.
//
// O que este teste protege é a fronteira: a organização da lista não recebe o
// resumo; o Atendimento, e o vendas fora da lista, continuam recebendo.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, WA_NUMBER_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import { ORGS_SO_ATE_O_CADASTRO } from '@/lib/agente/so-ate-o-cadastro';

const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000000f1';
const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000f1';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000f1';
const RESUMO = 'RESUMO-DA-MANHA: solicitou dois orçamentos e o vendedor deveria retornar com valores.';

let banco: Banco;
let supabaseClient: unknown;
let http: HttpFalso;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: 'PHONE-NUMBER-ID-F1',
    telefone: '+55 73 90000-0009', papel: 'vendedor', member_id: null, ativo: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendas-f1', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor.', tom: 'direto', limitacoes: null, info_adicional: null,
    sucessos: null, fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  ORGS_SO_ATE_O_CADASTRO.delete(ORG_A);
  http = instalarHttpFalso();
});

depois(() => {
  ORGS_SO_ATE_O_CADASTRO.delete(ORG_A);
  http?.restaurar();
});

/** Uma conversa do cliente no número dado, com um resumo antigo no cadastro dele. */
function semear(waNumberId: string): void {
  for (const t of ['contacts', 'conversations', 'messages', 'contact_history', 'ai_usage']) banco[t].length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Joana', telefone: '5500900000091', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, wa_number_id: waNumberId,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-0000000000f1', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto: 'quero um orçamento', read: false, camp: false, created_at: new Date().toISOString(),
  });
  banco.contact_history.push({
    id: 'dddddddd-0000-4000-8000-0000000000f2', organization_id: ORG_A, contact_id: CONTATO, canal: 'IA',
    resumo: RESUMO, data: new Date(Date.now() - 3_600_000).toISOString(), wa_number_id: waNumberId,
  });
}

/** O system que o motor mandou à Anthropic na primeira chamada. */
async function systemEnviado(waNumberId: string): Promise<string> {
  semear(waNumberId);
  const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
  await gerarRespostaIA(supabaseClient as never, ORG_A, CONVERSA);
  return String((http.chamadasAnthropic[0].corpo as { system?: string }).system);
}

describe('o resumo do atendimento anterior no prompt', () => {
  test('não entra em organização que vai só até o cadastro', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    const system = await systemEnviado(WA_NUMBER_VENDEDOR);
    assert.doesNotMatch(system, /RESUMO-DA-MANHA/);
    assert.doesNotMatch(system, /Resumos de atendimentos anteriores/);
  });

  test('continua entrando em vendas fora da lista', async () => {
    const system = await systemEnviado(WA_NUMBER_VENDEDOR);
    assert.match(system, /RESUMO-DA-MANHA/);
  });

  test('continua entrando no atendimento, mesmo com a organização na lista', async () => {
    ORGS_SO_ATE_O_CADASTRO.add(ORG_A);
    const system = await systemEnviado(WA_NUMBER_A);
    assert.match(system, /RESUMO-DA-MANHA/);
  });
});

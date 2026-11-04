// O cache de prompt entra atrás de uma chave por organização (`cache-de-prompt.ts`).
//
// O que não pode acontecer: uma organização fora da lista (as clínicas, que
// pagam) ver o pedido mudar. E, dentro da lista, o texto que o modelo lê mudar:
// o cache só corta o system em dois blocos, no fim da parte fixa.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import { ORGS_COM_CACHE_DE_PROMPT, systemDoPedido } from '@/lib/agente/cache-de-prompt';

const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000c1';

type Bloco = { type: string; text: string; cache_control?: { type: string } };

let banco: Banco;
let supabaseClient: unknown;
let http: HttpFalso;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  for (const t of ['contacts', 'conversations', 'messages', 'ai_usage']) banco[t].length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Joana', telefone: '5500900000093', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-0000000000c1', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto: 'oi, qual o horário?', read: false, camp: false, created_at: new Date().toISOString(),
  });
});

depois(() => {
  http?.restaurar();
  ORGS_COM_CACHE_DE_PROMPT.delete(ORG_A);
});

async function systemDaPrimeiraChamada(): Promise<unknown> {
  http = instalarHttpFalso([{}]);
  try {
    const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
    await gerarRespostaIA(supabaseClient as never, ORG_A, CONVERSA);
    return (http.chamadasAnthropic[0].corpo as { system?: unknown }).system;
  } finally {
    http.restaurar();
  }
}

describe('cache de prompt por organização', () => {
  test('mantém o system como texto único fora da lista', async () => {
    ORGS_COM_CACHE_DE_PROMPT.delete(ORG_A);
    const system = await systemDaPrimeiraChamada();
    assert.equal(typeof system, 'string');
  });

  test('marca só a parte fixa para o cache dentro da lista', async () => {
    const semCache = String(await systemDaPrimeiraChamada());
    ORGS_COM_CACHE_DE_PROMPT.add(ORG_A);
    try {
      const blocos = await systemDaPrimeiraChamada() as Bloco[];
      assert.deepEqual(blocos.map(b => b.cache_control?.type ?? null), ['ephemeral', null]);
      assert.equal(blocos.map(b => b.text).join(''), semCache, 'o texto lido pelo modelo é o mesmo');
    } finally {
      ORGS_COM_CACHE_DE_PROMPT.delete(ORG_A);
    }
  });

  test('devolve o texto inteiro quando ele não começa pela parte fixa', () => {
    ORGS_COM_CACHE_DE_PROMPT.add(ORG_A);
    try {
      assert.equal(systemDoPedido(ORG_A, 'fixo', 'outro começo'), 'outro começo');
    } finally {
      ORGS_COM_CACHE_DE_PROMPT.delete(ORG_A);
    }
  });
});

describe('a seção do fiscal no system', () => {
  test('não entra no roteiro de atendimento, mesmo com a chave do fiscal ligada', async () => {
    const { ORGS_COM_FISCAL } = await import('@/lib/agente/fiscal');
    ORGS_COM_FISCAL.add(ORG_A);
    try {
      assert.doesNotMatch(String(await systemDaPrimeiraChamada()), /Confirmação da lista/);
    } finally {
      ORGS_COM_FISCAL.delete(ORG_A);
    }
  });
});

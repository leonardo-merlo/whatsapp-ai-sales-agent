// O resumo de conversa parada rodava para sempre: gravar `resumida_em` fazia o
// gatilho empurrar `updated_at` para depois, e a guarda antiga
// (`resumida_em >= updated_at`) nunca passava. A cada 24 h a mesma conversa de
// junho virava um resumo novo e uma linha nova na memória do contato.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000a9';
const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000a9';
const DOIS_DIAS = 2 * 24 * 60 * 60 * 1000;

let banco: Banco;
let http: HttpFalso;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  process.env.CRON_SECRET = 'segredo-do-cron';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  http?.restaurar();
  http = instalarHttpFalso([{ texto: 'Resumo.' }]);
  const antigo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  banco.contacts.length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Ana', telefone: '5532999990009', perfil: null });
  banco.messages.length = 0;
  banco.messages.push({ id: 'm-a9', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'oi', created_at: antigo });
  banco.contact_history = [];
});

function conversa(resumidaEm: string | null, updatedAt: string) {
  banco.conversations.length = 0;
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, status: 'aberta', modo: 'ia',
    resumida_em: resumidaEm, updated_at: updatedAt, created_at: updatedAt,
  });
}

async function rodarCron() {
  const { GET } = await import('@/app/api/cron/resumir-paradas/route');
  return GET(new Request('http://x/api/cron/resumir-paradas', { headers: { authorization: 'Bearer segredo-do-cron' } }));
}

describe('resumo de conversa parada', () => {
  test('conversa já resumida, sem mensagem nova, não é resumida de novo', async () => {
    // O gatilho deixou updated_at 300 ms depois de resumida_em, como no banco.
    const resumida = new Date(Date.now() - DOIS_DIAS);
    conversa(resumida.toISOString(), new Date(resumida.getTime() + 300).toISOString());

    await rodarCron();

    assert.equal(http.chamadasAnthropic.length, 0);
  });

  test('conversa com mensagem depois do último resumo é resumida', async () => {
    const resumida = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
    conversa(resumida.toISOString(), new Date(Date.now() - DOIS_DIAS).toISOString());

    await rodarCron();

    assert.equal(http.chamadasAnthropic.length, 1);
  });

  test('conversa resumida de manhã e retomada à noite ganha outro resumo no mesmo dia', async () => {
    // Pedido do Leonardo em 08/10: um resumo por período de conversa, sem o teto de 24 h.
    const manha = new Date(Date.now() - 14 * 60 * 60 * 1000);
    banco.messages.push({ id: 'm-noite', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'quero outro orçamento', created_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    conversa(manha.toISOString(), new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());

    await rodarCron();

    assert.equal(http.chamadasAnthropic.length, 1);
  });

  test('o resumo novo leva só as mensagens depois do anterior', async () => {
    const manha = new Date(Date.now() - 14 * 60 * 60 * 1000);
    banco.messages.push({ id: 'm-noite', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'quero outro orçamento', created_at: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString() });
    conversa(manha.toISOString(), new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString());

    await rodarCron();

    const pedido = JSON.stringify(http.chamadasAnthropic[0]?.corpo);
    assert.deepEqual([pedido.includes('quero outro orçamento'), pedido.includes('Cliente: oi')], [true, false]);
  });
});

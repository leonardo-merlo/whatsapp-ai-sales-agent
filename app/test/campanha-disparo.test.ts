// Tarefa 3 (25/09): campanha passa a ser disparo de template aprovado.
//
// O que motivou: o botão "Disparar agora" só gravava a campanha, com a
// estimativa de alcance no lugar dos disparos, e nada saía. O que os testes
// travam, e que não dá para ver olhando a tela:
// (1) sai template, um por contato, e o número gravado é o que a Meta aceitou;
// (2) nada sai sem template aprovado, nem pelo número de outra conta;
// (3) acima do limite, nada sai — cortar no meio deixaria metade da lista
//     sem saber quem recebeu;
// (4) contato com telefone mascarado no painel não vira contato duplicado.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, WA_NUMBER_A, WA_NUMBER_B } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

type Cliente = SupabaseClient<Database>;

const WABA = 'WABA-A';
let banco: Banco;
let cliente: Cliente;
let http: HttpFalso;

const disparo = () => import('@/lib/campanhas/disparar');

const TEMPLATE = {
  id: 'tpl-promo', organization_id: ORG_A, waba_id: WABA, nome: 'promo_outubro', idioma: 'pt_BR',
  categoria: 'MARKETING', corpo: 'Olá, {{1}}! Temos {{2}} para você.', status: 'APPROVED', origem: 'cliente',
  meta_template_id: '1', motivo_rejeicao: null, oculto: false,
  variaveis: [{ nome: 'variavel_1', exemplo: 'Ana' }, { nome: 'variavel_2', exemplo: 'desconto' }],
};

function contato(id: string, nome: string, telefone: string | null, extra: Record<string, unknown> = {}) {
  return { id, organization_id: ORG_A, nome, telefone, bairro: 'Centro', status: 'ativo', wa_user_id: null, ...extra };
}

function pedido(extra: Record<string, unknown> = {}) {
  return {
    orgId: ORG_A, nome: 'Outubro', categoriaNome: null, waNumberId: WA_NUMBER_A, templateId: TEMPLATE.id,
    variaveis: [{ tipo: 'nome' as const }, { tipo: 'texto' as const, valor: '10% de desconto' }],
    filtros: { bairro: null, status: null },
    ...extra,
  };
}

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  cliente = supabase.client as Cliente;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.wa_numbers = cenarioBase().wa_numbers.map(n => ({ ...n, waba_id: n.id === WA_NUMBER_A ? WABA : 'OUTRA-WABA' }));
  banco.wa_templates = [{ ...TEMPLATE }];
  banco.contacts = [
    contato('c1', 'Ana Souza', '5511900000001'),
    contato('c2', 'Bruno Lima', '(11) 90000-0002'),
    contato('c3', 'Sem Telefone', null),
  ];
  banco.conversations = [];
  banco.messages = [];
  banco.campaigns = [];
  banco.campaign_categories = [];
  banco.notificacoes = [];
  http?.restaurar();
  http = instalarHttpFalso();
});

depois(() => http?.restaurar());

const enviosDeTemplate = () =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { type?: string })?.type === 'template');

describe('disparo de campanha', () => {
  test('manda o template a cada contato com WhatsApp e grava o que saiu de verdade', async () => {
    const { dispararCampanha } = await disparo();
    const r = await dispararCampanha(cliente, pedido());

    assert.deepEqual(r, { ok: true, campanhaId: banco.campaigns[0].id, enviados: 2, falhas: 0 });
    assert.equal(enviosDeTemplate().length, 2, 'o contato sem telefone fica de fora');
    assert.equal(banco.campaigns[0].disparos_count, 2);
  });

  test('a variável "nome do contato" vira o primeiro nome de cada um', async () => {
    const { dispararCampanha } = await disparo();
    await dispararCampanha(cliente, pedido());

    const nomes = enviosDeTemplate().map(c =>
      (c.corpo as { template: { components: { parameters: { text: string }[] }[] } }).template.components[0].parameters[0].text);
    assert.deepEqual(nomes.sort(), ['Ana', 'Bruno']);
  });

  test('a mensagem fica na conversa, marcada como de campanha', async () => {
    const { dispararCampanha } = await disparo();
    await dispararCampanha(cliente, pedido());

    const daAna = banco.messages.find(m => String(m.texto).startsWith('Olá, Ana!'));
    assert.equal(daAna?.camp, true);
  });

  test('telefone mascarado no painel não vira contato duplicado', async () => {
    const { dispararCampanha } = await disparo();
    await dispararCampanha(cliente, pedido());

    assert.equal(banco.contacts.length, 3);
  });
});

describe('o que não deixa sair', () => {
  test('template em análise: nada sai', async () => {
    banco.wa_templates = [{ ...TEMPLATE, status: 'PENDING' }];
    const { dispararCampanha } = await disparo();
    const r = await dispararCampanha(cliente, pedido());

    assert.equal(r.ok, false);
    assert.equal(enviosDeTemplate().length, 0);
    assert.equal(banco.campaigns.length, 0);
  });

  test('template escondido no Wappia: nada sai, mesmo aprovado na Meta', async () => {
    banco.wa_templates = [{ ...TEMPLATE, oculto: true }];
    const { dispararCampanha } = await disparo();
    const r = await dispararCampanha(cliente, pedido());

    assert.equal(r.ok, false);
    assert.equal(enviosDeTemplate().length, 0);
  });

  test('número de outra conta do WhatsApp: nada sai', async () => {
    const { dispararCampanha } = await disparo();
    const r = await dispararCampanha(cliente, pedido({ waNumberId: WA_NUMBER_B }));

    assert.equal(r.ok, false);
    assert.equal(enviosDeTemplate().length, 0);
  });

  test('variável de texto vazia: nada sai', async () => {
    const { dispararCampanha } = await disparo();
    const r = await dispararCampanha(cliente, pedido({ variaveis: [{ tipo: 'nome' }, { tipo: 'texto', valor: ' ' }] }));

    assert.equal(r.ok, false);
    assert.equal(enviosDeTemplate().length, 0);
  });

  test('acima do limite: nada sai, em vez de cortar no meio', async () => {
    const { dispararCampanha } = await disparo();
    const { LIMITE_POR_DISPARO } = await import('@/lib/campanhas/publico');
    banco.contacts = Array.from({ length: LIMITE_POR_DISPARO + 1 }, (_, i) =>
      contato(`x${i}`, `Pessoa ${i}`, `55119${String(i).padStart(8, '0')}`));

    const r = await dispararCampanha(cliente, pedido());

    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.erro, /limite/);
    assert.equal(enviosDeTemplate().length, 0);
  });

  test('falha de pagamento para o disparo no primeiro contato', async () => {
    http.restaurar();
    const original = globalThis.fetch;
    let envios = 0;
    globalThis.fetch = (async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.endsWith('/messages')) {
        envios++;
        return new Response(JSON.stringify({ error: { code: 131042, message: 'payment issue' } }), { status: 400 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    try {
      const { dispararCampanha } = await disparo();
      const r = await dispararCampanha(cliente, pedido());

      assert.equal(envios, 1, 'o segundo contato nem é tentado');
      assert.deepEqual(r.ok && [r.enviados, r.falhas], [0, 2]);
    } finally {
      globalThis.fetch = original;
      http = instalarHttpFalso();
    }
  });
});

describe('público', () => {
  test('filtra por bairro e status, e só quem tem WhatsApp', async () => {
    const { publicoDoDisparo } = await import('@/lib/campanhas/publico');
    const lista = publicoDoDisparo([
      contato('a', 'A', '5511900000001'),
      contato('b', 'B', '5511900000002', { bairro: 'Lapa' }),
      contato('c', 'C', '5511900000003', { status: 'inativo' }),
      contato('d', 'D', '123'),
    ], { bairro: 'Centro', status: 'ativo' });

    assert.deepEqual(lista.map(c => c.id), ['a']);
  });
});


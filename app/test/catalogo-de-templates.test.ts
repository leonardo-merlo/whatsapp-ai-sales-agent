// Catálogo de templates da Meta (migration 20260925000001).
//
// O que está em jogo, e que não dá para conferir olhando:
// (1) modelo pronto só vai para a Meta quando o cliente pede, e o orçamento
//     vencido nunca é um deles;
// (2) template que já existe na Meta não vira erro: entra no catálogo com o
//     status de verdade;
// (3) o webhook de status atualiza o catálogo SEM tirar do caminho a mensagem
//     que chega no mesmo POST — é por lá que todo atendimento passa;
// (4) a ordem das variáveis no envio é a do catálogo, não a de quem chama.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, SEGREDO_DO_APP, requisicaoDoWebhook,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

type Cliente = SupabaseClient<Database>;

const WABA = 'WABA-A';
let banco: Banco;
let cliente: Cliente;
let http: HttpFalso;

const catalogo = () => import('@/lib/whatsapp/catalogo-de-templates');

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  cliente = supabase.client as Cliente;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.wa_numbers = cenarioBase().wa_numbers.map(n => ({ ...n, waba_id: n.phone_number_id === NUMERO_A ? WABA : null }));
  banco.wa_templates = [];
  banco.notificacoes = [];
  banco.contacts = [];
  banco.conversations = [];
  banco.messages = [];
  http?.restaurar();
  http = instalarHttpFalso();
});

depois(() => http?.restaurar());

const criacoes = () => http.chamadasTemplates.filter(c => c.metodo === 'POST');

describe('modelo pronto, sob demanda', () => {
  test('entra no catálogo em análise, marcado como padrão da Wappia', async () => {
    const { criarTemplatePadrao } = await catalogo();
    const linha = await criarTemplatePadrao(cliente, { orgId: ORG_A, wabaId: WABA, token: 't', nome: 'lembrete_agendamento' });

    assert.equal(linha.status, 'PENDING');
    assert.equal(linha.origem, 'wappia');
    assert.equal(banco.wa_templates.length, 1);
  });

  test('manda exemplo de cada variável, que sem ele a Meta recusa', async () => {
    const { criarTemplatePadrao } = await catalogo();
    await criarTemplatePadrao(cliente, { orgId: ORG_A, wabaId: WABA, token: 't', nome: 'lembrete_agendamento' });

    const corpo = criacoes()[0].corpo as { parameter_format: string; components: { example?: { body_text: string[][] } }[] };
    assert.equal(corpo.parameter_format, 'positional');
    assert.equal(corpo.components[0].example?.body_text[0].length, 4);
  });

  test('o orçamento vencido não é um modelo pronto', async () => {
    const { criarTemplatePadrao } = await catalogo();
    await assert.rejects(() => criarTemplatePadrao(cliente, { orgId: ORG_A, wabaId: WABA, token: 't', nome: 'orcamento_rascunho_pronto' }));
    assert.equal(criacoes().length, 0);
  });

  test('template que já existe na Meta entra com o status de lá, sem erro', async () => {
    http.restaurar();
    const original = globalThis.fetch;
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada);
      if (url.includes('/message_templates') && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { code: 100, error_subcode: 2388024, message: 'Content in This Language Already Exists' } }), { status: 400 });
      }
      if (url.includes('/message_templates')) {
        return new Response(JSON.stringify({ data: [{
          id: '777', name: 'lembrete_agendamento', status: 'APPROVED', category: 'UTILITY', language: 'pt_BR',
          components: [{ type: 'BODY', text: 'Olá, {{1}}! ... {{2}} ... {{3}} às {{4}}. Ok?', example: { body_text: [['a', 'b', 'c', 'd']] } }],
        }] }), { status: 200 });
      }
      throw new Error(`rede: ${url}`);
    }) as typeof fetch;

    try {
      const { criarTemplatePadrao } = await catalogo();
      const linha = await criarTemplatePadrao(cliente, { orgId: ORG_A, wabaId: WABA, token: 't', nome: 'lembrete_agendamento' });

      assert.equal(linha.status, 'APPROVED');
      assert.equal(linha.meta_template_id, '777');
      assert.deepEqual((linha.variaveis as { nome: string }[]).map(v => v.nome), ['nome', 'empresa', 'data', 'hora'],
        'um padrão importado ganha os nomes de variável do padrão, senão o envio por nome não acha nada');
    } finally {
      globalThis.fetch = original;
      http = instalarHttpFalso();
    }
  });
});

describe('forma do template', () => {
  test('o nome amigável vira o nome que a Meta aceita', async () => {
    const { slugDoNome } = await catalogo();
    assert.equal(slugDoNome('Promoção de Outubro!'), 'promocao_de_outubro');
  });

  test('numeração com buraco é recusada antes de chamar a Meta', async () => {
    const { problemaNoTemplate } = await catalogo();
    const erro = problemaNoTemplate({
      nome: 'x', categoria: 'MARKETING', corpo: 'Oi {{1}}, veja {{3}} hoje.',
      variaveis: [{ nome: 'a', exemplo: '1' }, { nome: 'b', exemplo: '2' }],
    });
    assert.match(String(erro), /sequência/);
  });

  test('variável sem exemplo é recusada', async () => {
    const { problemaNoTemplate } = await catalogo();
    const erro = problemaNoTemplate({
      nome: 'x', categoria: 'MARKETING', corpo: 'Oi {{1}}, tudo bem?', variaveis: [{ nome: 'a', exemplo: ' ' }],
    });
    assert.match(String(erro), /exemplo/);
  });
});

function payloadDeTemplate(field: string, value: Record<string, unknown>) {
  return { id: WABA, changes: [{ field, value }] };
}

async function postar(entry: unknown[]) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = JSON.stringify({ object: 'whatsapp_business_account', entry });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

function linhaPendente() {
  banco.wa_templates.push({
    id: 'tpl-1', organization_id: ORG_A, waba_id: WABA, nome: 'promo', idioma: 'pt_BR', categoria: 'UTILITY',
    corpo: 'Oi {{1}}, tudo bem?', variaveis: [{ nome: 'variavel_1', exemplo: 'Ana' }],
    meta_template_id: '555', status: 'PENDING', motivo_rejeicao: null, origem: 'cliente', oculto: false,
  });
}

describe('webhook de template', () => {
  test('APPROVED atualiza o catálogo e resolve o aviso pendente', async () => {
    linhaPendente();
    banco.notificacoes.push({ id: 'n1', organization_id: ORG_A, tipo: 'template_nao_aprovado', status: 'pendente', wa_template_id: 'tpl-1' });

    const resp = await postar([payloadDeTemplate('message_template_status_update', {
      event: 'APPROVED', message_template_id: 555, message_template_name: 'promo', message_template_language: 'pt_BR', reason: 'NONE',
    })]);

    assert.equal(resp.status, 200);
    assert.equal(banco.wa_templates[0].status, 'APPROVED');
    assert.equal(banco.notificacoes[0].status, 'resolvida');
  });

  test('REJECTED guarda o motivo e avisa no sino', async () => {
    linhaPendente();
    await postar([payloadDeTemplate('message_template_status_update', {
      event: 'REJECTED', message_template_id: 555, message_template_name: 'promo', message_template_language: 'pt_BR', reason: 'PROMOTIONAL',
    })]);

    assert.equal(banco.wa_templates[0].motivo_rejeicao, 'PROMOTIONAL');
    assert.equal(banco.notificacoes.filter(n => n.tipo === 'template_nao_aprovado').length, 1);
  });

  test('recategorização concluída muda a categoria e avisa que o preço mudou', async () => {
    linhaPendente();
    await postar([payloadDeTemplate('template_category_update', {
      message_template_id: 555, message_template_name: 'promo', message_template_language: 'pt_BR',
      previous_category: 'UTILITY', new_category: 'MARKETING',
    })]);

    assert.equal(banco.wa_templates[0].categoria, 'MARKETING');
    assert.match(String(banco.notificacoes[0].corpo), /preço/);
  });

  test('aviso prévio de recategorização avisa mas não muda o catálogo', async () => {
    linhaPendente();
    await postar([payloadDeTemplate('template_category_update', {
      message_template_id: 555, message_template_name: 'promo', message_template_language: 'pt_BR',
      new_category: 'MARKETING', correct_category: 'MARKETING',
    })]);

    assert.equal(banco.wa_templates[0].categoria, 'UTILITY');
    assert.equal(banco.notificacoes.length, 1);
  });

  test('evento de template no mesmo POST não tira a mensagem do cliente do caminho', async () => {
    linhaPendente();
    await postar([
      payloadDeTemplate('message_template_status_update', { event: 'APPROVED', message_template_id: 555 }),
      {
        id: WABA,
        changes: [{
          field: 'messages',
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: NUMERO_A },
            contacts: [{ profile: { name: 'Ana' }, wa_id: '5511900000055' }],
            messages: [{ from: '5511900000055', id: 'wamid.tpl-junto', type: 'text', text: { body: 'oi' } }],
          },
        }],
      },
    ]);

    assert.equal(banco.wa_templates[0].status, 'APPROVED');
    assert.ok(banco.messages.some(m => m.autor === 'cliente' && m.texto === 'oi'), 'a mensagem do cliente foi gravada');
  });
});

describe('envio consulta o catálogo', () => {
  test('valores por nome saem na ordem da linha do catálogo', async () => {
    banco.wa_templates.push({
      id: 'tpl-2', organization_id: ORG_A, waba_id: WABA, nome: 'aviso', idioma: 'pt_BR', categoria: 'UTILITY',
      corpo: '...', status: 'APPROVED', origem: 'wappia', meta_template_id: '1', oculto: false,
      variaveis: [{ nome: 'nome', exemplo: 'a' }, { nome: 'data', exemplo: 'b' }],
    });
    const { prepararTemplate } = await catalogo();
    const r = await prepararTemplate(cliente, {
      orgId: ORG_A, phoneNumberId: NUMERO_A, nome: 'aviso', valores: { data: '12/10', nome: 'Ana' },
    });

    assert.ok(r.ok);
    if (r.ok) assert.deepEqual(r.template.variaveis, ['Ana', '12/10']);
  });

  test('número sem WABA registrada é recusado com motivo claro', async () => {
    banco.wa_numbers.forEach(n => { n.waba_id = null; });
    const { prepararTemplate } = await catalogo();
    const r = await prepararTemplate(cliente, { orgId: ORG_A, phoneNumberId: NUMERO_A, nome: 'aviso', valores: [] });

    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /Refaça a conexão/);
  });
});

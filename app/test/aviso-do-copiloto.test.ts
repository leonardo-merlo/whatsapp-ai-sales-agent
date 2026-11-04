// C6, item 5: o aviso que o vendedor recebe no copiloto — e a pendência do
// bloco A que ele fecha.
//
// **A pendência:** o envio de template funcionava desde 10/09, mas a mensagem
// sumia. Não aparecia em lugar nenhum do painel. Um lembrete mandado ontem, um
// aviso ao vendedor de manhã: nada disso existia para quem abria a tela. No
// Wappia Vendas isso é pior, porque avisar o vendedor é a única coisa que o
// número copiloto faz.
//
// **A diferença de produto que o texto do aviso carrega:** no fluxo automático
// de 13/09 o vendedor é INFORMADO, não convocado. O orçamento já foi ao
// cliente. O template antigo (`orcamento_rascunho_pronto`) dizia "aplique o
// desconto e envie ao cliente" — mandá-lo hoje faria o vendedor mandar um
// SEGUNDO orçamento.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, SEGREDO_DO_APP } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { Orcamento } from '@/lib/erp/contrato';

type Cliente = SupabaseClient<Database>;

const WA_NUMBER_COPILOTO = 'dddddddd-0000-4000-8000-0000000000c0';
const NUMERO_COPILOTO = 'PHONE-NUMBER-ID-COPILOTO';

const VENDEDOR = {
  memberId: 'membro-joao', nome: 'João', codigoErp: 'V-07', telefoneWhatsapp: '5573900000007',
};

const ORCAMENTO: Orcamento = {
  id: 'ORC-88123', numero: '88123', situacao: 'aberto', validade: '2026-09-20',
  itens: [{
    produto_codigo: '700005', descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC',
    quantidade: 10, preco_unitario: 112.40, desconto_percentual: 5, valor_total: 1067.80,
  }],
  valor_total: 1067.80, desconto_total: 56.20,
  link: 'https://erp.distribuidora-exemplo.test/orcamentos/88123',
};

let banco: Banco;
let cliente: Cliente;
let http: HttpFalso;

// Import tardio de propósito: `send-message` resolve o client de serviço no
// carregamento do módulo, e um import no topo aconteceria antes de `before()`
// instalar o dublê.
const avisarVendedorDoOrcamento: typeof import('@/lib/agente/avisar-vendedor').avisarVendedorDoOrcamento =
  async (...args) => (await import('@/lib/agente/avisar-vendedor')).avisarVendedorDoOrcamento(...args);

const COPILOTO = {
  id: WA_NUMBER_COPILOTO, organization_id: ORG_A, phone_number_id: NUMERO_COPILOTO,
  telefone: '+55 73 90000-0099', papel: 'copiloto', member_id: null, ativo: true, waba_id: 'WABA-COPILOTO',
};

/** A linha do catálogo que o envio consulta antes de chamar a Meta. */
const TEMPLATE_APROVADO = {
  id: 'tpl-orcamento', organization_id: ORG_A, waba_id: 'WABA-COPILOTO', nome: 'orcamento_enviado_ao_cliente',
  idioma: 'pt_BR', categoria: 'UTILITY', corpo: '...', status: 'APPROVED', origem: 'wappia', meta_template_id: '9001', oculto: false,
  variaveis: [
    { nome: 'vendedor', exemplo: 'João' }, { nome: 'orcamento', exemplo: '1' },
    { nome: 'cliente', exemplo: 'X' }, { nome: 'valor', exemplo: 'R$ 1,00' },
  ],
};

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';

  // O dublê tem que estar no lugar ANTES do primeiro import do código de
  // produção: `send-message` resolve o client de serviço no carregamento do
  // módulo, e trocar depois já não alcança.
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  cliente = supabase.client as Cliente;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.wa_numbers = [...cenarioBase().wa_numbers, { ...COPILOTO }];
  banco.contacts.length = 0;
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.wa_templates = [{ ...TEMPLATE_APROVADO }];
  banco.notificacoes = [];
  http?.restaurar();
  http = instalarHttpFalso();
});

depois(() => http?.restaurar());

const enviosDeTemplate = () =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { type?: string })?.type === 'template');

describe('o aviso chega ao vendedor', () => {
  test('sai pelo número copiloto, por template, com as variáveis na ordem', async () => {
    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Construtora Aurora', vendedor: VENDEDOR,
    });

    assert.equal(r.avisado, true);
    const envios = enviosDeTemplate();
    assert.equal(envios.length, 1);

    // Pelo número copiloto, não pelo do vendedor nem pelo de atendimento.
    assert.match(envios[0].url, new RegExp(`/${NUMERO_COPILOTO}/messages$`));

    const corpo = envios[0].corpo as {
      to?: string;
      template?: { name?: string; components?: { parameters: { text: string }[] }[] };
    };
    assert.equal(corpo.to, VENDEDOR.telefoneWhatsapp);
    assert.equal(corpo.template?.name, 'orcamento_enviado_ao_cliente');
    assert.deepEqual(
      corpo.template?.components?.[0].parameters.map(p => p.text),
      ['João', '88123', 'Construtora Aurora', 'R$ 1.067,80'],
      'a ordem das variáveis é a do template na Meta — trocar aqui troca o nome pelo valor na mensagem',
    );
  });

  test('o template NÃO é o antigo, que mandaria o vendedor enviar de novo', async () => {
    await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Construtora Aurora', vendedor: VENDEDOR,
    });

    const corpo = enviosDeTemplate()[0].corpo as { template?: { name?: string } };
    assert.notEqual(corpo.template?.name, 'orcamento_rascunho_pronto',
      'o texto aprovado em 10/09 diz "aplique o desconto e envie ao cliente" — no fluxo automático isso vira um segundo orçamento');
  });
});

describe('a pendência do bloco A: o template fica na conversa', () => {
  test('o aviso vira mensagem, num contato e numa conversa do número copiloto', async () => {
    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Construtora Aurora', vendedor: VENDEDOR,
    });

    assert.equal(r.avisado, true);

    const contato = banco.contacts.find(c => c.telefone === VENDEDOR.telefoneWhatsapp);
    assert.ok(contato, 'o vendedor virou contato da organização');
    assert.equal(contato!.nome, 'João');

    const conversa = banco.conversations.find(c => c.contact_id === contato!.id);
    assert.ok(conversa, 'e a conversa existe');
    assert.equal(conversa!.wa_number_id, WA_NUMBER_COPILOTO, 'carimbada com o número copiloto');

    const mensagens = banco.messages.filter(m => m.conversation_id === conversa!.id);
    assert.equal(mensagens.length, 1);
    // O que fica gravado é o texto que um humano lê, não o nome do template com
    // os parâmetros soltos.
    assert.match(String(mensagens[0].texto), /Orçamento 88123 para Construtora Aurora/);
    assert.match(String(mensagens[0].texto), /R\$ 1\.067,80/);
    assert.match(String(mensagens[0].texto), /O cliente já recebeu os itens e os valores/);
    assert.match(String(mensagens[0].texto), /erp\.distribuidora-exemplo\.test\/orcamentos\/88123/);
    // E o wamid da Meta fica junto, que é por onde um evento de entrega futuro
    // encontra esta mensagem.
    assert.equal(mensagens[0].wamid, 'wamid.enviado');
  });

  test('dois avisos caem na MESMA conversa do vendedor', async () => {
    await avisarVendedorDoOrcamento(cliente, { orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR });
    await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: { ...ORCAMENTO, id: 'ORC-88124', numero: '88124' }, nomeDoCliente: 'Outra', vendedor: VENDEDOR,
    });

    assert.equal(banco.contacts.length, 1);
    assert.equal(banco.conversations.length, 1, 'o copiloto tem uma conversa por vendedor, não uma por aviso');
    assert.equal(banco.messages.length, 2);
  });

  test('envio que falha deixa a mensagem E o motivo na conversa', async () => {
    http.restaurar();
    // A Meta recusando: template ainda não criado naquela WABA (código 132001).
    const original = globalThis.fetch;
    globalThis.fetch = (async (entrada: RequestInfo | URL) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes('graph.facebook.com')) {
        return new Response(JSON.stringify({ error: { message: 'Template name does not exist', code: 132001 } }), {
          status: 400, headers: { 'content-type': 'application/json' },
        });
      }
      return original(entrada);
    }) as typeof fetch;

    try {
      const r = await avisarVendedorDoOrcamento(cliente, {
        orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR,
      });

      assert.equal(r.avisado, false);
      const autores = banco.messages.map(m => m.autor);
      assert.deepEqual(autores, ['ia', 'sys'],
        'fica o que a gente tentou dizer E a nota de que não saiu — em vez de um buraco');
      assert.match(String(banco.messages[1].texto), /132001/);
    } finally {
      globalThis.fetch = original;
      http = instalarHttpFalso();
    }
  });
});

describe('template que não está aprovado não sai', () => {
  test('em análise: nem chama a Meta, deixa o motivo na conversa e avisa no sino', async () => {
    banco.wa_templates = [{ ...TEMPLATE_APROVADO, status: 'PENDING' }];

    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR,
    });

    assert.equal(r.avisado, false);
    assert.equal(enviosDeTemplate().length, 0, 'a Meta nem é chamada');
    assert.match(String(banco.messages.at(-1)?.texto), /em análise/);
    const notifs = banco.notificacoes.filter(n => n.tipo === 'template_nao_aprovado');
    assert.equal(notifs.length, 1);
  });

  test('escondido no Wappia: o aviso automático também não sai, e o sino explica', async () => {
    banco.wa_templates = [{ ...TEMPLATE_APROVADO, oculto: true }];

    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR,
    });

    assert.equal(r.avisado, false);
    assert.equal(enviosDeTemplate().length, 0, 'aprovado na Meta, mas escondido: a Meta nem é chamada');
    assert.match(String(banco.notificacoes[0]?.corpo), /Mostre de novo/);
  });

  test('o mesmo template bloqueado duas vezes gera um aviso só', async () => {
    banco.wa_templates = [{ ...TEMPLATE_APROVADO, status: 'REJECTED' }];

    await avisarVendedorDoOrcamento(cliente, { orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'A', vendedor: VENDEDOR });
    await avisarVendedorDoOrcamento(cliente, { orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'B', vendedor: VENDEDOR });

    assert.equal(banco.notificacoes.filter(n => n.tipo === 'template_nao_aprovado').length, 1);
  });

  test('fora do catálogo: não chama a Meta e diz que o template não existe', async () => {
    banco.wa_templates = [];

    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR,
    });

    assert.equal(r.avisado, false);
    assert.equal(enviosDeTemplate().length, 0);
    assert.match(String(banco.messages.at(-1)?.texto), /não existe/);
  });
});

describe('quando não dá para avisar, nada quebra', () => {
  test('sem número copiloto, devolve o motivo em vez de estourar', async () => {
    banco.wa_numbers = banco.wa_numbers.filter(n => n.id !== WA_NUMBER_COPILOTO);

    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: VENDEDOR,
    });

    assert.deepEqual(r, { avisado: false, motivo: 'sem-copiloto' });
    assert.equal(http.chamadasWhatsApp.length, 0);
  });

  test('vendedor sem WhatsApp cadastrado devolve o motivo', async () => {
    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora',
      vendedor: { ...VENDEDOR, telefoneWhatsapp: '' },
    });

    assert.deepEqual(r, { avisado: false, motivo: 'sem-telefone-do-vendedor' });
  });

  test('número sem dono não tem a quem avisar', async () => {
    const r = await avisarVendedorDoOrcamento(cliente, {
      orgId: ORG_A, orcamento: ORCAMENTO, nomeDoCliente: 'Aurora', vendedor: null,
    });

    assert.deepEqual(r, { avisado: false, motivo: 'sem-vendedor' });
  });
});

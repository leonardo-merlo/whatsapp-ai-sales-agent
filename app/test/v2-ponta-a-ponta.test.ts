// A v2 ligada (PIPELINE_VERSION=v2) dentro do fluxo de vendas da v1, do
// webhook ao orçamento. O motor, as ferramentas e a v2 são os de produção; a
// Anthropic e o ERP são dublês no limite HTTP.
//
// O que este arquivo prova:
// 1. a v1 continua dona da conversa (cliente identificado antes dos produtos);
// 2. os produtos vão para a v2 por `levantar_itens`, e as perguntas e a lista
//    saem do código da v2;
// 3. o "sim" da lista não gasta chamada de IA;
// 4. a v1 só cria o orçamento com os itens da lista que o cliente confirmou;
// 5. com a chave desligada, nada disso existe (a v1 fica igual).

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { assinar, cenarioBase, INDICES_UNICOS, ORG_A, requisicaoDoWebhook, payloadDeMensagem, SEGREDO_DO_APP } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDAS-V2';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000000f2';
const MEMBRO = 'membro-v2';
const CLIENTE_TELEFONE = '5500900000777';
const BASE_DO_ERP = 'https://erp.exemplo.teste/v1';
const CHAVE_DO_ERP = 'CHAVE-NO-VAULT';

let banco: Banco;
let http: HttpFalso;
let erp: SimuladorExemplo;
let tarefas: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  delete process.env.WEBHOOK_FILA_ORGS;

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 73 90000-0008', papel: 'vendedor', member_id: MEMBRO, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendas-v2', organization_id: ORG_A, ativo: true, prompt: 'Você é o assistente do vendedor João.',
    tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null, fallback_mode: 'transferir',
    fallback_atendente_id: null, wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  banco.organization_members = [{ id: MEMBRO, organization_id: ORG_A, nome: 'João', codigo_erp: 'V-07', telefone_whatsapp: '5573900000008', ativo: true, role: 'atendente' }];
  banco.organization_integrations = [{ id: 'integ-v2', organization_id: ORG_A, tipo: 'erp', endereco_base: BASE_DO_ERP, token_secret_id: 's', ativo: true, config: {} }];
  banco.catalogo_grupos = [
    { id: 'g-ca50', organization_id: ORG_A, codigo: '4101', nome: 'VERGALHOES CA50', ativo: true },
    { id: 'g-prego', organization_id: ORG_A, codigo: '4900', nome: 'PREGOS C CABECA', ativo: true },
  ];
  banco.catalogo_produtos = [
    { id: 'p-1', organization_id: ORG_A, grupo_id: 'g-ca50', codigo: '700005', descricao: 'VERGALHAO CA50 1/2 (12.5 MM)', unidade: 'VR', preco: 112.40, dados: {}, ativo: true, molde: 'vergalhão CA50', medidas: { bitola: '1/2', mm: '12.5' } },
    { id: 'p-2', organization_id: ORG_A, grupo_id: 'g-prego', codigo: '700113', descricao: 'PREGO 17 X 21', unidade: 'KG', preco: 17.6, dados: {}, ativo: true, molde: 'prego', medidas: { bitola: '17', comprimento: '21' } },
  ];
  for (const t of ['v2_pedidos', 'v2_itens', 'v2_trace', 'v2_snapshots', 'v2_cache_ia', 'orcamentos_em_andamento', 'erp_idempotencia']) banco[t] = [];

  const supabase = criarSupabaseFalso(banco, {
    ...INDICES_UNICOS,
    unicos: { ...INDICES_UNICOS.unicos, erp_idempotencia: [['organization_id', 'operacao', 'assinatura']] },
    funcoes: { credencial_da_integracao: () => CHAVE_DO_ERP },
  });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', { namedExports: { after: (cb: () => Promise<void> | void) => { tarefas.push(cb); } } });
});

beforeEach(() => {
  for (const t of ['contacts', 'conversations', 'messages', 'ai_usage', 'v2_pedidos', 'v2_itens', 'v2_trace', 'v2_snapshots', 'v2_cache_ia', 'orcamentos_em_andamento', 'erp_idempotencia']) banco[t].length = 0;
  tarefas = [];
  erp = criarSimuladorExemplo({
    produtos: [{ codigo: '700005', descricao: 'VERGALHAO CA50 1/2 (12.5 MM)', unidade: 'VR', preco: 112.40 }, { codigo: '700113', descricao: 'PREGO 17 X 21', unidade: 'KG', preco: 17.6 }],
    chave: CHAVE_DO_ERP,
    clientes: [{ id: 'CLI-4471', documento: '12345678000190', tipo: 'PJ', nome: 'Construtora Aurora Ltda', cidade: 'Porto Seguro', uf: 'BA', vendedor_id: 'V-07' }],
  });
});

depois(() => { http?.restaurar(); delete process.env.PIPELINE_VERSION; });

function comRespostas(respostas: RespostaAnthropic[]): void {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
  const doDuble = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith(BASE_DO_ERP)) return responderComoFetch(erp, BASE_DO_ERP, entrada, init);
    return doDuble(entrada, init);
  }) as typeof fetch;
}

async function entregar(texto: string): Promise<void> {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE_TELEFONE, texto, wamid: `wamid.${Math.random()}` } as never);
  await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  while (tarefas.length) await tarefas.shift()!();
}

const final = (resposta: string): RespostaAnthropic => ({
  json: {
    resposta, transferir_para_atendente: false, questionario_completo: false, respostas: [], resultado: 'nenhum', itens_vendidos: [],
    agendamento_data: '', agendamento_hora: '', agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
});

const PEDIDO = 'quero 10 barras de 1/2 e 8 quilos de prego 17x21';
const EXTRACAO: RespostaAnthropic = {
  json: {
    tipo_mensagem: 'novos_itens', respostas_a_perguntas: [],
    linhas: [{
      linha_id: 1, texto_original: PEDIDO, descartada: false, motivo_descarte: null,
      itens: [
        { familia: 'vergalhao', quantidade: { valor: '10', trecho: '10 barras' }, medidas: [{ valor: '1/2', etiqueta: 'bitola', unidade_escrita: null, trecho: '1/2' }], numeros_auxiliares: [], qualificadores: [], termos_nao_reconhecidos: [], idem_resolvido_de_linha: null },
        { familia: 'prego', quantidade: { valor: '8', trecho: '8 quilos' }, medidas: [{ valor: '17', etiqueta: 'bitola', unidade_escrita: null, trecho: '17' }, { valor: '21', etiqueta: 'comprimento', unidade_escrita: null, trecho: '21' }], numeros_auxiliares: [], qualificadores: [], termos_nao_reconhecidos: [], idem_resolvido_de_linha: null },
      ],
    }],
  },
};
const enviados = (): string[] => http.chamadasWhatsApp.map(c => String((c.corpo as { text?: { body?: string } })?.text?.body ?? ''));
const ferramentasDaChamada = (n: number): string[] => (((http.chamadasAnthropic[n]?.corpo as { tools?: { name: string }[] })?.tools) ?? []).map(t => t.name);

describe('v2 ligada no fluxo de vendas', () => {
  test('a v1 conduz, a v2 levanta os itens e o orçamento sai só com a lista confirmada', async () => {
    process.env.PIPELINE_VERSION = 'v2';
    // 1. CPF/CNPJ: é a v1, como sempre
    comRespostas([{ ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12.345.678/0001-90' } }] }, final('Achei seu cadastro. O que vai precisar?')]);
    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');
    assert.ok(ferramentasDaChamada(0).includes('levantar_itens') && !ferramentasDaChamada(0).includes('confirmar_itens'));

    // 2. os produtos: a v1 chama levantar_itens, a v2 extrai e manda as perguntas
    comRespostas([{ ferramentas: [{ nome: 'levantar_itens', entrada: {} }] }, EXTRACAO, final('Separei os itens, confere comigo:')]);
    await entregar(PEDIDO);
    const listaDaV2 = enviados().find(t => t.includes('Preciso confirmar'));
    assert.ok(listaDaV2?.includes('VERGALHAO CA50 1/2') && listaDaV2.includes('PREGO 17 X 21'), enviados().join(' || '));

    // 3. o cliente confirma os dois produtos: vai direto para a v2 (sem a v1)
    const perguntas = banco.v2_itens.filter(i => i.pergunta).map(i => (i.pergunta as { id: string }).id);
    comRespostas([{ json: { tipo_mensagem: 'resposta_pergunta', linhas: [], respostas_a_perguntas: perguntas.map(id => ({ pergunta_id: id, opcao_escolhida: 'sim' })) } }]);
    // A linha do CNPJ fica com o vendedor; desde 21/10 só as palavras do cliente tiram ela da lista.
    await entregar('1 sim, 2 sim, e pode seguir sem o resto');
    assert.ok(enviados().some(t => t.includes('Confere a lista?')), enviados().join(' || '));

    // 4. "sim" na lista: sem chamada de extração; com V2_ORCAMENTO=ligado a v1 segue para o orçamento
    process.env.V2_ORCAMENTO = 'ligado';
    comRespostas([
      { ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: 'CLI-4471', itens: [{ produto_codigo: '700005', quantidade: 10 }, { produto_codigo: '700113', quantidade: 8 }] } }] },
      final('Segue o seu orçamento.'),
    ]);
    await entregar('sim');
    assert.equal(erp.orcamentos.length, 1, 'um orçamento criado com a lista confirmada');
    assert.ok(String((http.chamadasAnthropic[0]?.corpo as { system?: unknown })?.system ? JSON.stringify((http.chamadasAnthropic[0].corpo as { system: unknown }).system) : '').includes('Lista confirmada pelo cliente'));
    delete process.env.V2_ORCAMENTO;
  });

  test('logs the v2 extraction cost in ai_usage under origem v2', async () => {
    process.env.PIPELINE_VERSION = 'v2';
    comRespostas([{ ferramentas: [{ nome: 'levantar_itens', entrada: {} }] }, EXTRACAO, final('Separei os itens:')]);
    await entregar(PEDIDO);
    assert.ok(((banco as unknown as Record<string, { origem?: string }[]>).ai_usage ?? []).some(r => r.origem === 'v2'));
  });

  test('sem V2_ORCAMENTO a conversa para na lista confirmada, sem IA e sem orçamento', async () => {
    process.env.PIPELINE_VERSION = 'v2';
    comRespostas([{ ferramentas: [{ nome: 'levantar_itens', entrada: {} }] }, EXTRACAO, final('Separei os itens:')]);
    // Os dois itens deste catálogo resolvem sozinhos: a lista já sai para o "sim".
    // Até 21/10 o pedido voltava a 'aguardando_confirmacao' depois do "sim" (T12),
    // e este teste confirmava duas vezes sem perceber.
    await entregar(PEDIDO);
    comRespostas([]);
    await entregar('sim');
    assert.ok(enviados().at(-1)?.includes('Lista confirmada!') && http.chamadasAnthropic.length === 0 && erp.orcamentos.length === 0, enviados().join(' || '));
  });

  test('o pedido confirmado fica confirmado (T12, 16/10)', async () => {
    process.env.PIPELINE_VERSION = 'v2';
    comRespostas([{ ferramentas: [{ nome: 'levantar_itens', entrada: {} }] }, EXTRACAO, final('Separei os itens:')]);
    await entregar(PEDIDO);
    comRespostas([]);
    await entregar('sim');
    assert.deepEqual(banco.v2_pedidos.map(p => p.estado), ['confirmado']);
  });

  test('a v1 não cria orçamento com item fora da lista confirmada', async () => {
    process.env.PIPELINE_VERSION = 'v2';
    comRespostas([{ ferramentas: [{ nome: 'levantar_itens', entrada: {} }] }, EXTRACAO, final('Separei os itens:')]);
    await entregar(PEDIDO);
    // sem confirmar a lista, a v1 tenta criar o orçamento: a trava recusa
    banco.v2_pedidos.length = 0;
    comRespostas([
      { ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: 'CLI-4471', itens: [{ produto_codigo: '700005', quantidade: 10 }] } }] },
      final('ok'),
    ]);
    await entregar('pode fechar');
    assert.equal(erp.orcamentos.length, 0);
  });

  test('com a chave desligada a v1 fica como sempre', async () => {
    delete process.env.PIPELINE_VERSION;
    comRespostas([final('Bom dia!')]);
    await entregar('bom dia');
    assert.ok(!ferramentasDaChamada(0).includes('levantar_itens'));
  });
});

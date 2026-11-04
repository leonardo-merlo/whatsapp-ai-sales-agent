// C6, item 4: o fluxo comercial inteiro, do webhook ao orçamento.
//
// A mensagem do cliente entra pelo webhook, a IA busca o produto no catálogo,
// identifica o cliente no sistema da Distribuidora Exemplo (aqui, o simulador), cria o
// orçamento e o cliente recebe os valores. **Nada é dublado no meio**: o motor
// é o de produção, o laço de ferramentas é o de produção, e o `fetch` que sai
// para o ERP cai no simulador que responde o contrato.
//
// Duas perguntas mandam neste arquivo, e as duas são sobre dinheiro:
//
// 1. **Os valores que o cliente lê vieram do sistema, ou o modelo os escreveu?**
//    O modelo é instruído a responder com um texto que contém um preço ERRADO
//    de propósito. Se esse preço aparecer no que o cliente recebeu, a proteção
//    não existe.
// 2. **Um pedido vira dois orçamentos?** A mesma mensagem reprocessada, e o
//    mesmo pedido feito duas vezes na mesma resposta, não podem criar dois
//    registros no sistema da Distribuidora Exemplo.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-VENDAS-E2E';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000000e2';
const MEMBRO_JOAO = 'membro-joao-e2e';
const INTEGRACAO = 'integracao-exemplo-e2e';
const CLIENTE_TELEFONE = '5500900000123';
const BASE_DO_ERP = 'https://erp.exemplo.teste/v1';
const CHAVE_DO_ERP = 'CHAVE-NO-VAULT';

const PRODUTOS_DO_ERP = [
  { codigo: '700005', descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40 },
  { codigo: '700113', descricao: 'PREGO 17 X 21', unidade: 'KG', preco: 17.6 },
];

let banco: Banco;
let http: HttpFalso;
let erp: SimuladorExemplo;
let tarefasPendentes: (() => Promise<void> | void)[] = [];
/** Quantas vezes a credencial foi pedida ao Vault. */
let leiturasDaCredencial = 0;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  // A fila NÃO está ligada por variável de ambiente de propósito: é o roteiro
  // de vendas que a torna obrigatória, e isso é conferido mais abaixo.
  delete process.env.WEBHOOK_FILA_ORGS;

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 73 90000-0007', papel: 'vendedor', member_id: MEMBRO_JOAO, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-vendas-e2e', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor João, da Distribuidora Exemplo.',
    tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  banco.organization_members = [
    { id: MEMBRO_JOAO, organization_id: ORG_A, nome: 'João', codigo_erp: 'V-07',
      telefone_whatsapp: '5573900000007', ativo: true, role: 'atendente' },
  ];
  banco.organization_integrations = [
    { id: INTEGRACAO, organization_id: ORG_A, tipo: 'erp', endereco_base: BASE_DO_ERP,
      token_secret_id: 'segredo-1', ativo: true, config: {} },
  ];
  banco.catalogo_grupos = [
    { id: 'g-4101', organization_id: ORG_A, codigo: '4101', nome: 'VERGALHOES CA50', ativo: true },
    { id: 'g-4900', organization_id: ORG_A, codigo: '4900', nome: 'PREGOS', ativo: true },
  ];
  banco.catalogo_produtos = [
    { id: 'p-1', organization_id: ORG_A, grupo_id: 'g-4101', codigo: '700005',
      descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40, dados: {}, ativo: true },
    { id: 'p-2', organization_id: ORG_A, grupo_id: 'g-4900', codigo: '700113',
      descricao: 'PREGO 17 X 21', unidade: 'KG', preco: 17.6, dados: {}, ativo: true },
  ];
  banco.erp_idempotencia = [];

  const supabase = criarSupabaseFalso(banco, {
    ...INDICES_UNICOS,
    unicos: {
      ...INDICES_UNICOS.unicos,
      // Espelha `erp_idempotencia_assinatura_unica`. É este índice que impede o
      // mesmo pedido virar dois orçamentos.
      erp_idempotencia: [['organization_id', 'operacao', 'assinatura']],
    },
    funcoes: {
      // A credencial mora no Vault e sai por função `SECURITY DEFINER`. O
      // dublê imita a função, não o Vault — o que importa é que a chave NUNCA
      // vem de coluna.
      credencial_da_integracao: () => { leiturasDaCredencial++; return CHAVE_DO_ERP; },
    },
  });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
});

beforeEach(() => {
  banco.contacts.length = 0;
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.ai_usage.length = 0;
  banco.erp_idempotencia.length = 0;
  tarefasPendentes = [];
  leiturasDaCredencial = 0;

  erp = criarSimuladorExemplo({
    produtos: PRODUTOS_DO_ERP,
    chave: CHAVE_DO_ERP,
    clientes: [{
      id: 'CLI-4471', documento: '12345678000190', tipo: 'PJ',
      nome: 'Construtora Aurora Ltda', cidade: 'Porto Seguro', uf: 'BA', vendedor_id: 'V-07',
    }],
  });
});

depois(() => http?.restaurar());

/** Instala o dublê da Anthropic e desvia o que for para o ERP ao simulador. */
function comRespostas(respostas: RespostaAnthropic[]) {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
  const fetchDoDuble = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith(BASE_DO_ERP)) return responderComoFetch(erp, BASE_DO_ERP, entrada, init);
    return fetchDoDuble(entrada, init);
  }) as typeof fetch;
}

async function entregar(texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE_TELEFONE, texto });
  const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  return resposta;
}

const PRECO_INVENTADO = 'R$ 999,99';
const FALA_DO_MODELO = `Prontinho! Segue o seu orçamento, o total ficou em ${PRECO_INVENTADO}.`;

const RESPOSTA_FINAL: RespostaAnthropic = {
  json: {
    resposta: FALA_DO_MODELO,
    transferir_para_atendente: false, questionario_completo: false, respostas: [],
    resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
    agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
};

const pedeBusca: RespostaAnthropic = { ferramentas: [{ nome: 'buscar_produtos', entrada: { assuntos: ['4101', '4900'] } }] };
const pedeCliente: RespostaAnthropic = { ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12.345.678/0001-90' } }] };
const pedeOrcamento: RespostaAnthropic = {
  ferramentas: [{
    nome: 'criar_orcamento',
    entrada: { cliente_id: 'CLI-4471', itens: [{ produto_codigo: '700005', quantidade: 10 }, { produto_codigo: '700113', quantidade: 8 }] },
  }],
};

const textosDaIA = () => banco.messages.filter(m => m.autor === 'ia').map(m => String(m.texto));
const enviadosAoCliente = () =>
  http.chamadasWhatsApp.map(c => String((c.corpo as { text?: { body?: string } })?.text?.body ?? ''));

describe('o caminho inteiro: produto, cliente, orçamento', () => {
  test('a IA percorre as ferramentas e o orçamento é criado no sistema', async () => {
    comRespostas([pedeBusca, pedeCliente, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90, quero 10 barras de 1/2 e 8 quilos de prego 17x21');

    assert.equal(erp.orcamentos.length, 1, 'um orçamento criado no sistema da Distribuidora Exemplo');
    const orcamento = erp.orcamentos[0];
    assert.equal(orcamento.itens.length, 2);
    assert.equal(orcamento.valor_total, 1208.6);

    // O vendedor do número foi junto, e veio do código cadastrado na tela.
    const criacao = erp.chamadas.find(c => c.metodo === 'POST' && c.caminho === '/orcamentos')!;
    assert.equal((criacao.corpo as { vendedor_id?: string }).vendedor_id, 'V-07');

    // A credencial foi buscada no Vault, e não de coluna.
    assert.ok(leiturasDaCredencial > 0);
    assert.equal(criacao.cabecalhos['authorization'], `Bearer ${CHAVE_DO_ERP}`);
  });

  test('os valores que o cliente lê vêm do sistema, não do modelo', async () => {
    comRespostas([pedeBusca, pedeCliente, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('quero 10 barras de 1/2 e 8 quilos de prego');

    const enviados = enviadosAoCliente();
    assert.equal(enviados.length, 2, 'a moldura do modelo e, depois, a tabela do sistema');

    // 1. A moldura veio do modelo, com o preço inventado que ele insistiu em escrever.
    assert.equal(enviados[0], FALA_DO_MODELO);

    // 2. A tabela veio do CÓDIGO, com os números do sistema.
    const tabela = enviados[1];
    assert.match(tabela, /CA50 1\/2 \(12\.5 MM\)/);
    assert.match(tabela, /PREGO 17 X 21/);
    assert.match(tabela, /Total: R\$ 1\.208,60/);
    assert.match(tabela, /Desconto: R\$ 56,20/);
    // E o preço que o modelo inventou NÃO está nela. Esta linha é a prova de
    // que o valor não passou pela escrita dele.
    assert.doesNotMatch(tabela, /999,99/);

    // As duas ficam na conversa, na ordem — para quem abre o painel é uma
    // conversa só.
    assert.deepEqual(textosDaIA(), [FALA_DO_MODELO, tabela]);
  });

  test('sem cadastro, a IA cadastra antes — e o telefone vem de quem escreveu', async () => {
    const pedeClienteNovo: RespostaAnthropic = { ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '11222333000144' } }] };
    const pedeCadastro: RespostaAnthropic = {
      ferramentas: [{ nome: 'cadastrar_cliente', entrada: { documento: '11222333000144', nome: 'Marcenaria Boa Vista Ltda', logradouro: 'Rua das Palmeiras', numero: '77', cidade: 'Eunapolis', uf: 'BA', cep: '45820000' } }],
    };
    comRespostas([pedeClienteNovo, pedeCadastro, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 11.222.333/0001-44');

    assert.equal(erp.clientes.length, 2, 'o cadastro novo entrou');
    const novo = erp.clientes.find(c => c.documento === '11222333000144')!;
    assert.equal(novo.nome, 'Marcenaria Boa Vista Ltda');
    // O telefone não é pedido ao modelo: vem de quem escreveu, que é o dado que
    // temos com certeza.
    assert.equal(novo.telefone, CLIENTE_TELEFONE);
    assert.equal(novo.vendedor_id, 'V-07');
  });
});

describe('um pedido nunca vira dois orçamentos', () => {
  test('o modelo pedindo o MESMO orçamento duas vezes cria um só', async () => {
    comRespostas([pedeBusca, pedeOrcamento, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('quero 10 barras de 1/2 e 8 quilos de prego');

    assert.equal(erp.orcamentos.length, 1, 'o segundo pedido foi barrado pela trava de idempotência');
    // E o cliente recebeu a tabela uma vez só.
    assert.equal(enviadosAoCliente().filter(t => t.includes('Total:')).length, 1);
  });

  test('a mesma mensagem respondida de novo (resposta perdida) não cria outro orçamento', async () => {
    comRespostas([pedeBusca, pedeCliente, pedeOrcamento, RESPOSTA_FINAL]);
    await entregar('quero 10 barras de 1/2 e 8 quilos de prego');
    assert.equal(erp.orcamentos.length, 1);

    // O cenário real: a resposta se perdeu (o `after()` morreu, o request foi
    // cortado) e a varredura chama o motor de novo para a MESMA mensagem do
    // cliente. Sem a trava, sai um segundo orçamento.
    banco.messages = banco.messages.filter(m => m.autor !== 'ia');
    comRespostas([pedeBusca, pedeCliente, pedeOrcamento, RESPOSTA_FINAL]);

    const { responderConversaComIA } = await import('@/lib/agente/responder-conversa');
    const { createServiceClient } = await import('@/lib/supabase/service');
    const conversa = banco.conversations[0];
    await responderConversaComIA(createServiceClient(), {
      orgId: ORG_A, conversationId: String(conversa.id), contatoNome: 'Cliente',
      destino: { telefone: CLIENTE_TELEFONE, bsuid: null }, phoneNumberId: NUMERO_VENDEDOR,
    });

    assert.equal(erp.orcamentos.length, 1, 'continua sendo um só');
    const criacoes = erp.chamadas.filter(c => c.metodo === 'POST' && c.caminho === '/orcamentos');
    assert.equal(criacoes.length, 1, 'a segunda tentativa nem chegou a sair para o ERP');
  });
});

describe('quando o sistema da Distribuidora Exemplo não responde', () => {
  test('o cliente final nunca fica sabendo que o sistema caiu', async () => {
    erp.definirFalha('fora-do-ar');
    comRespostas([pedeCliente, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90');

    // O que o modelo leu: instrução de conduta, não relato técnico.
    const segundaChamada = http.chamadasAnthropic[1]?.corpo as { messages?: { content: unknown }[] };
    const blocos = segundaChamada.messages?.at(-1)?.content as { content: string }[];
    assert.match(blocos[0].content, /NÃO diga ao cliente que o sistema está fora do ar/);
    assert.doesNotMatch(blocos[0].content, /503|fora do ar\./);
  });

  test('sem integração cadastrada, a conversa segue em vez de quebrar', async () => {
    const integracoes = banco.organization_integrations;
    banco.organization_integrations = [];
    try {
      comRespostas([pedeCliente, RESPOSTA_FINAL]);
      await entregar('meu cnpj é 12.345.678/0001-90');

      assert.equal(textosDaIA().length, 1, 'o cliente foi respondido mesmo assim');
      assert.equal(erp.chamadas.length, 0, 'e nada saiu para o ERP');
    } finally {
      banco.organization_integrations = integracoes;
    }
  });
});

describe('a fila em vendas', () => {
  test('o número de vendas usa a fila mesmo com WEBHOOK_FILA_ORGS desligada', async () => {
    comRespostas([RESPOSTA_FINAL]);
    assert.equal(process.env.WEBHOOK_FILA_ORGS, undefined, 'a chave está desligada');

    const { POST } = await import('@/app/api/webhooks/whatsapp/route');
    const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE_TELEFONE, texto: 'oi' });
    await POST(requisicaoDoWebhook(corpo, assinar(corpo)));

    // Antes de drenar: a mensagem do cliente já está gravada e a resposta não.
    assert.equal(banco.messages.filter(m => m.autor === 'cliente').length, 1);
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 0);
    assert.equal(tarefasPendentes.length, 1, 'a resposta foi adiada — é o que impede o reenvio da Meta');

    while (tarefasPendentes.length) await tarefasPendentes.shift()!();
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
  });
});

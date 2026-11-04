// C6, item 4: o cliente HTTP das quatro operações.
//
// Os testes rodam contra o **simulador** (`src/lib/erp/simulador.ts`), pelo
// `fetch` de verdade: nada aqui dubla o SDK nem a montagem do corpo. O que se
// mede é a política de erro, que é a parte que ninguém testa quando o servidor
// é real — e a parte que, errada, cria orçamento duplicado.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';
import { consultarClientePorDocumento } from '@/lib/erp/operacoes/consultar-cliente';
import { criarCliente } from '@/lib/erp/operacoes/criar-cliente';
import { cotarProdutos } from '@/lib/erp/operacoes/cotar';
import { criarOrcamento } from '@/lib/erp/operacoes/criar-orcamento';

const BASE = 'https://erp.exemplo/v1';
const CHAVE = 'chave-de-homologacao';
const conexao = { enderecoBase: BASE, token: CHAVE };

const PRODUTOS = [
  { codigo: '700005', descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40 },
  { codigo: '700113', descricao: 'PREGO 17 X 21', unidade: 'KG', preco: 17.6 },
];
const ENDERECO = {
  logradouro: 'Avenida Getulio Vargas', numero: '1250', complemento: null, bairro: 'Centro',
  cidade: 'Porto Seguro', uf: 'BA', cep: '45810000',
};
const CLIENTE = {
  id: 'Z06586/01', documento: '12345678000190', tipo: 'PJ' as const,
  nome: 'Construtora Aurora Ltda', endereco: ENDERECO,
  cidade: 'Porto Seguro', uf: 'BA', vendedor_id: 'V-07',
  situacao: 'ATIVO', podeFaturar: true,
};

let sim: SimuladorExemplo;
let fetchOriginal: typeof globalThis.fetch;

beforeEach(() => {
  sim = criarSimuladorExemplo({ produtos: PRODUTOS, clientes: [{ ...CLIENTE }], chave: CHAVE });
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) =>
    responderComoFetch(sim, BASE, entrada, init)) as typeof fetch;
});

afterEach(() => { globalThis.fetch = fetchOriginal; });

const CADASTRO = {
  documento: '98765432000155',
  nome: 'Obras Bahia',
  endereco: {
    logradouro: 'Rua das Palmeiras', numero: '77', complemento: null, bairro: 'Centro',
    cidade: 'Jundiai', uf: 'MG', cep: '36880000',
  },
};

describe('consultar cliente', () => {
  test('acha pelo POST, e "não encontrado" volta 200 em vez de erro', async () => {
    const achou = await consultarClientePorDocumento(conexao, '12.345.678/0001-90');
    assert.equal(achou.ok, true);
    assert.equal(achou.ok && achou.dados.encontrado, true);
    assert.equal(achou.ok && achou.dados.encontrado && achou.dados.cliente.id, 'Z06586/01');
    assert.equal(achou.ok && achou.dados.encontrado && achou.dados.cliente.cidade, 'Porto Seguro');

    // O documento vai no CORPO, não na query string: CPF e CNPJ em URL param em
    // log de proxy sem ninguém pedir.
    const chamada = sim.chamadas.at(-1)!;
    assert.equal(chamada.metodo, 'POST');
    assert.equal(chamada.caminho, '/clientes/consulta');
    assert.equal((chamada.corpo as Record<string, unknown>).documento, '12345678000190');

    const nao = await consultarClientePorDocumento(conexao, '99999999999');
    assert.equal(nao.ok, true, 'não encontrado é resposta, não falha — é o que manda a IA cadastrar');
    assert.deepEqual(nao.ok && nao.dados, { encontrado: false });
  });

  test('documento fora do tamanho nem chega a sair daqui', async () => {
    const antes = sim.chamadas.length;
    const r = await consultarClientePorDocumento(conexao, '123');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.codigo, 'documento_invalido');
    assert.equal(sim.chamadas.length, antes, 'nenhuma requisição foi feita');
  });
});

describe('criar cliente', () => {
  test('guarda as formas de pagamento que vêm na resposta do cadastro (14/10)', async () => {
    const resposta = {
      cliente_criado: true, cliente_id: 'Z00005/01', situacao: 'BLOQUEADO', empresas: [], regiao_atendida: false,
      formas_pagamento: [{ codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 }],
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(resposta), { status: 201 })) as typeof fetch;
    const r = await criarCliente(conexao, CADASTRO, 'chave-formas');
    assert.deepEqual(r.ok && r.dados.formas_pagamento?.map(f => f.codigo), ['PIX']);
  });

  test('cria, e o código nasce com Z', async () => {
    const r = await criarCliente(conexao, CADASTRO, 'chave-1');
    assert.equal(r.ok, true);
    // O Z é o que diz, olhando a base da Distribuidora Exemplo, o que nasceu de uma conversa.
    assert.match(r.ok ? r.dados.id : '', /^Z\d{5}\/01$/);
  });

  test('empresa nasce sem poder faturar, e isso NÃO é falha', async () => {
    const r = await criarCliente(conexao, CADASTRO, 'chave-pj');

    assert.equal(r.ok, true, 'cadastro bloqueado é o caminho normal de PJ, não um erro');
    if (!r.ok) return;
    assert.equal(r.dados.situacao, 'BLOQUEADO');
    assert.equal(r.dados.podeFaturar, false, 'bloqueado não fatura');
  });

  test('pessoa física nasce podendo faturar', async () => {
    const r = await criarCliente(conexao, { ...CADASTRO, documento: '09166691656', nome: 'Joao da Silva' }, 'chave-pf');
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.dados.podeFaturar, true);
  });

  test('endereço incompleto nem chega a sair daqui', async () => {
    const antes = sim.chamadas.length;
    const r = await criarCliente(
      conexao,
      { ...CADASTRO, endereco: { ...CADASTRO.endereco, cep: '' } },
      'chave-sem-cep',
    );

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.codigo, 'dados_obrigatorios_ausentes');
    assert.equal(!r.ok && r.campo, 'endereco.cep');
    assert.equal(sim.chamadas.length, antes, 'nenhuma requisição foi feita');
  });

  test('o corpo sai no formato da Distribuidora Exemplo, sem classificação fiscal', async () => {
    await criarCliente(conexao, { ...CADASTRO, telefone: '5573999990000', vendedorId: 'V-07' }, 'chave-2');

    const chamada = sim.chamadas.at(-1)!;
    assert.equal(chamada.caminho, '/clientes/novo');
    const corpo = chamada.corpo as Record<string, unknown>;
    assert.equal(corpo.telefone, '5573999990000');
    assert.equal(corpo.vendedor_id, 'V-07');
    assert.deepEqual((corpo.endereco as Record<string, unknown>).cep, '36880000');
    // Combinado com a Distribuidora Exemplo, e escrito nos dois documentos: a classificação
    // fiscal nasce pendente do lado deles, porque a IA não tem como apurar isso
    // numa conversa de WhatsApp e errar ali é errar ICMS.
    assert.equal('tipo_cliente' in corpo, false);
    assert.equal('segmento' in corpo, false);
  });

  test('documento já cadastrado volta como recusa, e a IA consulta de novo', async () => {
    const r = await criarCliente(conexao, { ...CADASTRO, documento: '12345678000190' }, 'chave-3');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, 'recusado');
    assert.equal(!r.ok && r.codigo, 'documento_ja_cadastrado', 'o código chega em MAIÚSCULAS e é normalizado aqui');
  });
});

describe('cotação (formato de precos, 08/10/2026)', () => {
  const itens = [{ produto_codigo: '700005', quantidade: 10 }, { produto_codigo: '700113', quantidade: 8 }];

  test('devolve itens com preço e o total', async () => {
    const r = await cotarProdutos(conexao, { clienteId: 'Z06586/01', condicaoPagamento: '001', itens });

    assert.equal(r.ok, true);
    assert.equal(r.ok && r.dados.itens.length, 2);
    assert.equal(r.ok && r.dados.valor_total, 1264.8);
  });

  test('manda condição de pagamento e produtos com os nomes do ERP', async () => {
    await cotarProdutos(conexao, { clienteId: 'Z06586/01', condicaoPagamento: '001', itens });

    assert.deepEqual(sim.chamadas.at(-1)?.corpo, {
      cliente_id: 'Z06586/01',
      condicao_pagamento: '001',
      produtos: [{ produto_id: '700005', quantidade: 10 }, { produto_id: '700113', quantidade: 8 }],
    });
  });

  test('traz saldo e estoque do ERP em cada item', async () => {
    sim = criarSimuladorExemplo({
      produtos: [{ ...PRODUTOS[1], saldo: 3.3 }], clientes: [{ ...CLIENTE }], chave: CHAVE,
    });
    const r = await cotarProdutos(conexao, {
      clienteId: 'Z06586/01', condicaoPagamento: '001', itens: [{ produto_codigo: '700113', quantidade: 8 }],
    });

    assert.equal(r.ok && r.dados.itens[0].saldo, 3.3);
    assert.equal(r.ok && r.dados.itens[0].estoque_disponivel, false);
  });

  test('recusa sem condição de pagamento, sem ir ao ERP', async () => {
    const r = await cotarProdutos(conexao, { clienteId: 'Z06586/01', itens });

    assert.equal(!r.ok && r.codigo, 'condicao_pagamento_ausente');
    assert.equal(sim.chamadas.length, 0);
  });

  test('produto sem preço (200 com encontrado: false) recusa a cotação inteira', async () => {
    const r = await cotarProdutos(conexao, {
      clienteId: 'Z06586/01', condicaoPagamento: '001',
      itens: [{ produto_codigo: '700005', quantidade: 1 }, { produto_codigo: '700999', quantidade: 1 }],
    });

    assert.equal(!r.ok && r.codigo, 'produto_nao_encontrado');
    assert.equal(!r.ok && r.campo, 'itens[1].produto_codigo');
  });

  test('lê uma resposta no formato da homologação (valores fictícios) de 08/10/2026', async () => {
    const real = {
      condicao_pagamento: '001', uf: 'MG', cliente_id: 'Z00002/01', vendedor_id: null,
      produtos: [
        { produto_id: '700170', encontrado: true, descricao: 'ELETRODO 46 2.50 (DENVER)', unidade: 'KG', quantidade: 10, preco_unitario: 34, total: 340, peso_kg: 10, empresa: 'EXEMPLO CENTRO', saldo: 512.4, estoque_disponivel: true, tabela_preco: 'T01', icms_st_estimado: 0 },
        { produto_id: '720013', encontrado: true, descricao: 'ARAME 12 (2,77 MM)', unidade: 'KG', quantidade: 10, preco_unitario: 21.5, total: 215, peso_kg: 10, empresa: 'EXEMPLO NORTE', saldo: 0, estoque_disponivel: false, tabela_preco: 'T02', icms_st_estimado: 48.1 },
      ],
      consultado_em: '2026-10-08T21:08:39-03:00',
      composicao_total: { mercadoria: true, frete: false, impostos: false },
    };
    globalThis.fetch = (async () => new Response(JSON.stringify(real), { status: 200 })) as typeof fetch;

    const r = await cotarProdutos(conexao, {
      clienteId: 'Z00002/01', condicaoPagamento: '001',
      itens: [{ produto_codigo: '700170', quantidade: 10 }, { produto_codigo: '720013', quantidade: 10 }],
    });

    assert.equal(r.ok && r.dados.valor_total, 555);
    assert.equal(r.ok && r.dados.itens[1].empresa, 'EXEMPLO NORTE');
  });
});

describe('criar orçamento', () => {
  const itens = [{ produto_codigo: '700005', quantidade: 10 }, { produto_codigo: '700113', quantidade: 8 }];

  test('a resposta traz o que a mensagem ao cliente precisa', async () => {
    const r = await criarOrcamento(conexao, { clienteId: 'Z06586/01', vendedorId: 'V-07', itens }, 'orc-1');

    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.dados.itens.length === 2 && r.dados.valor_total > 0);
    assert.equal(typeof r.dados.desconto_total, 'number');
  });

  test('resposta sem itens e valores é tratada como recusa, não como sucesso pela metade', async () => {
    // Um servidor que responde 201 com o orçamento pela metade é o caso que faz
    // a IA ter que escrever valor de memória — exatamente o que o desenho proíbe.
    globalThis.fetch = (async () => new Response(JSON.stringify({ orcamento: { id: 'ORC-1' } }), {
      status: 201, headers: { 'content-type': 'application/json' },
    })) as typeof fetch;

    const r = await criarOrcamento(conexao, { clienteId: 'Z06586/01', itens }, 'orc-2');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.codigo, 'orcamento_sem_valores');
  });

  test('sem cliente_id nem sai daqui', async () => {
    const antes = sim.chamadas.length;
    const r = await criarOrcamento(conexao, { clienteId: '', itens }, 'orc-3');
    assert.equal(r.ok, false);
    assert.equal(sim.chamadas.length, antes);
  });
});

describe('a política de retentativa, que é o ponto deste arquivo', () => {
  test('5xx é repetido, e a segunda tentativa vale', async () => {
    sim.definirFalha('instavel'); // falha a primeira vez de cada operação

    const r = await consultarClientePorDocumento(conexao, '12345678000190');

    assert.equal(r.ok, true, 'a retentativa salvou a consulta');
    assert.equal(sim.chamadas.length, 2, 'foram duas idas: a que falhou e a que deu certo');
  });

  test('4xx NUNCA é repetido — repetir um "não" só produz o mesmo "não"', async () => {
    const r = await criarOrcamento(conexao, {
      clienteId: 'CLI-NAO-EXISTE', itens: [{ produto_codigo: '700005', quantidade: 1 }],
    }, 'orc-4');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, 'recusado');
    assert.equal(sim.chamadas.length, 1, 'uma ida só');
  });

  test('401 vira motivo "credencial", separado de indisponível', async () => {
    const r = await consultarClientePorDocumento({ enderecoBase: BASE, token: 'errada' }, '12345678000190');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, 'credencial', 'chave errada é problema nosso, não do cliente final');
    assert.equal(sim.chamadas.length, 1, 'e também não se repete');
  });

  test('sistema fora do ar: tenta três vezes e desiste com "indisponivel"', async () => {
    sim.definirFalha('fora-do-ar');

    const r = await consultarClientePorDocumento(conexao, '12345678000190');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, 'indisponivel');
    assert.equal(sim.chamadas.length, 3, 'três tentativas, e só');
  });

  test('erro de rede também é repetido', async () => {
    let idas = 0;
    globalThis.fetch = (async () => {
      idas++;
      throw new Error('conexão recusada');
    }) as typeof fetch;

    const r = await consultarClientePorDocumento(conexao, '12345678000190');

    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.motivo, 'indisponivel');
    assert.equal(idas, 3);
  });
});

// C6, item 3: o simulador do sistema da Distribuidora Exemplo responde o contrato.
//
// A API deles não existe ainda. Estes testes são o que garante que o simulador
// não vira ficção: cada caso aqui é um trecho de `docs/contrato-api-exemplo.md`,
// e o mesmo simulador é o alvo do cliente HTTP do item 4. Quando a Distribuidora Exemplo
// entregar homologação, o que muda é o endereço base — e estes testes passam a
// ser a descrição do que se espera do servidor deles.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';

const CHAVE = 'chave-de-homologacao';
const BASE = 'https://erp.exemplo/v1';

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
/** O endereço completo que a Distribuidora Exemplo exige em todo cadastro novo. */
const ENDERECO_NOVO = {
  logradouro: 'Rua das Palmeiras', numero: '77', bairro: 'Centro',
  cidade: 'Jundiai', uf: 'MG', cep: '36880000',
};

let sim: SimuladorExemplo;

beforeEach(() => {
  sim = criarSimuladorExemplo({ produtos: PRODUTOS, clientes: [{ ...CLIENTE }], chave: CHAVE });
});

/** Chama o simulador como o cliente HTTP vai chamar. */
async function chamar(metodo: string, caminho: string, corpo?: unknown, extras: Record<string, string> = {}) {
  const resposta = await responderComoFetch(sim, BASE, `${BASE}${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${CHAVE}`, 'content-type': 'application/json', ...extras },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: resposta.status, corpo: await resposta.json() };
}

describe('operação 1 · consultar cliente', () => {
  test('acha pelo documento, mesmo mandado com ponto e barra', async () => {
    const r = await chamar('POST', '/clientes/consulta', { documento: '12.345.678/0001-90' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.encontrado, true);
    assert.equal(r.corpo.cliente_id, 'Z06586/01');
    assert.equal(r.corpo.vendedor_id, 'V-07');
  });

  test('não cadastrado é 200 com encontrado:false, e não um erro', async () => {
    // É o caminho previsto que leva ao cadastro. Erro faria o atendimento parar
    // numa situação que é rotina.
    const r = await chamar('POST', '/clientes/consulta', { documento: '99999999999' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.encontrado, false);
    assert.equal(r.corpo.cliente_id, null);
  });

  test('sem documento é 400', async () => {
    const r = await chamar('POST', '/clientes/consulta', {});
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'DOCUMENTO_INVALIDO');
  });
});

describe('operação 2 · criar cliente', () => {
  test('cria, o código nasce com Z e a empresa nasce bloqueada', async () => {
    const r = await chamar('POST', '/clientes/novo',
      { documento: '98765432000155', nome: 'Obras Bahia Ltda', telefone: '5573900000000', endereco: ENDERECO_NOVO },
      { 'idempotency-key': 'k1' });

    assert.equal(r.status, 201);
    assert.match(r.corpo.cliente_id, /^Z\d{5}\/01$/);
    // Pessoa jurídica entra sem classificação fiscal e o comercial confere.
    assert.equal(r.corpo.situacao, 'BLOQUEADO');
    assert.equal(r.corpo.regiao_atendida, true);
    assert.equal(sim.clientes.length, 2);
  });

  test('pessoa física nasce ativa', async () => {
    const r = await chamar('POST', '/clientes/novo',
      { documento: '09166691656', nome: 'Joao da Silva', endereco: ENDERECO_NOVO },
      { 'idempotency-key': 'k-pf' });

    assert.equal(r.status, 201);
    assert.equal(r.corpo.situacao, 'ATIVO');
  });

  test('a MESMA chave de idempotência não cria um segundo cadastro', async () => {
    const corpo = { documento: '98765432000155', nome: 'Obras Bahia Ltda', endereco: ENDERECO_NOVO };
    const primeira = await chamar('POST', '/clientes/novo', corpo, { 'idempotency-key': 'k1' });
    const segunda = await chamar('POST', '/clientes/novo', corpo, { 'idempotency-key': 'k1' });

    assert.equal(segunda.corpo.cliente_id, primeira.corpo.cliente_id);
    assert.equal(sim.clientes.length, 2, 'um cliente novo, não dois');
  });

  test('documento que já existe é 409, e a IA consulta de novo', async () => {
    const r = await chamar('POST', '/clientes/novo',
      { documento: '12345678000190', nome: 'Outro nome qualquer', endereco: ENDERECO_NOVO },
      { 'idempotency-key': 'k2' });

    assert.equal(r.status, 409);
    assert.equal(r.corpo.erro.codigo, 'DOCUMENTO_JA_CADASTRADO');
  });

  test('endereço incompleto é recusado, com o campo apontado', async () => {
    const r = await chamar('POST', '/clientes/novo',
      { documento: '98765432000155', nome: 'Obras Bahia', endereco: { ...ENDERECO_NOVO, cep: '' } });

    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'DADOS_OBRIGATORIOS_AUSENTES');
    assert.equal(r.corpo.erro.campo, 'endereco.cep');
  });

  test('documento fora do tamanho é recusado com 422', async () => {
    const r = await chamar('POST', '/clientes/novo', { documento: '123', nome: 'Fulano', endereco: ENDERECO_NOVO });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'documento_invalido');
    assert.equal(r.corpo.erro.campo, 'documento');
  });
});

describe('operação 3 · consulta de preço (formato de precos)', () => {
  const pedido = {
    cliente_id: 'Z06586/01', condicao_pagamento: '001',
    produtos: [{ produto_id: '700005', quantidade: 10 }, { produto_id: '700113', quantidade: 8 }],
  };

  test('devolve preço unitário e total por produto', async () => {
    const r = await chamar('POST', '/cotacoes', pedido);

    assert.equal(r.status, 200);
    const [vergalhao, prego] = r.corpo.produtos;
    assert.equal(vergalhao.preco_unitario, 112.40);
    assert.equal(prego.total, 140.8);
  });

  test('não cria registro nenhum — é só consulta', async () => {
    await chamar('POST', '/cotacoes', pedido);
    assert.equal(sim.orcamentos.length, 0);
  });

  test('produto sem preço volta 200 com encontrado: false, e o resto vem', async () => {
    const r = await chamar('POST', '/cotacoes', {
      ...pedido, produtos: [{ produto_id: '700005', quantidade: 1 }, { produto_id: '700999', quantidade: 1 }],
    });

    assert.equal(r.status, 200);
    assert.deepEqual(r.corpo.produtos.map((p: { encontrado: boolean }) => p.encontrado), [true, false]);
  });

  test('sem condição de pagamento é 400 FORMA_PAGAMENTO_INVALIDA', async () => {
    const r = await chamar('POST', '/cotacoes', { ...pedido, condicao_pagamento: undefined });

    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro.codigo, 'FORMA_PAGAMENTO_INVALIDA');
  });

  test('quantidade zero vira 1, como no real', async () => {
    const r = await chamar('POST', '/cotacoes', { ...pedido, produtos: [{ produto_id: '700005', quantidade: 0 }] });
    assert.equal(r.corpo.produtos[0].quantidade, 1);
  });
});

describe('operação 4 · criar orçamento', () => {
  const pedido = {
    cliente_id: 'Z06586/01', vendedor_id: 'V-07', canal: 'whatsapp',
    itens: [{ produto_codigo: '700005', quantidade: 10 }, { produto_codigo: '700113', quantidade: 8 }],
  };

  test('cria com itens, valores e desconto na resposta', async () => {
    const r = await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o1' });

    assert.equal(r.status, 201);
    const orc = r.corpo.orcamento;
    assert.match(orc.id, /^ORC-/);
    assert.equal(orc.itens.length, 2);
    assert.equal(orc.valor_total, 1208.6);
    assert.equal(orc.desconto_total, 56.20);
    // São estes três campos que a mensagem ao cliente copia. Sem eles a IA
    // teria que escrever valor de memória — o que o desenho inteiro proíbe.
    for (const item of orc.itens) {
      assert.ok(item.descricao && item.preco_unitario > 0 && item.valor_total > 0);
    }
  });

  test('a MESMA chave de idempotência não cria um segundo orçamento', async () => {
    const a = await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o1' });
    const b = await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o1' });

    assert.equal(b.corpo.orcamento.id, a.corpo.orcamento.id);
    assert.equal(sim.orcamentos.length, 1, 'é ESTE teste que impede orçamento duplicado quando a Meta reenvia');
  });

  test('chave diferente cria outro orçamento', async () => {
    await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o1' });
    await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o2' });
    assert.equal(sim.orcamentos.length, 2);
  });

  test('cliente que não existe é recusado com 422', async () => {
    const r = await chamar('POST', '/orcamentos', { ...pedido, cliente_id: 'CLI-0000' });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'cliente_nao_encontrado');
  });

  test('cliente sem crédito é recusado, e nada é criado', async () => {
    sim.definirFalha('sem-credito');
    const r = await chamar('POST', '/orcamentos', pedido, { 'idempotency-key': 'o9' });

    assert.equal(r.status, 422);
    assert.equal(r.corpo.erro.codigo, 'cliente_sem_credito');
    assert.equal(sim.orcamentos.length, 0);
  });
});

describe('os caminhos ruins, que é para o que o simulador existe', () => {
  test('chave errada é 401 em qualquer operação', async () => {
    const resposta = await responderComoFetch(sim, BASE, `${BASE}/clientes/consulta`, {
      method: 'GET', headers: { authorization: 'Bearer errada' },
    });
    assert.equal(resposta.status, 401);
  });

  test('sistema fora do ar é 503, e não uma resposta vazia', async () => {
    sim.definirFalha('fora-do-ar');
    const r = await chamar('POST', '/clientes/consulta', { documento: '12345678000190' });
    assert.equal(r.status, 503);
  });

  test('instável: falha a primeira vez de cada operação e acerta na segunda', async () => {
    sim.definirFalha('instavel');
    const primeira = await chamar('POST', '/clientes/consulta', { documento: '12345678000190' });
    const segunda = await chamar('POST', '/clientes/consulta', { documento: '12345678000190' });

    assert.equal(primeira.status, 502);
    assert.equal(segunda.status, 200, 'é este cenário que separa retentativa que funciona de repetição do erro');
  });

  test('rota que não existe no contrato é 404 com código', async () => {
    const r = await chamar('GET', '/inventada');
    assert.equal(r.status, 404);
    assert.equal(r.corpo.erro.codigo, 'rota_desconhecida');
  });
});

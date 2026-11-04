// A forma de pagamento depois da lista confirmada (pedido do Leonardo em 14/10).
// As formas imitam a consulta de cliente da homologação da Distribuidora Exemplo de 14/10:
// o código agrupa por tipo, esconde o que não é por link e resolve o cartão
// por parcela e bandeira.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { FormaDePagamentoDoErp } from '@/lib/erp/contrato';
import { formasDaResposta } from '@/lib/erp/operacoes/consultar-cliente';
import { escolherPagamento, linhasDoMenu, opcoesDoOrcamento, opcoesOferecidas, rotuloDaDescricao, rotuloDaOpcao, textoDoPagamento, type Escolha } from '@/lib/agente/maquina/pagamento';
import { passo, type Evento } from '@/lib/agente/maquina/transicoes';
import { textoDaEtapa } from '@/lib/agente/maquina/textos';
import { LEITURA_VAZIA, type ClienteDoOrcamento, type EstadoDoOrcamento, type Leitura, type PagamentoParcial } from '@/lib/agente/maquina/tipos';
import { resumirOrcamento } from '@/lib/data/orcamentos-do-contato';

const forma = (codigo: string, descricao: string, tipo: string, parcelas = 1, extra: Partial<FormaDePagamentoDoErp> = {}): FormaDePagamentoDoErp => ({
  codigo, descricao, forma: tipo, parcelas, disponivel: true, valor_minimo: null, valor_maximo: 50000, ...extra,
});

const FORMAS: FormaDePagamentoDoErp[] = [
  forma('001', 'A VISTA', 'R$'),
  forma('B00', 'BOL ANTECIPADO', 'BO', 1, { valor_minimo: 50, valor_maximo: 10000 }),
  forma('CB1', 'CARTAO BNDES VISA', 'CC'),
  forma('CB2', 'CARTAO BNDES MASTER', 'CC'),
  forma('CDM', 'CARTAO DEBITO MASTER', 'CD'),
  forma('CDV', 'CARTAO DEBITO VISA', 'CD'),
  ...[1, 2, 3, 4, 5, 6].map(n => forma(`CM${n}`, `C.C. MASTER ${n} PARCELAS`, 'CC', n)),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => forma(`CV${n}`, `C.C. VISA ${n} PARCELAS`, 'CC', n)),
  forma('CVA', 'C.C. VISA 10 PARCELAS', 'CC', 10),
  forma('PIX', 'PIX', 'PIX', 1, { valor_minimo: 0.01, valor_maximo: 10000 }),
  forma('R01', 'RECEBER NA ENTREGA', 'DP'),
  forma('RE1', 'R.E. A VISTA', 'DP'),
];
const OPCOES = opcoesOferecidas(FORMAS);
const escolher = (texto: string, parcial?: PagamentoParcial, pergunta: string | null = 'pagamento'): Escolha =>
  escolherPagamento(OPCOES, texto, parcial, pergunta);
const codigo = (e: Escolha): string | null => (e.tipo === 'escolhida' ? e.opcao.codigo : null);

const CNPJ = '11222333000181';
const CLIENTE: ClienteDoOrcamento = {
  id: 'Z00002/01', nome: 'EMPRESA TESTE AGENTE LTDA', cidade: 'JUNDIAI', uf: 'MG',
  situacao: 'BLOQUEADO', pode_faturar: false, confirmado: true, origem: 'erp',
};
const ITENS = [{ item_id: 'i1', codigo: '700123', descricao: 'VERGALHAO', quantidade: '10' }];

describe('o menu de formas de pagamento', () => {
  test('agrupa os cartões e esconde o que não é pago por link', () => {
    assert.deepEqual(linhasDoMenu(OPCOES), ['PIX', 'Boleto antecipado', 'Cartão de crédito em até 10x', 'Cartão de débito', 'Cartão BNDES']);
  });

  test('não oferece a forma que o ERP marcou como indisponível', () => {
    const opcoes = opcoesOferecidas([forma('PIX', 'PIX', 'PIX', 1, { disponivel: false }), forma('B00', 'BOL ANTECIPADO', 'BO')]);
    assert.deepEqual(linhasDoMenu(opcoes), ['Boleto antecipado']);
  });

  test('escreve por extenso as abreviações do cadastro deles', () => {
    assert.deepEqual(['BOL ANTECIPADO', 'C. C. 13 PARCELAS'].map(rotuloDaDescricao), ['Boleto antecipado', 'Cartão de crédito 13 parcelas']);
  });
});

describe('a escolha do cliente', () => {
  test('resolve na hora o tipo com uma condição só', () => {
    assert.deepEqual([codigo(escolher('pix')), codigo(escolher('Pode ser no boleto'))], ['PIX', 'B00']);
  });

  test('resolve o cartão com parcela e bandeira na mesma mensagem', () => {
    assert.equal(codigo(escolher('3x no visa')), 'CV3');
  });

  test('pergunta as parcelas quando o cliente só diz cartão', () => {
    const e = escolher('cartão');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.parcial], ['parcelas', { grupo: 'credito' }]);
  });

  test('pergunta a bandeira quando a parcela existe nas duas', () => {
    const e = escolher('3x');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.parcial], ['bandeira', { grupo: 'credito', parcelas: 3 }]);
  });

  test('junta a resposta ao que o cliente já tinha dito', () => {
    assert.deepEqual([
      codigo(escolher('visa', { grupo: 'credito', parcelas: 3 }, 'bandeira')),
      codigo(escolher('5', { grupo: 'credito', bandeira: 'MASTER' }, 'parcelas')),
    ], ['CV3', 'CM5']);
  });

  test('escolhe sozinho a bandeira que é a única com aquela parcela', () => {
    assert.equal(codigo(escolher('cartão em 8 vezes')), 'CV8');
  });

  test('avisa o limite quando a parcela não existe naquela bandeira', () => {
    const e = escolher('10x no master');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.foraDoLimite, e.parcial], ['parcelas', true, { grupo: 'credito', bandeira: 'MASTER' }]);
  });

  test('pergunta a bandeira do débito', () => {
    assert.deepEqual([escolher('débito').tipo, codigo(escolher('débito visa'))], ['falta', 'CDV']);
  });

  test('recomeça quando o cliente troca de tipo no meio', () => {
    assert.equal(codigo(escolher('não, prefiro pix', { grupo: 'credito', parcelas: 3 }, 'bandeira')), 'PIX');
  });

  test('não aceita o que não é pago por link nem o que não entendeu', () => {
    assert.deepEqual([escolher('dinheiro').tipo, escolher('receber na entrega').tipo], ['nada', 'nada']);
  });

  test('ignora o tipo que o cliente negou', () => {
    assert.deepEqual(
      ['não quero pix, quero boleto', 'nao pix, boleto', 'pix não, boleto', 'quero boleto e não pix', 'não tenho cartão, vai no pix'].map(f => codigo(escolher(f))),
      ['B00', 'B00', 'B00', 'B00', 'PIX'],
    );
  });

  test('ignora a bandeira que o cliente negou', () => {
    assert.equal(codigo(escolher('3x, não no master, no visa')), 'CV3');
  });

  test('não escolhe nada quando o cliente só nega', () => {
    assert.deepEqual([escolher('não quero boleto').tipo, escolher('pix não').tipo], ['nada', 'nada']);
  });

  test('fica com a preferência quando o cliente cita duas formas', () => {
    assert.deepEqual(['prefiro boleto, mas pode ser pix', 'pode ser pix, mas prefiro boleto'].map(f => codigo(escolher(f))), ['B00', 'B00']);
  });

  test('não escolhe sozinho entre duas formas sem preferência', () => {
    assert.deepEqual([escolher('pix ou boleto, tanto faz').tipo, escolher('débito ou crédito').tipo], ['nada', 'nada']);
  });

  test('continua lendo frases com não que não negam a forma', () => {
    assert.deepEqual(['não sei, pode ser pix', 'pix, se não der boleto', 'débito master', 'cartão bndes em 3x'].map(f => escolher(f)).map(e => e.tipo === 'escolhida' ? e.opcao.codigo : e.tipo), ['PIX', 'PIX', 'CDM', 'falta']);
  });

  test('diz que não está liberado o tipo que o cliente não tem', () => {
    assert.equal(escolherPagamento(opcoesOferecidas([forma('PIX', 'PIX', 'PIX')]), 'boleto', undefined, 'pagamento').tipo, 'indisponivel');
  });
});

describe('as perguntas do cartão', () => {
  const dados = (parcial: PagamentoParcial): EstadoDoOrcamento['dados'] => ({ cliente: { ...CLIENTE, formas_pagamento: FORMAS }, pagamento_parcial: parcial });

  test('pergunta parcela e bandeira juntas quando faltam as duas', () => {
    assert.equal(textoDoPagamento('parcelas', dados({ grupo: 'credito' })), 'Em quantas vezes? Vai até 10x. E é Master ou Visa?');
  });

  test('diz até quantas vezes vai na bandeira escolhida', () => {
    assert.equal(textoDoPagamento('parcelas_fora', dados({ grupo: 'credito', bandeira: 'MASTER' })), 'No cartão de crédito Master vai até 6x. Em quantas vezes?');
  });
});

// Teste de campo de 21/10: o Leonardo escolheu "cartão de débito", respondeu "master" à bandeira
// e saiu "cartão de crédito Master em 3x". E o Master, que vai até 6x, dizia "vai até 24x".
describe('o cartão no teste de campo de 21/10', () => {
  const FORMAS_21_10: FormaDePagamentoDoErp[] = [
    ...FORMAS,
    // CVD a CVO da homologação: a descrição diz 13 a 24 parcelas, sem bandeira, e o campo diz 3.
    ...[13, 14, 24].map(n => forma(`CX${n}`, `C. C. ${n} PARCELAS`, 'CC', 3)),
  ];
  const opcoes = opcoesOferecidas(FORMAS_21_10);
  const dados = (parcial: PagamentoParcial): EstadoDoOrcamento['dados'] => ({ cliente: { ...CLIENTE, formas_pagamento: FORMAS_21_10 }, pagamento_parcial: parcial });

  test('a bandeira respondida no débito continua no débito', () => {
    assert.equal(codigo(escolherPagamento(opcoes, 'master', { grupo: 'debito' }, 'bandeira')), 'CDM');
  });

  test('o Master vai até 6x, não até 24x', () => {
    assert.equal(textoDoPagamento('parcelas_fora', dados({ grupo: 'credito', bandeira: 'MASTER' })), 'No cartão de crédito Master vai até 6x. Em quantas vezes?');
  });

  test('cartão sem bandeira cuja descrição contradiz o campo de parcelas não entra no menu', () => {
    assert.ok(linhasDoMenu(opcoes).includes('Cartão de crédito em até 10x'));
  });

  test('"12" no Master pede de novo com o limite certo', () => {
    const e = escolherPagamento(opcoes, '12', { grupo: 'credito', bandeira: 'MASTER' }, 'parcelas');
    assert.equal(e.tipo === 'falta' && e.foraDoLimite, true);
  });
});

// TI do cliente, 21/10: a consulta passou a mandar `tipo` (PIX, BOLETO, CARTAO_CREDITO, CARTAO_DEBITO) e
// `bandeira` (VISA, MASTERCARD, ou null quando o cliente escolhe a bandeira no link). Formas reais da
// consulta do Z00005/01 de 21/10.
describe('os campos tipo e bandeira do ERP (21/10)', () => {
  const FORMAS_NOVAS: FormaDePagamentoDoErp[] = [
    forma('PIX', 'PIX', 'PIX', 1, { tipo: 'PIX', bandeira: null, valor_maximo: 10000 }),
    forma('CDM', 'CARTAO DEBITO MASTER', 'CD', 1, { tipo: 'CARTAO_DEBITO', bandeira: 'MASTERCARD' }),
    forma('CM3', 'C.C. MASTER 3 PARCELAS', 'CC', 3, { tipo: 'CARTAO_CREDITO', bandeira: 'MASTERCARD' }),
    forma('CV3', 'C.C. VISA 3 PARCELAS', 'CC', 3, { tipo: 'CARTAO_CREDITO', bandeira: 'VISA' }),
    forma('CVD', 'C. C. 13 PARCELAS', 'CC', 13, { tipo: 'CARTAO_CREDITO', bandeira: null }),
    forma('X01', 'CONDICAO NOVA', 'ZZ', 1, { tipo: 'BOLETO', bandeira: null }),
  ];
  const opcoes = opcoesOferecidas(FORMAS_NOVAS);

  test('o tipo do ERP decide o grupo, sem olhar o código da forma', () => {
    assert.equal(opcoes.find(o => o.codigo === 'X01')?.grupo, 'boleto');
  });
  test('a bandeira MASTERCARD do ERP atende quem responde "master"', () => {
    assert.equal(codigo(escolherPagamento(opcoes, 'master 3x', { grupo: 'credito' }, 'parcelas')), 'CM3');
  });
  test('cartão sem bandeira do ERP vale para a bandeira que o cliente escolher', () => {
    assert.equal(codigo(escolherPagamento(opcoes, '13x', { grupo: 'credito', bandeira: 'MASTER' }, 'parcelas')), 'CVD');
  });
  test('a consulta guarda o tipo e a bandeira', () => {
    const [f] = formasDaResposta([{ codigo: 'CM3', descricao: 'C.C. MASTER 3 PARCELAS', forma: 'CC', tipo: 'CARTAO_CREDITO', bandeira: 'MASTERCARD', parcelas: 3, disponivel: true }]);
    assert.deepEqual([f.tipo, f.bandeira], ['CARTAO_CREDITO', 'MASTERCARD']);
  });
});

// Teste de 16/10: o cadastro de teste passou a receber 211 formas, 91 de boleto, e o menu listou todas.
const FORMAS_COM_PRAZOS: FormaDePagamentoDoErp[] = [
  forma('PIX', 'PIX', 'PIX'),
  forma('B00', 'BOL ANTECIPADO', 'BO'),
  forma('B28', 'BOLETO 28 DIAS', 'BO'),
  forma('B30', 'BOLETO 30 DIAS', 'BO'),
  forma('B36', 'BOLETO 30/60 DIAS', 'BO'),
  forma('B39', 'BOLETO 30/60/90 DIAS', 'BO'),
  forma('B24', '10,20,40 DIAS BOLETO', 'BO'),
  forma('BX5', 'BOLETO 5X', 'BO'),
  forma('BX7', 'BOLETO 7X 30/45/60/75/90/105/120', 'BO'),
  forma('BXA', 'BOLETO 10X', 'BOL'),
  forma('CV3', 'C.C. VISA 3 PARCELAS', 'CC', 3),
  forma('CHQ', 'CHEQUES', 'CQ'),
  forma('X35', '35 DIAS', ''),
];
const COM_PRAZOS = opcoesOferecidas(FORMAS_COM_PRAZOS);
const prazo = (texto: string): string | null => codigo(escolherPagamento(COM_PRAZOS, texto, { grupo: 'boleto' }, 'opcao_de_pagamento'));

describe('o boleto com muitos prazos', () => {
  const dados = (parcial?: PagamentoParcial): EstadoDoOrcamento['dados'] =>
    ({ cliente: { ...CLIENTE, formas_pagamento: FORMAS_COM_PRAZOS }, ...(parcial ? { pagamento_parcial: parcial } : {}) });

  test('mostra o boleto numa linha só e deixa cheque e forma sem tipo de fora', () => {
    assert.deepEqual(linhasDoMenu(COM_PRAZOS), ['PIX', 'Boleto', 'Cartão de crédito em até 3x']);
  });

  test('pergunta o prazo quando o cliente só diz boleto', () => {
    const e = escolherPagamento(COM_PRAZOS, 'boleto', undefined, 'pagamento');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.parcial], ['opcao_de_pagamento', { grupo: 'boleto' }]);
  });

  test('pergunta o prazo com exemplos dos que estão liberados', () => {
    assert.equal(textoDoPagamento('opcao', dados({ grupo: 'boleto' })), 'Em qual prazo? Por exemplo: antecipado, 28 dias, 30 dias, 30/60 dias ou 30/60/90 dias.');
  });

  test('casa o prazo em dias escrito de vários jeitos', () => {
    assert.deepEqual(['30/60/90', '30, 60 e 90 dias', '30 60 90', '28 dias', '10/20/40'].map(prazo), ['B39', 'B39', 'B39', 'B28', 'B24']);
  });

  test('casa o boleto em vezes e o antecipado', () => {
    assert.deepEqual(['5x', '10 vezes', '7x', 'antecipado'].map(prazo), ['BX5', 'BXA', 'BX7', 'B00']);
  });

  test('resolve tipo e prazo na mesma mensagem', () => {
    assert.deepEqual(['boleto 30/60', 'boleto em 5x'].map(f => codigo(escolherPagamento(COM_PRAZOS, f, undefined, 'pagamento'))), ['B36', 'BX5']);
  });

  test('avisa quando o prazo pedido não está liberado', () => {
    const e = escolherPagamento(COM_PRAZOS, '45 dias', { grupo: 'boleto' }, 'opcao_de_pagamento');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.foraDoLimite, e.parcial], ['opcao_de_pagamento', true, { grupo: 'boleto' }]);
  });

  test('não confunde entrada mais 30 com boleto 30 dias', () => {
    assert.equal(prazo('entrada + 30'), null);
  });

  test('não troca para o cartão quando a resposta do prazo é em vezes', () => {
    const e = escolherPagamento(COM_PRAZOS, '3x', { grupo: 'boleto' }, 'opcao_de_pagamento');
    assert.deepEqual(e.tipo === 'falta' && e.parcial, { grupo: 'boleto' });
  });

  test('diz que o prazo não está liberado e mostra exemplos', () => {
    assert.equal(textoDoPagamento('opcao_fora', dados({ grupo: 'boleto' })), 'Esse prazo não está disponível para este pedido. Alguns que estão: antecipado, 28 dias, 30 dias, 30/60 dias ou 30/60/90 dias. Qual prefere?');
  });

  test('confirma o boleto com o prazo por extenso', () => {
    const o = COM_PRAZOS.find(x => x.codigo === 'B39')!;
    assert.equal(rotuloDaOpcao(o), 'boleto 30/60/90 dias');
  });
});

const levantando = (cliente: ClienteDoOrcamento): EstadoDoOrcamento => ({
  etapa: 'levantando_itens', pergunta: 'produtos', desdeMensagem: 'm0',
  dados: { documento: { valor: CNPJ, origem: 'cliente' }, cliente, entrega: { cidade: 'JUNDIAI', uf: 'MG', regioes: ['M01'], origem: 'cliente' } },
});
const confirmou: Evento = { tipo: 'v2', pedidoId: 'p1', texto: '', confirmados: ITENS };
const msg = (id: string, texto: string, leitura: Partial<Leitura> = {}): Evento =>
  ({ tipo: 'mensagem', mensagem: { mensagemId: id, texto, documento: null, documentoInvalido: false, leitura: { ...LEITURA_VAZIA, ...leitura } } });

describe('a etapa da forma de pagamento', () => {
  const pagando = passo(levantando({ ...CLIENTE, formas_pagamento: FORMAS }), confirmou, 'm7').estado!;

  test('T14: a lista confirmada pergunta a forma de pagamento', () => {
    const p = passo(levantando({ ...CLIENTE, formas_pagamento: FORMAS }), confirmou, 'm7');
    assert.deepEqual([p.estado?.etapa, p.estado?.pergunta, p.fala], ['definindo_pagamento', 'pagamento', { tipo: 'fixa', chave: 'lista_confirmada_pedir_pagamento' }]);
  });

  test('mostra os tipos em tópicos depois do "Lista confirmada!"', () => {
    assert.equal(textoDaEtapa('lista_confirmada_pedir_pagamento', pagando, { estados: [] }),
      'Lista confirmada! Como prefere pagar?\n\n• PIX\n• Boleto antecipado\n• Cartão de crédito em até 10x\n• Cartão de débito\n• Cartão BNDES');
  });

  test('sem nenhuma forma pagável por link, para no vendedor como antes', () => {
    const p = passo(pagando, { tipo: 'formas_de_pagamento', formas: [forma('R01', 'RECEBER NA ENTREGA', 'DP')] }, 'm7');
    assert.deepEqual([p.estado?.etapa, p.estado?.motivoPausa, p.fala], ['aguardando_vendedor', 'lista_confirmada', { tipo: 'fixa', chave: 'lista_confirmada' }]);
  });

  test('T15: a escolha consulta o preço da lista com a condição escolhida', () => {
    const p = passo(pagando, msg('m8', 'pix'), 'm8');
    assert.deepEqual([p.estado?.etapa, p.acao], ['definindo_pagamento', { tipo: 'cotar', condicao: 'PIX', clienteId: 'Z00002/01', itens: [{ codigo: '700123', quantidade: '10' }] }]);
  });

  const escolheuBoleto = passo(pagando, msg('m8', 'boleto'), 'm8').estado!;
  const cotou = (total: number): Evento => ({
    tipo: 'cotacao', resultado: 'ok',
    cotacao: { condicao: 'B00', valor_total: total, consultado_em: null, itens: [{ codigo: '700123', quantidade: 10, preco_unitario: total / 10, valor_total: total, estoque_disponivel: true, empresa: 'EXEMPLO CENTRO' }] },
  });

  test('T16: o total dentro do limite para no vendedor com o preço guardado', () => {
    const p = passo(escolheuBoleto, cotou(800), 'm8');
    assert.deepEqual([p.estado?.etapa, p.estado?.motivoPausa, p.estado?.dados.cotacao?.valor_total], ['aguardando_vendedor', 'pagamento_escolhido', 800]);
  });

  test('T17: acima do máximo volta à pergunta, sem a condição recusada no menu', () => {
    const p = passo(escolheuBoleto, cotou(12000), 'm8');
    assert.deepEqual([p.estado?.etapa, p.estado?.pergunta, p.estado?.dados.pagamentos_recusados], ['definindo_pagamento', 'pagamento', ['B00']]);
  });

  test('avisa o máximo e mostra as outras formas', () => {
    const p = passo(escolheuBoleto, cotou(12000), 'm8');
    assert.equal(textoDaEtapa('pagamento_fora_do_limite', p.estado, { estados: [] }),
      'O valor máximo para boleto antecipado é de R$ 10.000,00. Escolha outra forma de pagamento ou reduza os produtos para ficar dentro desse valor.\n\n• Cartão de crédito em até 10x\n• Cartão de débito\n• Cartão BNDES');
  });

  test('avisa o mínimo pedindo para adicionar produtos', () => {
    const p = passo(escolheuBoleto, cotou(30), 'm8');
    assert.match(textoDaEtapa('pagamento_fora_do_limite', p.estado, { estados: [] }), /^O valor mínimo para boleto antecipado é de R\$ 50,00\. Escolha outra forma de pagamento ou adicione produtos/);
  });

  test('sem preço do ERP, segue para o vendedor conferir', () => {
    const p = passo(escolheuBoleto, { tipo: 'cotacao', resultado: 'falhou', codigo: 'produto_nao_encontrado', mensagem: 'sem preço' }, 'm8');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.cotacao_falhou?.codigo], ['aguardando_vendedor', 'produto_nao_encontrado']);
  });

  test('produtos depois do aviso voltam à lista da v2', () => {
    const recusado = passo({ ...escolheuBoleto, dados: { ...escolheuBoleto.dados, v2_pedido_id: 'p1' } }, cotou(30), 'm8').estado!;
    const p = passo(recusado, msg('m9', 'mais 20 vergalhões', { intencao: 'produtos', produtosCitados: true }), 'm9');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.pagamentos_recusados, p.acao], ['levantando_itens', undefined, { tipo: 'v2', texto: 'mais 20 vergalhões', pedidoId: 'p1' }]);
  });

  // Teste de 16/10: todo boleto com máximo de R$ 2.000 e lista de R$ 3.000.
  const COM_TETO: FormaDePagamentoDoErp[] = [
    forma('PIX', 'PIX', 'PIX', 1, { valor_maximo: 10000 }),
    forma('B01', 'BOL 30 DIAS', 'BO', 1, { valor_maximo: 2000 }),
    forma('B06', 'BOL 30/60 DIAS', 'BO', 2, { valor_maximo: 2000 }),
    forma('CV3', 'C.C. VISA 3 PARCELAS', 'CC', 3, { valor_maximo: 50000 }),
  ];
  const recusadoNoTeto = (total: number): EstadoDoOrcamento => {
    const pagandoComTeto = passo(levantando({ ...CLIENTE, formas_pagamento: COM_TETO }), confirmou, 'm7').estado!;
    const escolheu = passo({ ...pagandoComTeto, dados: { ...pagandoComTeto.dados, v2_pedido_id: 'p1' } }, msg('m8', 'boleto 30 dias'), 'm8').estado!;
    return passo(escolheu, cotou(total), 'm8').estado!;
  };

  test('depois da recusa, esconde as formas cujo limite não comporta o total', () => {
    assert.deepEqual(linhasDoMenu(opcoesDoOrcamento(recusadoNoTeto(3000).dados)), ['PIX', 'Cartão de crédito em até 3x']);
  });

  test('forma escondida pelo total diz que não aceita o valor, não que não está liberada', () => {
    const p = passo(recusadoNoTeto(3000), msg('m9', 'boleto 30/60'), 'm9');
    assert.deepEqual(p.fala, { tipo: 'fixa', chave: 'forma_fora_do_total' });
  });

  test('mudar os produtos devolve ao menu as formas escondidas pelo total', () => {
    const p = passo(recusadoNoTeto(3000), msg('m9', 'tira 10 vergalhões', { intencao: 'produtos', produtosCitados: true }), 'm9');
    assert.equal(p.estado?.dados.total_referencia, undefined);
  });

  test('sem nenhuma forma que comporte o total, pede só para ajustar os produtos', () => {
    assert.equal(textoDaEtapa('pagamento_fora_do_limite', recusadoNoTeto(60000), { estados: [] }),
      'Esse boleto não está disponível para este pedido, e nenhuma outra forma aceita o valor desta lista. O vendedor vai falar com você.');
  });

  test('a mesma mensagem repetida (varredura) refaz a consulta de preço que ficou pela metade', () => {
    const p = passo(escolheuBoleto, msg('m8', 'boleto'), 'm8');
    assert.equal(p.acao?.tipo, 'cotar');
  });

  test('guarda os limites da condição para conferir quando o total existir', () => {
    const p = passo(pagando, msg('m8', 'boleto'), 'm8');
    assert.deepEqual([p.estado?.dados.pagamento?.valor_minimo, p.estado?.dados.pagamento?.valor_maximo], [50, 10000]);
  });

  test('prazo de boleto não liberado repete a pergunta do prazo com o aviso', () => {
    const comPrazos = passo(levantando({ ...CLIENTE, formas_pagamento: FORMAS_COM_PRAZOS }), confirmou, 'm7').estado!;
    const boleto = passo(comPrazos, msg('m8', 'boleto'), 'm8').estado!;
    const p = passo(boleto, msg('m9', '33 dias'), 'm9');
    assert.deepEqual([p.estado?.pergunta, p.fala], ['opcao_de_pagamento', { tipo: 'fixa', chave: 'prazo_nao_liberado' }]);
  });

  test('confirma a escolha com o nome por extenso', () => {
    const p1 = passo(pagando, msg('m8', 'cartão'), 'm8');
    const p2 = passo(p1.estado, msg('m9', '3x visa'), 'm9');
    assert.equal(textoDaEtapa('pagamento_escolhido', p2.estado, { estados: [] }), 'Anotado: cartão de crédito Visa em 3x. O vendedor vai te mandar o orçamento com os preços.');
  });

  test('outro assunto: a IA responde e o código repete a pergunta', () => {
    const p = passo(pagando, msg('m8', 'vocês entregam amanhã?', { intencao: 'outro_assunto' }), 'm8');
    assert.deepEqual([p.estado?.etapa, p.fala], ['definindo_pagamento', { tipo: 'livre', depois: 'pedir_pagamento' }]);
  });
});

describe('as formas na consulta de cliente', () => {
  test('lê as formas da resposta do ERP e descarta linha sem código', () => {
    const r = formasDaResposta([{ codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: null, valor_maximo: 10000 }, { descricao: 'SEM CODIGO' }]);
    assert.deepEqual(r, [{ codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: null, valor_maximo: 10000 }]);
  });
});

describe('o orçamento na ficha do contato', () => {
  const linha = (etapa: string, dados: unknown) => ({ id: 'o1', created_at: '2026-10-14T12:00:00Z', updated_at: '2026-10-14T12:00:00Z', etapa, pergunta_pendente: null, dados });
  const DEPOIS = Date.parse('2026-10-14T13:00:00Z');

  test('mostra que parou na forma de pagamento', () => {
    assert.equal(resumirOrcamento(linha('definindo_pagamento', { itens: ITENS }), DEPOIS).situacao, 'Parou na forma de pagamento');
  });

  test('mostra a forma escolhida para o vendedor', () => {
    const dados = { itens: ITENS, pagamento: { codigo: 'CV3', rotulo: 'cartão de crédito Visa em 3x' } };
    assert.equal(resumirOrcamento(linha('aguardando_vendedor', dados), DEPOIS).pagamento, 'cartão de crédito Visa em 3x · CV3');
  });
});

// Teste de campo de 21/10: "Master, 13x" saiu como "cartão de crédito em 13x", sem a bandeira que o cliente falou.
describe('o texto do crédito sem bandeira no ERP usa a que o cliente falou', () => {
  const formas = opcoesOferecidas([
    forma('CM3', 'C.C. MASTER 3 PARCELAS', 'CC', 3, { tipo: 'CARTAO_CREDITO', bandeira: 'MASTERCARD' }),
    forma('CVD', 'C. C. 13 PARCELAS', 'CC', 13, { tipo: 'CARTAO_CREDITO', bandeira: null }),
  ]);
  test('escreve a bandeira do cliente quando a forma não tem', () => {
    const e = escolherPagamento(formas, 'Master, 13x', undefined, 'parcelas');
    assert.equal(e.tipo === 'escolhida' && rotuloDaOpcao(e.opcao, e.bandeira), 'cartão de crédito Master em 13x');
  });
  test('mantém o texto sem bandeira quando o cliente não falou nenhuma', () => {
    const e = escolherPagamento(formas, '13x', undefined, 'parcelas');
    assert.equal(e.tipo === 'escolhida' && rotuloDaOpcao(e.opcao, e.bandeira), 'cartão de crédito em 13x');
  });
  test('usa a bandeira do ERP quando a forma tem', () => {
    const e = escolherPagamento(formas, 'Master 3x', undefined, 'parcelas');
    assert.equal(e.tipo === 'escolhida' && rotuloDaOpcao(e.opcao, e.bandeira), 'cartão de crédito Master em 3x');
  });
});

// Válvula de escape, item 1 (22/10): escolher a forma é uma das três ações sem volta. Só escolhe com a mensagem clara.
describe('a forma só é escolhida com a mensagem clara', () => {
  const pagando = passo(levantando({ ...CLIENTE, formas_pagamento: FORMAS }), confirmou, 'm7').estado!;

  test('não escolhe nada quando a mensagem é uma pergunta', () => {
    const perguntas = ['tem desconto no pix?', 'aceita pix?', 'qual a chave pix?', 'quanto fica no pix?', 'dá pra parcelar no boleto?', 'cartão em 10x tem juros?'];
    assert.deepEqual(perguntas.map(t => escolher(t).tipo), perguntas.map(() => 'nada'));
  });

  test('responde a pergunta e repete o menu, mesmo sem a IA ler outro assunto', () => {
    const p = passo(pagando, msg('m8', 'tem desconto no pix?'), 'm8');
    assert.deepEqual([p.estado?.dados.pagamento, p.acao, p.fala], [undefined, null, { tipo: 'livre', depois: 'pedir_pagamento' }]);
  });

  test('não escolhe 10x quando o cliente copia a linha do menu', () => {
    const e = escolher('Cartão de crédito em até 10x');
    assert.deepEqual(e.tipo === 'falta' && e.pergunta, 'parcelas');
  });

  test('não escolhe quando o cliente divide entre dois tipos', () => {
    assert.equal(escolher('metade pix metade cartão').tipo, 'nada');
  });

  test('não troca o prazo pedido pelo único boleto liberado', () => {
    const e = escolher('boleto 28 dias');
    assert.deepEqual(e.tipo === 'falta' && [e.pergunta, e.foraDoLimite], ['opcao_de_pagamento', true]);
  });

  test('diz que o prazo não está liberado e mostra o único que está', () => {
    const dados = { cliente: { ...CLIENTE, formas_pagamento: FORMAS }, pagamento_parcial: { grupo: 'boleto' as const } };
    assert.equal(textoDoPagamento('opcao_fora', dados), 'Esse prazo não está disponível para este pedido. Alguns que estão: antecipado. Qual prefere?');
  });

  test('escolhe o único boleto quando o cliente não cita prazo', () => {
    assert.deepEqual([codigo(escolher('boleto')), codigo(escolher('boleto antecipado'))], ['B00', 'B00']);
  });
});

describe('número por extenso na forma de pagamento', () => {
  test('lê as parcelas escritas por extenso', () => {
    assert.deepEqual([codigo(escolher('três vezes no visa')), codigo(escolher('duas vezes', { grupo: 'credito', bandeira: 'VISA' }, 'parcelas'))], ['CV3', 'CV2']);
  });

  test('lê "em três" como resposta à pergunta das parcelas', () => {
    assert.equal(codigo(escolher('em três', { grupo: 'credito', bandeira: 'VISA' }, 'parcelas')), 'CV3');
  });

  test('lê o prazo do boleto escrito por extenso', () => {
    assert.deepEqual([prazo('trinta dias'), prazo('trinta, sessenta e noventa')], ['B30', 'B39']);
  });
});

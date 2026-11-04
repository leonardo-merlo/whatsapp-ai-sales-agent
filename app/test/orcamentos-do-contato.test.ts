import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { produtosMaisPedidos, resumirOrcamento, type LinhaDoOrcamento } from '@/lib/data/orcamentos-do-contato';

const AGORA = Date.parse('2026-10-08T15:00:00Z');
const linha = (etapa: string, extra: Partial<LinhaDoOrcamento> = {}): LinhaDoOrcamento => ({
  id: 'o1', created_at: '2026-10-08T12:00:00Z', updated_at: '2026-10-08T12:00:00Z', etapa, pergunta_pendente: null, dados: {}, ...extra,
});
const itens = (...codigos: string[]) => ({ itens: codigos.map(c => ({ item_id: c, codigo: c, descricao: `PRODUTO ${c}`, quantidade: '1' })) });

describe('o bloco Em aberto da ficha', () => {
  test('mostra a lista confirmada esperando o vendedor', () => {
    assert.equal(resumirOrcamento(linha('aguardando_vendedor', { dados: itens('700004') }), AGORA).pendencia, 'Lista confirmada, esperando o orçamento do vendedor');
  });

  test('mostra o orçamento parado na cidade', () => {
    assert.equal(resumirOrcamento(linha('confirmando_regiao', { pergunta_pendente: 'cidade' }), AGORA).pendencia, 'Orçamento sem terminar: parou na cidade');
  });

  test('não mostra orçamento parado há mais de 24 h, que a máquina considera vencido', () => {
    const r = resumirOrcamento(linha('aguardando_documento', { updated_at: '2026-10-06T12:00:00Z' }), AGORA);
    assert.deepEqual([r.pendencia, r.situacao], [null, 'Venceu sem terminar']);
  });

  test('não mostra orçamento encerrado com a lista confirmada', () => {
    const r = resumirOrcamento(linha('encerrado', { dados: itens('700004') }), AGORA);
    assert.deepEqual([r.pendencia, r.situacao], [null, 'Lista confirmada']);
  });
});

describe('T1: número e validade no painel (teste de campo de 20/10)', () => {
  const numerado = (etapa: string, expira_em: string) => linha(etapa, { numero: 123, expira_em, dados: itens('700004') });

  test('mostra o número e até quando vale', () => {
    const r = resumirOrcamento(numerado('aguardando_vendedor', '2026-10-13T15:00:00Z'), AGORA);
    assert.deepEqual([r.numero, r.validade], [123, 'vale até 13/10']);
  });

  test('o orçamento encerrado porque o cliente pediu outro continua em aberto enquanto vale', () => {
    const r = resumirOrcamento(numerado('encerrado', '2026-10-13T15:00:00Z'), AGORA);
    assert.deepEqual([r.pendencia, r.situacao], ['Orçamento nº 123, esperando o vendedor', 'Lista confirmada']);
  });

  test('depois da validade vale como vencido e sai do Em aberto', () => {
    const r = resumirOrcamento(numerado('aguardando_vendedor', '2026-10-07T15:00:00Z'), AGORA);
    assert.deepEqual([r.validade, r.situacao, r.pendencia], ['venceu em 07/10', 'Vencido', null]);
  });

  test('orçamento de antes do número fica como era', () => {
    assert.equal(resumirOrcamento(linha('encerrado', { dados: itens('700004') }), AGORA).validade, null);
  });
});

describe('produtos mais pedidos', () => {
  test('conta em quantas listas cada produto apareceu', () => {
    const orcamentos = [
      resumirOrcamento(linha('encerrado', { id: 'a', dados: itens('700004', '700113') }), AGORA),
      resumirOrcamento(linha('encerrado', { id: 'b', dados: itens('700004') }), AGORA),
    ];
    assert.deepEqual(produtosMaisPedidos(orcamentos).map(p => [p.codigo, p.vezes]), [['700004', 2], ['700113', 1]]);
  });
});

// Teste de campo de 21/10: a lista pediu 200 parafusos e a cotação mandou 200 ao ERP, que
// vende o parafuso por cento (unidade "CT", R$ 69,52 o cento). Saiu R$ 13.904 de parafuso,
// o total passou de R$ 10.000 e o PIX foi recusado. O Leonardo confirmou: CT é cento.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { quantidadeNaUnidadeDoErp } from '@/lib/erp/unidade-do-erp';

describe('a quantidade na unidade do ERP', () => {
  test('converte unidades para centos quando o produto é vendido em CT', () => {
    assert.equal(quantidadeNaUnidadeDoErp(200, 'CT'), 2);
  });

  test('arredonda para cima o cento incompleto', () => {
    assert.equal(quantidadeNaUnidadeDoErp(150, 'ct'), 2);
  });

  test('não mexe em produto vendido por unidade, quilo ou sem unidade', () => {
    assert.deepEqual([quantidadeNaUnidadeDoErp(10, 'UN'), quantidadeNaUnidadeDoErp(2.5, 'KG'), quantidadeNaUnidadeDoErp(3, null)], [10, 2.5, 3]);
  });
});

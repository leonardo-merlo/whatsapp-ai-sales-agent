// S1: um plano só, R$ 250/mês. Os três de julho ficam escondidos, não apagados.
// Contra o banco de verdade; pulado sem SUPABASE_DB_URL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { consultar, urlDoBanco } from './apoio/psql.mts';

const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';

describe('plano único', { skip: motivoDoPulo ?? false }, () => {
  test('a vitrine tem só o plano de R$ 250, com anual igual a 10 mensalidades', () => {
    const linhas = consultar(`SELECT key, preco_centavos, preco_anual_centavos FROM public.plans WHERE visivel ORDER BY key;`);
    assert.deepEqual(linhas, [['unico', '25000', '250000']]);
  });

  test('o plano novo tem as vagas do Profissional', () => {
    const [[novo, profissional]] = consultar(`
      SELECT (SELECT max_atendentes FROM public.plans WHERE key = 'unico'),
             (SELECT max_atendentes FROM public.plans WHERE key = 'profissional');`);
    assert.equal(novo, profissional);
  });

  test('os planos antigos continuam existindo, escondidos', () => {
    const [[escondidos]] = consultar(`SELECT count(*) FROM public.plans WHERE NOT visivel AND key IN ('basico', 'profissional', 'avancado');`);
    assert.equal(escondidos, '3');
  });
});

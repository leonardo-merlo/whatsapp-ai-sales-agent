// T1 (teste de campo de 20/10): o número do orçamento, por organização, e a
// validade. A regra mora na função do Postgres, então o teste é contra o banco.
//
// A migration AINDA NÃO está aplicada: cada teste roda o arquivo dela dentro de
// `BEGIN … ROLLBACK`, junto com o que confere. Nada é confirmado no banco.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { consultar, urlDoBanco } from './apoio/psql.mts';

const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';
// Sem as linhas de comentário: elas têm acento, e no Windows o argumento do
// psql vai no código de página do console (o banco recusa o byte). O SQL é ASCII.
const MIGRATION = readFileSync(new URL('../../supabase/migrations/20261021000020_orcamento_numero.sql', import.meta.url), 'utf8')
  .split('\n').filter(l => !l.trim().startsWith('--')).join('\n');

/** Duas fichas na mesma conversa (a primeira já encerrada), para numerar. */
const DUAS_FICHAS = `
  CREATE TEMP TABLE alvo ON COMMIT DROP AS SELECT id, organization_id FROM public.conversations LIMIT 1;
  INSERT INTO public.orcamentos_em_andamento (id, organization_id, conversation_id, etapa, modo)
    SELECT '00000000-0000-4000-8000-0000000000a1', organization_id, id, 'encerrado', 'valendo' FROM alvo;
  INSERT INTO public.orcamentos_em_andamento (id, organization_id, conversation_id, etapa, modo)
    SELECT '00000000-0000-4000-8000-0000000000a2', organization_id, id, 'aguardando_vendedor', 'valendo' FROM alvo;`;

describe('número e validade do orçamento (T1)', { skip: motivoDoPulo ?? false }, () => {
  test('dois orçamentos da mesma organização ganham números seguidos, e a validade é a pedida', () => {
    const linhas = consultar(`
      BEGIN;
      ${MIGRATION}
      ${DUAS_FICHAS}
      SELECT numero FROM public.numerar_orcamento('00000000-0000-4000-8000-0000000000a1', '2026-10-26T15:00:00Z');
      SELECT numero, to_char(expira_em AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI')
        FROM public.numerar_orcamento('00000000-0000-4000-8000-0000000000a2', '2026-10-26T15:00:00Z');
      ROLLBACK;`);
    const [[primeiro], [segundo, validade]] = linhas;
    assert.deepEqual([Number(segundo) - Number(primeiro), validade], [1, '2026-10-26 15:00']);
  });

  test('chamada de novo, devolve o mesmo número e a mesma validade', () => {
    const linhas = consultar(`
      BEGIN;
      ${MIGRATION}
      ${DUAS_FICHAS}
      SELECT numero, expira_em FROM public.numerar_orcamento('00000000-0000-4000-8000-0000000000a1', '2026-10-26T15:00:00Z');
      SELECT numero, expira_em FROM public.numerar_orcamento('00000000-0000-4000-8000-0000000000a1', '2026-10-30T15:00:00Z');
      ROLLBACK;`);
    assert.deepEqual(linhas[0], linhas[1]);
  });

  test('o painel (authenticated) não chama a função', () => {
    const [[pode]] = consultar(`
      BEGIN;
      ${MIGRATION}
      SELECT has_function_privilege('authenticated', 'public.numerar_orcamento(uuid, timestamptz)', 'EXECUTE');
      ROLLBACK;`);
    assert.equal(pode, 'f');
  });
});

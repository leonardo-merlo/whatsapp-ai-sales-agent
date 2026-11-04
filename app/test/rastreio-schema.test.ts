// As regras de `agente_turnos` e `orcamentos_em_andamento` que moram no
// Postgres, e não no código: a execução começa `em_andamento`, o índice de "um
// orçamento ativo por conversa" é parcial, e a leitura é só de admin.
//
// Contra o banco de verdade (o de produção), tudo em `BEGIN … ROLLBACK`. Sem
// `SUPABASE_DB_URL` o teste se marca como pulado em vez de fingir que passou —
// a mesma validação foi feita à mão pelo MCP em 27/09, antes de aplicar.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { consultar, urlDoBanco } from './apoio/psql.mts';

const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';

/** Uma conversa qualquer, com a organização dela, para as linhas de teste. */
const UMA_CONVERSA = `(SELECT id, organization_id FROM public.conversations LIMIT 1)`;

describe('schema do rastreio por turno', { skip: motivoDoPulo ?? false }, () => {
  test('a ficha nasce em_andamento', () => {
    const [[status]] = consultar(`
      BEGIN;
      INSERT INTO public.agente_turnos (organization_id, conversation_id, origem)
        SELECT organization_id, id, 'fila' FROM ${UMA_CONVERSA} c;
      SELECT status FROM public.agente_turnos ORDER BY created_at DESC LIMIT 1;
      ROLLBACK;`);
    assert.equal(status, 'em_andamento');
  });

  test('um segundo orçamento ativo na mesma conversa é recusado; depois de final, abre outro', () => {
    const [[resultado]] = consultar(`
      BEGIN;
      INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa)
        SELECT organization_id, id, 'aguardando_documento' FROM ${UMA_CONVERSA} c;
      DO $$ BEGIN
        INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa)
          SELECT organization_id, id, 'consultando_cadastro' FROM (SELECT id, organization_id FROM public.conversations LIMIT 1) c;
        RAISE EXCEPTION 'passou';
      EXCEPTION WHEN unique_violation THEN NULL; END $$;
      UPDATE public.orcamentos_em_andamento SET etapa = 'cadastro_concluido';
      INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa)
        SELECT organization_id, id, 'aguardando_documento' FROM ${UMA_CONVERSA} c;
      SELECT 'ok';
      ROLLBACK;`);
    assert.equal(resultado, 'ok');
  });

  test('máquina valendo: a gravação com versão velha não altera nada (a segunda execução desiste)', () => {
    const [[primeira], [segunda]] = consultar(`
      BEGIN;
      INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa, modo, versao)
        SELECT organization_id, id, 'aguardando_documento', 'valendo', 1 FROM ${UMA_CONVERSA} c;
      WITH a AS (UPDATE public.orcamentos_em_andamento SET etapa = 'consultando_cadastro', versao = 2
        WHERE modo = 'valendo' AND versao = 1 AND conversation_id = (SELECT id FROM ${UMA_CONVERSA} c) RETURNING 1)
        SELECT count(*) FROM a;
      WITH b AS (UPDATE public.orcamentos_em_andamento SET etapa = 'coletando_cadastro', versao = 2
        WHERE modo = 'valendo' AND versao = 1 AND conversation_id = (SELECT id FROM ${UMA_CONVERSA} c) RETURNING 1)
        SELECT count(*) FROM b;
      ROLLBACK;`);
    assert.deepEqual([primeira, segunda], ['1', '0']);
  });

  test('máquina valendo e sombra convivem na mesma conversa (o índice é por modo)', () => {
    const [[resultado]] = consultar(`
      BEGIN;
      INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa, modo)
        SELECT organization_id, id, 'levantando_itens', 'valendo' FROM ${UMA_CONVERSA} c;
      INSERT INTO public.orcamentos_em_andamento (organization_id, conversation_id, etapa, modo)
        SELECT organization_id, id, 'aguardando_documento', 'sombra' FROM ${UMA_CONVERSA} c;
      SELECT 'ok';
      ROLLBACK;`);
    assert.equal(resultado, 'ok');
  });

  test('um usuário que não é admin da organização não lê a ficha', () => {
    const linhas = consultar(`
      BEGIN;
      INSERT INTO public.agente_turnos (organization_id, origem)
        SELECT organization_id, 'fila' FROM ${UMA_CONVERSA} c;
      SET LOCAL ROLE authenticated;
      SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-4000-8000-000000000000","role":"authenticated"}';
      SELECT count(*) FROM public.agente_turnos;
      ROLLBACK;`);
    assert.equal(linhas[0][0], '0');
  });
});

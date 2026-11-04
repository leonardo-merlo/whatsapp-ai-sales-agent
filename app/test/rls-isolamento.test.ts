// Teste 5 do A1: a RLS isola uma organização da outra. É o teste que não pode
// rodar contra dublê nenhum — a regra mora no Postgres, em policies que o
// código da aplicação nem enxerga. Um dublê aqui testaria a imitação.
//
// Roda contra o banco de verdade, que neste projeto é o de produção, então:
// tudo dentro de `BEGIN … ROLLBACK`, as leituras usam os dados que já existem
// (não semeia nada) e a única escrita é uma que PRECISA ser barrada.
//
// Precisa de `SUPABASE_DB_URL` no `.env.local` (a connection string do painel
// do Supabase) e do `psql` no PATH. Sem isso o teste se marca como pulado em
// vez de fingir que passou.

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { comoUsuario, consultar, urlDoBanco } from './apoio/psql.mts';

interface Duo {
  orgPropria: string;
  usuario: string;
  orgAlheia: string;
}

const motivoDoPulo = urlDoBanco()
  ? null
  : 'SUPABASE_DB_URL não definida — sem ela não há como impersonar um usuário no Postgres.';

describe('isolamento entre organizações (RLS)', { skip: motivoDoPulo ?? false }, () => {
  let duo: Duo;

  before(() => {
    // As duas orgs saem do próprio banco: uma com membro e contatos (para o
    // usuário ter o que ver) e outra, diferente, também com contatos (para
    // haver o que ele NÃO pode ver). Descobrir em vez de fixar id mantém o
    // teste vivo depois de qualquer troca de org de demonstração.
    const linhas = consultar(`
      WITH com_membro AS (
        SELECT m.organization_id, m.user_id
        FROM public.organization_members m
        WHERE m.user_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.organization_id = m.organization_id)
        LIMIT 1
      )
      SELECT cm.organization_id::text, cm.user_id::text, o.id::text
      FROM com_membro cm
      JOIN public.organizations o ON o.id <> cm.organization_id
      WHERE EXISTS (SELECT 1 FROM public.contacts c WHERE c.organization_id = o.id)
        AND NOT EXISTS (
          SELECT 1 FROM public.organization_members m2
          WHERE m2.organization_id = o.id AND m2.user_id = cm.user_id
        )
      LIMIT 1;
    `);
    assert.equal(linhas.length, 1, 'o banco não tem duas orgs com dados para comparar');
    duo = { orgPropria: linhas[0][0], usuario: linhas[0][1], orgAlheia: linhas[0][2] };
  });

  test('o membro enxerga os dados da própria organização', () => {
    const [linha] = comoUsuario(duo.usuario, `
      SELECT
        (SELECT count(*) FROM public.contacts      WHERE organization_id = '${duo.orgPropria}'),
        (SELECT count(*) FROM public.organizations WHERE id              = '${duo.orgPropria}');
    `);
    assert.ok(Number(linha[0]) > 0, 'o membro não vê os contatos da própria org — a RLS está apertada demais');
    assert.equal(Number(linha[1]), 1, 'o membro não vê a própria organização');
  });

  test('o mesmo membro não lê nada da organização alheia', () => {
    const [linha] = comoUsuario(duo.usuario, `
      SELECT
        (SELECT count(*) FROM public.contacts       WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.conversations  WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.messages       WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.appointments   WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.ai_agent_config WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.agente_versoes WHERE organization_id = '${duo.orgAlheia}'),
        (SELECT count(*) FROM public.organizations  WHERE id              = '${duo.orgAlheia}');
    `);
    const rotulos = ['contacts', 'conversations', 'messages', 'appointments', 'ai_agent_config', 'agente_versoes', 'organizations'];
    linha.forEach((valor, i) => {
      assert.equal(Number(valor), 0, `vazou ${rotulos[i]} da org alheia`);
    });
  });

  test('a service_role continua enxergando as duas — o teste acima não passa por vazio', () => {
    const [linha] = consultar(`
      SELECT
        (SELECT count(*) FROM public.contacts WHERE organization_id = '${duo.orgPropria}'),
        (SELECT count(*) FROM public.contacts WHERE organization_id = '${duo.orgAlheia}');
    `);
    assert.ok(Number(linha[0]) > 0);
    assert.ok(Number(linha[1]) > 0, 'a org alheia está vazia, então o teste anterior não provou nada');
  });

  test('o membro não consegue escrever na organização alheia', () => {
    // O insert roda dentro do BEGIN/ROLLBACK e precisa levantar 42501
    // (insufficient_privilege). Se passar, o bloco levanta e o teste quebra.
    const [linha] = comoUsuario(duo.usuario, `
      DO $$
      BEGIN
        INSERT INTO public.contacts (organization_id, nome, telefone, origem)
        VALUES ('${duo.orgAlheia}', 'teste de rls', '5500000000000', 'whatsapp');
        RAISE EXCEPTION 'o insert em org alheia foi aceito';
      EXCEPTION
        WHEN insufficient_privilege THEN NULL;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('o membro não grava cópia do agente na organização alheia', () => {
    // Item 9 (29/09): a tabela nasceu vazia, então só a leitura acima não prova
    // nada. A escrita barrada prova que a policy está lá.
    const [linha] = comoUsuario(duo.usuario, `
      DO $$
      BEGIN
        INSERT INTO public.agente_versoes (organization_id, conteudo, autor)
        VALUES ('${duo.orgAlheia}', '{}'::jsonb, 'teste de rls');
        RAISE EXCEPTION 'a copia em org alheia foi aceita';
      EXCEPTION
        WHEN insufficient_privilege THEN NULL;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });
});

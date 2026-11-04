// S14: um sistema, duas caras. A empresa tem produtos contratados, o cookie
// escolhe qual está na tela, e o produto decide menu e modelos de template.
//
// A parte do banco (quem pode mudar `organizations.produtos`) roda contra o
// Postgres de verdade em BEGIN … ROLLBACK, e se marca pulada sem SUPABASE_DB_URL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { escolherProduto, produtosValidos, secoesOcultasDoProduto } from '../src/lib/produtos.ts';
import { modelosDoProduto } from '../src/lib/whatsapp/templates.ts';
import { consultar, urlDoBanco } from './apoio/psql.mts';

describe('produto na tela', () => {
  test('usa o do cookie quando a empresa contratou', () => {
    assert.equal(escolherProduto(['atendimento', 'vendas'], 'vendas'), 'vendas');
  });

  test('ignora o cookie de um produto não contratado', () => {
    assert.equal(escolherProduto(['vendas'], 'atendimento'), 'vendas');
  });

  test('ignora cookie com valor qualquer', () => {
    assert.equal(escolherProduto(['atendimento'], 'admin'), 'atendimento');
  });

  test('lista vazia ou estranha no banco vira atendimento', () => {
    assert.deepEqual(produtosValidos([]), ['atendimento']);
    assert.deepEqual(produtosValidos(['vendas', 'xyz']), ['vendas']);
  });
});

describe('menu por produto', () => {
  test('Vendas esconde a Agenda', () => {
    assert.deepEqual(secoesOcultasDoProduto('vendas'), ['agenda']);
  });

  test('Atendimento esconde Desenvolvimento e mantém o que a empresa já escondia', () => {
    assert.deepEqual(secoesOcultasDoProduto('atendimento', ['campanhas']), ['campanhas', 'desenvolvimento']);
  });
});

describe('modelos de template por produto', () => {
  test('Atendimento vê só lembrete e remarcação', () => {
    assert.deepEqual(modelosDoProduto('atendimento', true).map(t => t.nome), ['lembrete_agendamento', 'aviso_remarcacao']);
  });

  test('Vendas com copiloto não vê modelo de clínica', () => {
    const nomes = modelosDoProduto('vendas', true).map(t => t.nome);
    assert.ok(!nomes.includes('lembrete_agendamento') && !nomes.includes('aviso_remarcacao') && nomes.length > 0);
  });

  test('Vendas sem copiloto não vê modelo nenhum', () => {
    assert.equal(modelosDoProduto('vendas', false).length, 0);
  });
});

const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';

describe('schema dos produtos', { skip: motivoDoPulo ?? false }, () => {
  test('o admin da empresa não muda os produtos dela', () => {
    const linhas = consultar(`
      BEGIN;
      CREATE TEMP TABLE r (v text); GRANT ALL ON r TO authenticated;
      SELECT set_config('request.jwt.claims', json_build_object('sub', m.user_id, 'role', 'authenticated')::text, true)
        FROM public.organization_members m WHERE m.role IN ('owner', 'admin') AND m.user_id IS NOT NULL LIMIT 1;
      SET LOCAL ROLE authenticated;
      DO $$ BEGIN
        UPDATE public.organizations SET produtos = '{atendimento,vendas}'
          WHERE public.is_admin_of(id);
        INSERT INTO r VALUES ('passou');
      EXCEPTION WHEN insufficient_privilege THEN INSERT INTO r VALUES ('barrou'); END $$;
      SELECT v FROM r;
      ROLLBACK;`);
    assert.equal(linhas.at(-1)?.[0], 'barrou');
  });

  test('produto fora da lista é recusado', () => {
    const [[resultado]] = consultar(`
      BEGIN;
      DO $$ BEGIN
        UPDATE public.organizations SET produtos = '{crm}' WHERE id = (SELECT id FROM public.organizations LIMIT 1);
        RAISE EXCEPTION 'passou';
      EXCEPTION WHEN check_violation THEN NULL; END $$;
      SELECT 'ok';
      ROLLBACK;`);
    assert.equal(resultado, 'ok');
  });

  test('a Distribuidora Exemplo tem só vendas', () => {
    const [[produtos]] = consultar(`SELECT produtos::text FROM public.organizations WHERE id = 'e8e00000-0000-4000-8000-0000000000e1';`);
    assert.equal(produtos, '{vendas}');
  });
});

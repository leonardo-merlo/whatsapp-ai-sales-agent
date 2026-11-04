// Provas do schema do ciclo do pedido. RLS e constraint moram no Postgres, não no
// nosso código — dublê aqui testaria a própria imitação.
//
// Só existe um banco neste projeto, o de produção. Por isso TUDO roda dentro de
// `BEGIN … ROLLBACK` e nada é confirmado.

import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { comoUsuario, consultar, urlDoBanco } from './apoio/psql.mts';

const motivoDoPulo = urlDoBanco()
  ? null
  : 'SUPABASE_DB_URL não definida — sem ela não há banco para conferir.';

/** Roda o SQL como service_role dentro de uma transação que nunca é confirmada. */
function comRollback(sql: string): string[][] {
  return consultar(['BEGIN;', sql, 'ROLLBACK;'].join('\n'));
}

interface Alvo {
  org: string;
  usuario: string;
  orgAlheia: string;
}

let alvo: Alvo;

function descobrirAlvo(): void {
  // Sai do próprio banco em vez de fixar id: sobrevive a qualquer troca da org de
  // demonstração.
  const linhas = consultar(`
    WITH com_membro AS (
      SELECT m.organization_id, m.user_id
      FROM public.organization_members m
      WHERE m.user_id IS NOT NULL
      LIMIT 1
    )
    SELECT cm.organization_id::text, cm.user_id::text, o.id::text
    FROM com_membro cm
    JOIN public.organizations o ON o.id <> cm.organization_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public.organization_members m2
      WHERE m2.organization_id = o.id AND m2.user_id = cm.user_id
    )
    LIMIT 1;
  `);
  assert.equal(linhas.length, 1, 'o banco não tem duas organizações para comparar');
  alvo = { org: linhas[0][0], usuario: linhas[0][1], orgAlheia: linhas[0][2] };
}

describe('ciclo do pedido · descoberta', { skip: motivoDoPulo ?? false }, () => {
  before(descobrirAlvo);

  test('achou uma org com membro e uma org alheia', () => {
    assert.ok(alvo.org);
    assert.ok(alvo.usuario);
    assert.notEqual(alvo.org, alvo.orgAlheia);
  });
});

describe('ciclo do pedido · contacts', { skip: motivoDoPulo ?? false }, () => {
  before(descobrirAlvo);

  test('o mesmo cliente do ERP pode existir em dois contatos da mesma org', () => {
    // Dois vendedores, dois números, duas conversas: o mesmo CNPJ vira dois
    // contatos legítimos. Um índice único aqui quebraria o segundo cadastro.
    const [linha] = comRollback(`
      INSERT INTO public.contacts (organization_id, nome, telefone, origem, erp_cliente_id, documento)
      VALUES ('${alvo.org}', 'teste erp a', '5500000000001', 'whatsapp', 'Z06586/01', '11222333000181'),
             ('${alvo.org}', 'teste erp b', '5500000000002', 'whatsapp', 'Z06586/01', '11222333000181');
      SELECT count(*)::text FROM public.contacts
       WHERE organization_id = '${alvo.org}' AND erp_cliente_id = 'Z06586/01';
    `);
    assert.equal(Number(linha[0]), 2, 'o segundo contato com o mesmo erp_cliente_id foi barrado');
  });

  test('cpf continua existindo ao lado de documento', () => {
    // documento é coluna nova de propósito: cpf já tem dado real e é da ficha do
    // Atendimento. Se cpf sumir, a migration deixou de ser aditiva.
    const [linha] = consultar(`
      SELECT count(*)::text FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'contacts'
         AND column_name IN ('cpf', 'documento', 'erp_cliente_id');
    `);
    assert.equal(Number(linha[0]), 3, 'faltou cpf, documento ou erp_cliente_id em contacts');
  });
});

describe('ciclo do pedido · orcamentos', { skip: motivoDoPulo ?? false }, () => {
  before(descobrirAlvo);

  test('o mesmo orcamento do ERP nao entra duas vezes na mesma org', () => {
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}';
      BEGIN
        INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id)
        VALUES (v_org, 'ORC-TESTE-1');
        BEGIN
          INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id)
          VALUES (v_org, 'ORC-TESTE-1');
          RAISE EXCEPTION 'o orcamento repetido foi aceito';
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('modalidade_entrega so aceita RETIRADA ou ENTREGA', () => {
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}';
      BEGIN
        BEGIN
          INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id, modalidade_entrega)
          VALUES (v_org, 'ORC-TESTE-2', 'CORREIOS');
          RAISE EXCEPTION 'modalidade invalida foi aceita';
        EXCEPTION WHEN check_violation THEN NULL;
        END;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('apagar o orcamento leva os itens junto', () => {
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}'; v_orc uuid;
      BEGIN
        INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id)
        VALUES (v_org, 'ORC-TESTE-3') RETURNING id INTO v_orc;
        INSERT INTO public.erp_orcamento_itens (organization_id, orcamento_id, descricao, quantidade)
        VALUES (v_org, v_orc, 'CA50 1/2', 10);
        DELETE FROM public.erp_orcamentos WHERE id = v_orc;
        IF EXISTS (SELECT 1 FROM public.erp_orcamento_itens WHERE orcamento_id = v_orc) THEN
          RAISE EXCEPTION 'o item sobreviveu ao orcamento';
        END IF;
      END $$;
      SELECT 'cascata ok';
    `);
    assert.equal(linha[0], 'cascata ok');
  });

  test('membro le, mas nao escreve', () => {
    const [linha] = comoUsuario(alvo.usuario, `
      DO $$
      BEGIN
        INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id)
        VALUES ('${alvo.org}', 'ORC-TESTE-4');
        RAISE EXCEPTION 'a sessao de usuario conseguiu escrever';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END $$;
      SELECT count(*)::text FROM public.erp_orcamentos WHERE organization_id = '${alvo.orgAlheia}';
    `);
    assert.equal(Number(linha[0]), 0, 'vazou orcamento de org alheia');
  });
});

describe('ciclo do pedido · pedidos', { skip: motivoDoPulo ?? false }, () => {
  before(descobrirAlvo);

  test('um orcamento vira no maximo um pedido', () => {
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}'; v_orc uuid;
      BEGIN
        INSERT INTO public.erp_orcamentos (organization_id, erp_orcamento_id)
        VALUES (v_org, 'ORC-PED-1') RETURNING id INTO v_orc;
        INSERT INTO public.erp_pedidos
          (organization_id, orcamento_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
        VALUES (v_org, v_orc, 'PED-1', 'ENTREGA', 'AGUARDANDO_PAGAMENTO', now());
        BEGIN
          INSERT INTO public.erp_pedidos
            (organization_id, orcamento_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
          VALUES (v_org, v_orc, 'PED-2', 'ENTREGA', 'AGUARDANDO_PAGAMENTO', now());
          RAISE EXCEPTION 'o segundo pedido no mesmo orcamento foi aceito';
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('dois pedidos sem orcamento convivem — o unique e parcial', () => {
    // O índice único de orcamento_id precisa ignorar nulo, senão o segundo pedido
    // avulso seria barrado por "já existe um pedido sem orçamento".
    const [linha] = comRollback(`
      INSERT INTO public.erp_pedidos
        (organization_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
      VALUES ('${alvo.org}', 'PED-AVULSO-1', 'RETIRADA', 'AGUARDANDO_PAGAMENTO', now()),
             ('${alvo.org}', 'PED-AVULSO-2', 'RETIRADA', 'AGUARDANDO_PAGAMENTO', now());
      SELECT count(*)::text FROM public.erp_pedidos
       WHERE organization_id = '${alvo.org}' AND orcamento_id IS NULL;
    `);
    assert.equal(Number(linha[0]), 2, 'o segundo pedido sem orcamento foi barrado');
  });

  test('modalidade_entrega e obrigatoria e fechada', () => {
    const [linha] = comRollback(`
      DO $$
      BEGIN
        BEGIN
          INSERT INTO public.erp_pedidos
            (organization_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
          VALUES ('${alvo.org}', 'PED-3', 'CORREIOS', 'AGUARDANDO_PAGAMENTO', now());
          RAISE EXCEPTION 'modalidade invalida foi aceita';
        EXCEPTION WHEN check_violation THEN NULL;
        END;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('membro le, mas nao escreve', () => {
    const [linha] = comoUsuario(alvo.usuario, `
      DO $$
      BEGIN
        INSERT INTO public.erp_pedidos
          (organization_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
        VALUES ('${alvo.org}', 'PED-4', 'ENTREGA', 'AGUARDANDO_PAGAMENTO', now());
        RAISE EXCEPTION 'a sessao de usuario conseguiu escrever';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END $$;
      SELECT count(*)::text FROM public.erp_pedidos WHERE organization_id = '${alvo.orgAlheia}';
    `);
    assert.equal(Number(linha[0]), 0, 'vazou pedido de org alheia');
  });
});

describe('ciclo do pedido · eventos', { skip: motivoDoPulo ?? false }, () => {
  before(descobrirAlvo);

  test('o mesmo evento_id nao entra duas vezes na mesma org', () => {
    // É esta trava que impede o reenvio da Distribuidora Exemplo virar duas mensagens ao cliente.
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}';
      BEGIN
        INSERT INTO public.erp_eventos (organization_id, evento_id, tipo_evento, payload)
        VALUES (v_org, 'EVT-TESTE-1', 'pedido.pago', '{}'::jsonb);
        BEGIN
          INSERT INTO public.erp_eventos (organization_id, evento_id, tipo_evento, payload)
          VALUES (v_org, 'EVT-TESTE-1', 'pedido.pago', '{}'::jsonb);
          RAISE EXCEPTION 'o evento repetido foi aceito';
        EXCEPTION WHEN unique_violation THEN NULL;
        END;
      END $$;
      SELECT 'barrado';
    `);
    assert.equal(linha[0], 'barrado');
  });

  test('evento orfao e aceito, com aplicado_em nulo', () => {
    // A Distribuidora Exemplo pode avisar de um pedido que não nasceu na nossa conversa. Se o
    // banco recusasse, a rota devolveria erro e eles reenviariam para sempre.
    const [linha] = comRollback(`
      INSERT INTO public.erp_eventos (organization_id, evento_id, tipo_evento, pedido_id, payload)
      VALUES ('${alvo.org}', 'EVT-TESTE-2', 'pedido.pago', 'PED-QUE-NAO-EXISTE', '{}'::jsonb);
      SELECT count(*)::text FROM public.erp_eventos
       WHERE organization_id = '${alvo.org}' AND evento_id = 'EVT-TESTE-2' AND aplicado_em IS NULL;
    `);
    assert.equal(Number(linha[0]), 1, 'o evento orfao foi recusado ou nasceu marcado como aplicado');
  });

  test('apagar o pedido nao apaga o evento — o log e a fita', () => {
    const [linha] = comRollback(`
      DO $$
      DECLARE v_org uuid := '${alvo.org}'; v_ped uuid;
      BEGIN
        INSERT INTO public.erp_pedidos
          (organization_id, erp_pedido_id, modalidade_entrega, status, status_ocorrido_em)
        VALUES (v_org, 'PED-LOG-1', 'ENTREGA', 'PAGO', now()) RETURNING id INTO v_ped;
        INSERT INTO public.erp_eventos (organization_id, evento_id, tipo_evento, pedido_uuid, payload)
        VALUES (v_org, 'EVT-TESTE-3', 'pedido.pago', v_ped, '{}'::jsonb);
        DELETE FROM public.erp_pedidos WHERE id = v_ped;
        IF NOT EXISTS (SELECT 1 FROM public.erp_eventos WHERE evento_id = 'EVT-TESTE-3') THEN
          RAISE EXCEPTION 'o evento sumiu junto com o pedido';
        END IF;
      END $$;
      SELECT 'log sobreviveu';
    `);
    assert.equal(linha[0], 'log sobreviveu');
  });

  test('membro le, mas nao escreve', () => {
    const [linha] = comoUsuario(alvo.usuario, `
      DO $$
      BEGIN
        INSERT INTO public.erp_eventos (organization_id, evento_id, payload)
        VALUES ('${alvo.org}', 'EVT-TESTE-4', '{}'::jsonb);
        RAISE EXCEPTION 'a sessao de usuario conseguiu escrever';
      EXCEPTION WHEN insufficient_privilege THEN NULL;
      END $$;
      SELECT count(*)::text FROM public.erp_eventos WHERE organization_id = '${alvo.orgAlheia}';
    `);
    assert.equal(Number(linha[0]), 0, 'vazou evento de org alheia');
  });

  test('orcamento_eventos continua existindo — a migration e aditiva', () => {
    const [linha] = consultar(`
      SELECT count(*)::text FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'orcamento_eventos';
    `);
    assert.equal(Number(linha[0]), 1, 'orcamento_eventos foi removida — a regra 2 do bloco C proibe');
  });
});

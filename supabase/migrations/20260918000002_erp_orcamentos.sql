-- =============================================================
-- erp_orcamentos e erp_orcamento_itens — o orçamento do lado de cá
-- =============================================================
-- Hoje um orçamento vive só dentro da resposta HTTP da Distribuidora Exemplo e some quando a
-- requisição termina. O vendedor não consegue ver "os orçamentos deste cliente",
-- que é justamente onde ele deveria agir: orçamento enviado e não fechado.
--
-- O prefixo `erp_` existe para lembrar que **a fonte da verdade é o sistema do
-- cliente, não nós.** Aqui é espelho.
--
-- `status` é texto e não enum porque a lista de valores do orçamento ainda está
-- "A DEFINIR" no contrato v3. Enum agora significaria uma migration por valor novo.
--
-- Valores em `numeric(12,2)` e não em centavos como `sales`: o contrato manda reais
-- com duas casas e o nosso lado nunca recalcula, só repassa.
--
-- Migration ADITIVA: só cria tabelas. Organização sem Vendas fica com elas vazias.

CREATE TABLE IF NOT EXISTS public.erp_orcamentos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  contact_id          uuid        REFERENCES public.contacts(id)                ON DELETE SET NULL,
  conversation_id     uuid        REFERENCES public.conversations(id)           ON DELETE SET NULL,
  wa_number_id        uuid        REFERENCES public.wa_numbers(id)              ON DELETE SET NULL,
  erp_orcamento_id    text        NOT NULL,
  erp_cliente_id      text,
  solicitacao_id      text,
  vendedor_id         text,
  empresa             text,
  status              text,
  validade            timestamptz,
  modalidade_entrega  text,
  condicao_pagamento  text,
  subtotal            numeric(12,2),
  frete               numeric(12,2),
  impostos            numeric(12,2),
  desconto_percentual numeric(5,2),
  valor_final         numeric(12,2),
  peso_total_kg       numeric(10,3),
  link                text,
  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_orcamentos_modalidade_valida
    CHECK (modalidade_entrega IS NULL OR modalidade_entrega IN ('RETIRADA', 'ENTREGA'))
);

COMMENT ON TABLE public.erp_orcamentos IS
  'Espelho do orcamento criado no sistema do cliente (operacao 3 do contrato v3). A fonte da verdade e o ERP.';
COMMENT ON COLUMN public.erp_orcamentos.wa_number_id IS
  'De qual numero, logo de qual vendedor, o orcamento nasceu. conversation_id e SET NULL e levaria esse vinculo junto.';
COMMENT ON COLUMN public.erp_orcamentos.condicao_pagamento IS
  'Codigo da condicao de pagamento. E ela que escolhe a tabela de preco: sem ela nao existe preco.';
COMMENT ON COLUMN public.erp_orcamentos.validade IS
  'Ate quando este orcamento ainda pode virar pedido. Passou, o Agente refaz em vez de tentar comprar.';
COMMENT ON COLUMN public.erp_orcamentos.payload IS
  'Resposta crua do ERP. O contrato ainda tem campos A DEFINIR — nada se perde aqui.';

CREATE UNIQUE INDEX IF NOT EXISTS erp_orcamentos_unico
  ON public.erp_orcamentos (organization_id, erp_orcamento_id);
CREATE INDEX IF NOT EXISTS erp_orcamentos_contato_idx
  ON public.erp_orcamentos (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS erp_orcamentos_cliente_idx
  ON public.erp_orcamentos (organization_id, erp_cliente_id);

-- `organization_id` é desnormalizado de propósito, igual a `sale_items`: mantém a
-- policy de RLS igual à das outras tabelas, sem subquery no orçamento.
CREATE TABLE IF NOT EXISTS public.erp_orcamento_itens (
  id                 uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid          NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  orcamento_id       uuid          NOT NULL REFERENCES public.erp_orcamentos(id) ON DELETE CASCADE,
  produto_id         text,
  descricao          text,
  descricao_livre    text,
  quantidade         numeric(12,3),
  preco_unitario     numeric(12,2),
  total_item         numeric(12,2),
  peso_kg            numeric(10,3),
  estoque_disponivel boolean
);

COMMENT ON TABLE public.erp_orcamento_itens IS
  'Itens do orcamento, como o ERP devolveu. organization_id e desnormalizado para a policy de RLS nao precisar de subquery.';
COMMENT ON COLUMN public.erp_orcamento_itens.produto_id IS
  'Nulo quando o ERP nao identificou o produto: o que o cliente disse fica em descricao_livre e nenhum codigo e inventado.';
COMMENT ON COLUMN public.erp_orcamento_itens.estoque_disponivel IS
  'Informativo. Falta de estoque nao impede o orcamento de existir nem de ser enviado ao cliente.';

CREATE INDEX IF NOT EXISTS erp_orcamento_itens_orcamento_idx
  ON public.erp_orcamento_itens (orcamento_id);
CREATE INDEX IF NOT EXISTS erp_orcamento_itens_org_idx
  ON public.erp_orcamento_itens (organization_id);

DROP TRIGGER IF EXISTS erp_orcamentos_updated_at ON public.erp_orcamentos;
CREATE TRIGGER erp_orcamentos_updated_at
  BEFORE UPDATE ON public.erp_orcamentos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──
-- Leitura de membro: orçamento e pedido são operacionais, o vendedor precisa ver
-- sem pedir. Difere de `sales`, que é `is_admin_of` porque faturamento é visão de
-- dono. Escrita: NENHUMA policy — quem grava é a rota, com service_role.
ALTER TABLE public.erp_orcamentos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_orcamento_itens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can select" ON public.erp_orcamentos;
CREATE POLICY "members can select" ON public.erp_orcamentos
  FOR SELECT USING (public.is_member_of(organization_id));

DROP POLICY IF EXISTS "members can select" ON public.erp_orcamento_itens;
CREATE POLICY "members can select" ON public.erp_orcamento_itens
  FOR SELECT USING (public.is_member_of(organization_id));

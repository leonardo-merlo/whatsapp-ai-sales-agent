-- =============================================================
-- Vendas detectadas pela IA + notificações com aprovação humana
--
-- Fluxo: a IA fecha uma venda na conversa → o motor grava `sales` com status
-- 'pendente' e os itens em `sale_items` → cria uma `notificacoes` para o dono →
-- o dono aprova (RPC aprovar_venda: dá baixa no estoque de verdade) ou descarta.
--
-- A venda pendente É a notificação de aprovação: não existe uma fila separada de
-- "baixas a aplicar" para sair de sincronia com as vendas.
--
-- A baixa exige aprovação porque a IA erra nome e quantidade de produto — o
-- match contra o catálogo é feito no código do motor, e o que não bate vira item
-- com product_id nulo (a notificação avisa o dono em vez de mexer no estoque).
-- =============================================================

CREATE TYPE public.sale_status AS ENUM ('pendente', 'confirmada', 'descartada');
CREATE TYPE public.notificacao_status AS ENUM ('pendente', 'resolvida', 'descartada');
CREATE TYPE public.notificacao_tipo AS ENUM ('venda_baixa_estoque', 'estoque_minimo');

-- ── sales ─────────────────────────────────────
CREATE TABLE public.sales (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  contact_id           uuid        REFERENCES public.contacts(id)                ON DELETE SET NULL,
  conversation_id      uuid        REFERENCES public.conversations(id)           ON DELETE SET NULL,
  valor_total_centavos integer     NOT NULL DEFAULT 0,
  status               sale_status NOT NULL DEFAULT 'pendente',
  origem               text        NOT NULL DEFAULT 'ia',  -- 'ia' | 'manual'
  baixa_aplicada_em    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_valor_nao_negativo CHECK (valor_total_centavos >= 0)
);

CREATE INDEX ON public.sales(organization_id);
CREATE INDEX ON public.sales(contact_id);
CREATE INDEX ON public.sales(created_at);

-- Idempotência: a IA reporta "venda concluída" em toda mensagem seguinte da mesma
-- conversa (o desfecho continua valendo), então sem trava viravam N vendas e N
-- baixas. Uma venda por conversa é o mesmo critério já usado em
-- questionnaire_responses. Uma segunda compra na MESMA conversa precisa ser
-- lançada à mão (origem 'manual'), que é o caso raro em PME.
CREATE UNIQUE INDEX sales_uma_por_conversa_ia
  ON public.sales(conversation_id)
  WHERE origem = 'ia' AND conversation_id IS NOT NULL;

CREATE TRIGGER sales_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── sale_items ────────────────────────────────
-- organization_id é desnormalizado de propósito: mantém a policy de RLS igual à
-- das outras tabelas (is_member_of direto, sem subquery em sales).
CREATE TABLE public.sale_items (
  id                  uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid    NOT NULL REFERENCES public.organizations(id)    ON DELETE CASCADE,
  sale_id             uuid    NOT NULL REFERENCES public.sales(id)            ON DELETE CASCADE,
  -- Nulo quando a IA citou algo que não existe no catálogo: guarda o que ela
  -- disse em nome_snapshot e não dá baixa em nada.
  product_id          uuid    REFERENCES public.business_prices(id)           ON DELETE SET NULL,
  nome_snapshot       text    NOT NULL,
  quantidade          integer NOT NULL DEFAULT 1,
  valor_unit_centavos integer NOT NULL DEFAULT 0,
  CONSTRAINT sale_items_quantidade_positiva CHECK (quantidade > 0),
  CONSTRAINT sale_items_valor_nao_negativo  CHECK (valor_unit_centavos >= 0)
);

CREATE INDEX ON public.sale_items(sale_id);
CREATE INDEX ON public.sale_items(product_id);
CREATE INDEX ON public.sale_items(organization_id);

-- ── notificacoes ──────────────────────────────
CREATE TABLE public.notificacoes (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid                NOT NULL REFERENCES public.organizations(id)   ON DELETE CASCADE,
  tipo            notificacao_tipo    NOT NULL,
  titulo          text                NOT NULL,
  corpo           text                NOT NULL,
  status          notificacao_status  NOT NULL DEFAULT 'pendente',
  sale_id         uuid                REFERENCES public.sales(id)                    ON DELETE CASCADE,
  product_id      uuid                REFERENCES public.business_prices(id)          ON DELETE CASCADE,
  contact_id      uuid                REFERENCES public.contacts(id)                 ON DELETE SET NULL,
  lida_em         timestamptz,
  resolvida_em    timestamptz,
  created_at      timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX ON public.notificacoes(organization_id, status);
CREATE INDEX ON public.notificacoes(created_at);

-- Um alerta de estoque mínimo aberto por produto: o aviso "está acabando" não
-- deve reaparecer a cada venda enquanto o dono não repõe.
CREATE UNIQUE INDEX notificacoes_um_alerta_estoque_por_produto
  ON public.notificacoes(product_id)
  WHERE tipo = 'estoque_minimo' AND status = 'pendente';

-- ── RLS ───────────────────────────────────────
-- Vendas, faturamento e estoque são visão de dono: leitura restrita a
-- owner/admin (is_admin_of), diferente das tabelas operacionais que o atendente
-- precisa ver. Escrita pelo motor de IA acontece via service_role (bypassa RLS).
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins can select" ON public.sales
  FOR SELECT USING (public.is_admin_of(organization_id));
CREATE POLICY "admins full write" ON public.sales
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins can select" ON public.sale_items
  FOR SELECT USING (public.is_admin_of(organization_id));
CREATE POLICY "admins full write" ON public.sale_items
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins can select" ON public.notificacoes
  FOR SELECT USING (public.is_admin_of(organization_id));
CREATE POLICY "admins full write" ON public.notificacoes
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ── Aprovar / descartar venda ─────────────────
-- SECURITY INVOKER (padrão): roda com os privilégios de quem chamou, então a RLS
-- acima é a autorização real. A checagem explícita de is_admin_of existe só para
-- devolver erro claro em vez de "0 linhas afetadas".
CREATE OR REPLACE FUNCTION public.aprovar_venda(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_status sale_status;
  r        record;
BEGIN
  SELECT organization_id, status INTO v_org, v_status
  FROM public.sales WHERE id = p_sale_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;
  IF NOT public.is_admin_of(v_org) THEN
    RAISE EXCEPTION 'Sem permissão para aprovar vendas';
  END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta venda já foi resolvida';
  END IF;

  -- Baixa item a item, agrupando por produto (o mesmo item pode vir repetido).
  -- O WHERE com estoque_qtd >= qtd faz a checagem e a escrita na mesma instrução:
  -- duas aprovações simultâneas não conseguem derrubar o saldo abaixo de zero.
  -- Produto sem controle de estoque ou sem saldo suficiente simplesmente não
  -- sofre baixa — a venda segue confirmada e o dono ajusta o estoque à mão.
  FOR r IN
    SELECT product_id, sum(quantidade) AS qtd
    FROM public.sale_items
    WHERE sale_id = p_sale_id AND product_id IS NOT NULL
    GROUP BY product_id
  LOOP
    UPDATE public.business_prices
    SET estoque_qtd = estoque_qtd - r.qtd
    WHERE id = r.product_id
      AND controla_estoque
      AND estoque_qtd IS NOT NULL
      AND estoque_qtd >= r.qtd;
  END LOOP;

  UPDATE public.sales
  SET status = 'confirmada', baixa_aplicada_em = now()
  WHERE id = p_sale_id;

  UPDATE public.notificacoes
  SET status = 'resolvida', resolvida_em = now()
  WHERE sale_id = p_sale_id AND status = 'pendente';

  -- Alerta de estoque acabando: é um aviso SEPARADO da aprovação de baixa. Sai
  -- depois da baixa, quando o saldo cruza o mínimo. ON CONFLICT porque o índice
  -- parcial acima permite só um alerta aberto por produto.
  INSERT INTO public.notificacoes (organization_id, tipo, titulo, corpo, product_id)
  SELECT bp.organization_id,
         'estoque_minimo',
         bp.procedimento || ' está acabando',
         'Restam ' || bp.estoque_qtd || ' em estoque (mínimo definido: ' || bp.estoque_minimo || ').',
         bp.id
  FROM public.business_prices bp
  WHERE bp.id IN (
          SELECT product_id FROM public.sale_items
          WHERE sale_id = p_sale_id AND product_id IS NOT NULL
        )
    AND bp.controla_estoque
    AND bp.estoque_qtd IS NOT NULL
    AND bp.estoque_minimo IS NOT NULL
    AND bp.estoque_qtd <= bp.estoque_minimo
  ON CONFLICT DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.descartar_venda(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_status sale_status;
BEGIN
  SELECT organization_id, status INTO v_org, v_status
  FROM public.sales WHERE id = p_sale_id;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Venda não encontrada';
  END IF;
  IF NOT public.is_admin_of(v_org) THEN
    RAISE EXCEPTION 'Sem permissão para descartar vendas';
  END IF;
  IF v_status <> 'pendente' THEN
    RAISE EXCEPTION 'Esta venda já foi resolvida';
  END IF;

  UPDATE public.sales SET status = 'descartada' WHERE id = p_sale_id;
  UPDATE public.notificacoes
  SET status = 'descartada', resolvida_em = now()
  WHERE sale_id = p_sale_id AND status = 'pendente';
END;
$$;

-- Mesmo padrão dos helpers de RLS (20260630000003 / 20260701000002): nada de
-- EXECUTE para o público, só para quem está autenticado.
REVOKE ALL ON FUNCTION public.aprovar_venda(uuid)   FROM public;
REVOKE ALL ON FUNCTION public.descartar_venda(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.aprovar_venda(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.descartar_venda(uuid) TO authenticated;

-- Realtime: o sino precisa acender sem reload. A RLS acima continua sendo a
-- única autorização — o Realtime só entrega linha que o SELECT já permitiria.
alter publication supabase_realtime add table public.notificacoes;

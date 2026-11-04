-- =============================================================
-- erp_pedidos — o estado atual do pedido, projetado do log
-- =============================================================
-- Uma linha por pedido, com o estado de agora. O histórico fica em `erp_eventos`;
-- esta tabela é o saldo, aquela é o extrato. Ninguém soma o extrato inteiro para
-- mostrar o saldo na tela.
--
-- **Por que as trilhas são colunas e não quatro tabelas.** O contrato v3 não tem
-- nenhum evento parcial: a entrega é EM_SEPARACAO -> SAIU_PARA_ENTREGA ->
-- ENTREGA_REALIZADA, uma trilha só, sem identificador de remessa. Uma tabela por
-- trilha seria uma tabela que sempre tem exatamente uma linha, e cinco joins para
-- responder onde está o pedido.
--
-- **Por que `concluido_em` é uma coluna só.** Um pedido percorre a trilha de
-- retirada OU a de entrega, nunca as duas — é o `modalidade_entrega` que decide.
-- Duas colunas teriam garantidamente uma delas sempre nula.
--
-- **Devolução não ganha colunas próprias.** Ela acontece depois da conclusão,
-- sobrescreve o `status`, e as datas ficam no log. `concluido_em` continua sendo a
-- data da entrega, que é o que a pergunta "quando chegou?" quer saber.
--
-- Migration ADITIVA.

CREATE TABLE IF NOT EXISTS public.erp_pedidos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  orcamento_id        uuid        REFERENCES public.erp_orcamentos(id)          ON DELETE SET NULL,
  contact_id          uuid        REFERENCES public.contacts(id)                ON DELETE SET NULL,
  conversation_id     uuid        REFERENCES public.conversations(id)           ON DELETE SET NULL,
  wa_number_id        uuid        REFERENCES public.wa_numbers(id)              ON DELETE SET NULL,
  erp_pedido_id       text        NOT NULL,
  erp_cliente_id      text,
  modalidade_entrega  text        NOT NULL,
  valor_final         numeric(12,2),
  confirmado_em       timestamptz,

  -- O estado atual, vindo do envelope de todo evento.
  status              text        NOT NULL,
  status_ocorrido_em  timestamptz NOT NULL DEFAULT now(),

  -- Pagamento
  pagamento_link      text,
  pagamento_expira_em timestamptz,
  pago_em             timestamptz,
  valor_pago          numeric(12,2),

  -- Faturamento
  nota_numero         text,
  nota_chave_acesso   text,
  faturado_em         timestamptz,

  -- Fim da trilha: entregue OU retirado; o status diz qual.
  concluido_em        timestamptz,

  -- Cancelamento, falha de entrega ou erro de faturamento.
  motivo              text,

  payload             jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_pedidos_modalidade_valida
    CHECK (modalidade_entrega IN ('RETIRADA', 'ENTREGA'))
);

COMMENT ON TABLE public.erp_pedidos IS
  'Estado atual do pedido no sistema do cliente. Projecao de erp_eventos: le-se num SELECT, sem somar o log.';
COMMENT ON COLUMN public.erp_pedidos.wa_number_id IS
  'De qual numero, logo de qual vendedor, o pedido nasceu. conversation_id e SET NULL e levaria esse vinculo junto.';
COMMENT ON COLUMN public.erp_pedidos.status_ocorrido_em IS
  'O ocorrido_em do evento que produziu o status. E a trava contra evento fora de ordem: evento mais antigo nao sobrescreve estado mais novo.';
COMMENT ON COLUMN public.erp_pedidos.concluido_em IS
  'Entregue OU retirado - um pedido percorre so uma das duas trilhas, e o status diz qual.';
COMMENT ON COLUMN public.erp_pedidos.motivo IS
  'Motivo do estado atual quando ele e ruim. Em ERRO_FATURAMENTO isso NAO vai ao cliente, so ao vendedor.';

CREATE UNIQUE INDEX IF NOT EXISTS erp_pedidos_unico
  ON public.erp_pedidos (organization_id, erp_pedido_id);

-- Um orçamento vira no máximo um pedido. O índice é PARCIAL porque pedido sem
-- orçamento é possível (lançamento avulso), e sem o WHERE o segundo avulso seria
-- barrado por "já existe um pedido com orcamento_id nulo".
-- ATENCAO: indice parcial nao serve de alvo de ON CONFLICT sem repetir o
-- predicado. O upsert da rota usa erp_pedidos_unico, que e total.
CREATE UNIQUE INDEX IF NOT EXISTS erp_pedidos_um_por_orcamento
  ON public.erp_pedidos (orcamento_id)
  WHERE orcamento_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS erp_pedidos_contato_idx
  ON public.erp_pedidos (organization_id, contact_id);
CREATE INDEX IF NOT EXISTS erp_pedidos_cliente_idx
  ON public.erp_pedidos (organization_id, erp_cliente_id);
CREATE INDEX IF NOT EXISTS erp_pedidos_status_idx
  ON public.erp_pedidos (organization_id, status);

DROP TRIGGER IF EXISTS erp_pedidos_updated_at ON public.erp_pedidos;
CREATE TRIGGER erp_pedidos_updated_at
  BEFORE UPDATE ON public.erp_pedidos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──
-- Leitura de membro: pedido é operacional, o vendedor precisa ver sem perguntar.
-- Escrita nenhuma por sessão de usuário — quem grava é a rota, com service_role.
ALTER TABLE public.erp_pedidos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can select" ON public.erp_pedidos;
CREATE POLICY "members can select" ON public.erp_pedidos
  FOR SELECT USING (public.is_member_of(organization_id));

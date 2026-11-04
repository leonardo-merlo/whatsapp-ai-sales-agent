-- =============================================================
-- erp_eventos — o log do ciclo inteiro
-- =============================================================
-- O extrato, do qual `erp_pedidos` é o saldo. Imutável: nada aqui é atualizado
-- depois de escrito, exceto `aplicado_em`.
--
-- **Por que nasce nova em vez de `orcamento_eventos` ser renomeada.** A regra 2 do
-- bloco C diz que toda migration é aditiva, nunca renomeia nem remove.
-- `orcamento_eventos` foi feita para o contrato v1 (chaveia por orcamento_id, não
-- conhece pedido nem tipo de evento) e tem 0 linhas em 18/09 — não há dado a
-- migrar. Ela fica parada, marcada como obsoleta, e some num cleanup aprovado à
-- parte.
--
-- **`pedido_uuid` é SET NULL, não CASCADE.** Apagar um pedido não pode apagar a
-- fita do que aconteceu com ele.
--
-- **`aplicado_em` nulo significa "chegou mas não foi projetado"**: evento de pedido
-- que não é nosso, ou evento fora de ordem. Os dois casos precisam responder 200 à
-- Distribuidora Exemplo, senão ela reenvia para sempre.
--
-- Migration ADITIVA.

CREATE TABLE IF NOT EXISTS public.erp_eventos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evento_id        text        NOT NULL,
  -- Nulo nos eventos do contrato v1, que não mandam tipo.
  tipo_evento      text,
  status           text,
  ocorrido_em      timestamptz,
  -- Identificadores como o ERP os manda, em texto.
  pedido_id        text,
  orcamento_id     text,
  cliente_id       text,
  -- O pedido do nosso lado, resolvido no momento da escrita.
  pedido_uuid      uuid        REFERENCES public.erp_pedidos(id) ON DELETE SET NULL,
  dados            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  payload          jsonb       NOT NULL,
  aplicado_em      timestamptz,
  recebido_em      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_eventos IS
  'Log de tudo que o sistema do cliente avisou sobre orcamento e pedido. E daqui que sai a linha do tempo do painel.';
COMMENT ON COLUMN public.erp_eventos.evento_id IS
  'Identificador do evento no sistema do cliente. E por ele que a repeticao e ignorada.';
COMMENT ON COLUMN public.erp_eventos.tipo_evento IS
  'Nulo nos eventos do contrato v1, que nao mandam tipo.';
COMMENT ON COLUMN public.erp_eventos.aplicado_em IS
  'Quando este evento foi projetado em erp_pedidos. Nulo = chegou mas nao mexeu no estado (pedido desconhecido ou evento fora de ordem).';
COMMENT ON COLUMN public.erp_eventos.payload IS
  'Corpo cru da requisicao. O contrato ainda tem campos A DEFINIR - nada se perde aqui.';

-- Idempotência: o mesmo evento reenviado não conta duas vezes. Por organização
-- porque o `evento_id` é gerado do lado do cliente e nada garante que dois clientes
-- diferentes não usem a mesma sequência.
CREATE UNIQUE INDEX IF NOT EXISTS erp_eventos_evento_unico
  ON public.erp_eventos (organization_id, evento_id);
CREATE INDEX IF NOT EXISTS erp_eventos_pedido_idx
  ON public.erp_eventos (organization_id, pedido_id);
CREATE INDEX IF NOT EXISTS erp_eventos_orcamento_idx
  ON public.erp_eventos (organization_id, orcamento_id);
CREATE INDEX IF NOT EXISTS erp_eventos_pedido_uuid_idx
  ON public.erp_eventos (pedido_uuid);

-- ── RLS ──
ALTER TABLE public.erp_eventos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can select" ON public.erp_eventos;
CREATE POLICY "members can select" ON public.erp_eventos
  FOR SELECT USING (public.is_member_of(organization_id));

-- ── a tabela do v1 fica parada ──
COMMENT ON TABLE public.orcamento_eventos IS
  'OBSOLETA desde 18/09/2026. Substituida por erp_eventos, que cobre o ciclo inteiro. Mantida porque migration aqui e aditiva; remover so com aprovacao explicita.';

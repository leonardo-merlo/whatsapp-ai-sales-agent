-- =============================================================
-- Assinatura real via Asaas (Fase 6)
-- IDs do Asaas pra criar/reaproveitar cliente e assinatura, e pra
-- reconciliar o webhook de confirmação de pagamento com a fatura local.
-- =============================================================

ALTER TABLE public.organizations ADD COLUMN asaas_customer_id text;
ALTER TABLE public.subscriptions ADD COLUMN asaas_subscription_id text;
ALTER TABLE public.invoices ADD COLUMN asaas_payment_id text;

CREATE UNIQUE INDEX invoices_asaas_payment_id_idx ON public.invoices(asaas_payment_id)
  WHERE asaas_payment_id IS NOT NULL;

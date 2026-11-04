-- =============================================================
-- Status de pagamento por número
-- =============================================================
-- O único sinal que a Meta dá quando o cartão do cliente falha é o erro
-- síncrono na resposta do envio (131042/131044) — não existe webhook de
-- billing. Até aqui esse código só virava `console.error`. Este item guarda
-- o estado por número e avisa pelo sino que já existe, no mesmo padrão de
-- `venda_baixa_estoque`/`estoque_minimo` (20260729000002_vendas_notificacoes.sql).
--
-- Migration ADITIVA. `billing_status` volta para 'ok' sozinho no próximo
-- envio bem-sucedido daquele número (lib/whatsapp/billing-status.ts).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wa_number_billing_status') THEN
    CREATE TYPE public.wa_number_billing_status AS ENUM ('ok', 'pagamento_falhou');
  END IF;
END $$;

ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS billing_status wa_number_billing_status NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS billing_atualizado_em timestamptz;

COMMENT ON COLUMN public.wa_numbers.billing_status IS
  'ok ou pagamento_falhou (erro 131042/131044 da Meta no envio). Some sozinho no próximo envio que passar.';

-- Novo tipo de notificação no sino que já existe (mesmo enum de
-- venda_baixa_estoque/estoque_minimo). Não é usado dentro desta migration —
-- ALTER TYPE ... ADD VALUE não pode ser referenciado na mesma transação em
-- que foi criado.
ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'numero_pagamento_falhou';

-- De qual número veio a notificação. Nulo nas notificações de venda/estoque,
-- que já existiam antes deste campo.
ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS notificacoes_wa_number_id_idx ON public.notificacoes (wa_number_id);

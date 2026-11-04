-- =============================================================
-- Plano único de R$ 250 (S1), parte 2: esconder os antigos e criar o novo
-- =============================================================
-- Decisão do Leonardo em 29/09: um plano só, R$ 250/mês, para PME local. A Meta
-- cobra direto no cartão da conta do cliente, então o valor cobre IA e
-- infraestrutura.
--
-- Os três planos de julho (Básico, Profissional, Avançado) ficam ESCONDIDOS,
-- não apagados: assinatura antiga continua apontando para eles e valendo. Só
-- a vitrine (landing, tela de plano, rota de assinar) passa a filtrar
-- `visivel`.
--
-- Números do plano novo (conta no docs/handoff-2026-09-29.md):
--   preço 25000 centavos, anual = mensal x 10 (como os outros);
--   max_atendentes 5, igual ao Profissional;
--   max_msgs_mes 1000: no teto, a IA custa no máximo 25% do preço.
--
-- Migration ADITIVA: uma coluna com default e uma linha nova.

ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS visivel boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.plans.visivel IS
  'false = plano fora da vitrine (landing, tela de plano, rota de assinar). Assinaturas existentes continuam valendo.';

UPDATE public.plans SET visivel = false WHERE key IN ('basico', 'profissional', 'avancado');

INSERT INTO public.plans (id, key, nome, preco_centavos, preco_anual_centavos, max_atendentes, max_msgs_mes, visivel)
VALUES ('bbbbbbbb-0000-0000-0000-000000000004', 'unico', 'Wappia', 25000, 250000, 5, 1000, true)
ON CONFLICT (id) DO NOTHING;

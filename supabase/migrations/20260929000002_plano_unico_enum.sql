-- =============================================================
-- Plano único de R$ 250 (S1), parte 1: a chave nova no enum
-- =============================================================
-- Separada da parte 2 porque o Postgres não deixa usar um valor de enum
-- recém-criado dentro da mesma transação que o criou.
--
-- Migration ADITIVA: um valor novo no enum plan_key.

ALTER TYPE public.plan_key ADD VALUE IF NOT EXISTS 'unico';

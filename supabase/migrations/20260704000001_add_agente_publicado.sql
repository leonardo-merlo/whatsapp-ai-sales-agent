-- =============================================================
-- Rascunho / Publicado do agente (Fase 3)
-- Adiciona snapshot congelado do que foi publicado, separado do
-- rascunho (ai_agent_config + business_* já editáveis hoje).
-- =============================================================

ALTER TABLE public.ai_agent_config
  ADD COLUMN published_snapshot jsonb,
  ADD COLUMN published_at timestamptz;

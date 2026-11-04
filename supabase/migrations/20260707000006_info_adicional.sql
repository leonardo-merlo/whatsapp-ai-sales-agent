-- =============================================================
-- Informações adicionais do agente (aba Conhecimento)
-- Texto livre que o cliente quiser que o agente saiba, além dos campos estruturados.
-- =============================================================

ALTER TABLE public.ai_agent_config
  ADD COLUMN info_adicional text NOT NULL DEFAULT '';

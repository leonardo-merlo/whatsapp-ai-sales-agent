-- =============================================================
-- Tom de voz do agente (redesenho da seção Agente)
-- Seletor de tom (chips) que o build-prompt.ts traduz numa frase
-- fixa prefixada à instrução principal — o usuário não escreve
-- a personalidade à mão.
-- =============================================================

CREATE TYPE public.agente_tom AS ENUM ('simpatico', 'direto', 'formal', 'descontraido');

ALTER TABLE public.ai_agent_config
  ADD COLUMN tom public.agente_tom NOT NULL DEFAULT 'simpatico';

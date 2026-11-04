-- =============================================================
-- Fundação WhatsApp Cloud API (Fase 4)
-- Mapeia qual organização corresponde a qual número da Cloud API,
-- para o webhook receiver rotear mensagens recebidas para a org certa.
-- =============================================================

ALTER TABLE public.organizations
  ADD COLUMN wa_phone_number_id text;

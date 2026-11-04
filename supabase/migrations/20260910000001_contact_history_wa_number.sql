-- De qual número veio cada resumo de atendimento.
--
-- Decisão do Leonardo em 2026-09-10: quando o mesmo cliente conversa com dois
-- vendedores, a IA de cada vendedor só enxerga o que aconteceu NAQUELA conversa.
-- As mensagens já dá para separar (conversations.wa_number_id, fase 3), mas os
-- resumos de atendimentos anteriores ficam em contact_history, que não sabia de
-- onde vinham — sem esta coluna, o resumo da conversa do Pedro apareceria para
-- a IA do João.
--
-- Aditiva: nula nos resumos que já existem, e nulo significa "vale para
-- qualquer número", que é o comportamento de antes. No Wappia Atendimento, com
-- um número só, nada muda.

ALTER TABLE public.contact_history
  ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.contact_history.wa_number_id IS
  'Número da conversa que gerou este resumo. Nulo nos resumos anteriores a 2026-09-10 — esses valem para qualquer número.';

CREATE INDEX IF NOT EXISTS contact_history_wa_number_id_idx
  ON public.contact_history (wa_number_id);

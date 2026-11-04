-- Marca quando a conversa foi resumida pela última vez, para o cron de resumo
-- automático não re-resumir conversas sem novidade.
ALTER TABLE public.conversations
  ADD COLUMN resumida_em timestamptz;

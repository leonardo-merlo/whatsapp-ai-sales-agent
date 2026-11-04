-- Perguntas de qualificação passam a pertencer a um objetivo (venda, agendamento
-- ou contato). Assim cada objetivo do agente tem sua própria lista de perguntas.
-- As perguntas já existentes ficam no objetivo "contato" (genérico) e podem ser
-- reorganizadas na tela.

ALTER TABLE public.business_qualification_questions
  ADD COLUMN objetivo text NOT NULL DEFAULT 'contato';

ALTER TABLE public.business_qualification_questions
  ADD CONSTRAINT business_qualification_questions_objetivo_check
  CHECK (objetivo IN ('venda', 'agendamento', 'contato'));

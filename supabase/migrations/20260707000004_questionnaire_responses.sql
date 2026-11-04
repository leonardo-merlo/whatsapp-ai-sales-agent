-- =============================================================
-- Respostas de questionário coletadas pelo agente
-- Quando o agente completa o Questionário numa conversa, grava as respostas
-- ligadas ao contato (e à conversa de origem). Aparecem na ficha do cliente
-- para orientar o próximo passo do atendente. Histórico: N respostas por contato.
-- =============================================================

CREATE TABLE public.questionnaire_responses (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id)  ON DELETE CASCADE,
  contact_id       uuid        NOT NULL REFERENCES public.contacts(id)       ON DELETE CASCADE,
  conversation_id  uuid        REFERENCES public.conversations(id)           ON DELETE SET NULL,
  respostas        jsonb       NOT NULL DEFAULT '[]'::jsonb, -- [{pergunta, resposta}]
  resultado        text,                                     -- 'venda' | 'agendamento' | 'contato' | null
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.questionnaire_responses(contact_id);
CREATE INDEX ON public.questionnaire_responses(organization_id);

ALTER TABLE public.questionnaire_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members full" ON public.questionnaire_responses
  FOR ALL USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));

-- Regras automáticas do agente: condições que, quando detectadas na conversa,
-- disparam um comportamento — transferir para um atendente humano ou responder
-- com uma mensagem segura pré-definida. Injetadas no system prompt do agente.
CREATE TABLE public.business_rules (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome             text        NOT NULL,
  condicao         text        NOT NULL,
  acao             text        NOT NULL DEFAULT 'transferir',
  mensagem         text        NOT NULL DEFAULT '',
  ativo            boolean     NOT NULL DEFAULT true,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_rules_acao_check CHECK (acao IN ('transferir', 'responder'))
);

CREATE INDEX ON public.business_rules(organization_id);

-- Mesmo padrão das demais tabelas de conhecimento do negócio:
-- leitura para membros da org, escrita para admins.
ALTER TABLE public.business_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.business_rules
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.business_rules
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

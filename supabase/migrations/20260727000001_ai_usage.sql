-- ── ai_usage ──────────────────────────────────
-- Uma linha por chamada Claude do sistema. Base para relatórios de custo/tokens.
-- Escrita best-effort (nunca derruba a resposta); leitura por membros da org.
CREATE TABLE public.ai_usage (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  origem           text        NOT NULL,  -- 'motor' | 'resumo' | 'simulador' | 'perfil'
  model            text        NOT NULL,
  input_tokens     integer     NOT NULL DEFAULT 0,
  output_tokens    integer     NOT NULL DEFAULT 0,
  conversation_id  uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.ai_usage(organization_id);
CREATE INDEX ON public.ai_usage(created_at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
-- Membros leem os próprios dados de uso (base do futuro dashboard).
CREATE POLICY "members can select" ON public.ai_usage
  FOR SELECT USING (public.is_member_of(organization_id));
-- Inserção autenticada (encerrar/simulador usam o client do usuário). O webhook
-- usa service_role, que ignora RLS — então já cobre o motor de IA.
CREATE POLICY "members can insert" ON public.ai_usage
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));

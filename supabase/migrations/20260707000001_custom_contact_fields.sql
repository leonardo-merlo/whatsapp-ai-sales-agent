-- =============================================================
-- Campos customizados de contato (multi-segmento)
-- - contacts.custom_fields jsonb (valores por contato)
-- - custom_field_definitions (quais campos existem por organização)
-- - remove colunas fixas de clínica: convenio, tratamento, proximo_retorno
-- =============================================================

-- ── 1. Valores dos campos customizados por contato ──
ALTER TABLE public.contacts
  ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Migrar dados existentes para custom_fields antes de dropar ──
-- convenio/tratamento viram entradas de custom_fields quando não vazios.
UPDATE public.contacts
SET custom_fields = custom_fields
  || CASE WHEN coalesce(convenio, '') <> '' THEN jsonb_build_object('convenio', convenio) ELSE '{}'::jsonb END
  || CASE WHEN coalesce(tratamento, '') <> '' AND tratamento <> '—' THEN jsonb_build_object('tratamento', tratamento) ELSE '{}'::jsonb END;

-- ── 3. Remover colunas fixas de clínica ──
ALTER TABLE public.contacts DROP COLUMN convenio;
ALTER TABLE public.contacts DROP COLUMN tratamento;
ALTER TABLE public.contacts DROP COLUMN proximo_retorno;

-- ── 4. Definições de campos customizados por organização ──
CREATE TABLE public.custom_field_definitions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key              text        NOT NULL,
  label            text        NOT NULL,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE INDEX ON public.custom_field_definitions(organization_id);

-- RLS no padrão do projeto: leitura para membros, escrita para admins.
ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.custom_field_definitions
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.custom_field_definitions
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- =============================================================
-- Generalização multi-segmento (Fase 2)
-- O produto atende qualquer negócio local, não só clínicas:
--   clinic_* → business_* · municipe → cliente · convenio vira texto
--   organizations.segmento · convite de equipe por e-mail
-- =============================================================

-- ── 1. Renomear tabelas de conhecimento (policies acompanham) ──
ALTER TABLE public.clinic_prices RENAME TO business_prices;
ALTER TABLE public.clinic_business_hours RENAME TO business_hours;
ALTER TABLE public.clinic_faqs RENAME TO business_faqs;
ALTER TABLE public.clinic_qualification_questions RENAME TO business_qualification_questions;
ALTER TABLE public.clinic_triggers RENAME TO business_triggers;

-- ── 2. Autor de mensagem: municipe → cliente ──
ALTER TYPE public.message_autor RENAME VALUE 'municipe' TO 'cliente';

-- ── 3. Convênio deixa de ser enum fixo (só faz sentido em saúde) ──
ALTER TABLE public.contacts ALTER COLUMN convenio DROP DEFAULT;
ALTER TABLE public.contacts ALTER COLUMN convenio TYPE text USING convenio::text;
ALTER TABLE public.contacts ALTER COLUMN convenio SET DEFAULT 'particular';
DROP TYPE public.convenio_type;

-- ── 4. Segmento do negócio (define presets de UI e do agente) ──
ALTER TABLE public.organizations
  ADD COLUMN segmento text NOT NULL DEFAULT 'outro';

UPDATE public.organizations SET segmento = 'clinica'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ── 5. Convite de equipe por e-mail ──
-- Membro é criado com user_id NULL + invite_email; quando a pessoa
-- se cadastra com esse e-mail, claim_member_invite faz o vínculo.
ALTER TABLE public.organization_members
  ADD COLUMN invite_email text;

CREATE OR REPLACE FUNCTION public.claim_member_invite()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meu_email text;
  convite record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  -- Quem já pertence a uma organização não reivindica convite
  IF EXISTS (SELECT 1 FROM public.organization_members WHERE user_id = auth.uid()) THEN
    RETURN NULL;
  END IF;

  SELECT email INTO meu_email FROM auth.users WHERE id = auth.uid();

  SELECT id, organization_id INTO convite
  FROM public.organization_members
  WHERE user_id IS NULL AND lower(invite_email) = lower(meu_email)
  ORDER BY created_at
  LIMIT 1;

  IF convite.id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.organization_members
  SET user_id = auth.uid(), invite_email = NULL
  WHERE id = convite.id;

  RETURN convite.organization_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_member_invite() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_member_invite() TO authenticated;

-- ── 6. RPC de criação de organização ganha o segmento ──
DROP FUNCTION IF EXISTS public.create_organization_with_owner(text, text);

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  org_nome text,
  owner_nome text,
  org_segmento text DEFAULT 'outro'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF org_nome IS NULL OR length(trim(org_nome)) < 2 THEN
    RAISE EXCEPTION 'Nome da organização inválido';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_members WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Usuário já pertence a uma organização';
  END IF;

  INSERT INTO public.organizations (nome, segmento)
  VALUES (trim(org_nome), coalesce(nullif(trim(org_segmento), ''), 'outro'))
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, nome)
  VALUES (new_org_id, auth.uid(), 'owner', coalesce(nullif(trim(owner_nome), ''), trim(org_nome)));

  INSERT INTO public.ai_agent_config (organization_id)
  VALUES (new_org_id);

  RETURN new_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text) TO authenticated;

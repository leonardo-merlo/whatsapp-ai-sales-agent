-- =============================================================
-- RPC de bootstrap: cria organização + membro owner num passo.
-- Necessária porque o RLS impede um usuário recém-cadastrado de
-- inserir em organizations/organization_members (ovo e galinha).
-- SECURITY DEFINER com EXECUTE restrito a authenticated.
-- =============================================================

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  org_nome  text,
  owner_nome text
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

  -- MVP: um usuário pertence a uma única organização
  IF EXISTS (
    SELECT 1 FROM public.organization_members WHERE user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Usuário já pertence a uma organização';
  END IF;

  INSERT INTO public.organizations (nome)
  VALUES (trim(org_nome))
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, nome)
  VALUES (new_org_id, auth.uid(), 'owner', coalesce(nullif(trim(owner_nome), ''), trim(org_nome)));

  -- Config padrão do agente, para a tela Agente sempre ter uma linha
  INSERT INTO public.ai_agent_config (organization_id)
  VALUES (new_org_id);

  RETURN new_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text, text) TO authenticated;

-- =============================================================
-- Um mesmo login em mais de uma organização
-- =============================================================
-- A RLS já suportava isso desde o schema inicial: `is_member_of` pergunta se
-- existe vínculo COM AQUELA organização, não "qual é a organização do usuário".
-- Quem proibia eram duas funções, e o motivo era simplificar a v1:
--
--   * `claim_member_invite` recusava o convite de quem já tinha organização;
--   * `create_organization_with_owner` levantava exceção no mesmo caso.
--
-- Isso deixou de servir: o Leonardo precisa estar na organização dele e na do
-- cliente, e um vendedor pode atender por uma empresa e ser dono de outra.
--
-- Migration ADITIVA no sentido que importa: nenhuma linha muda, nenhum vínculo
-- existente é tocado. O que muda é o que passa a ser **permitido**.

-- ── 1. Convite aceito mesmo por quem já tem organização ──
-- A troca de guarda é o ponto: em vez de "não tenho organização nenhuma", a
-- condição vira "ainda não estou NESTA organização". É o que impede dois
-- vínculos na mesma empresa sem impedir vínculos em empresas diferentes.
CREATE OR REPLACE FUNCTION public.claim_member_invite()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meu_email text;
  convite   record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  SELECT email INTO meu_email FROM auth.users WHERE id = auth.uid();
  IF meu_email IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT m.id, m.organization_id INTO convite
  FROM public.organization_members m
  WHERE m.user_id IS NULL
    AND lower(m.invite_email) = lower(meu_email)
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_members meu
      WHERE meu.user_id = auth.uid()
        AND meu.organization_id = m.organization_id
    )
  ORDER BY m.created_at
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

-- ── 2. Criar uma organização a mais ──
-- O limite de 10 entra no lugar da proibição: sem nenhum teto, esta função é um
-- laço de criação de empresas para qualquer conta autenticada. Dez é folgado
-- para o uso real e barato de subir se um dia apertar.
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
  quantas    int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado';
  END IF;

  IF org_nome IS NULL OR length(trim(org_nome)) < 2 THEN
    RAISE EXCEPTION 'Nome da organização inválido';
  END IF;

  SELECT count(*) INTO quantas
  FROM public.organization_members
  WHERE user_id = auth.uid();

  IF quantas >= 10 THEN
    RAISE EXCEPTION 'Limite de organizações por usuário atingido';
  END IF;

  INSERT INTO public.organizations (nome, segmento)
  VALUES (trim(org_nome), coalesce(nullif(trim(org_segmento), ''), 'outro'))
  RETURNING id INTO new_org_id;

  INSERT INTO public.organization_members (organization_id, user_id, role, nome)
  VALUES (new_org_id, auth.uid(), 'owner', coalesce(nullif(trim(owner_nome), ''), trim(org_nome)));

  RETURN new_org_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text, text, text) TO authenticated;

-- ── 3. Um vínculo por pessoa em cada organização ──
-- Enquanto "uma organização por usuário" valia, isso era impossível por
-- construção. Agora não é mais: sem este índice, aceitar dois convites da mesma
-- empresa criaria dois vínculos, a lista de troca mostraria a empresa duas
-- vezes e o papel dependeria de qual linha viesse primeiro.
-- Parcial porque convite pendente tem `user_id` nulo, e uma empresa pode ter
-- vários convites em aberto.
CREATE UNIQUE INDEX IF NOT EXISTS organization_members_um_vinculo_por_org
  ON public.organization_members (organization_id, user_id)
  WHERE user_id IS NOT NULL;

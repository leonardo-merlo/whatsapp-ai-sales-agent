-- =============================================================
-- Apagar uma integração leva o segredo junto
-- =============================================================
-- **A sujeira que o primeiro teste real revelou (14/09):** apagar a linha de
-- `organization_integrations` deixa o segredo dela **órfão no Vault** — uma
-- chave de API guardada sem dono, que ninguém mais encontra e ninguém mais
-- apaga. Na primeira vez foi limpo à mão. Segredo órfão não vaza sozinho, mas
-- é a pior espécie de resto: cresce em silêncio, e um dia alguém audita o
-- Vault e não sabe quais linhas ainda valem.
--
-- O DELETE direto na tabela não tem como levar o segredo junto: o schema
-- `vault` não é acessível de dentro de uma policy nem do PostgREST. Então
-- apagar deixa de ser DELETE e passa a ser esta função, que faz as duas
-- coisas na ordem certa — o segredo primeiro, a linha depois. Se o DELETE do
-- segredo falhar, a linha fica de pé e o problema aparece; o contrário
-- (linha some, segredo fica) é justamente o que se quer impedir.
--
-- Migration ADITIVA: só cria uma função. Nada muda para quem já está no ar.

CREATE OR REPLACE FUNCTION public.apagar_integracao(
  p_integration_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
  v_existe    boolean;
BEGIN
  SELECT token_secret_id, true INTO v_secret_id, v_existe
    FROM public.organization_integrations
   WHERE id = p_integration_id;

  IF v_existe IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_secret_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_secret_id;
  END IF;

  DELETE FROM public.organization_integrations WHERE id = p_integration_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.apagar_integracao(uuid) IS
  'Apaga a integracao e o segredo dela no Vault, nessa ordem. So service_role — a rota confere que quem pede e admin da organizacao.';

REVOKE ALL ON FUNCTION public.apagar_integracao(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apagar_integracao(uuid) TO service_role;

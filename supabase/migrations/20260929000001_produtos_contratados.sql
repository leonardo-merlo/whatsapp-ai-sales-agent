-- =============================================================
-- Produtos contratados por organização (S14)
-- =============================================================
-- Um sistema, duas caras: Wappia Atendimento e Wappia Vendas. O produto decide
-- o menu, a cor e os modelos de template que a empresa enxerga.
--
-- Quem marca é o Leonardo (script app/scripts/produtos-da-org.mjs). O cliente
-- não escolhe, então o admin da própria organização NÃO pode mudar esta coluna,
-- mesmo tendo UPDATE em organizations pela RLS: um gatilho barra a troca quando
-- quem pede é um usuário logado. O service_role (script) e as funções
-- security definer passam.
--
-- O roteiro por número (ai_agent_config.roteiro) continua mandando no motor.
-- Esta coluna é só da tela.
--
-- Migration ADITIVA: uma coluna com default, um check e um gatilho. A Distribuidora Exemplo
-- passa a ter só vendas; toda outra organização fica com atendimento, que é o
-- default.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS produtos text[] NOT NULL DEFAULT '{atendimento}';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_produtos_validos;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_produtos_validos
  CHECK (cardinality(produtos) > 0 AND produtos <@ ARRAY['atendimento', 'vendas']::text[]);

COMMENT ON COLUMN public.organizations.produtos IS
  'Produtos contratados (atendimento, vendas). Decide menu, cor e modelos de template. Definido pela Wappia, nunca pelo cliente.';

CREATE OR REPLACE FUNCTION public.produtos_so_pela_wappia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.produtos := '{atendimento}';
    ELSIF NEW.produtos IS DISTINCT FROM OLD.produtos THEN
      RAISE EXCEPTION 'Os produtos da empresa são definidos pela Wappia.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organizations_produtos_so_pela_wappia ON public.organizations;
CREATE TRIGGER organizations_produtos_so_pela_wappia
  BEFORE INSERT OR UPDATE OF produtos ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.produtos_so_pela_wappia();

UPDATE public.organizations
   SET produtos = '{vendas}'
 WHERE id = 'e8e00000-0000-4000-8000-0000000000e1';

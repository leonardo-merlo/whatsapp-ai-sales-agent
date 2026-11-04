-- Enforcement de limite de plano: impede que uma org ative mais atendentes
-- do que o max_atendentes do plano contratado (ou do plano básico, como teto
-- de trial quando não há assinatura ativa). Aplicado como trigger porque
-- organization_members é inserida/atualizada direto do browser (client
-- Supabase com RLS), sem API route intermediária — o limite precisa ser
-- garantido no Postgres, não só no client.

CREATE OR REPLACE FUNCTION public.check_limite_atendentes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_atendentes int;
  v_ativos int;
BEGIN
  IF NEW.ativo IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ativo IS TRUE THEN
    RETURN NEW; -- já estava ativo, não é uma nova ativação
  END IF;

  SELECT p.max_atendentes INTO v_max_atendentes
  FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id
  WHERE s.organization_id = NEW.organization_id AND s.status = 'ativa'
  LIMIT 1;

  IF v_max_atendentes IS NULL THEN
    -- sem assinatura ativa (trial): usa o teto do plano básico como referência
    SELECT max_atendentes INTO v_max_atendentes FROM public.plans WHERE key = 'basico';
  END IF;

  SELECT count(*) INTO v_ativos
  FROM public.organization_members
  WHERE organization_id = NEW.organization_id AND ativo = true
    AND id IS DISTINCT FROM NEW.id;

  IF v_max_atendentes IS NOT NULL AND v_ativos >= v_max_atendentes THEN
    RAISE EXCEPTION 'LIMITE_ATENDENTES_ATINGIDO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_limite_atendentes ON public.organization_members;
CREATE TRIGGER trg_check_limite_atendentes
  BEFORE INSERT OR UPDATE OF ativo ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.check_limite_atendentes();

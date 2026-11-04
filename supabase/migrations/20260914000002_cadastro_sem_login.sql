-- =============================================================
-- Cadastrar alguém da equipe sem dar login
-- =============================================================
-- **O problema:** para dizer "este número é do vendedor João", o João precisa
-- existir em `organization_members` — e a única forma de criar alguém lá é
-- convidar por e-mail, o que cria um login. Os sete vendedores da Distribuidora Exemplo
-- não vão entrar no painel: eles só precisam existir como NOME, CÓDIGO no
-- sistema e WHATSAPP, para o orçamento sair com o vendedor certo e o copiloto
-- saber para quem avisar.
--
-- **O que esta migration muda de regra, e é preciso dizer em voz alta:**
-- `check_limite_atendentes` conta hoje TODO membro ativo contra o
-- `max_atendentes` do plano. Sete vendedores sem login ocupariam sete vagas de
-- atendente — e vaga de atendente é vaga no painel, que é o que o plano cobra.
-- Quem não entra no painel não ocupa vaga. A partir daqui a trava conta só
-- quem tem acesso: `acessa_painel = true`.
--
-- **Comportamento antigo é o padrão.** A coluna nasce `true` e o backfill não
-- existe porque o DEFAULT já cobre as linhas existentes: toda pessoa que já
-- está cadastrada hoje continua contando exatamente como contava, e nenhuma
-- organização passa a caber mais gente do que cabia. O único jeito de criar
-- uma linha `false` é o cadastro novo, que ainda não existe na tela.

ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS acessa_painel boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organization_members.acessa_painel IS
  'A pessoa entra no painel (ocupa vaga de atendente no plano)? false = só cadastrada, para o número do vendedor ter dono, código no ERP e WhatsApp — sem login.';

-- ── A trava de limite passa a contar só quem ocupa vaga ─────
-- Mesma função de 20260704170000, com duas mudanças: a saída antecipada quando
-- a própria linha não acessa o painel, e o `acessa_painel` na contagem.
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
  -- Quem não entra no painel não ocupa vaga: um vendedor cadastrado só para
  -- ter código no ERP e WhatsApp não é um atendente a mais no sistema.
  IF NEW.acessa_painel IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.ativo IS TRUE AND OLD.acessa_painel IS TRUE THEN
    RETURN NEW; -- já ocupava vaga, não é uma nova ativação
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
  WHERE organization_id = NEW.organization_id AND ativo = true AND acessa_painel = true
    AND id IS DISTINCT FROM NEW.id;

  IF v_max_atendentes IS NOT NULL AND v_ativos >= v_max_atendentes THEN
    RAISE EXCEPTION 'LIMITE_ATENDENTES_ATINGIDO' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

-- O trigger precisa disparar também quando alguém PASSA a acessar o painel
-- (o "convidar depois quem foi só cadastrado"): sem `acessa_painel` na lista
-- de colunas, promover sete vendedores a atendente fura o limite calado.
DROP TRIGGER IF EXISTS trg_check_limite_atendentes ON public.organization_members;
CREATE TRIGGER trg_check_limite_atendentes
  BEFORE INSERT OR UPDATE OF ativo, acessa_painel ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.check_limite_atendentes();

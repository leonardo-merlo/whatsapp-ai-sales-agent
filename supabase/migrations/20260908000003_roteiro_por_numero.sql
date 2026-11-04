-- =============================================================
-- Roteiro por número — ai_agent_config deixa de ser um por empresa
-- =============================================================
-- `ai_agent_config` tem `UNIQUE (organization_id)`: um comportamento por
-- empresa. No Wappia Vendas o número do vendedor precisa de um roteiro
-- diferente do número de atendimento da mesma empresa.
--
-- **Referência vazia significa "vale para a empresa toda"**, que é exatamente
-- como tudo funciona hoje: a linha que já existe fica com `wa_number_id` nulo e
-- nenhum cliente atual se move.
--
-- O `UNIQUE (organization_id)` é trocado por dois índices únicos PARCIAIS. Não é
-- afrouxamento: continua existindo no máximo UMA linha da empresa toda, e passa
-- a existir no máximo uma por número. A regra antiga continua valendo, só que
-- agora expressa no lugar certo.

ALTER TABLE public.ai_agent_config
  ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS roteiro      text NOT NULL DEFAULT 'atendimento';

COMMENT ON COLUMN public.ai_agent_config.wa_number_id IS
  'Número a que este comportamento se aplica. NULO = vale para a empresa toda (o comportamento de sempre).';
COMMENT ON COLUMN public.ai_agent_config.roteiro IS
  'Qual roteiro o motor deve seguir neste número. Texto com CHECK, e não enum, porque os valores ainda vão mudar no bloco C.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_agent_config_roteiro_valido'
  ) THEN
    ALTER TABLE public.ai_agent_config
      ADD CONSTRAINT ai_agent_config_roteiro_valido
      CHECK (roteiro IN ('atendimento', 'vendas', 'copiloto'));
  END IF;
END $$;

ALTER TABLE public.ai_agent_config
  DROP CONSTRAINT IF EXISTS ai_agent_config_organization_id_key;

-- No máximo uma configuração "da empresa toda" por organização — a mesma regra
-- de antes, agora restrita às linhas sem número.
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_config_um_por_org
  ON public.ai_agent_config (organization_id)
  WHERE wa_number_id IS NULL;

-- E no máximo uma por número.
CREATE UNIQUE INDEX IF NOT EXISTS ai_agent_config_um_por_numero
  ON public.ai_agent_config (wa_number_id)
  WHERE wa_number_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_agent_config_wa_number_id_idx
  ON public.ai_agent_config (wa_number_id);

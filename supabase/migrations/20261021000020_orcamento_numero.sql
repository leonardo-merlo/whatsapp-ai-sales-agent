-- =============================================================
-- Número do orçamento, sequencial por organização (T1, teste de campo de 20/10)
-- =============================================================
-- Pedido do Leonardo: "é importante o cliente ter vários orçamentos ao mesmo
-- tempo, e ter o prazo de 5 dias, o orçamento é identificável por um número".
--
-- O número nasce quando a lista é confirmada (a máquina chama
-- `numerar_orcamento`), e junto vem a validade em `expira_em`, coluna que já
-- existe. Um contador por organização, e não uma SEQUENCE global: cada
-- distribuidora começa no 1, e o número que o cliente lê fica curto.
--
-- Migration ADITIVA: coluna nula, tabela e função novas. Orçamento antigo
-- continua sem número. O código lê a ficha com `select('*')` e trata a falta
-- da função como "sem número", então pode ir ao ar antes desta migration.

ALTER TABLE public.orcamentos_em_andamento ADD COLUMN IF NOT EXISTS numero integer;

CREATE UNIQUE INDEX IF NOT EXISTS orcamentos_em_andamento_numero_idx
  ON public.orcamentos_em_andamento (organization_id, numero)
  WHERE numero IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.orcamento_contadores (
  organization_id uuid    PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  ultimo          integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.orcamento_contadores IS
  'O ultimo numero de orcamento dado em cada organizacao. So a funcao numerar_orcamento escreve.';

-- Sem policy: ninguém lê pelo painel, só a service_role pela função.
ALTER TABLE public.orcamento_contadores ENABLE ROW LEVEL SECURITY;

-- Dá o número ao orçamento, uma vez só: chamada de novo (varredura, a lista
-- confirmada de novo depois de mudar), devolve o número e a validade que ele
-- já tem. O FOR UPDATE e o ON CONFLICT seguram duas execuções ao mesmo tempo.
CREATE OR REPLACE FUNCTION public.numerar_orcamento(p_id uuid, p_expira_em timestamptz)
RETURNS TABLE (numero integer, expira_em timestamptz)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_org    uuid;
  v_numero integer;
  v_expira timestamptz;
BEGIN
  SELECT o.organization_id, o.numero, o.expira_em INTO v_org, v_numero, v_expira
  FROM public.orcamentos_em_andamento o WHERE o.id = p_id FOR UPDATE;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'orcamento % nao existe', p_id;
  END IF;

  IF v_numero IS NULL THEN
    INSERT INTO public.orcamento_contadores AS c (organization_id, ultimo) VALUES (v_org, 1)
    ON CONFLICT (organization_id) DO UPDATE SET ultimo = c.ultimo + 1
    RETURNING c.ultimo INTO v_numero;
    v_expira := p_expira_em;
    UPDATE public.orcamentos_em_andamento o SET numero = v_numero, expira_em = v_expira WHERE o.id = p_id;
  END IF;

  RETURN QUERY SELECT v_numero, v_expira;
END;
$$;

REVOKE ALL ON FUNCTION public.numerar_orcamento(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.numerar_orcamento(uuid, timestamptz) TO service_role;

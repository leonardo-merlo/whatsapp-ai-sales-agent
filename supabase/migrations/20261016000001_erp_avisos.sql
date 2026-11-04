-- =============================================================
-- erp_avisos — dado do sistema de gestão num formato que o código não lê
-- =============================================================
-- Em 16/10 vimos que mudar o FORMATO do que o ERP manda (um código de forma de
-- pagamento novo, uma descrição escrita de outro jeito) quebra a leitura sem
-- aviso: a forma some do menu, o produto perde a medida. Aqui fica uma linha
-- por aviso DIFERENTE, com quantas vezes chegou e quando foi a última, para o
-- painel mostrar antes de um cliente reclamar.
--
-- Quem grava é `registrar_avisos_erp`, chamada pelo observador das chamadas ao
-- ERP (service_role). Aviso inédito gera uma notificação no sino.
--
-- RLS de ADMIN, como `erp_chamadas`: o detalhe traz dado cru do cliente.
--
-- Migration ADITIVA: cria tabela, função e um valor de enum.

ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'erp_formato_novo';

CREATE TABLE IF NOT EXISTS public.erp_avisos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'forma_desconhecida' | 'boleto_sem_prazo' | 'produto_sem_medida' ...
  tipo             text        NOT NULL,
  -- O que identifica o aviso dentro do tipo (código da forma, id do produto).
  chave            text        NOT NULL,
  -- 'cliente' | 'produto' | 'regiao'
  origem           text        NOT NULL,
  -- O que chegou, em uma linha ("CHEQUES, forma CQ").
  descricao        text        NOT NULL,
  -- De quem veio da última vez (id do cliente no ERP, id do produto).
  referencia       text,
  ocorrencias      integer     NOT NULL DEFAULT 1,
  primeira_em      timestamptz NOT NULL DEFAULT now(),
  ultima_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, tipo, chave)
);

COMMENT ON TABLE public.erp_avisos IS
  'Dados do sistema de gestão que chegaram num formato que o código não lê; uma linha por aviso distinto.';

CREATE INDEX IF NOT EXISTS erp_avisos_recentes_idx
  ON public.erp_avisos (organization_id, ultima_em DESC);

ALTER TABLE public.erp_avisos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins can select" ON public.erp_avisos;
CREATE POLICY "admins can select" ON public.erp_avisos
  FOR SELECT USING (public.is_admin_of(organization_id));

-- Grava os avisos de uma chamada numa ida só: inédito entra, repetido soma.
-- Devolve quantos eram inéditos; havendo algum, uma notificação só no sino.
CREATE OR REPLACE FUNCTION public.registrar_avisos_erp(p_org uuid, p_avisos jsonb)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_novos integer;
BEGIN
  WITH gravados AS (
    INSERT INTO public.erp_avisos AS a (organization_id, tipo, chave, origem, descricao, referencia)
    SELECT p_org, x->>'tipo', x->>'chave', x->>'origem', x->>'descricao', x->>'referencia'
    FROM jsonb_array_elements(p_avisos) x
    ON CONFLICT (organization_id, tipo, chave) DO UPDATE
      SET ocorrencias = a.ocorrencias + 1,
          ultima_em   = now(),
          descricao   = EXCLUDED.descricao,
          referencia  = COALESCE(EXCLUDED.referencia, a.referencia)
    RETURNING (xmax = 0) AS novo
  )
  SELECT count(*) FILTER (WHERE novo) INTO v_novos FROM gravados;

  IF v_novos > 0 THEN
    INSERT INTO public.notificacoes (organization_id, tipo, titulo, corpo)
    VALUES (
      p_org, 'erp_formato_novo', 'Formato novo do ERP',
      CASE WHEN v_novos = 1 THEN '1 aviso novo em Desenvolvimento, Configuração.'
           ELSE v_novos || ' avisos novos em Desenvolvimento, Configuração.' END
    );
  END IF;

  RETURN v_novos;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_avisos_erp(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_avisos_erp(uuid, jsonb) TO service_role;

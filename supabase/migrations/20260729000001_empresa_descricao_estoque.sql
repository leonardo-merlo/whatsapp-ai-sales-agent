-- =============================================================
-- Seção Empresa: descrição do negócio + estoque numérico
--
-- 1) organizations.descricao — o que o negócio faz e seus diferenciais.
--    Vive em organizations (e não em ai_agent_config) porque é fato sobre a
--    empresa, não configuração de comportamento do agente: a aba Empresa passa
--    a ser a fonte única de nome/descrição/endereço.
--
-- 2) business_prices ganha estoque NUMÉRICO. A coluna `estoque` (text, criada em
--    20260707000005) é livre — aceita "8 unidades" ou "sob encomenda" — e por
--    isso não pode ser decrementada. Ela continua existindo como observação de
--    disponibilidade; quem controla baixa de verdade é `estoque_qtd`.
--    `controla_estoque` separa produto (tem estoque) de serviço (não tem).
-- =============================================================

ALTER TABLE public.organizations
  ADD COLUMN descricao text NOT NULL DEFAULT '';

ALTER TABLE public.business_prices
  ADD COLUMN controla_estoque boolean NOT NULL DEFAULT false,
  ADD COLUMN estoque_qtd      integer,
  ADD COLUMN estoque_minimo   integer;

-- Estoque nunca fica negativo: a baixa é aplicada por RPC que recusa a operação
-- quando não há saldo, e a constraint é a última linha de defesa.
ALTER TABLE public.business_prices
  ADD CONSTRAINT business_prices_estoque_qtd_nao_negativo
    CHECK (estoque_qtd IS NULL OR estoque_qtd >= 0),
  ADD CONSTRAINT business_prices_estoque_minimo_nao_negativo
    CHECK (estoque_minimo IS NULL OR estoque_minimo >= 0);

-- Backfill best-effort: aproveita o primeiro número do texto livre ("8", "8 un",
-- "10 a 15" → 10) e só liga o controle de estoque para quem tinha número. Texto
-- sem número nenhum ("sob encomenda", "") fica sem controle, para o dono decidir.
UPDATE public.business_prices
SET estoque_qtd      = (substring(estoque from '^\s*(\d+)'))::integer,
    controla_estoque = true
WHERE substring(estoque from '^\s*(\d+)') IS NOT NULL;

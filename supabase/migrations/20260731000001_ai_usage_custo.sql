-- =============================================================
-- ai_usage.custo_usd — custo em dólares de cada chamada Claude.
--
-- O custo é gravado NO INSERT, não calculado na leitura. O motivo é o
-- histórico: se a Anthropic mudar o preço amanhã, o gasto de ontem não pode
-- se reescrever. A tabela de preços em código (app/src/lib/agente/precos-ia.ts)
-- vale só para as linhas novas; o passado fica congelado no preço da época.
--
-- Tipo: numeric, nunca float. O custo de uma chamada é da ordem de centésimos
-- de milésimo de dólar (~US$ 0,005) e some no arredondamento binário de um
-- double quando somado por milhares de linhas. numeric(14,8) dá 8 casas de
-- resolução (US$ 0,00000001 — bem abaixo do custo de 1 token de entrada do
-- Haiku, US$ 0,000001) e cabe até US$ 999.999,99999999 no total por linha.
-- =============================================================

ALTER TABLE public.ai_usage
  ADD COLUMN custo_usd numeric(14,8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.ai_usage.custo_usd IS
  'Custo em USD desta chamada, calculado no insert com o preço vigente na época. Não recalcular na leitura.';

-- Backfill APROXIMADO das linhas existentes.
--
-- Aproximado porque aplica o preço de HOJE (consultado em 2026-07-31 em
-- platform.claude.com/docs/en/about-claude/pricing) a chamadas que aconteceram
-- antes — é a melhor estimativa possível, não o valor cobrado de fato. Só as
-- linhas gravadas a partir desta migration têm o custo real da época.
--
-- Preços Claude Haiku 4.5, por milhão de tokens:
--   entrada US$ 1,00 · saída US$ 5,00 · cache write (5 min) US$ 1,25 · cache read US$ 0,10
--
-- Modelo fora da lista fica com 0 em vez de um número inventado: zero é
-- visivelmente "não sei", um palpite silencioso não é.
UPDATE public.ai_usage
SET custo_usd = CASE model
  WHEN 'claude-haiku-4-5' THEN (
      input_tokens                * 1.00
    + output_tokens               * 5.00
    + cache_creation_input_tokens * 1.25
    + cache_read_input_tokens     * 0.10
  ) / 1000000.0
  ELSE 0
END;

-- =============================================================
-- Detalhes de produtos/serviços
-- A tela do Agente "Produtos/serviços" ganha descrição, observações e estoque.
-- business_prices já é a tabela de produtos da org (procedimento = nome, valor).
-- =============================================================

ALTER TABLE public.business_prices
  ADD COLUMN descricao   text NOT NULL DEFAULT '',
  ADD COLUMN observacoes text NOT NULL DEFAULT '',
  ADD COLUMN estoque     text NOT NULL DEFAULT '';

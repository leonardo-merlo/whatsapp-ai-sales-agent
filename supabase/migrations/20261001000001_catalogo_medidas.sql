-- Medidas do produto lidas da descrição por molde (parte A do fiscal, 01/10).
--
-- Só acrescenta duas colunas, nulas por padrão: nada que já existe muda, e quem
-- não tem moldes (todas as organizações menos a Distribuidora Exemplo) fica com as duas
-- nulas para sempre. Quem preenche é a importação do catálogo (CSV ou sync
-- diário), por `src/lib/catalogo/moldes.ts`; a descrição nunca é alterada.

ALTER TABLE public.catalogo_produtos
  ADD COLUMN IF NOT EXISTS molde   text,
  ADD COLUMN IF NOT EXISTS medidas jsonb;

COMMENT ON COLUMN public.catalogo_produtos.molde IS
  'Nome do molde do grupo do produto. Nulo: grupo sem medida ou organização sem moldes.';
COMMENT ON COLUMN public.catalogo_produtos.medidas IS
  'Colunas lidas da descrição, como estão escritas ({"bitola":"3/8","mm":"10.0"}). Nulo com molde preenchido: o molde não leu a descrição (lista "sem medidas" do painel).';

-- =============================================================
-- Catálogo por assunto — o produto sai do prompt e vai para o banco
-- =============================================================
-- No Wappia Atendimento a lista de produtos cabe no prompt: são dezenas, e a
-- aba Empresa manda todas elas em `## Produtos e serviços`. No Wappia Vendas
-- não cabe: a Distribuidora Exemplo tem 1055 produtos em 159 grupos. Mandar tudo custa
-- caro, estoura o contexto e o modelo erra mais quanto mais longa a lista.
--
-- A direção do Leonardo: **no prompt vai só o índice** (a lista dos grupos), a
-- IA identifica o ASSUNTO, e uma ferramenta busca no banco só os produtos
-- daquele grupo. Ela nunca vê o catálogo inteiro, e só escolhe entre linhas que
-- existem de verdade.
--
-- Três decisões que a estrutura carrega:
--
-- 1. **O catálogo é DA EMPRESA, não de cada vendedor.** Por isso a chave é
--    `organization_id`, e não `wa_number_id`: cadastra-se uma vez e serve aos
--    sete números. (Compare com `ai_agent_config`, que é por número de
--    propósito — lá o que varia é o comportamento, aqui é a tabela de preços.)
--
-- 2. **Produto que sai do CSV novo é DESATIVADO, nunca apagado.** É a lição que
--    `business_prices` ensinou na fase 7: apagar e reinserir troca os ids a cada
--    salvamento, e qualquer coisa que aponte para o produto (um item de
--    orçamento, um histórico) fica órfã em silêncio. Aqui o id de um código é
--    para sempre.
--
-- 3. **O dicionário e as regras moram junto do catálogo, não do agente.** Eles
--    dizem como LER o catálogo ("ø 12.5 é CA50 1/2", "não troque a medida que o
--    cliente pediu"), então são da empresa pelo mesmo motivo que o catálogo é.
--    Se ficassem em `ai_agent_config` cada vendedor poderia ter regras
--    diferentes para o mesmo produto — que é justamente o erro que a Distribuidora Exemplo
--    não pode ter num orçamento.
--
-- Migration ADITIVA: só cria tabelas. Nenhuma organização existente muda de
-- comportamento — sem linha em `catalogo_produtos`, o prompt continua exatamente
-- como está hoje.

-- ── grupos (o índice que vai para o prompt) ──
CREATE TABLE IF NOT EXISTS public.catalogo_grupos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  codigo           text        NOT NULL,
  nome             text        NOT NULL,
  ativo            boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_grupos IS
  'Assuntos do catálogo. É esta lista (e só ela) que entra no prompt do roteiro de vendas.';

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_grupos_org_codigo_unico
  ON public.catalogo_grupos (organization_id, codigo);

-- ── produtos (o que a ferramenta busca) ──
CREATE TABLE IF NOT EXISTS public.catalogo_produtos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  grupo_id         uuid        NOT NULL REFERENCES public.catalogo_grupos(id) ON DELETE CASCADE,
  codigo           text        NOT NULL,
  descricao        text        NOT NULL,
  unidade          text,
  preco            numeric(14,2),
  -- Todo o resto do CSV, sem esquema fixo. A Distribuidora Exemplo manda peso e preço por
  -- quilo; o próximo cliente vai mandar outra coisa. Uma coluna por cliente
  -- seria uma migration por cliente.
  dados            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ativo            boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_produtos IS
  'Produtos do catálogo da empresa. Nunca vão inteiros para o prompt: a IA pede por grupo e recebe só aquele grupo.';
COMMENT ON COLUMN public.catalogo_produtos.ativo IS
  'Produto que não veio no último CSV fica false em vez de ser apagado — o id de um código é estável para sempre.';

CREATE UNIQUE INDEX IF NOT EXISTS catalogo_produtos_org_codigo_unico
  ON public.catalogo_produtos (organization_id, codigo);
CREATE INDEX IF NOT EXISTS catalogo_produtos_grupo_idx
  ON public.catalogo_produtos (grupo_id) WHERE ativo;

-- ── como ler o catálogo ──
CREATE TABLE IF NOT EXISTS public.catalogo_config (
  organization_id  uuid        PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- "ø 12.5 é CA50 1/2", "vara = barra de 12 m": a gíria do cliente traduzida
  -- para o vocabulário do catálogo.
  dicionario       text        NOT NULL DEFAULT '',
  -- Quando perguntar em vez de chutar. A regra que vale mais que todas:
  -- a medida que o cliente pediu não se troca por outra.
  regras           text        NOT NULL DEFAULT '',
  importado_em     timestamptz,
  importado_nome   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.catalogo_config IS
  'Dicionário de gíria e regras de identificação do catálogo, por organização. Entram no prompt junto com a lista de grupos.';

-- ── updated_at ──
DROP TRIGGER IF EXISTS catalogo_grupos_updated_at ON public.catalogo_grupos;
CREATE TRIGGER catalogo_grupos_updated_at
  BEFORE UPDATE ON public.catalogo_grupos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS catalogo_produtos_updated_at ON public.catalogo_produtos;
CREATE TRIGGER catalogo_produtos_updated_at
  BEFORE UPDATE ON public.catalogo_produtos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS catalogo_config_updated_at ON public.catalogo_config;
CREATE TRIGGER catalogo_config_updated_at
  BEFORE UPDATE ON public.catalogo_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──
-- Leitura para todo membro (a tela do Agente mostra o resumo do catálogo);
-- escrita só para admin, como toda configuração da conta. O motor não passa por
-- nenhuma das duas: ele usa `service_role`, que a RLS não alcança.
ALTER TABLE public.catalogo_grupos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_produtos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_config   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can select" ON public.catalogo_grupos;
CREATE POLICY "members can select" ON public.catalogo_grupos
  FOR SELECT USING (public.is_member_of(organization_id));
DROP POLICY IF EXISTS "admins full write" ON public.catalogo_grupos;
CREATE POLICY "admins full write" ON public.catalogo_grupos
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS "members can select" ON public.catalogo_produtos;
CREATE POLICY "members can select" ON public.catalogo_produtos
  FOR SELECT USING (public.is_member_of(organization_id));
DROP POLICY IF EXISTS "admins full write" ON public.catalogo_produtos;
CREATE POLICY "admins full write" ON public.catalogo_produtos
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS "members can select" ON public.catalogo_config;
CREATE POLICY "members can select" ON public.catalogo_config
  FOR SELECT USING (public.is_member_of(organization_id));
DROP POLICY IF EXISTS "admins full write" ON public.catalogo_config;
CREATE POLICY "admins full write" ON public.catalogo_config
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

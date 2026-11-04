-- Pipeline v2 de identificação de produto (branch pipeline-v2, plano de 05/10).
--
-- Só tabelas novas, com prefixo v2_: nenhuma tabela da v1 muda. As regras
-- (famílias, gírias, padrões...) ficam em arquivos versionados no git
-- (app/src/lib/v2/dados); aqui fica o que muda a cada conversa.
--
-- RLS ligada e SEM política: só o service role (o motor, no servidor) lê e
-- grava. organization_id não tem chave estrangeira de propósito: a bancada
-- grava com uma organização de teste que não existe em organizations, para
-- nunca misturar linhas de teste com as da Distribuidora Exemplo.

CREATE TABLE IF NOT EXISTS public.v2_pedidos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  referencia       text NOT NULL,
  estado           text NOT NULL DEFAULT 'levantando'
                   CHECK (estado IN ('levantando', 'aguardando_confirmacao', 'confirmado')),
  proxima_pergunta integer NOT NULL DEFAULT 1,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_pedidos_org_ref ON public.v2_pedidos (organization_id, referencia);

CREATE TABLE IF NOT EXISTS public.v2_itens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL,
  pedido_id         uuid NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE,
  ordem             integer NOT NULL,
  linha_id          integer,
  texto_original    text NOT NULL,
  extracao          jsonb,
  conferencias      jsonb,
  resultado         jsonb,
  status            text NOT NULL
                    CHECK (status IN ('resolvido', 'pergunta', 'respondido', 'nao_vende', 'vendedor', 'fora_do_orcamento')),
  codigo_final      text,
  quantidade        text,
  pergunta          jsonb,
  respostas         jsonb NOT NULL DEFAULT '[]'::jsonb,
  versao_regras     text NOT NULL,
  versao_catalogo   text NOT NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  atualizado_em     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_itens_pedido ON public.v2_itens (pedido_id, ordem);

CREATE TABLE IF NOT EXISTS public.v2_trace (
  id               bigserial PRIMARY KEY,
  organization_id  uuid NOT NULL,
  pedido_id        uuid NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE,
  item_id          uuid,
  etapa            text NOT NULL CHECK (etapa IN ('transcricao', 'extracao', 'conferencia', 'resolucao', 'resposta')),
  entrada          jsonb,
  saida            jsonb,
  regras           text[] NOT NULL DEFAULT '{}',
  travas           jsonb,
  duracao_ms       integer,
  tokens           jsonb,
  custo_usd        numeric(14,8) NOT NULL DEFAULT 0,
  criado_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS v2_trace_pedido ON public.v2_trace (pedido_id, id);

CREATE TABLE IF NOT EXISTS public.v2_snapshots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL,
  pedido_id        uuid NOT NULL REFERENCES public.v2_pedidos(id) ON DELETE CASCADE,
  hash             text NOT NULL,
  itens            jsonb NOT NULL,
  confirmado       boolean NOT NULL DEFAULT false,
  confirmado_em    timestamptz,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pedido_id, hash)
);

-- O cache é por entrada, não por organização: a mesma mensagem com o mesmo
-- prompt devolve a mesma extração.
CREATE TABLE IF NOT EXISTS public.v2_cache_ia (
  chave            text PRIMARY KEY,
  tipo             text NOT NULL CHECK (tipo IN ('extracao', 'transcricao')),
  modelo           text NOT NULL,
  prompt_version   text NOT NULL,
  schema_version   text NOT NULL,
  entrada_resumo   text NOT NULL,
  saida            text NOT NULL,
  uso              jsonb NOT NULL,
  custo_usd        numeric(14,8) NOT NULL DEFAULT 0,
  criado_em        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.v2_pedidos   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_itens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_trace     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v2_cache_ia  ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.v2_itens IS 'Pipeline v2: estado de cada item do pedido (extração, conferências, resolução, pergunta pendente, código final).';
COMMENT ON TABLE public.v2_snapshots IS 'Pipeline v2: a lista congelada. Preço e orçamento só aceitam snapshot confirmado.';
COMMENT ON TABLE public.v2_cache_ia IS 'Pipeline v2: cache das chamadas de IA. Chave = hash(entrada + contexto + versão do prompt + versão do schema + modelo).';

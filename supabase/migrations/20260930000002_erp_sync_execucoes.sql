-- =============================================================
-- erp_sync_execucoes — o desfecho de cada sync do sistema de gestão
-- =============================================================
-- `erp_chamadas` guarda a ida e a volta HTTP, mas não o que o sync FEZ com a
-- resposta. Um 200 com a lista no formato errado, uma lista vazia recusada ou
-- uma lista parcial (o `falhas` da Distribuidora Exemplo em 30/09) só apareciam no log da
-- Vercel. Aqui fica uma linha por execução, por organização: é daqui que o
-- painel tira "último sync" e é aqui que se vê que a madrugada deu errado.
--
-- RLS de ADMIN, como `erp_chamadas`: as falhas trazem mensagens cruas do
-- sistema do cliente.
--
-- Migration ADITIVA: só cria tabela.

CREATE TABLE IF NOT EXISTS public.erp_sync_execucoes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'produtos' | 'regioes'
  tipo             text        NOT NULL,
  -- 'aplicado' | 'falhou' | 'formato_invalido' | 'recusado_por_seguranca'
  status           text        NOT NULL,
  motivo           text,
  gravados         integer     NOT NULL DEFAULT 0,
  desativados      integer     NOT NULL DEFAULT 0,
  -- Itens que vieram com problema (id sem campo, cidade sem UF...).
  problemas        text[]      NOT NULL DEFAULT '{}',
  -- O `falhas` que o sistema deles mandou. Não vazio = lista parcial.
  falhas_do_erp    text[]      NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_sync_execucoes IS
  'Uma linha por execução de sync do sistema de gestão: status, contagens e falhas que o cliente reportou.';

CREATE INDEX IF NOT EXISTS erp_sync_execucoes_recentes_idx
  ON public.erp_sync_execucoes (organization_id, tipo, created_at DESC);

ALTER TABLE public.erp_sync_execucoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins can select" ON public.erp_sync_execucoes;
CREATE POLICY "admins can select" ON public.erp_sync_execucoes
  FOR SELECT USING (public.is_admin_of(organization_id));

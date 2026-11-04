-- =============================================================
-- Histórico do agente (item 9 do backlog, caminho B + D, 29/09)
-- =============================================================
-- Salvar continua pondo no ar na hora. O que muda: cada salvamento da tela
-- Conhecimento guarda uma cópia do que foi salvo, e a tela lista as cópias com
-- um botão para carregar uma delas de volta. Carregar não grava nada: preenche
-- a tela, e só o Salvar seguinte põe no ar (e vira uma cópia nova).
--
-- `conteudo` é o mesmo formato que a tela envia ao salvar
-- (`AgenteConfigPayload` sem `ativo`), para voltar a ele sem tradução.
-- `autor` é o nome de quem salvou, gravado como texto: o membro pode sair da
-- empresa e o histórico continua dizendo quem foi.
--
-- Migration ADITIVA: tabela nova, nada existente muda.

CREATE TABLE IF NOT EXISTS public.agente_versoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conteudo        jsonb NOT NULL,
  autor           text NOT NULL DEFAULT '',
  criada_por      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.agente_versoes IS
  'Uma copia por salvamento da tela Conhecimento. Imutavel: voltar para uma copia carrega na tela e o proximo salvamento cria outra.';

CREATE INDEX IF NOT EXISTS agente_versoes_recentes_idx ON public.agente_versoes (organization_id, created_at DESC);

ALTER TABLE public.agente_versoes ENABLE ROW LEVEL SECURITY;

-- Mesmo critério de quem salva a tela: owner e admin.
DROP POLICY IF EXISTS "admins can select" ON public.agente_versoes;
CREATE POLICY "admins can select" ON public.agente_versoes
  FOR SELECT USING (public.is_admin_of(organization_id));

DROP POLICY IF EXISTS "admins can insert" ON public.agente_versoes;
CREATE POLICY "admins can insert" ON public.agente_versoes
  FOR INSERT WITH CHECK (public.is_admin_of(organization_id));

-- Sem UPDATE nem DELETE: a cópia não muda depois de gravada.

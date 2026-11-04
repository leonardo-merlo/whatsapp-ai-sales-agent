-- =============================================================
-- Catálogo de templates da Meta, por WABA
-- =============================================================
-- Template é ativo da WABA, não do app: cada cliente precisa da própria
-- cópia, aprovada na conta dele. Até aqui os templates eram criados à mão no
-- painel da Meta e o código só conhecia um mapa fixo em
-- lib/whatsapp/templates.ts. Isso não escala e não deixa o cliente ter
-- templates próprios, que nunca caberiam num arquivo .ts.
--
-- Esta tabela passa a ser o CATÁLOGO: os padrões que a Wappia cria na conexão
-- e os que o cliente cria pelo painel convivem aqui. O envio consulta a linha
-- antes de chamar a Meta e só manda o que está APPROVED.
--
-- O nome não é `message_templates` porque essa tabela já existe e guarda
-- textos locais de campanha, sem relação nenhuma com a Meta.
--
-- `status` e `categoria` ficam em texto com o valor cru da Meta (APPROVED,
-- UTILITY...). Enum aqui quebraria o webhook no dia em que a Meta inventar um
-- status novo, e ela inventa.
--
-- Migration ADITIVA.

CREATE TABLE IF NOT EXISTS public.wa_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  waba_id text NOT NULL,
  nome text NOT NULL,
  idioma text NOT NULL DEFAULT 'pt_BR',
  categoria text NOT NULL,
  corpo text NOT NULL,
  -- [{ "nome": "cliente", "exemplo": "Ana" }, ...] na ordem de {{1}}, {{2}}...
  -- A Meta recusa template posicional sem exemplo de cada variável.
  variaveis jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta_template_id text,
  status text NOT NULL DEFAULT 'PENDING',
  motivo_rejeicao text,
  origem text NOT NULL DEFAULT 'cliente' CHECK (origem IN ('wappia', 'cliente')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Índice inteiro, não parcial: é o alvo do upsert da sincronização, e o
  -- PostgREST não consegue usar índice parcial em ON CONFLICT (42P10).
  CONSTRAINT wa_templates_unico UNIQUE (organization_id, waba_id, nome, idioma)
);

-- O webhook de status só traz o id da Meta.
CREATE INDEX IF NOT EXISTS wa_templates_meta_template_id_idx ON public.wa_templates (meta_template_id);

ALTER TABLE public.wa_templates ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer membro (a tela de campanha escolhe daqui). Escrita não
-- tem política: criar template exige o token do cliente, que mora no Vault, e
-- por isso passa sempre por rota do servidor com service_role.
DROP POLICY IF EXISTS wa_templates_select ON public.wa_templates;
CREATE POLICY wa_templates_select ON public.wa_templates
  FOR SELECT USING (public.is_member_of(organization_id));

-- Avisos no sino. Não usados nesta migration: ADD VALUE não pode ser
-- referenciado na mesma transação em que foi criado.
ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'template_nao_aprovado';
ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'template_recategorizado';

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS wa_template_id uuid REFERENCES public.wa_templates(id) ON DELETE CASCADE;

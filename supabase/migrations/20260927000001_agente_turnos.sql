-- =============================================================
-- agente_turnos + orcamentos_em_andamento (sombra)
-- =============================================================
-- Spec: docs/superpowers/specs/2026-09-27-rastreio-por-turno-e-sombra-design.md
--
-- **Uma ficha por EXECUÇÃO do motor.** Não por mensagem: quando a varredura
-- refaz um turno, são duas linhas, e é isso que mostra a execução que morreu no
-- meio (o 4º defeito de 21/09). Uma linha que fica em `em_andamento` é uma
-- execução que não terminou.
--
-- **A máquina de estados em sombra.** `orcamentos_em_andamento` é a tabela do
-- spec da máquina (2026-09-21), com `modo`. Nesta fase só existe `sombra`: o
-- motor NUNCA lê esta tabela. Na fase 2, `modo = 'valendo'` sem outra migration.
--
-- **Leitura de ADMIN, escrita nenhuma por sessão de usuário.** O prompt leva
-- CPF, CNPJ e endereço, como `erp_chamadas`. Quem grava é o motor, com
-- service_role.
--
-- Migration ADITIVA: cria duas tabelas, uma view, duas colunas NULAS e um job
-- de limpeza. Nada existente muda de forma.

-- ── agente_turnos ──
CREATE TABLE IF NOT EXISTS public.agente_turnos (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Nulo no simulador, que não tem conversa.
  conversation_id     uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  wa_number_id        uuid        REFERENCES public.wa_numbers(id)    ON DELETE SET NULL,
  -- A última mensagem do cliente que esta execução responde.
  mensagem_id         uuid        REFERENCES public.messages(id)      ON DELETE SET NULL,

  origem              text        NOT NULL CHECK (origem IN ('webhook', 'fila', 'varredura', 'simulador')),
  roteiro             text,
  modelo              text,
  status              text        NOT NULL DEFAULT 'em_andamento'
                      CHECK (status IN ('em_andamento', 'respondeu', 'silencio', 'transferiu', 'descartado', 'erro')),

  -- Marcas do que o código fez fora do caminho feliz (resgate_500,
  -- repetiu_texto_picado, max_tokens...). Texto e não enum: marca nova entra
  -- sem migration.
  caminho             text[]      NOT NULL DEFAULT '{}',
  estado_antes        jsonb,
  estado_depois       jsonb,
  -- Na ordem executada: nome, entrada, ok, duração e os ids em erp_chamadas.
  ferramentas         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  resposta            text,
  erro                text,

  -- O que foi ao Claude na primeira volta. Expira em 30 dias (job abaixo).
  prompt_system       text,
  prompt_mensagens    jsonb,
  prompt_hash         text,

  sombra_etapa_antes  text,
  sombra_etapa_depois text,
  divergencias        text[]      NOT NULL DEFAULT '{}',

  duracao_ms          integer,
  created_at          timestamptz NOT NULL DEFAULT now(),
  terminou_em         timestamptz
);

COMMENT ON TABLE public.agente_turnos IS
  'Uma linha por execucao do motor: o que entrou, o caminho do codigo, as ferramentas e o que saiu. em_andamento parado = execucao que morreu.';
COMMENT ON COLUMN public.agente_turnos.prompt_system IS
  'System enviado na primeira volta. Zerado depois de 30 dias pelo job expirar-prompt-dos-turnos.';

CREATE INDEX IF NOT EXISTS agente_turnos_recentes_idx ON public.agente_turnos (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS agente_turnos_conversa_idx ON public.agente_turnos (conversation_id);
CREATE INDEX IF NOT EXISTS agente_turnos_mensagem_idx ON public.agente_turnos (mensagem_id);
CREATE INDEX IF NOT EXISTS agente_turnos_divergencias_idx ON public.agente_turnos (organization_id, created_at DESC)
  WHERE divergencias <> '{}';

ALTER TABLE public.agente_turnos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins can select" ON public.agente_turnos;
CREATE POLICY "admins can select" ON public.agente_turnos
  FOR SELECT USING (public.is_admin_of(organization_id));

-- ── orcamentos_em_andamento ──
CREATE TABLE IF NOT EXISTS public.orcamentos_em_andamento (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id      uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id           uuid        REFERENCES public.contacts(id)   ON DELETE SET NULL,
  wa_number_id         uuid        REFERENCES public.wa_numbers(id) ON DELETE SET NULL,

  modo                 text        NOT NULL DEFAULT 'sombra' CHECK (modo IN ('sombra', 'valendo')),
  etapa                text        NOT NULL CHECK (etapa IN (
                         'aguardando_documento', 'consultando_cadastro', 'coletando_cadastro', 'criando_cadastro',
                         'confirmando_regiao', 'levantando_itens', 'definindo_pagamento', 'criando_orcamento',
                         'orcamento_criado', 'criando_pedido', 'aguardando_vendedor',
                         'pedido_criado', 'expirado', 'substituido', 'encerrado', 'cadastro_concluido')),
  etapa_desde_mensagem uuid        REFERENCES public.messages(id) ON DELETE SET NULL,
  -- Sobe a cada transição. É a trava de concorrência (update ... where versao = N).
  versao               integer     NOT NULL DEFAULT 1,
  pergunta_pendente    text,
  retorno_para         jsonb,
  motivo_pausa         text,
  dados                jsonb       NOT NULL DEFAULT '{}'::jsonb,
  erp_orcamento_id     uuid        REFERENCES public.erp_orcamentos(id) ON DELETE SET NULL,
  substitui_id         uuid        REFERENCES public.orcamentos_em_andamento(id) ON DELETE SET NULL,
  expira_em            timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.orcamentos_em_andamento IS
  'O orcamento enquanto esta sendo montado (maquina de estados). modo=sombra: so observa, o motor nao le.';

-- Um ativo por conversa e por modo. Índice PARCIAL: o código lê e então insere
-- ou atualiza por id — upsert pelo PostgREST não enxerga índice parcial (42P10).
CREATE UNIQUE INDEX IF NOT EXISTS orcamentos_em_andamento_um_ativo_idx
  ON public.orcamentos_em_andamento (conversation_id, modo)
  WHERE etapa NOT IN ('pedido_criado', 'expirado', 'substituido', 'encerrado', 'cadastro_concluido');
CREATE INDEX IF NOT EXISTS orcamentos_em_andamento_org_idx
  ON public.orcamentos_em_andamento (organization_id, updated_at DESC);

ALTER TABLE public.orcamentos_em_andamento ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins can select" ON public.orcamentos_em_andamento;
CREATE POLICY "admins can select" ON public.orcamentos_em_andamento
  FOR SELECT USING (public.is_admin_of(organization_id));

-- ── a chave que liga as três ──
ALTER TABLE public.ai_usage     ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES public.agente_turnos(id) ON DELETE SET NULL;
ALTER TABLE public.erp_chamadas ADD COLUMN IF NOT EXISTS turno_id uuid REFERENCES public.agente_turnos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ai_usage_turno_idx     ON public.ai_usage (turno_id)     WHERE turno_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS erp_chamadas_turno_idx ON public.erp_chamadas (turno_id) WHERE turno_id IS NOT NULL;

-- ── como ler ──
-- security_invoker: a view respeita a RLS de quem lê (admin da organização).
CREATE OR REPLACE VIEW public.agente_turnos_resumo
WITH (security_invoker = true) AS
SELECT
  t.id,
  t.organization_id,
  t.created_at,
  t.conversation_id,
  t.origem,
  t.roteiro,
  t.status,
  t.caminho,
  t.divergencias,
  t.sombra_etapa_antes,
  t.sombra_etapa_depois,
  t.duracao_ms,
  (SELECT count(*) FROM public.ai_usage u WHERE u.turno_id = t.id)                    AS chamadas_ia,
  (SELECT coalesce(sum(u.custo_usd), 0) FROM public.ai_usage u WHERE u.turno_id = t.id) AS custo_usd,
  (SELECT count(*) FROM public.erp_chamadas e WHERE e.turno_id = t.id)                AS chamadas_erp
FROM public.agente_turnos t;

-- ── o prompt expira em 30 dias ──
-- SQL puro, sem pg_net: roda dentro do banco. Para desligar:
-- select cron.unschedule('expirar-prompt-dos-turnos');
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('expirar-prompt-dos-turnos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expirar-prompt-dos-turnos');

SELECT cron.schedule(
  'expirar-prompt-dos-turnos',
  '17 4 * * *',
  $$
    UPDATE public.agente_turnos
       SET prompt_system = NULL, prompt_mensagens = NULL
     WHERE created_at < now() - interval '30 days'
       AND (prompt_system IS NOT NULL OR prompt_mensagens IS NOT NULL);
  $$
);

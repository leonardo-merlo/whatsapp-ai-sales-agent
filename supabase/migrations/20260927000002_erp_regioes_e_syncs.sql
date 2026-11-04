-- =============================================================
-- erp_regioes + agendamento dos syncs do sistema de gestão
-- =============================================================
-- Spec: docs/superpowers/specs/2026-09-27-syncs-exemplo-design.md
--
-- **O sync mensal de regiões (contrato v4, proposta a confirmar).** Cada região
-- com as cidades e os grupos de produto entregues ali. Se a regra da Distribuidora Exemplo
-- for por produto, `produto_ids` já existe e `grupos` fica nulo. Região que
-- sumiu da lista é desativada, nunca apagada.
--
-- **Nesta entrega a região só é gravada**: o motor ainda não a lê.
--
-- **Os dois jobs chamam a rota /api/cron/sincronizar-erp**, que está atrás de
-- uma chave DESLIGADA no código (`SYNCS_DO_ERP_LIGADOS`): desligada, ela responde
-- 200 sem ler nada nem chamar ninguém. Mesmo padrão de 20260910000002: pg_cron +
-- pg_net, Bearer do Vault, URL com www (o apex responde 308 e o pg_net não
-- segue redirect). Nunca cron não diário no vercel.json: o plano Hobby rejeita o
-- deploy em silêncio.
--
-- Migration ADITIVA: uma tabela nova e dois jobs.

CREATE TABLE IF NOT EXISTS public.erp_regioes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- O id da região no sistema do cliente ("SP-SE").
  regiao_id        text        NOT NULL,
  nome             text        NOT NULL,
  -- [{ "cidade": "Jundiaí", "uf": "MG" }, ...]
  cidades          jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Os grupos do sync diário entregues aqui (proposta da v4)...
  grupos           text[],
  -- ...ou os produtos, se a regra deles for por produto.
  produto_ids      text[],
  ativo            boolean     NOT NULL DEFAULT true,
  sincronizado_em  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT erp_regioes_uma_por_id UNIQUE (organization_id, regiao_id)
);

COMMENT ON TABLE public.erp_regioes IS
  'Regioes de entrega do sistema de gestao (sync mensal, contrato v4). Ausente da lista = ativo false.';

CREATE INDEX IF NOT EXISTS erp_regioes_ativas_idx ON public.erp_regioes (organization_id) WHERE ativo;

ALTER TABLE public.erp_regioes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members can select" ON public.erp_regioes;
CREATE POLICY "members can select" ON public.erp_regioes
  FOR SELECT USING (public.is_member_of(organization_id));

-- ── agendamento ──
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.unschedule('sincronizar-produtos-do-erp')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sincronizar-produtos-do-erp');
SELECT cron.unschedule('sincronizar-regioes-do-erp')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sincronizar-regioes-do-erp');

-- Todo dia às 06:10 UTC (03:10 em Brasília), fora do horário de atendimento.
SELECT cron.schedule(
  'sincronizar-produtos-do-erp',
  '10 6 * * *',
  $$
    SELECT net.http_get(
      url := 'https://www.wappia.com.br/api/cron/sincronizar-erp?tipo=produtos',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);

-- Dia 1 de cada mês às 06:20 UTC.
SELECT cron.schedule(
  'sincronizar-regioes-do-erp',
  '20 6 1 * *',
  $$
    SELECT net.http_get(
      url := 'https://www.wappia.com.br/api/cron/sincronizar-erp?tipo=regioes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);

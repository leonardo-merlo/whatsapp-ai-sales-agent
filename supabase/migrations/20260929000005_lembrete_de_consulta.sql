-- =============================================================
-- Lembrete antes da consulta, com confirmação sim/não (S5, Bloco B)
-- =============================================================
-- A varredura (/api/cron/lembretes, a cada 15 min pelo pg_cron) manda o
-- template `lembrete_agendamento` X horas antes da consulta. O "sim" ou "não"
-- do paciente é lido pelo motor no formato estruturado, só quando existe
-- lembrete pendente para aquele contato; sem regex.
--
-- Controle por consulta (appointments):
--   lembrete_enviado_em   quando o lembrete saiu; nulo = ainda não saiu.
--   lembrete_tentativas   quantas vezes a varredura tentou e não conseguiu
--                         (sem template aprovado, por exemplo). Para em 3.
--   confirmado_em         quando o paciente respondeu "sim".
--   lembrete_resposta     'sim' ou 'nao'; nulo = lembrete sem resposta.
--
-- Configuração por empresa (organizations):
--   lembrete_ativo        desligado por padrão: sem template aprovado nada sai,
--                         e ligar para todo mundo só acenderia o sino.
--   lembrete_horas_antes  padrão 24, entre 1 e 72.
--
-- Nunca cron não diário no vercel.json: a conta Hobby rejeita o deploy. O
-- agendamento é do pg_cron, no mesmo padrão de 20260910000002 (Bearer do
-- Vault, URL com www).
--
-- Migration ADITIVA: colunas com default ou nulas, um índice parcial e um job.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em timestamptz,
  ADD COLUMN IF NOT EXISTS lembrete_tentativas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmado_em timestamptz,
  ADD COLUMN IF NOT EXISTS lembrete_resposta text;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_lembrete_resposta_valida;
ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_lembrete_resposta_valida
  CHECK (lembrete_resposta IS NULL OR lembrete_resposta IN ('sim', 'nao'));

CREATE INDEX IF NOT EXISTS appointments_lembrete_a_enviar
  ON public.appointments (organization_id, data)
  WHERE lembrete_enviado_em IS NULL AND status = 'agendado';

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS lembrete_ativo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lembrete_horas_antes integer NOT NULL DEFAULT 24;

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_lembrete_horas_validas;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_lembrete_horas_validas
  CHECK (lembrete_horas_antes BETWEEN 1 AND 72);

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('lembrete-de-consulta')
where exists (select 1 from cron.job where jobname = 'lembrete-de-consulta');

select cron.schedule(
  'lembrete-de-consulta',
  '*/15 * * * *',
  $$
    select net.http_get(
      url := 'https://www.wappia.com.br/api/cron/lembretes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);

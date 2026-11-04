-- Agendamento do resumo de conversas paradas.
--
-- Sai do Vercel Cron para o pg_cron do Supabase: o plano Hobby da Vercel so
-- aceita cron diario, e um "0 * * * *" no vercel.json fazia a Vercel REJEITAR o
-- deploy inteiro (sem criar registro nenhum no painel). No pg_cron roda de hora
-- em hora, sem custo.
--
-- A URL usa www de proposito: o apex responde 308 e o pg_net nao segue redirect.
--
-- PRE-REQUISITO (rodar UMA vez, trocando pelo valor real de CRON_SECRET do
-- .env.local -- nunca comitar o valor):
--   select vault.create_secret('SEU_CRON_SECRET', 'cron_secret', 'Bearer da rota /api/cron/*');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotente: remove o agendamento anterior antes de recriar.
select cron.unschedule('resumir-conversas-paradas')
where exists (select 1 from cron.job where jobname = 'resumir-conversas-paradas');

select cron.schedule(
  'resumir-conversas-paradas',
  '0 * * * *',
  $$
    select net.http_get(
      url := 'https://www.wappia.com.br/api/cron/resumir-paradas',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);

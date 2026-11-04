-- Agendamento da varredura de mensagem sem resposta (rota /api/cron/responder-pendentes).
--
-- A cada 2 minutos. A rota tem teto de 60 s, entao duas rodadas nunca se
-- sobrepoem -- e sobreposicao responderia a mesma conversa duas vezes.
--
-- Mesmo padrao de 20260727000005: pg_cron + pg_net, Bearer lido do Vault (o
-- segredo 'cron_secret' ja existe), URL com www porque o apex responde 308 e o
-- pg_net nao segue redirect.
--
-- Nao altera schema. Para desligar: select cron.unschedule('responder-mensagens-pendentes');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('responder-mensagens-pendentes')
where exists (select 1 from cron.job where jobname = 'responder-mensagens-pendentes');

select cron.schedule(
  'responder-mensagens-pendentes',
  '*/2 * * * *',
  $$
    select net.http_get(
      url := 'https://www.wappia.com.br/api/cron/responder-pendentes',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      ),
      timeout_milliseconds := 60000
    );
  $$
);

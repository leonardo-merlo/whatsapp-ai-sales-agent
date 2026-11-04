-- BSUID: o identificador do cliente por portfolio, que a Meta passou a mandar
-- com os nomes de usuario do WhatsApp.
-- https://developers.facebook.com/documentation/business-messaging/whatsapp/business-scoped-user-ids
--
-- Quando o cliente ativa nome de usuario e nao falou com aquele numero da
-- empresa nos ultimos 30 dias, o webhook chega SEM telefone, so com o BSUID.
-- Hoje essa mensagem e descartada sem aviso: o contato e procurado pelo
-- telefone, e contacts.telefone nao aceita nulo.
--
-- Duas colunas novas e uma restricao afrouxada. Afrouxar o NOT NULL de
-- telefone nao apaga nada e nao muda nenhum contato existente (todos os 23 tem
-- telefone, conferido em 2026-09-10); so passa a permitir o contato que so
-- tem BSUID. O cadastro manual na tela continua exigindo telefone.
--
-- Sem indice UNICO no BSUID, igual ao telefone (que tambem nao tem): um insert
-- recusado aqui seria a mensagem do cliente sumindo, que e o que esta migration
-- existe para evitar. O indice e so para a busca do webhook.

alter table public.contacts add column if not exists wa_user_id text;
alter table public.contacts add column if not exists wa_username text;
alter table public.contacts alter column telefone drop not null;

create index if not exists contacts_org_wa_user_id_idx
  on public.contacts (organization_id, wa_user_id)
  where wa_user_id is not null;

comment on column public.contacts.wa_user_id is
  'BSUID da Meta (ex.: BR.1234...). Escopo: o portfolio de negocios dono do numero. Atualizado quando muda.';
comment on column public.contacts.wa_username is
  'Nome de usuario do WhatsApp, quando o cliente ativou. So para exibir.';

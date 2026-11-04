-- Separa razão social de nome fantasia.
--
-- Até aqui organizations.nome era uma coluna só, editada tanto na aba Empresa
-- (onde o sentido é "como o cliente conhece o negócio") quanto em Configurações
-- → Dados do negócio (onde o sentido é o nome jurídico usado na cobrança do
-- Asaas e nas faturas). Os dois sentidos passam a ter coluna própria:
--   organizations.nome           → razão social
--   organizations.nome_fantasia  → nome que a IA e o cliente veem

alter table public.organizations
  add column if not exists nome_fantasia text not null default '';

-- Backfill: quem já existe passa a ter o mesmo valor nos dois campos. Nenhuma
-- org fica sem nome de exibição, e quem quiser separar edita depois.
update public.organizations
  set nome_fantasia = nome
  where nome_fantasia = '';

comment on column public.organizations.nome is 'Razão social — nome jurídico, usado na cobrança e nas faturas.';
comment on column public.organizations.nome_fantasia is 'Nome fantasia — como o cliente conhece o negócio; é o que a IA usa.';

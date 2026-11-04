-- Adiciona o WhatsApp Business Account ID (WABA) por organização.
-- Populado pelo fluxo de Embedded Signup quando o cliente conecta o WhatsApp dele;
-- fica ao lado de wa_phone_number_id (número) e wa_number (telefone exibido).
alter table public.organizations add column if not exists waba_id text;

comment on column public.organizations.waba_id is
  'WhatsApp Business Account ID do cliente, obtido no Embedded Signup (Tech Provider).';

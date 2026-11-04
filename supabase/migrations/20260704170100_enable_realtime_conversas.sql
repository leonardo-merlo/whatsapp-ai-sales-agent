-- Habilita Supabase Realtime (postgres_changes) para as tabelas usadas na
-- tela Conversas. RLS já existente continua sendo a única autorização —
-- Realtime só entrega ao client linhas que a policy de SELECT já permitiria.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversations;

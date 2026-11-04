-- Fixa search_path na trigger function (evita search_path mutável)
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- Revoga execução direta das funções SECURITY DEFINER de RLS via RPC
REVOKE EXECUTE ON FUNCTION public.is_member_of(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_admin_of(uuid) FROM anon, authenticated;

-- Correção: policies de RLS avaliam is_member_of/is_admin_of com as
-- permissões do usuário consultante — authenticated PRECISA de EXECUTE.
-- (A revogação total em 20260630000002/3 quebrava todo SELECT de membros.)
-- anon continua sem acesso (não há fluxo anônimo).
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_of(uuid) TO authenticated;

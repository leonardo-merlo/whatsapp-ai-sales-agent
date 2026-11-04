-- Faturamento é visão de dono.
--
-- A RLS já bloqueava a escrita de subscriptions/invoices por is_admin_of, mas a
-- LEITURA estava em is_member_of — ou seja, um atendente convidado enxergava o
-- plano contratado e o histórico de faturas da empresa. Mesmo critério que já
-- vale para sales/sale_items/notificacoes desde 20260729000002.

drop policy if exists "members can select" on public.subscriptions;
create policy "admins can select" on public.subscriptions
  for select using (public.is_admin_of(organization_id));

drop policy if exists "members can select" on public.invoices;
create policy "admins can select" on public.invoices
  for select using (public.is_admin_of(organization_id));

-- ai_usage é custo de operação: mesma natureza. O INSERT continua is_member_of
-- de propósito — quem grava é a sessão do próprio usuário durante a conversa,
-- e um atendente que assume uma conversa precisa conseguir registrar o uso.
drop policy if exists "members can select" on public.ai_usage;
create policy "admins can select" on public.ai_usage
  for select using (public.is_admin_of(organization_id));

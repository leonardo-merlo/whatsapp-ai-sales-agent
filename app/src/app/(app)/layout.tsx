import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { fetchInitialData } from '@/lib/data/queries';
import { membroAtivo } from '@/lib/data/org-ativa';
import AppChrome from '@/components/app-chrome';
import { secoesOcultasDoProduto } from '@/lib/produtos';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Um usuário pode estar em mais de uma organização. A ativa vem do cookie,
  // validada contra os vínculos que o banco confirma — ver lib/data/org-ativa.ts.
  const member = await membroAtivo(supabase, user.id);

  if (!member) redirect('/setup');

  const initial = await fetchInitialData(supabase, member.organizationId);

  return (
    <AppChrome
      org={{
        orgId: member.organizationId,
        orgName: member.orgNome,
        segmento: member.orgSegmento,
        memberId: member.memberId,
        memberName: member.nome,
        memberRole: member.role,
        userEmail: user.email ?? '',
        organizacoes: member.vinculos.map(v => ({ id: v.organizationId, nome: v.orgNome })),
        // O produto ativo soma as seções dele às que a empresa já esconde.
        secoesOcultas: secoesOcultasDoProduto(member.produtoAtivo, member.secoesOcultas),
        produtos: member.produtos,
        produtoAtivo: member.produtoAtivo,
      }}
      initial={initial}
    >
      {children}
    </AppChrome>
  );
}

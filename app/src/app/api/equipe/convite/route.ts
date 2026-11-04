// Manda o e-mail de convite de um membro já criado (S4).
//
// O convite nasce pelo client (`adicionarMembro`, sob a RLS de admin); esta
// rota só envia o e-mail. Confere no banco que o membro é da organização
// ativa, que ainda não tem login e que quem pede é admin.

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { enviarEmailDeConvite } from '@/lib/email/convite';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const ativa = await orgDaRequisicao(supabase, user.id);
  if (!ativa) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (ativa.role !== 'owner' && ativa.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador convida.' }, { status: 403 });
  }

  let corpo: { memberId?: string };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { data: membro } = await supabase
    .from('organization_members')
    .select('nome, invite_email, user_id')
    .eq('id', corpo.memberId ?? '')
    .eq('organization_id', ativa.organizationId)
    .maybeSingle();
  if (!membro?.invite_email || membro.user_id) {
    return Response.json({ error: 'Convite não encontrado.' }, { status: 404 });
  }

  const { data: org } = await supabase
    .from('organizations').select('nome, nome_fantasia').eq('id', ativa.organizationId).maybeSingle();

  const enviado = await enviarEmailDeConvite({
    para: membro.invite_email,
    nomeDoConvidado: membro.nome,
    nomeDaEmpresa: org?.nome_fantasia || org?.nome || 'sua empresa',
    appUrl: process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin,
  });
  return Response.json({ ok: true, enviado });
}

// Encerra uma conversa e, em seguida, gera um resumo do atendimento para a ficha
// do contato (memória entre conversas). O resumo chama a IA, por isso precisa ser
// uma rota de servidor. Se o resumo falhar, o encerramento continua valendo.
// Autenticado pela sessão do usuário (client Supabase normal, com RLS).

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { resumirConversa } from '@/lib/agente/resumir-conversa';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });

  let body: { conversationId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!body.conversationId) return Response.json({ error: 'Conversa não informada' }, { status: 400 });

  const { data: conversa } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', body.conversationId)
    .eq('organization_id', member.organizationId)
    .maybeSingle();
  if (!conversa) return Response.json({ error: 'Conversa não encontrada' }, { status: 404 });

  const { error } = await supabase.from('conversations').update({ status: 'encerrada' }).eq('id', conversa.id);
  if (error) return Response.json({ error: 'Não foi possível encerrar a conversa' }, { status: 500 });

  await supabase.from('messages').insert({
    organization_id: member.organizationId,
    conversation_id: conversa.id,
    autor: 'sys',
    texto: 'Conversa encerrada pela equipe',
    read: true,
  });

  try {
    await resumirConversa(supabase, member.organizationId, conversa.id);
  } catch (err) {
    console.error('Falha ao resumir conversa encerrada:', err instanceof Error ? err.message : err);
  }

  return Response.json({ ok: true });
}

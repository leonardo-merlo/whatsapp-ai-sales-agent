// Esconder (ou voltar a mostrar) um template no Wappia. Não mexe na Meta: lá
// ele continua aprovado. Rota porque `wa_templates` não tem escrita pela RLS.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode esconder templates.' }, { status: 403 });
  }

  let corpo: { id?: string; oculto?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!corpo.id || typeof corpo.oculto !== 'boolean') return Response.json({ error: 'Dados incompletos.' }, { status: 400 });

  const { data, error } = await createServiceClient()
    .from('wa_templates')
    .update({ oculto: corpo.oculto, updated_at: new Date().toISOString() })
    .eq('id', corpo.id)
    .eq('organization_id', membro.organizationId)
    .select('id')
    .maybeSingle();
  if (error || !data) return Response.json({ error: 'Template não encontrado.' }, { status: 404 });

  // Voltou a aparecer: o aviso de "não pode ser enviado" deixa de valer.
  if (!corpo.oculto) {
    await createServiceClient().from('notificacoes')
      .update({ status: 'resolvida', resolvida_em: new Date().toISOString() })
      .eq('wa_template_id', corpo.id)
      .eq('tipo', 'template_nao_aprovado')
      .eq('status', 'pendente');
  }
  return Response.json({ ok: true });
}

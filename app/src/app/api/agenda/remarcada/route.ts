// Depois de arrastar uma consulta na agenda (S6).
//
// A consulta já foi salva pela tela, sob a RLS. Aqui: (1) o lembrete volta a
// valer para o horário novo, e (2) se a pessoa deixou "avisar o cliente"
// marcado, sai o template `aviso_remarcacao` pelo mesmo caminho do lembrete.
// A autorização é conferida com o client do usuário; o envio usa o service
// role porque atendente também remarca, e o sino é tabela de admin.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { enviarAvisoDaConsulta } from '@/lib/agenda/lembrete';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const ativa = await orgDaRequisicao(supabase, user.id);
  if (!ativa) return Response.json({ error: 'Sem organização' }, { status: 403 });

  let corpo: { appointmentId?: string; avisar?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  // Lida pelo client do usuário: se a RLS não deixa ver, não existe.
  const { data: consulta } = await supabase
    .from('appointments')
    .select('id, organization_id, contact_id, paciente_nome, servico, data, hora, lembrete_tentativas')
    .eq('id', corpo.appointmentId ?? '')
    .eq('organization_id', ativa.organizationId)
    .maybeSingle();
  if (!consulta) return Response.json({ error: 'Consulta não encontrada.' }, { status: 404 });

  const service = createServiceClient();
  await service.from('appointments').update({
    lembrete_enviado_em: null, lembrete_tentativas: 0, lembrete_resposta: null, confirmado_em: null,
  }).eq('id', consulta.id);
  // Confirmada para o horário antigo não vale para o novo.
  await service.from('appointments').update({ status: 'agendado' }).eq('id', consulta.id).eq('status', 'confirmado');

  if (!corpo.avisar) return Response.json({ ok: true, avisado: false });
  const envio = await enviarAvisoDaConsulta(service, consulta, 'aviso_remarcacao');
  return Response.json({ ok: true, avisado: envio.enviado, motivo: envio.enviado ? undefined : envio.motivo });
}

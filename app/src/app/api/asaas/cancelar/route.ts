// Cancela a renovação da assinatura ativa da org. O acesso continua até o fim
// do período já pago (periodo_fim) — só desliga a renovação automática. No
// cartão, cancela também a assinatura recorrente no Asaas; no Pix avulso não há
// o que cancelar (a cobrança seguinte simplesmente não é gerada).

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { cancelarAssinaturaAsaas } from '@/lib/asaas/client';

export const runtime = 'nodejs';

export async function POST() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });
  if (member.role !== 'owner' && member.role !== 'admin') {
    return Response.json({ error: 'Apenas o dono ou administradores podem cancelar a assinatura' }, { status: 403 });
  }

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('id, asaas_subscription_id')
    .eq('organization_id', member.organizationId)
    .eq('status', 'ativa')
    .maybeSingle();
  if (!subscription) return Response.json({ error: 'Nenhuma assinatura ativa encontrada' }, { status: 400 });

  try {
    if (subscription.asaas_subscription_id) {
      await cancelarAssinaturaAsaas(subscription.asaas_subscription_id);
    }
    const { error } = await supabase
      .from('subscriptions')
      .update({ renova_automatico: false })
      .eq('id', subscription.id);
    if (error) throw error;
  } catch (err) {
    console.error('Erro ao cancelar assinatura Asaas:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Não foi possível cancelar a assinatura — tente novamente.' }, { status: 502 });
  }

  return Response.json({ ok: true });
}

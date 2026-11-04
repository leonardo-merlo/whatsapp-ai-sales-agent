// Polling de status de uma fatura — usado pelo modal de pagamento pra saber
// quando o Pix caiu, sem depender do webhook ter alcançado o client.

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';

export const runtime = 'nodejs';

export async function GET(request: Request, { params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });

  const { data: invoice } = await supabase
    .from('invoices')
    .select('status')
    .eq('id', invoiceId)
    .eq('organization_id', member.organizationId)
    .maybeSingle();
  if (!invoice) return Response.json({ error: 'Fatura não encontrada' }, { status: 404 });

  return Response.json({ status: invoice.status });
}

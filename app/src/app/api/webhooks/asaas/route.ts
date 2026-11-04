// Webhook do Asaas — recebe confirmação/vencimento de cobrança.
// Autenticado por um token estático (asaas-access-token), comparado em
// tempo constante — mais simples que o HMAC do webhook do WhatsApp porque
// o Asaas não assina o corpo, só reenvia um token fixo configurado no painel.
// Sem sessão de usuário: usa o client service_role (mesma justificativa do
// webhook do WhatsApp).

import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { cancelarAssinaturaAsaas } from '@/lib/asaas/client';
import { somaIntervalo, type Intervalo } from '@/lib/asaas/periodo';

export const runtime = 'nodejs';

type ServiceClient = ReturnType<typeof createServiceClient>;

function isValidToken(received: string | null, expected: string): boolean {
  if (!received) return false;
  const receivedBuf = Buffer.from(received, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

// Calcula até quando o plano fica válido. Estende a partir do fim atual quando
// ele ainda é futuro (renovação encadeia o período); senão, a partir de hoje.
function calcularPeriodoFim(intervalo: string | null, periodoFimAtual: string | null): string {
  const iv: Intervalo = intervalo === 'anual' ? 'anual' : 'mensal';
  const hoje = new Date().toISOString().slice(0, 10);
  const base = periodoFimAtual && periodoFimAtual > hoje ? periodoFimAtual : hoje;
  return somaIntervalo(base, iv);
}

// Primeiro pagamento (a fatura já existe): ativa e mantém a validade definida na
// criação; só preenche periodo_fim se estiver vazio.
async function ativarAssinatura(supabase: ServiceClient, subId: string) {
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('organization_id, intervalo, periodo_fim')
    .eq('id', subId)
    .maybeSingle();
  if (!sub) return;
  const periodoFim = sub.periodo_fim ?? calcularPeriodoFim(sub.intervalo, null);
  await supabase.from('subscriptions').update({ status: 'ativa', periodo_fim: periodoFim }).eq('id', subId);

  // Troca de plano: qualquer outra assinatura ativa da org é substituída por esta
  // (cancela a recorrência antiga no Asaas, se for cartão).
  const { data: outras } = await supabase
    .from('subscriptions')
    .select('id, asaas_subscription_id')
    .eq('organization_id', sub.organization_id)
    .eq('status', 'ativa')
    .neq('id', subId);
  for (const o of outras ?? []) {
    if (o.asaas_subscription_id) {
      try { await cancelarAssinaturaAsaas(o.asaas_subscription_id); } catch { /* pode já não existir */ }
    }
    await supabase.from('subscriptions').update({ status: 'trocada', renova_automatico: false }).eq('id', o.id);
  }
}

interface AsaasWebhookPayload {
  event?: string;
  payment?: { id?: string; subscription?: string; value?: number; dueDate?: string };
}

export async function POST(request: Request) {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!expectedToken) {
    console.error('ASAAS_WEBHOOK_TOKEN não configurado — recusando webhook.');
    return new Response('Not configured', { status: 500 });
  }

  if (!isValidToken(request.headers.get('asaas-access-token'), expectedToken)) {
    return new Response('Invalid token', { status: 401 });
  }

  let payload: AsaasWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return new Response('Malformed payload', { status: 400 });
  }

  const paymentId = payload.payment?.id;
  if (!payload.event || !paymentId) return new Response('OK', { status: 200 });

  const pago = payload.event === 'PAYMENT_CONFIRMED' || payload.event === 'PAYMENT_RECEIVED';
  const vencido = payload.event === 'PAYMENT_OVERDUE';
  if (!pago && !vencido) return new Response('OK', { status: 200 });

  const supabase = createServiceClient();
  const { data: invoice } = await supabase
    .from('invoices')
    .select('id, subscription_id')
    .eq('asaas_payment_id', paymentId)
    .maybeSingle();

  if (invoice) {
    if (pago) {
      await supabase.from('invoices').update({ status: 'pago', pago_em: new Date().toISOString() }).eq('id', invoice.id);
      if (invoice.subscription_id) await ativarAssinatura(supabase, invoice.subscription_id);
    } else {
      await supabase.from('invoices').update({ status: 'vencido' }).eq('id', invoice.id);
      if (invoice.subscription_id) {
        await supabase.from('subscriptions').update({ status: 'inadimplente' }).eq('id', invoice.subscription_id);
      }
    }
    return new Response('OK', { status: 200 });
  }

  // Sem fatura para esse pagamento: cobrança de RENOVAÇÃO do cartão — o Asaas
  // gera um novo pagamento a cada ciclo da assinatura. Vinculamos pela
  // assinatura, registramos a fatura paga e estendemos a validade.
  const asaasSubId = payload.payment?.subscription;
  if (pago && asaasSubId) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, organization_id, intervalo, periodo_fim')
      .eq('asaas_subscription_id', asaasSubId)
      .maybeSingle();
    if (sub) {
      await supabase.from('invoices').insert({
        organization_id: sub.organization_id,
        subscription_id: sub.id,
        valor_centavos: Math.round((payload.payment?.value ?? 0) * 100),
        status: 'pago',
        pago_em: new Date().toISOString(),
        vencimento: payload.payment?.dueDate ?? new Date().toISOString().slice(0, 10),
        asaas_payment_id: paymentId,
      });
      await supabase
        .from('subscriptions')
        .update({ status: 'ativa', periodo_fim: calcularPeriodoFim(sub.intervalo, sub.periodo_fim) })
        .eq('id', sub.id);
    }
  }

  return new Response('OK', { status: 200 });
}

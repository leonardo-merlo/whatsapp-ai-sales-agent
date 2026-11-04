// Inicia a cobrança de um plano. Dois caminhos de pagamento:
//  • Cartão → assinatura recorrente no Asaas (renova sozinho a cada ciclo).
//  • Pix    → cobrança avulsa pré-paga do período (mensal/anual), sem renovação.
// Se a org já tem um plano ativo, isto é uma TROCA: aplica crédito proporcional
// do tempo não usado do período atual na primeira cobrança do novo plano.
// Autenticado pela sessão do usuário (client Supabase normal, com RLS).

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import {
  criarClienteAsaas, criarAssinaturaAsaas, criarCobrancaPix, atualizarValorCobranca,
  buscarPrimeiraCobranca, buscarQrCodePix, cancelarAssinaturaAsaas,
} from '@/lib/asaas/client';
import { validarCpfOuCnpj } from '@/lib/asaas/validacao';
import { somaIntervalo, creditoProporcional, type Intervalo } from '@/lib/asaas/periodo';

export const runtime = 'nodejs';

const VALOR_MINIMO_CENTAVOS = 500; // ~R$5, mínimo aceito pelo Asaas numa cobrança

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });
  if (member.role !== 'owner' && member.role !== 'admin') {
    return Response.json({ error: 'Apenas o dono ou administradores podem assinar um plano' }, { status: 403 });
  }

  let body: { planKey?: string; metodoPagamento?: string; intervalo?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!body.planKey) return Response.json({ error: 'Plano não informado' }, { status: 400 });

  const metodo = body.metodoPagamento ?? 'PIX';
  if (metodo !== 'PIX' && metodo !== 'CREDIT_CARD') {
    return Response.json({ error: 'Método de pagamento inválido' }, { status: 400 });
  }
  const intervalo: Intervalo = body.intervalo === 'anual' ? 'anual' : 'mensal';

  const { data: plan } = await supabase
    .from('plans')
    .select('id, key, nome, preco_centavos, preco_anual_centavos')
    .eq('key', body.planKey as 'basico')
    // Plano escondido não se assina de novo; quem já tem continua com ele.
    .eq('visivel', true)
    .maybeSingle();
  if (!plan) return Response.json({ error: 'Plano inválido' }, { status: 400 });

  const { data: org } = await supabase
    .from('organizations')
    .select('nome, cnpj, asaas_customer_id')
    .eq('id', member.organizationId)
    .single();
  if (!org) return Response.json({ error: 'Organização não encontrada' }, { status: 404 });
  if (!org.cnpj || !validarCpfOuCnpj(org.cnpj)) {
    return Response.json({ error: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido em "Dados do negócio" antes de assinar um plano.' }, { status: 400 });
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const valorNovo = intervalo === 'anual' ? plan.preco_anual_centavos : plan.preco_centavos;
  const periodoFim = somaIntervalo(hoje, intervalo);
  const descricao = `Wappia — plano ${plan.nome} (${intervalo === 'anual' ? 'anual' : 'mensal'})`;

  // Plano ativo atual — troca de plano aplica crédito proporcional.
  const { data: ativa } = await supabase
    .from('subscriptions')
    .select('id, intervalo, periodo_inicio, periodo_fim, plans(key, preco_centavos, preco_anual_centavos)')
    .eq('organization_id', member.organizationId)
    .eq('status', 'ativa')
    .maybeSingle();

  if (ativa) {
    const RANK: Record<string, number> = { basico: 1, profissional: 2, avancado: 3 };
    const atualKey = (ativa.plans as { key: string } | null)?.key ?? '';
    if (atualKey === plan.key && ativa.intervalo === intervalo) {
      return Response.json({ error: 'Esse já é o seu plano atual.' }, { status: 400 });
    }
    // Downgrade no meio de um período pago não é permitido — a pessoa mantém o
    // plano atual até o fim e troca por um menor só na renovação.
    const ehDowngrade = (RANK[plan.key] ?? 0) < (RANK[atualKey] ?? 0)
      || (RANK[plan.key] === RANK[atualKey] && ativa.intervalo === 'anual' && intervalo === 'mensal');
    if (ehDowngrade) {
      return Response.json({ error: 'Seu plano atual já está pago até o fim do período. A troca por um plano menor pode ser feita quando este período terminar.' }, { status: 400 });
    }
  }

  let creditoCentavos = 0;
  if (ativa && ativa.periodo_fim) {
    const planoAtual = ativa.plans as { preco_centavos: number; preco_anual_centavos: number } | null;
    const valorPagoAtual = ativa.intervalo === 'anual'
      ? (planoAtual?.preco_anual_centavos ?? 0)
      : (planoAtual?.preco_centavos ?? 0);
    creditoCentavos = creditoProporcional(valorPagoAtual, ativa.periodo_inicio, ativa.periodo_fim, hoje);
  }
  const valorCobrar = Math.max(valorNovo - creditoCentavos, VALOR_MINIMO_CENTAVOS);
  const creditoReais = (valorNovo - valorCobrar) / 100;

  try {
    // Reaproveita uma cobrança pendente idêntica (mesmo plano, método e
    // intervalo); se o pedido mudou, descarta a pendente antes de criar a nova.
    const { data: pendente } = await supabase
      .from('subscriptions')
      .select('id, asaas_subscription_id, plan_id, metodo_pagamento, intervalo')
      .eq('organization_id', member.organizationId)
      .eq('status', 'pendente')
      .maybeSingle();

    if (pendente) {
      const mesmoPedido = pendente.plan_id === plan.id
        && pendente.metodo_pagamento === metodo
        && pendente.intervalo === intervalo;

      const { data: faturaPendente } = await supabase
        .from('invoices')
        .select('id, asaas_payment_id, valor_centavos, vencimento')
        .eq('subscription_id', pendente.id)
        .eq('status', 'pendente')
        .maybeSingle();

      if (mesmoPedido && faturaPendente?.asaas_payment_id) {
        if (metodo === 'CREDIT_CARD' && pendente.asaas_subscription_id) {
          const cobranca = await buscarPrimeiraCobranca(pendente.asaas_subscription_id);
          return Response.json({
            invoiceId: faturaPendente.id, metodo: 'CREDIT_CARD', intervalo,
            invoiceUrl: cobranca.invoiceUrl,
            valor: faturaPendente.valor_centavos / 100, vencimento: faturaPendente.vencimento,
          });
        }
        if (metodo === 'PIX') {
          const qr = await buscarQrCodePix(faturaPendente.asaas_payment_id);
          return Response.json({
            invoiceId: faturaPendente.id, metodo: 'PIX', intervalo,
            qrCodeBase64: qr.encodedImage, copiaCola: qr.payload,
            valor: faturaPendente.valor_centavos / 100, vencimento: faturaPendente.vencimento,
          });
        }
      }

      // Pedido diferente: cancela a assinatura pendente no Asaas (se houver) e
      // marca a pendente + faturas como canceladas localmente.
      if (pendente.asaas_subscription_id) {
        try { await cancelarAssinaturaAsaas(pendente.asaas_subscription_id); } catch { /* pode já não existir */ }
      }
      await supabase.from('invoices').update({ status: 'cancelado' }).eq('subscription_id', pendente.id).eq('status', 'pendente');
      await supabase.from('subscriptions').update({ status: 'cancelada' }).eq('id', pendente.id);
    }

    let asaasCustomerId = org.asaas_customer_id;
    if (!asaasCustomerId) {
      const cliente = await criarClienteAsaas(org.nome, org.cnpj);
      asaasCustomerId = cliente.id;
      await supabase.from('organizations').update({ asaas_customer_id: asaasCustomerId }).eq('id', member.organizationId);
    }

    // ── Cartão: assinatura recorrente (valor cheio); crédito abatido só na 1ª cobrança ──
    if (metodo === 'CREDIT_CARD') {
      const cycle = intervalo === 'anual' ? 'YEARLY' : 'MONTHLY';
      const assinatura = await criarAssinaturaAsaas(asaasCustomerId, valorNovo, hoje, cycle, descricao);

      const { data: subRow, error: subError } = await supabase
        .from('subscriptions')
        .insert({
          organization_id: member.organizationId,
          plan_id: plan.id,
          status: 'pendente',
          asaas_subscription_id: assinatura.id,
          periodo_inicio: hoje,
          periodo_fim: periodoFim,
          metodo_pagamento: 'CREDIT_CARD',
          intervalo,
          renova_automatico: true,
        })
        .select('id')
        .single();
      if (subError) throw subError;

      const cobranca = await buscarPrimeiraCobranca(assinatura.id);
      if (valorCobrar !== valorNovo) {
        await atualizarValorCobranca(cobranca.id, valorCobrar);
      }
      const { data: invoiceRow, error: invoiceError } = await supabase
        .from('invoices')
        .insert({
          organization_id: member.organizationId,
          subscription_id: subRow.id,
          valor_centavos: valorCobrar,
          status: 'pendente',
          vencimento: cobranca.dueDate,
          asaas_payment_id: cobranca.id,
        })
        .select('id')
        .single();
      if (invoiceError) throw invoiceError;

      return Response.json({
        invoiceId: invoiceRow.id, metodo: 'CREDIT_CARD', intervalo, credito: creditoReais,
        invoiceUrl: cobranca.invoiceUrl,
        valor: valorCobrar / 100, vencimento: cobranca.dueDate,
      });
    }

    // ── Pix: cobrança avulsa pré-paga, já criada com o crédito abatido ──
    const cobranca = await criarCobrancaPix(asaasCustomerId, valorCobrar, hoje, descricao);

    const { data: subRow, error: subError } = await supabase
      .from('subscriptions')
      .insert({
        organization_id: member.organizationId,
        plan_id: plan.id,
        status: 'pendente',
        asaas_subscription_id: null,
        periodo_inicio: hoje,
        periodo_fim: periodoFim,
        metodo_pagamento: 'PIX',
        intervalo,
        renova_automatico: false,
      })
      .select('id')
      .single();
    if (subError) throw subError;

    const { data: invoiceRow, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        organization_id: member.organizationId,
        subscription_id: subRow.id,
        valor_centavos: valorCobrar,
        status: 'pendente',
        vencimento: cobranca.dueDate,
        asaas_payment_id: cobranca.id,
      })
      .select('id')
      .single();
    if (invoiceError) throw invoiceError;

    const qr = await buscarQrCodePix(cobranca.id);
    return Response.json({
      invoiceId: invoiceRow.id, metodo: 'PIX', intervalo, credito: creditoReais,
      qrCodeBase64: qr.encodedImage, copiaCola: qr.payload,
      valor: valorCobrar / 100, vencimento: cobranca.dueDate,
    });
  } catch (err) {
    console.error('Erro ao criar assinatura Asaas:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Não foi possível iniciar o pagamento — tente novamente.' }, { status: 502 });
  }
}

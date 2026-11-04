// Status de pagamento por número (migration 20260922000001).
//
// Não existe webhook de billing da Meta — o único sinal de que o cartão do
// cliente falhou é o erro síncrono na resposta do envio. Até aqui esse erro
// só virava `console.error` em cada chamador de sendWhatsAppMessage/
// sendWhatsAppTemplate (send-message.ts), sem ninguém saber além do log do
// servidor.
//
// `marcarFalhaDePagamento` grava o estado no número e avisa pelo sino que já
// existe (mesmo padrão de venda_baixa_estoque/estoque_minimo). `marcarEnvioOk`
// fecha o ciclo sozinha: assim que um envio por aquele número passar, o
// status volta a 'ok' e a notificação pendente se resolve — sem isso o aviso
// ficaria preso na tela mesmo depois de o cliente corrigir o pagamento.

import { createServiceClient } from '../supabase/service';

/** Códigos da Meta observados como falha de pagamento (131042 já citado em
 *  send-message.ts; 131044 é o "sem forma de pagamento válida"). Lista curta
 *  de propósito — cresce quando um código novo aparecer na prática, não por
 *  adivinhação. */
const CODIGOS_DE_PAGAMENTO = [131042, 131044];

export function ehFalhaDePagamento(codigo: number | undefined | null): boolean {
  return codigo != null && CODIGOS_DE_PAGAMENTO.includes(codigo);
}

/**
 * Marca o número com problema de pagamento e avisa pelo sino — uma vez só
 * por problema em aberto: se já existe notificação pendente para este
 * número, não duplica a cada mensagem que continuar falhando.
 */
export async function marcarFalhaDePagamento(
  phoneNumberId: string,
  codigo: number,
  mensagemDaMeta: string,
): Promise<void> {
  const supabase = createServiceClient();
  const { data: numero, error } = await supabase
    .from('wa_numbers')
    .update({ billing_status: 'pagamento_falhou', billing_atualizado_em: new Date().toISOString() })
    .eq('phone_number_id', phoneNumberId)
    .select('id, organization_id, telefone')
    .maybeSingle();
  if (error || !numero) {
    console.error('Billing: falha ao marcar número com problema de pagamento', error?.message);
    return;
  }

  const { data: existente } = await supabase
    .from('notificacoes')
    .select('id')
    .eq('wa_number_id', numero.id)
    .eq('tipo', 'numero_pagamento_falhou')
    .eq('status', 'pendente')
    .maybeSingle();
  if (existente) return;

  const { error: notifErro } = await supabase.from('notificacoes').insert({
    organization_id: numero.organization_id,
    tipo: 'numero_pagamento_falhou',
    titulo: `Pagamento com problema${numero.telefone ? ` em ${numero.telefone}` : ''}`,
    corpo: `A Meta recusou o envio (código ${codigo}: ${mensagemDaMeta}). Confira a forma de pagamento desse número no Gerenciador de Negócios da Meta.`,
    wa_number_id: numero.id,
    status: 'pendente',
  });
  if (notifErro) console.error('Billing: falha ao criar notificação de pagamento', notifErro.message);
}

/**
 * Chamada depois de todo envio bem-sucedido. Só escreve quando o número
 * estava marcado com problema — na maioria das mensagens é um update que não
 * casa linha nenhuma e não faz mais nada.
 */
export async function marcarEnvioOk(phoneNumberId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data: numero, error } = await supabase
    .from('wa_numbers')
    .update({ billing_status: 'ok', billing_atualizado_em: new Date().toISOString() })
    .eq('phone_number_id', phoneNumberId)
    .neq('billing_status', 'ok')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error('Billing: falha ao limpar status de pagamento', error.message);
    return;
  }
  if (!numero) return; // já estava ok — nada para resolver

  const { error: notifErro } = await supabase
    .from('notificacoes')
    .update({ status: 'resolvida', resolvida_em: new Date().toISOString() })
    .eq('wa_number_id', numero.id)
    .eq('tipo', 'numero_pagamento_falhou')
    .eq('status', 'pendente');
  if (notifErro) console.error('Billing: falha ao resolver notificação de pagamento', notifErro.message);
}

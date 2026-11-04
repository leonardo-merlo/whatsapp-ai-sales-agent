// Um pedido de criação vira um pedido só, mesmo que o caminho até ele seja
// percorrido duas vezes.
//
// **Por que isto precisa existir do nosso lado.** A chave `Idempotency-Key`
// é mandada ao ERP, e o contrato pede que eles a respeitem. Mas o contrato
// deles ainda não existe, e mesmo depois que existir, confiar a integridade do
// nosso dado à implementação de outro time é confiar demais. Esta tabela é a
// trava daqui: a assinatura do pedido tem índice único, e quem chega depois lê
// a resposta que o primeiro guardou em vez de criar de novo.
//
// **O que faz dois pedidos serem o mesmo pedido.** A mensagem do cliente que os
// originou, mais o conteúdo. É essa dupla que descreve o caso real: a Meta
// reenvia a MESMA mensagem quando demoramos a confirmar, e o motor a reprocessa
// inteira. Se a assinatura fosse só o conteúdo, um cliente que pede o mesmo
// orçamento de novo meia hora depois seria barrado; se fosse só a mensagem, duas
// criações legítimas dentro de uma mesma resposta virariam uma.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export type OperacaoQueCria = 'criar_cliente' | 'criar_orcamento';

export interface ContextoDeIdempotencia {
  supabase: Client;
  orgId: string;
  conversationId: string | null;
  /** Id da mensagem do cliente que está sendo respondida. Sem ela não há como
   *  distinguir reprocessamento de pedido novo — e aí a trava é desligada, o
   *  que é melhor do que travar pedido legítimo. */
  mensagemId: string | null;
}

export function assinaturaDoPedido(mensagemId: string, corpo: unknown): string {
  const conteudo = createHash('sha256').update(JSON.stringify(corpo ?? null)).digest('hex').slice(0, 32);
  return `${mensagemId}:${conteudo}`;
}

export type ResultadoIdempotente<T> =
  | { estado: 'executou'; dados: T }
  | { estado: 'ja-feito'; dados: T }
  | { estado: 'em-andamento' }
  | { estado: 'falhou'; erro: unknown };

/**
 * Roda `executar` no máximo uma vez por assinatura.
 *
 * A ordem importa e é escolhida: **grava a intenção ANTES de chamar o ERP.** Se
 * gravasse depois, duas execuções simultâneas (o reenvio da Meta chega enquanto
 * a primeira ainda está falando com o ERP) passariam as duas pela checagem e
 * criariam dois orçamentos — que é exatamente o que não pode acontecer.
 *
 * Quando o pedido falha, a linha é **apagada**: a falha não pode virar uma
 * trava permanente contra tentar de novo mais tarde.
 */
export async function umaVezSo<T>(
  ctx: ContextoDeIdempotencia,
  operacao: OperacaoQueCria,
  corpo: unknown,
  executar: (chave: string) => Promise<{ ok: boolean; valor: T }>,
): Promise<ResultadoIdempotente<T>> {
  // Sem mensagem de origem não há como distinguir reprocessamento de pedido
  // novo. Executar sem trava é o menor dos males: travar por engano faria o
  // cliente ficar sem orçamento e ninguém saberia por quê.
  if (!ctx.mensagemId) {
    try {
      const { valor } = await executar(crypto.randomUUID());
      return { estado: 'executou', dados: valor };
    } catch (erro) {
      return { estado: 'falhou', erro };
    }
  }

  const assinatura = assinaturaDoPedido(ctx.mensagemId, corpo);
  const chave = crypto.randomUUID();

  const { data: criada, error } = await ctx.supabase
    .from('erp_idempotencia')
    .insert({
      organization_id: ctx.orgId,
      operacao,
      assinatura,
      chave,
      conversation_id: ctx.conversationId,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // 23505: alguém já pediu isto. Ou já terminou (e a resposta está guardada),
    // ou ainda está em andamento.
    if (error.code === '23505') {
      const { data: existente } = await ctx.supabase
        .from('erp_idempotencia')
        .select('resposta, concluida_em, chave')
        .eq('organization_id', ctx.orgId).eq('operacao', operacao).eq('assinatura', assinatura)
        .maybeSingle();

      if (existente?.concluida_em && existente.resposta !== null) {
        return { estado: 'ja-feito', dados: existente.resposta as T };
      }
      return { estado: 'em-andamento' };
    }
    // Falha de banco não pode impedir o atendimento: segue sem trava e loga.
    console.error('Idempotência indisponível, seguindo sem trava:', error.message);
    try {
      const { valor } = await executar(chave);
      return { estado: 'executou', dados: valor };
    } catch (erro) {
      return { estado: 'falhou', erro };
    }
  }

  try {
    const { ok, valor } = await executar(chave);
    if (!ok) {
      // Recusado ou indisponível: a linha sai, para uma tentativa futura não
      // encontrar uma trava contra um pedido que nunca existiu do outro lado.
      if (criada?.id) await ctx.supabase.from('erp_idempotencia').delete().eq('id', criada.id);
      return { estado: 'executou', dados: valor };
    }
    if (criada?.id) {
      await ctx.supabase.from('erp_idempotencia')
        .update({ resposta: valor as never, concluida_em: new Date().toISOString() })
        .eq('id', criada.id);
    }
    return { estado: 'executou', dados: valor };
  } catch (erro) {
    if (criada?.id) await ctx.supabase.from('erp_idempotencia').delete().eq('id', criada.id);
    return { estado: 'falhou', erro };
  }
}

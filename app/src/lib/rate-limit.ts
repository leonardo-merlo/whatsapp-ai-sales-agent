// Rate limit best-effort em memória (por instância do servidor). Segura abuso
// pontual e picos acidentais; um limite distribuído de verdade (que valha entre
// múltiplas instâncias serverless) exige um store compartilhado como
// Redis/Upstash — fica anotado como próximo passo quando escalar.
//
// Para o limite POR CONVERSA (final do arquivo) essa limitação seria fatal: em
// serverless cada instância teria o próprio contador e o teto nunca valeria de
// verdade. Por isso aquele conta no banco, não aqui.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './supabase/database.types';

// Quantas respostas automáticas a IA pode dar na MESMA conversa dentro de uma
// hora. Acima disso não é atendimento, é loop (dois bots conversando, cliente
// testando o robô, mensagem repetida em rajada) — e cada volta custa tokens.
// Era 30 até 20/10/2026: um orçamento de vendas gasta 10 a 15 respostas, e três
// orçamentos seguidos no teste de campo da Distribuidora Exemplo cortaram o cliente no meio do
// cadastro. 200 fica só como freio de loop; o que substitui de vez é o item 14 do backlog.
// Estourar o limite não bloqueia o cliente: direciona a conversa para um humano.
export const LIMITE_RESPOSTAS_IA_POR_HORA = 200;

interface Hit { count: number; reset: number; }

const buckets = new Map<string, Hit>();

export interface RateLimitResult { ok: boolean; retryAfter: number; }

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Limpeza preguiçosa para o mapa não crescer sem limite em processos longos.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  }

  const hit = buckets.get(key);
  if (!hit || hit.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (hit.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((hit.reset - now) / 1000) };
  }
  hit.count++;
  return { ok: true, retryAfter: 0 };
}

// ── Limite de respostas da IA por conversa (contado no banco) ──

export interface LimiteConversaResult {
  /** true quando a IA já respondeu o teto nesta conversa na última hora. */
  estourou: boolean;
  respostasNaUltimaHora: number;
}

/** Conta as respostas da IA na última hora nesta conversa. Mensagens de campanha
 *  (`camp`) ficam de fora: são disparo em massa, não resposta de atendimento.
 *  Falha aberta — erro de infraestrutura na contagem não pode travar o
 *  atendimento de quem está esperando. */
export async function checarLimiteDaConversa(
  supabase: SupabaseClient<Database>,
  conversationId: string,
): Promise<LimiteConversaResult> {
  const umaHoraAtras = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('autor', 'ia')
    .eq('camp', false)
    .gte('created_at', umaHoraAtras);

  if (error || count === null) {
    if (error) console.error('Erro ao contar respostas da IA na conversa:', error.message);
    return { estourou: false, respostasNaUltimaHora: 0 };
  }
  return { estourou: count >= LIMITE_RESPOSTAS_IA_POR_HORA, respostasNaUltimaHora: count };
}

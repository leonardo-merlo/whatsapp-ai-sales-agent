// Grava uma linha de uso de tokens em ai_usage. Best-effort: nunca lança —
// falha de log jamais pode derrubar a resposta ao cliente.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { calcularCustoUsd } from './precos-ia';

type Client = SupabaseClient<Database>;
type Origem = 'motor' | 'resumo' | 'simulador' | 'perfil' | 'midia' | 'v2';

export const MODELO_IA = 'claude-haiku-4-5';

export async function logAiUsage(
  supabase: Client,
  params: {
    orgId: string;
    origem: Origem;
    model: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      // Nuláveis no SDK, e sempre nulos enquanto o projeto não usar cache_control.
      cache_creation_input_tokens?: number | null;
      cache_read_input_tokens?: number | null;
    } | null | undefined;
    conversationId?: string | null;
    /** A execução do motor a que esta chamada pertence (`agente_turnos`). */
    turnoId?: string | null;
  },
): Promise<void> {
  if (!params.usage) return;
  try {
    const { error } = await supabase.from('ai_usage').insert({
      organization_id: params.orgId,
      origem: params.origem,
      model: params.model,
      input_tokens: params.usage.input_tokens,
      output_tokens: params.usage.output_tokens,
      cache_creation_input_tokens: params.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: params.usage.cache_read_input_tokens ?? 0,
      conversation_id: params.conversationId ?? null,
      // Só entra quando existe: sem rastreio, a linha sai igual à de sempre.
      ...(params.turnoId ? { turno_id: params.turnoId } : {}),
      // Custo congelado no preço vigente agora — a leitura nunca recalcula.
      custo_usd: calcularCustoUsd(params.model, params.usage),
    });
    if (error) console.error('Falha ao gravar ai_usage:', error.message);
  } catch {
    /* log de uso é secundário; ignora falha */
  }
}

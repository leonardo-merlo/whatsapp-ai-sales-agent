// Consulta de uso e custo da IA (tabela ai_usage) para a tela de Configurações.
//
// A agregação é feita no cliente e não no banco de propósito: não há RPC nem
// view para isso, e o volume é pequeno (uma linha por chamada Claude, filtrada
// por org e por período). Se um dia uma org passar de algumas dezenas de
// milhares de linhas no período, vale trocar por uma RPC com GROUP BY.
//
// RLS: ai_usage tem política is_member_of, ou seja QUALQUER membro da org lê.
// Quem decide se a tela aparece é a camada de cima (owner/admin) — este módulo
// só consulta.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export type PeriodoUso = '7d' | '30d' | '90d';

export type OrigemUso = 'motor' | 'resumo' | 'simulador' | 'perfil' | 'midia' | 'v2';

export const ORIGENS_USO: readonly OrigemUso[] = ['motor', 'resumo', 'simulador', 'perfil', 'midia', 'v2'];

/** Rótulo em PT-BR de cada origem, para a tela. */
export const ROTULO_ORIGEM: Record<OrigemUso, string> = {
  motor: 'Atendente no WhatsApp',
  resumo: 'Resumo de conversa',
  simulador: 'Testes do agente',
  perfil: 'Perfil do cliente',
  midia: 'Leitura de imagens',
  v2: 'Lista de produtos',
};

export interface UsoPorOrigem {
  origem: OrigemUso | 'outros';
  chamadas: number;
  tokens: number;
  custoUsd: number;
}

export interface ResumoUsoIA {
  periodo: PeriodoUso;
  chamadas: number;
  tokensEntrada: number;
  tokensSaida: number;
  /** Entrada + saída + tokens de cache (escrita e leitura). */
  tokensTotal: number;
  custoUsd: number;
  porOrigem: UsoPorOrigem[];
}

const DIAS_POR_PERIODO: Record<PeriodoUso, number> = { '7d': 7, '30d': 30, '90d': 90 };

function inicioDoPeriodo(periodo: PeriodoUso): string {
  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_POR_PERIODO[periodo]);
  return desde.toISOString();
}

function resumoVazio(periodo: PeriodoUso): ResumoUsoIA {
  return { periodo, chamadas: 0, tokensEntrada: 0, tokensSaida: 0, tokensTotal: 0, custoUsd: 0, porOrigem: [] };
}

/**
 * Uso e custo da IA da organização no período. Devolve o resumo zerado (nunca
 * lança) se a consulta falhar — é uma tela de leitura, não vale derrubá-la.
 */
export async function fetchUsoIA(
  supabase: Client,
  orgId: string,
  periodo: PeriodoUso,
): Promise<ResumoUsoIA> {
  const { data, error } = await supabase
    .from('ai_usage')
    .select('origem, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, custo_usd')
    .eq('organization_id', orgId)
    .gte('created_at', inicioDoPeriodo(periodo));

  if (error || !data) {
    if (error) console.error('Falha ao ler ai_usage:', error.message);
    return resumoVazio(periodo);
  }

  const resumo = resumoVazio(periodo);
  const porOrigem = new Map<OrigemUso | 'outros', UsoPorOrigem>();

  for (const linha of data) {
    const tokens =
      linha.input_tokens +
      linha.output_tokens +
      linha.cache_creation_input_tokens +
      linha.cache_read_input_tokens;
    // custo_usd chega como number pelo PostgREST, mas numeric pode vir string
    // em alguns caminhos — Number() cobre os dois sem mentir sobre o tipo.
    const custo = Number(linha.custo_usd) || 0;

    resumo.chamadas += 1;
    resumo.tokensEntrada += linha.input_tokens;
    resumo.tokensSaida += linha.output_tokens;
    resumo.tokensTotal += tokens;
    resumo.custoUsd += custo;

    const chave = (ORIGENS_USO as readonly string[]).includes(linha.origem)
      ? (linha.origem as OrigemUso)
      : 'outros';
    const atual = porOrigem.get(chave) ?? { origem: chave, chamadas: 0, tokens: 0, custoUsd: 0 };
    atual.chamadas += 1;
    atual.tokens += tokens;
    atual.custoUsd += custo;
    porOrigem.set(chave, atual);
  }

  resumo.porOrigem = [...porOrigem.values()].sort((a, b) => b.custoUsd - a.custoUsd);
  return resumo;
}

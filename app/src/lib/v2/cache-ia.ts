// O cache das chamadas de IA (v2_cache_ia). Toda transcrição e toda extração
// ficam guardadas pela chave = hash(entrada + contexto da conversa + versão do
// prompt + versão do schema + modelo). Antes de chamar a API, procura aqui.
//
// Mudar regra, tabela, resolvedor ou conversa NÃO muda a chave: a bancada
// reavalia tudo com custo zero. Só mudar o prompt ou o schema gera chamada nova.

import { createHash } from 'node:crypto';
import { calcularCustoUsd, type TokensUso } from '@/lib/agente/precos-ia';

export type TipoDeChamada = 'extracao' | 'transcricao';

export interface RegistroDoCache {
  chave: string;
  tipo: TipoDeChamada;
  modelo: string;
  prompt_version: string;
  schema_version: string;
  /** Começo da entrada, só para quem lê o banco entender a linha. */
  entrada_resumo: string;
  /** O JSON que a IA devolveu. */
  saida: string;
  uso: TokensUso;
  custo_usd: number;
}

export interface CacheDeIA {
  ler(chave: string): Promise<RegistroDoCache | null>;
  gravar(registro: RegistroDoCache): Promise<void>;
}

export function chaveDoCache(partes: { tipo: TipoDeChamada; entrada: string; prompt_version: string; schema_version: string; modelo: string }): string {
  return createHash('sha256').update(JSON.stringify([partes.tipo, partes.entrada, partes.prompt_version, partes.schema_version, partes.modelo])).digest('hex');
}

/** Cache em memória (testes e pré-carga da bancada). */
export function cacheEmMemoria(inicial: RegistroDoCache[] = []): CacheDeIA & { registros: Map<string, RegistroDoCache> } {
  const registros = new Map(inicial.map(r => [r.chave, r]));
  return {
    registros,
    async ler(chave) { return registros.get(chave) ?? null; },
    async gravar(r) { registros.set(r.chave, r); },
  };
}

// ── o cliente da API ──

export interface RespostaDaIA { texto: string; uso: TokensUso; modelo: string; stop_reason: string | null }

/** Quem fala com a API. Na bancada offline, um cliente que falha: nenhuma chamada sai. */
export interface ClienteIA { chamar(pedido: Record<string, unknown>): Promise<RespostaDaIA> }

export class ErroSemCache extends Error {
  readonly chave: string;
  readonly tipo: TipoDeChamada;
  constructor(chave: string, tipo: TipoDeChamada, resumo: string) {
    super(`Sem cache para ${tipo} (${resumo.slice(0, 60)}…) e a bancada está offline.`);
    this.chave = chave;
    this.tipo = tipo;
  }
}

export const CLIENTE_OFFLINE: ClienteIA = {
  async chamar() { throw new Error('cliente offline: nenhuma chamada à API é permitida'); },
};

/** Cliente de verdade, pelo SDK da Anthropic (import dinâmico: os testes não carregam o SDK). */
export async function clienteAnthropic(apiKey?: string): Promise<ClienteIA> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic(apiKey ? { apiKey } : {});
  return {
    async chamar(pedido) {
      const resposta = await anthropic.messages.create(pedido as unknown as Parameters<typeof anthropic.messages.create>[0]) as unknown as {
        content: { type: string; text?: string }[]; usage: TokensUso; model: string; stop_reason: string | null;
      };
      const texto = resposta.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('');
      return { texto, uso: resposta.usage, modelo: resposta.model, stop_reason: resposta.stop_reason };
    },
  };
}

export interface ChamadaComCache {
  registro: RegistroDoCache;
  /** Veio do cache (custo zero agora)? */
  doCache: boolean;
}

/**
 * Procura no cache; se não achar, chama a API (ou falha, se o cliente for o
 * offline) e grava. `aoGastar` é avisado do custo de cada chamada nova: é por
 * onde a bancada soma o gasto e para no teto.
 */
export async function chamarComCache(
  cache: CacheDeIA,
  cliente: ClienteIA,
  partes: { tipo: TipoDeChamada; entrada: string; prompt_version: string; schema_version: string; modelo: string },
  pedido: Record<string, unknown>,
  opcoes: { offline?: boolean; aoGastar?: (usd: number) => void } = {},
): Promise<ChamadaComCache> {
  const chave = chaveDoCache(partes);
  const achado = await cache.ler(chave);
  if (achado) return { registro: achado, doCache: true };
  if (opcoes.offline) throw new ErroSemCache(chave, partes.tipo, partes.entrada);
  const resposta = await cliente.chamar(pedido);
  if (resposta.stop_reason === 'max_tokens') throw new Error(`${partes.tipo}: resposta cortada por max_tokens`);
  const custo = calcularCustoUsd(partes.modelo, resposta.uso);
  opcoes.aoGastar?.(custo);
  const registro: RegistroDoCache = {
    chave, tipo: partes.tipo, modelo: partes.modelo, prompt_version: partes.prompt_version, schema_version: partes.schema_version,
    entrada_resumo: partes.entrada.slice(0, 200), saida: resposta.texto, uso: resposta.uso, custo_usd: custo,
  };
  await cache.gravar(registro);
  return { registro, doCache: false };
}

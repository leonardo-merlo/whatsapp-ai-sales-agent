// Onde o estado da v2 mora: pedido, itens, trace, snapshots (Fase F e G).
// Duas implementações com a mesma interface: memória (testes) e Supabase
// (produção e bancada). A bancada lê o resultado daqui, nunca do texto da IA.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CacheDeIA, RegistroDoCache } from './cache-ia';
import type { Conferencia, ItemExtraido, OperacaoNaLista, ResultadoResolucao } from './tipos';

export type StatusDoItem = 'resolvido' | 'pergunta' | 'respondido' | 'nao_vende' | 'vendedor' | 'fora_do_orcamento';

export interface Pergunta {
  id: string;
  texto: string;
  opcoes: { rotulo: string; codigos: string[] }[];
  /**
   * confirmacao: um produto só, sim ou não. produto/atributo: escolher. quantidade: quanto. vendedor: seguir sem o item?
   * qual_item: a mudança pedida serve a mais de um item da lista; a resposta diz em qual aplicar `operacao`.
   */
  tipo: 'confirmacao' | 'escolha' | 'nao_encontrado' | 'quantidade' | 'vendedor' | 'ilegivel' | 'nao_entendi' | 'qual_item';
  operacao?: OperacaoNaLista;
}

export interface ItemDoPedido {
  id: string;
  pedido_id: string;
  ordem: number;
  linha_id: number | null;
  texto_original: string;
  extracao: ItemExtraido | null;
  conferencias: Conferencia[];
  resultado: ResultadoResolucao | null;
  status: StatusDoItem;
  codigo_final: string | null;
  quantidade: string | null;
  pergunta: Pergunta | null;
  respostas: { pergunta_id: string; resposta: string }[];
  versao_regras: string;
  versao_catalogo: string;
}

export interface Pedido { id: string; organization_id: string; referencia: string; estado: 'levantando' | 'aguardando_confirmacao' | 'confirmado'; proxima_pergunta: number }

export interface ItemDoSnapshot { item_id: string; codigo: string; descricao: string; quantidade: string | null }
export interface Snapshot { id: string; pedido_id: string; hash: string; itens: ItemDoSnapshot[]; confirmado: boolean }

export interface Trace {
  pedido_id: string;
  item_id?: string | null;
  etapa: 'transcricao' | 'extracao' | 'conferencia' | 'resolucao' | 'resposta';
  entrada?: unknown;
  saida?: unknown;
  regras?: string[];
  travas?: unknown;
  duracao_ms?: number;
  tokens?: unknown;
  custo_usd?: number;
}

export interface ArmazemV2 {
  organizacao: string;
  criarPedido(referencia: string): Promise<Pedido>;
  pedido(id: string): Promise<Pedido | null>;
  atualizarPedido(id: string, campos: Partial<Pick<Pedido, 'estado' | 'proxima_pergunta'>>): Promise<void>;
  itens(pedidoId: string): Promise<ItemDoPedido[]>;
  inserirItem(item: Omit<ItemDoPedido, 'id'>): Promise<ItemDoPedido>;
  atualizarItem(id: string, campos: Partial<Omit<ItemDoPedido, 'id' | 'pedido_id'>>): Promise<void>;
  gravarTrace(trace: Trace): Promise<void>;
  traces(pedidoId: string): Promise<(Trace & { id: number })[]>;
  gravarSnapshot(s: Omit<Snapshot, 'id' | 'confirmado'>): Promise<Snapshot>;
  snapshots(pedidoId: string): Promise<Snapshot[]>;
  confirmarSnapshot(id: string): Promise<void>;
}

// ── memória ──

export function armazemEmMemoria(organizacao = '00000000-0000-4000-8000-0000000000b2'): ArmazemV2 {
  let seq = 0;
  const novoId = (): string => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const pedidos = new Map<string, Pedido>();
  const itens = new Map<string, ItemDoPedido>();
  const traces: (Trace & { id: number })[] = [];
  const snapshots = new Map<string, Snapshot>();
  const copia = <T>(x: T): T => structuredClone(x);
  return {
    organizacao,
    async criarPedido(referencia) { const p: Pedido = { id: novoId(), organization_id: organizacao, referencia, estado: 'levantando', proxima_pergunta: 1 }; pedidos.set(p.id, p); return copia(p); },
    async pedido(id) { return pedidos.has(id) ? copia(pedidos.get(id)!) : null; },
    async atualizarPedido(id, campos) { Object.assign(pedidos.get(id)!, campos); },
    async itens(pedidoId) { return [...itens.values()].filter(i => i.pedido_id === pedidoId).sort((a, b) => a.ordem - b.ordem).map(copia); },
    async inserirItem(item) { const i = { ...copia(item), id: novoId() }; itens.set(i.id, i); return copia(i); },
    async atualizarItem(id, campos) { Object.assign(itens.get(id)!, copia(campos)); },
    async gravarTrace(t) { traces.push({ ...copia(t), id: traces.length + 1 }); },
    async traces(pedidoId) { return traces.filter(t => t.pedido_id === pedidoId).map(copia); },
    async gravarSnapshot(s) {
      const existente = [...snapshots.values()].find(x => x.pedido_id === s.pedido_id && x.hash === s.hash);
      if (existente) return copia(existente);
      const n: Snapshot = { ...copia(s), id: novoId(), confirmado: false };
      snapshots.set(n.id, n);
      return copia(n);
    },
    async snapshots(pedidoId) { return [...snapshots.values()].filter(s => s.pedido_id === pedidoId).map(copia); },
    async confirmarSnapshot(id) { snapshots.get(id)!.confirmado = true; },
  };
}

// ── Supabase (service role) ──

type Linha = Record<string, unknown>;

async function ok<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(`v2 banco: ${error.message}`);
  return data as T;
}

export function armazemSupabase(supabase: SupabaseClient, organizacao: string): ArmazemV2 {
  const daLinha = (l: Linha): ItemDoPedido => ({
    id: l.id as string, pedido_id: l.pedido_id as string, ordem: l.ordem as number, linha_id: (l.linha_id as number | null) ?? null,
    texto_original: l.texto_original as string, extracao: (l.extracao as ItemExtraido | null) ?? null,
    conferencias: (l.conferencias as Conferencia[] | null) ?? [], resultado: (l.resultado as ResultadoResolucao | null) ?? null,
    status: l.status as StatusDoItem, codigo_final: (l.codigo_final as string | null) ?? null, quantidade: (l.quantidade as string | null) ?? null,
    pergunta: (l.pergunta as Pergunta | null) ?? null, respostas: (l.respostas as ItemDoPedido['respostas']) ?? [],
    versao_regras: l.versao_regras as string, versao_catalogo: l.versao_catalogo as string,
  });
  const agora = (): string => new Date().toISOString();
  return {
    organizacao,
    async criarPedido(referencia) {
      return ok(supabase.from('v2_pedidos').insert({ organization_id: organizacao, referencia }).select('id, organization_id, referencia, estado, proxima_pergunta').single()) as Promise<Pedido>;
    },
    async pedido(id) {
      return ok(supabase.from('v2_pedidos').select('id, organization_id, referencia, estado, proxima_pergunta').eq('id', id).eq('organization_id', organizacao).maybeSingle()) as Promise<Pedido | null>;
    },
    async atualizarPedido(id, campos) { await ok(supabase.from('v2_pedidos').update({ ...campos, atualizado_em: agora() }).eq('id', id).eq('organization_id', organizacao)); },
    async itens(pedidoId) {
      const linhas = await ok(supabase.from('v2_itens').select('*').eq('pedido_id', pedidoId).eq('organization_id', organizacao).order('ordem'));
      return (linhas as Linha[]).map(daLinha);
    },
    async inserirItem(item) {
      return daLinha(await ok(supabase.from('v2_itens').insert({ ...item, organization_id: organizacao }).select('*').single()) as Linha);
    },
    async atualizarItem(id, campos) { await ok(supabase.from('v2_itens').update({ ...campos, atualizado_em: agora() }).eq('id', id).eq('organization_id', organizacao)); },
    async gravarTrace(t) { await ok(supabase.from('v2_trace').insert({ ...t, organization_id: organizacao })); },
    async traces(pedidoId) {
      return ok(supabase.from('v2_trace').select('*').eq('pedido_id', pedidoId).eq('organization_id', organizacao).order('id')) as Promise<(Trace & { id: number })[]>;
    },
    async gravarSnapshot(s) {
      const existente = await ok(supabase.from('v2_snapshots').select('id, pedido_id, hash, itens, confirmado').eq('pedido_id', s.pedido_id).eq('hash', s.hash).maybeSingle());
      if (existente) return existente as Snapshot;
      return ok(supabase.from('v2_snapshots').insert({ ...s, organization_id: organizacao }).select('id, pedido_id, hash, itens, confirmado').single()) as Promise<Snapshot>;
    },
    async snapshots(pedidoId) {
      return ok(supabase.from('v2_snapshots').select('id, pedido_id, hash, itens, confirmado').eq('pedido_id', pedidoId).eq('organization_id', organizacao).order('criado_em')) as Promise<Snapshot[]>;
    },
    async confirmarSnapshot(id) { await ok(supabase.from('v2_snapshots').update({ confirmado: true, confirmado_em: agora() }).eq('id', id).eq('organization_id', organizacao)); },
  };
}

/** O cache de IA no banco (v2_cache_ia). `preCarregar` traz tudo de uma vez: a bancada offline não faz uma consulta por item. */
export function cacheSupabase(supabase: SupabaseClient): CacheDeIA & { preCarregar(): Promise<number> } {
  const memoria = new Map<string, RegistroDoCache>();
  let carregado = false;
  return {
    async preCarregar() {
      for (let desde = 0; ; desde += 1000) {
        const linhas = await ok(supabase.from('v2_cache_ia').select('*').range(desde, desde + 999)) as Linha[];
        for (const l of linhas) memoria.set(l.chave as string, { ...(l as unknown as RegistroDoCache), custo_usd: Number(l.custo_usd) });
        if (linhas.length < 1000) break;
      }
      carregado = true;
      return memoria.size;
    },
    async ler(chave) {
      if (memoria.has(chave)) return memoria.get(chave)!;
      if (carregado) return null;
      const l = await ok(supabase.from('v2_cache_ia').select('*').eq('chave', chave).maybeSingle()) as Linha | null;
      if (!l) return null;
      const r = { ...(l as unknown as RegistroDoCache), custo_usd: Number(l.custo_usd) };
      memoria.set(chave, r);
      return r;
    },
    async gravar(r) {
      await ok(supabase.from('v2_cache_ia').upsert({ ...r }));
      memoria.set(r.chave, r);
    },
  };
}

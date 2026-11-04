// A chave entre v1 e v2: PIPELINE_VERSION=v1|v2, padrão v1. Só o valor exato
// "v2" liga a v2, e só no roteiro de vendas; qualquer outra coisa (vazio,
// erro de digitação) mantém a v1 intacta.
//
// Com a v2 ligada, a v1 continua dona do fluxo (CPF/CNPJ, cadastro, região,
// preço, orçamento) e a v2 cuida só de levantar os itens: ver integracao-v1.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import { montarCatalogo, type CatalogoV2 } from './catalogo';
import { auditarCatalogo, CORRECOES } from './saude';
import type { ProdutoDoCatalogo, SaudeDoProduto } from './tipos';

export type VersaoDoPipeline = 'v1' | 'v2';

export function versaoDoPipeline(valor: string | undefined = process.env.PIPELINE_VERSION): VersaoDoPipeline {
  return valor?.trim() === 'v2' ? 'v2' : 'v1';
}

/** A IA lê as mudanças na lista e o código confere (V2_OPERACOES=ligado, 25/10). Padrão: desligada, frases no código. */
export function operacoesLigadas(valor: string | undefined = process.env.V2_OPERACOES): boolean {
  return valor?.trim() === 'ligado';
}

/** A v2 cuida dos itens desta conversa? Só com a chave em v2 e no roteiro de vendas. */
export function usaPipelineV2(roteiro: string | null | undefined, valor?: string): boolean {
  return versaoDoPipeline(valor) === 'v2' && roteiro === 'vendas';
}

interface CatalogoEmMemoria { catalogo: CatalogoV2; saude: Map<string, SaudeDoProduto>; versao: string; carregadoEm: number }
const CATALOGOS = new Map<string, CatalogoEmMemoria>();
const VALIDADE_DO_CATALOGO_MS = 10 * 60 * 1000;

/** O catálogo da organização estruturado pela v2, guardado 10 minutos em memória. */
export async function catalogoDaOrganizacao(supabase: SupabaseClient, orgId: string): Promise<CatalogoEmMemoria> {
  const guardado = CATALOGOS.get(orgId);
  if (guardado && Date.now() - guardado.carregadoEm < VALIDADE_DO_CATALOGO_MS) return guardado;
  const { data: grupos, error: erroDosGrupos } = await supabase.from('catalogo_grupos').select('id, nome').eq('organization_id', orgId);
  if (erroDosGrupos) throw new Error(`v2: grupos do catálogo: ${erroDosGrupos.message}`);
  const nomeDoGrupo = new Map(((grupos ?? []) as { id: string; nome: string }[]).map(g => [g.id, g.nome]));
  const linhas: ProdutoDoCatalogo[] = [];
  let maisRecente = '';
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from('catalogo_produtos')
      .select('codigo, descricao, unidade, molde, medidas, dados, updated_at, grupo_id')
      .eq('organization_id', orgId).eq('ativo', true).order('codigo').range(desde, desde + 999);
    if (error) throw new Error(`v2: catálogo: ${error.message}`);
    for (const p of (data ?? []) as unknown as { codigo: string; descricao: string; unidade: string | null; molde: string | null; medidas: Record<string, string> | null; dados: { peso_kg?: string } | null; updated_at: string; grupo_id: string | null }[]) {
      linhas.push({ codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, grupo: (p.grupo_id && nomeDoGrupo.get(p.grupo_id)) || null, molde: p.molde, medidas: p.medidas, peso_kg: p.dados?.peso_kg ? Number(p.dados.peso_kg) : null });
      if (p.updated_at > maisRecente) maisRecente = p.updated_at;
    }
    if (!data || data.length < 1000) break;
  }
  const catalogo = montarCatalogo(linhas, CORRECOES);
  const novo = { catalogo, saude: auditarCatalogo(catalogo).saude, versao: `${linhas.length} produtos, ${maisRecente.slice(0, 19)}`, carregadoEm: Date.now() };
  CATALOGOS.set(orgId, novo);
  return novo;
}

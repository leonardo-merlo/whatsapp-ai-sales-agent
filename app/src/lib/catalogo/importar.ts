// Grava no banco o catálogo lido do CSV.
//
// A decisão que governa este arquivo: **produto que não veio no arquivo novo é
// DESATIVADO, não apagado.** Apagar e reinserir é o que `business_prices` fazia
// na fase 7, e o efeito só aparecia depois: os ids eram trocados a cada
// salvamento, então qualquer coisa que apontasse para o produto ficava órfã em
// silêncio. Aqui o id de um código é para sempre — o que muda é o `ativo`.
//
// Nada aqui roda dentro de uma transação, porque o PostgREST não expõe uma. A
// ordem é escolhida para que uma falha no meio deixe o catálogo **maior**, e
// nunca menor: primeiro grupos, depois produtos, e só no fim a desativação do
// que sumiu. Uma queda no meio deixa produto a mais, que a IA pode oferecer;
// deixar produto a menos faria ela dizer que não existe algo que existe.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { LinhaDoCatalogo } from './ler-csv';
import { lerMedidas, MOLDES_POR_ORG } from './moldes';

type Client = SupabaseClient<Database>;

/** O "nome do arquivo" que o sync diário grava. A tela de Produtos usa para
 *  dizer de onde veio a lista. */
export const NOME_DO_SYNC_DE_PRODUTOS = 'sync diário do sistema de gestão';

export interface ResumoDaImportacao {
  grupos: number;
  produtos: number;
  desativados: number;
}

/** Em quantos pedaços cada gravação vai ao banco. 1055 linhas num INSERT só
 *  passam do tamanho de requisição que o PostgREST aceita. */
const LOTE = 200;

function emLotes<T>(itens: T[], tamanho = LOTE): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
}

/** O PostgREST do Supabase devolve no máximo 1000 linhas por select, sem
 *  avisar. A Distribuidora Exemplo passou de 1000 produtos em 30/09: toda leitura do
 *  catálogo inteiro precisa vir em páginas. */
const PAGINA = 1000;

export async function lerEmPaginas<T>(
  pagina: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler o catálogo: ${error.message}`);
    todas.push(...(data ?? []));
    if ((data ?? []).length < PAGINA) return todas;
  }
}

export async function importarCatalogo(
  supabase: Client,
  orgId: string,
  linhas: LinhaDoCatalogo[],
  nomeDoArquivo: string,
  /** `false` quando a lista sabidamente veio incompleta: grava o que veio e
   *  não desativa produto nenhum (só o grupo que ficou sem produto). */
  desativarAusentes = true,
): Promise<ResumoDaImportacao> {
  if (!linhas.length) throw new Error('Nada para importar.');

  // ── 1. grupos ──
  const gruposDoArquivo = new Map<string, string>();
  for (const l of linhas) if (!gruposDoArquivo.has(l.grupoCodigo)) gruposDoArquivo.set(l.grupoCodigo, l.grupoNome);

  for (const lote of emLotes([...gruposDoArquivo])) {
    const { error } = await supabase.from('catalogo_grupos').upsert(
      lote.map(([codigo, nome]) => ({ organization_id: orgId, codigo, nome, ativo: true })),
      { onConflict: 'organization_id,codigo' },
    );
    if (error) throw new Error(`Falha ao gravar os grupos: ${error.message}`);
  }

  const { data: gruposNoBanco, error: erroGrupos } = await supabase
    .from('catalogo_grupos').select('id, codigo').eq('organization_id', orgId);
  if (erroGrupos) throw new Error(`Falha ao ler os grupos: ${erroGrupos.message}`);
  const idDoGrupo = new Map((gruposNoBanco ?? []).map(g => [g.codigo, g.id]));

  // ── 2. produtos ──
  // As medidas são refeitas a cada importação, de todos os produtos: a conta é
  // de milissegundos, e assim um molde consertado vale também para o produto
  // cuja descrição não mudou. Organização sem moldes não manda as colunas.
  const temMoldes = orgId in MOLDES_POR_ORG;
  const produtos = linhas.map(l => ({
    organization_id: orgId,
    grupo_id: idDoGrupo.get(l.grupoCodigo)!,
    codigo: l.codigo,
    descricao: l.descricao,
    unidade: l.unidade,
    preco: l.preco,
    dados: l.dados as unknown as Database['public']['Tables']['catalogo_produtos']['Insert']['dados'],
    ativo: true,
    ...(temMoldes ? lerMedidas(orgId, l.grupoNome, l.descricao) : {}),
  }));
  for (const lote of emLotes(produtos)) {
    const { error } = await supabase.from('catalogo_produtos').upsert(lote, { onConflict: 'organization_id,codigo' });
    if (error) throw new Error(`Falha ao gravar os produtos: ${error.message}`);
  }

  // ── 3. o que sumiu do arquivo ──
  // Feito por diferença lida do banco, e não por `not in (...)` com 1055
  // códigos na URL: a consulta ficaria maior que o limite de tamanho de uma
  // requisição HTTP e falharia só nos catálogos grandes — justamente os que
  // este código existe para atender.
  const paraDesativar: string[] = [];
  if (desativarAusentes) {
    const todosOsProdutos = await lerEmPaginas<{ id: string; codigo: string }>((de, ate) => supabase
      .from('catalogo_produtos').select('id, codigo').eq('organization_id', orgId).eq('ativo', true)
      .order('id').range(de, ate));
    const codigosDoArquivo = new Set(linhas.map(l => l.codigo));
    paraDesativar.push(...todosOsProdutos.filter(p => !codigosDoArquivo.has(p.codigo)).map(p => p.id));
    for (const lote of emLotes(paraDesativar)) {
      const { error } = await supabase.from('catalogo_produtos').update({ ativo: false }).in('id', lote);
      if (error) throw new Error(`Falha ao desativar produtos que saíram do catálogo: ${error.message}`);
    }
  }

  // ── 3b. grupo sem nenhum produto ativo ──
  // Vale também para a lista parcial: não desliga produto nenhum, e um grupo
  // vazio no índice do prompt faz a IA buscar ali e dizer ao cliente que o
  // produto não existe (30/09: "CHAPA GALVANIZADA 24" virou "CHAPAS
  // GALVANIZADAS 24" no sistema da Distribuidora Exemplo e o grupo antigo ficou vazio).
  const [gruposAtivos, produtosAtivos] = await Promise.all([
    lerEmPaginas<{ id: string }>((de, ate) => supabase
      .from('catalogo_grupos').select('id').eq('organization_id', orgId).eq('ativo', true)
      .order('id').range(de, ate)),
    lerEmPaginas<{ grupo_id: string }>((de, ate) => supabase
      .from('catalogo_produtos').select('grupo_id').eq('organization_id', orgId).eq('ativo', true)
      .order('id').range(de, ate)),
  ]);
  const gruposComProduto = new Set(produtosAtivos.map(p => p.grupo_id));
  const gruposVazios = gruposAtivos.filter(g => !gruposComProduto.has(g.id)).map(g => g.id);
  for (const lote of emLotes(gruposVazios)) {
    await supabase.from('catalogo_grupos').update({ ativo: false }).in('id', lote);
  }

  // ── 4. quando e de qual arquivo ──
  await supabase.from('catalogo_config').upsert(
    { organization_id: orgId, importado_em: new Date().toISOString(), importado_nome: nomeDoArquivo },
    { onConflict: 'organization_id' },
  );

  return {
    grupos: gruposDoArquivo.size,
    produtos: linhas.length,
    desativados: paraDesativar.length,
  };
}

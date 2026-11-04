// Sync diário de produtos (contrato v4): a lista inteira do sistema da
// Distribuidora Exemplo vira o catálogo que a IA consulta.
//
// **A mesma regra do CSV, pelo mesmo código.** A gravação é `importarCatalogo`:
// produto que sumiu da lista é DESATIVADO, nunca apagado, e o id de um código é
// para sempre. O que este arquivo acrescenta é o que um CSV subido à mão não
// precisa e uma chamada automática às 3 da manhã precisa:
//
// - **Proteção contra lista quebrada.** Lista vazia, ou uma lista que
//   desativaria de uma vez mais de 30% dos ativos (e mais de 10 produtos), não é
//   aplicada. Um bug do lado de lá numa madrugada não pode apagar o catálogo da
//   IA — ela passaria a dizer que não existe o que existe.
// - **Lista com `falhas` não desativa nada.** Em 30/09 cinco filiais deles
//   falharam e a lista veio com 734 de ~1055. O que veio é gravado; o que não
//   veio fica como estava, e a trava de queda nem entra na conta.
// - **Item incompleto não é ausente.** Veio com id e faltando campo: não é
//   atualizado e também não é desativado.
// - **O que o sync não traz, fica.** Preço e as colunas extras do CSV continuam;
//   o sync só junta peso, unidade de venda e filiais (`empresas`) aos `dados`.
//   A descrição é a do sistema deles: desde 30/09 ela é a que vale.
// - **Grupo pelo nome.** O contrato manda `"grupo": "Vergalhões"`. O grupo já
//   cadastrado com o mesmo nome (sem diferença de maiúscula e acento) é
//   reaproveitado; os 159 grupos do CSV de 13/09 não são trocados à toa.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import { chamarErp, type ConexaoComOErp } from '../cliente-http';
import { importarCatalogo, lerEmPaginas, NOME_DO_SYNC_DE_PRODUTOS } from '../../catalogo/importar';
import type { LinhaDoCatalogo } from '../../catalogo/ler-csv';
import { lerProdutosDoSync } from './formato';

type Client = SupabaseClient<Database>;

export type StatusDoSync = 'aplicado' | 'falhou' | 'formato_invalido' | 'recusado_por_seguranca';

export interface ResultadoDoSync {
  status: StatusDoSync;
  motivo?: string;
  gravados: number;
  desativados: number;
  problemas: string[];
  /** O `falhas` que o sistema deles mandou. Não vazio = lista parcial. */
  falhasDoErp: string[];
}

/** A partir de quantos produtos desativados de uma vez o sync desconfia. */
export const QUEDA_MAXIMA_PERCENTUAL = 0.3;
export const QUEDA_MAXIMA_ABSOLUTA = 10;

export const NOME_DA_IMPORTACAO = NOME_DO_SYNC_DE_PRODUTOS;

/** Nome de grupo comparável: sem acento, sem diferença de maiúscula nem de
 *  espaço repetido ("PERFIS U SIMPLES CH.  12" chega com dois). */
export function nomeComparavel(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

const semNada = (
  status: StatusDoSync, motivo: string, problemas: string[] = [], falhasDoErp: string[] = [],
): ResultadoDoSync => ({ status, motivo, gravados: 0, desativados: 0, problemas, falhasDoErp });

export async function sincronizarProdutos(
  supabase: Client,
  orgId: string,
  conexao: ConexaoComOErp,
  caminho: string,
): Promise<ResultadoDoSync> {
  const r = await chamarErp<unknown>(conexao, { metodo: 'GET', operacao: 'sync_produtos', caminho });
  if (!r.ok) return semNada('falhou', `${r.motivo}: ${r.codigo} — ${r.mensagem}`);

  const leitura = lerProdutosDoSync(r.dados);
  if (!leitura.ok) return semNada('formato_invalido', leitura.motivo);
  if (!leitura.itens.length) {
    return semNada('recusado_por_seguranca', 'A lista de produtos veio vazia.', leitura.problemas, leitura.falhasDoErp);
  }

  // Em páginas: sem isso o banco devolve só os primeiros 1000, e o produto
  // que ficasse de fora perderia o preço do CSV ao ser regravado.
  let noBanco: { codigo: string; descricao: string; unidade: string | null; preco: number | null; dados: unknown; ativo: boolean; grupo_id: string }[];
  let grupos: { id: string; codigo: string; nome: string }[];
  try {
    [noBanco, grupos] = await Promise.all([
      lerEmPaginas<typeof noBanco[number]>((de, ate) => supabase.from('catalogo_produtos')
        .select('codigo, descricao, unidade, preco, dados, ativo, grupo_id').eq('organization_id', orgId)
        .order('codigo').range(de, ate)),
      lerEmPaginas<typeof grupos[number]>((de, ate) => supabase.from('catalogo_grupos')
        .select('id, codigo, nome').eq('organization_id', orgId).order('codigo').range(de, ate)),
    ]);
  } catch (err) {
    return semNada('falhou', `Não consegui ler o catálogo atual: ${err instanceof Error ? err.message : String(err)}`);
  }

  const parcial = leitura.falhasDoErp.length > 0;

  const vistos = new Set([...leitura.itens.map(p => p.produto_id), ...leitura.idsIncompletos]);
  const ativos = (noBanco ?? []).filter(p => p.ativo);
  const desativaria = ativos.filter(p => !vistos.has(p.codigo)).length;
  if (!parcial && desativaria > QUEDA_MAXIMA_ABSOLUTA && desativaria > ativos.length * QUEDA_MAXIMA_PERCENTUAL) {
    return semNada('recusado_por_seguranca',
      `A lista desativaria ${desativaria} de ${ativos.length} produtos ativos de uma vez.`, leitura.problemas, leitura.falhasDoErp);
  }

  const grupoPorNome = new Map((grupos ?? []).map(g => [nomeComparavel(g.nome), g]));
  const grupoPorId = new Map((grupos ?? []).map(g => [g.id, g]));
  const existentePorCodigo = new Map((noBanco ?? []).map(p => [p.codigo, p]));
  const dadosComoTexto = (dados: unknown): Record<string, string> =>
    Object.fromEntries(Object.entries((dados ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]));

  const linhas: LinhaDoCatalogo[] = leitura.itens.map(p => {
    const grupo = grupoPorNome.get(nomeComparavel(p.grupo));
    const existente = existentePorCodigo.get(p.produto_id);
    return {
      codigo: p.produto_id,
      grupoCodigo: grupo?.codigo ?? p.grupo,
      grupoNome: grupo?.nome ?? p.grupo,
      descricao: p.descricao,
      unidade: p.unidade_venda,
      preco: existente?.preco ?? null,
      dados: {
        ...dadosComoTexto(existente?.dados),
        peso_kg: String(p.peso_kg),
        unidade_venda: p.unidade_venda,
        ...(p.empresas.length ? { empresas: p.empresas.join(', ') } : {}),
      },
    };
  });

  // O item incompleto que já existe entra como está no banco: é o jeito de a
  // importação, que desativa tudo o que não veio, não desativá-lo.
  for (const id of leitura.idsIncompletos) {
    const existente = existentePorCodigo.get(id);
    const grupo = existente?.grupo_id ? grupoPorId.get(existente.grupo_id) : undefined;
    if (!existente || !grupo) continue;
    linhas.push({
      codigo: id,
      grupoCodigo: grupo.codigo,
      grupoNome: grupo.nome,
      descricao: existente.descricao,
      unidade: existente.unidade,
      preco: existente.preco,
      dados: dadosComoTexto(existente.dados),
    });
  }

  try {
    const resumo = await importarCatalogo(supabase, orgId, linhas, NOME_DA_IMPORTACAO, !parcial);
    return {
      status: 'aplicado',
      gravados: leitura.itens.length,
      desativados: resumo.desativados,
      problemas: leitura.problemas,
      falhasDoErp: leitura.falhasDoErp,
    };
  } catch (err) {
    return semNada('falhou', err instanceof Error ? err.message : String(err), leitura.problemas, leitura.falhasDoErp);
  }
}

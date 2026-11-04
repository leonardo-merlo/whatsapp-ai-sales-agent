// O catálogo estruturado da v2 (Fase B): cada produto com família, medidas
// canônicas em colunas (v2_produto_medidas) e atributos lidos da descrição.
// `valoresValidos` é a v2_valores_validos: gerada do catálogo, nada manual.
//
// Ex.: `TUBO METALON 50X30X18` (grupo TUBOS QUAD. E RETANG. CH. 18) →
// família metalon, medidas lado 50, lado 30, chapa 18.

import { normalizarMedida } from './conversao';
import { familia, familiaDoProduto } from './familias';
import { formatar, lerValor, limparDescricao, numerosDoTexto } from './numeros';
import type { Familia, MedidaCanonica, ProdutoDoCatalogo, ProdutoV2 } from './tipos';

export interface FalhaDeLeitura { codigo: string; descricao: string; motivo: string }

export interface CatalogoV2 {
  produtos: ProdutoV2[];
  porCodigo: Map<string, ProdutoV2>;
  porFamilia: Map<string, ProdutoV2[]>;
  /** Produtos que não viraram medidas (ou não têm família). */
  falhas: FalhaDeLeitura[];
}

/** Atributos presentes na descrição: nome → valor. */
export function atributosDaDescricao(f: Familia, descricao: string): Record<string, string> {
  const desc = limparDescricao(descricao);
  const saida: Record<string, string> = {};
  for (const a of f.atributos ?? []) {
    for (const [valor, regex] of Object.entries(a.valores)) {
      if (new RegExp(regex).test(desc)) { saida[a.nome] = valor; break; }
    }
  }
  return saida;
}

/** As medidas canônicas de um produto pelo molde da família. */
export function medidasDoProduto(f: Familia, p: ProdutoDoCatalogo): { medidas: MedidaCanonica[]; erros: string[] } {
  const medidas: MedidaCanonica[] = [];
  const erros: string[] = [];
  if (f.medidas_da_descricao) {
    for (const n of numerosDoTexto(p.descricao.replace(/\(I\)/g, ''))) {
      const lido = lerValor(n);
      if (lido) medidas.push({ etiqueta: 'numero', valor: formatar(lido.valor) });
    }
    return { medidas, erros };
  }
  for (const m of f.medidas ?? []) {
    let bruto: string | undefined;
    if (m.coluna) bruto = p.medidas?.[m.coluna];
    else if (m.regex_descricao) bruto = limparDescricao(p.descricao).match(new RegExp(m.regex_descricao))?.[1];
    if (bruto === undefined || bruto === null || bruto === '') continue;
    const n = normalizarMedida(f, m, String(bruto), m.unidade === 'mm' ? 'mm' : null);
    if (n.valor === null) erros.push(`${m.etiqueta}: ${n.erro}`);
    else medidas.push({ etiqueta: m.etiqueta, valor: n.valor });
  }
  return { medidas, erros };
}

/**
 * Monta o catálogo da v2. `correcoes` troca família e medidas de códigos com
 * cadastro errado (v2_correcoes_cadastro), sem mudar a descrição do ERP.
 */
export function montarCatalogo(
  linhas: ProdutoDoCatalogo[],
  correcoes: { codigo: string; familia: string; medidas: MedidaCanonica[]; atributos?: Record<string, string> }[] = [],
): CatalogoV2 {
  const produtos: ProdutoV2[] = [];
  const falhas: FalhaDeLeitura[] = [];
  const corrigido = new Map(correcoes.map(c => [c.codigo, c]));
  for (const p of linhas) {
    const c = corrigido.get(p.codigo);
    if (c) {
      produtos.push({ codigo: p.codigo, descricao: p.descricao, familia: c.familia, medidas: c.medidas, atributos: c.atributos ?? {}, unidade: p.unidade, peso_kg: p.peso_kg ?? null, grupo: p.grupo });
      continue;
    }
    const f = familiaDoProduto(p.grupo, p.descricao);
    if (!f) { falhas.push({ codigo: p.codigo, descricao: p.descricao, motivo: `grupo sem família: ${p.grupo}` }); continue; }
    const { medidas, erros } = medidasDoProduto(f, p);
    const esperadas = (f.medidas ?? []).filter(m => !m.opcional && !m.ausente_por_padrao).length;
    const lidas = medidas.filter(m => (f.medidas ?? []).some(d => d.etiqueta === m.etiqueta && !d.opcional && !d.ausente_por_padrao)).length;
    if (erros.length) falhas.push({ codigo: p.codigo, descricao: p.descricao, motivo: erros.join('; ') });
    else if (!f.medidas_da_descricao && lidas < esperadas) {
      falhas.push({ codigo: p.codigo, descricao: p.descricao, motivo: `descrição não lida pelo molde (${lidas} de ${esperadas} medidas)` });
    }
    produtos.push({ codigo: p.codigo, descricao: p.descricao, familia: f.id, medidas, atributos: atributosDaDescricao(f, p.descricao), unidade: p.unidade, peso_kg: p.peso_kg ?? null, grupo: p.grupo });
  }
  const porFamilia = new Map<string, ProdutoV2[]>();
  for (const p of produtos) {
    if (!porFamilia.has(p.familia)) porFamilia.set(p.familia, []);
    porFamilia.get(p.familia)!.push(p);
  }
  return { produtos, porCodigo: new Map(produtos.map(p => [p.codigo, p])), porFamilia, falhas };
}

/** v2_valores_validos: (família, medida) → valores que existem no catálogo. */
export function valoresValidos(catalogo: CatalogoV2): Map<string, Map<string, Set<string>>> {
  const saida = new Map<string, Map<string, Set<string>>>();
  for (const p of catalogo.produtos) {
    if (!saida.has(p.familia)) saida.set(p.familia, new Map());
    const daFamilia = saida.get(p.familia)!;
    for (const m of p.medidas) {
      if (!daFamilia.has(m.etiqueta)) daFamilia.set(m.etiqueta, new Set());
      daFamilia.get(m.etiqueta)!.add(m.valor);
    }
  }
  return saida;
}

/** A descrição curta das medidas de um produto: "lado 50 · lado 30 · chapa 18". */
export function resumoDasMedidas(p: ProdutoV2): string {
  return p.medidas.map(m => `${m.etiqueta} ${m.valor}`).join(' · ');
}

export { familia };

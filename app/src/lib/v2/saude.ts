// A saúde de cada produto (v2_produto_saude) e a auditoria do catálogo.
//
// Produto `suspeito` nunca é resolvido sozinho: se for o único candidato, vira
// pergunta de confirmação. Nada depende da Distribuidora Exemplo corrigir o cadastro.
//
// Checagens:
//   peso: o do ERP contra o calculado pelas medidas (aço 7,85 kg/dm³). A unidade
//     do peso (kg/m, kg por peça de 6 m, 12 m...) é descoberta por família: vale a
//     hipótese que explica a maioria. Se nenhuma explica, a família fica fora;
//   descrição não lida pelo molde;
//   correção conhecida (v2_correcoes_cadastro) e códigos ME não confirmados;
//   gêmeos (mesma família, medidas e atributos) são LISTADOS, não postos em
//     quarentena: com dois candidatos iguais o resolvedor já pergunta sozinho.

import correcoesJson from './dados/correcoes-cadastro.json' with { type: 'json' };
import type { CatalogoV2 } from './catalogo';
import { CONVERSAO } from './conversao';
import { FAMILIAS } from './familias';
import { iguais, lerValor } from './numeros';
import type { Familia, MedidaCanonica, ProdutoV2, SaudeDoProduto } from './tipos';

export interface Correcao { id: string; codigo: string; familia: string; medidas: MedidaCanonica[]; rotulo: string }
// Correção inativada sai do catálogo e da quarentena: o código volta a ser o que o ERP diz (21/10: 702182).
export const CORRECOES: Correcao[] = (correcoesJson.correcoes as (Correcao & { status: string })[]).filter(c => c.status === 'ativa');

export const TOLERANCIA_DO_PESO = 0.15;
const DENSIDADE = 7.85e-3; // kg por mm² por metro
const POL = 25.4;

/** Espessura da chapa em mm: tabela do normalizador; "1.8" é 1,8 mm; fração é polegada. */
export function mmDaChapa(codigo: string): number | null {
  const tabela = CONVERSAO.tabelas.find(t => t.id === 'mm_para_chapa');
  const par = tabela?.pares.find(p => p[1] === codigo);
  if (par) return Number(par[0]);
  if (codigo === '1/4') return 6.3;
  const lido = lerValor(codigo);
  if (!lido) return null;
  if (lido.forma === 'fracao') return lido.valor * POL;
  if (lido.forma === 'decimal') return lido.valor;
  return null;
}

const valor = (p: ProdutoV2, etiqueta: string, n = 0): number | null => {
  const achados = p.medidas.filter(m => m.etiqueta === etiqueta);
  const v = achados[n] ? Number(achados[n].valor) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};
const chapaMm = (p: ProdutoV2): number | null => {
  const c = p.medidas.find(m => m.etiqueta === 'chapa');
  return c ? mmDaChapa(c.valor) : null;
};

/** kg por metro (ou por folha, na chapa) calculado pelas medidas. Null: sem dado para calcular. */
export function pesoCalculado(f: Familia, p: ProdutoV2): number | null {
  const formula = f.peso?.formula;
  if (!formula) return null;
  switch (formula) {
    case 'redondo_macico': { const d = valor(p, 'bitola'); return d ? Math.PI * d * d / 4 * DENSIDADE : null; }
    case 'quadrado_macico': { const a = valor(p, 'lado'); return a ? (a * POL) ** 2 * DENSIDADE : null; }
    case 'barra_retangular': {
      const w = valor(p, 'largura'); const t = valor(p, 'espessura');
      return w && t ? w * POL * t * POL * DENSIDADE : null;
    }
    case 'cantoneira': {
      const a = valor(p, 'aba'); const t = valor(p, 'espessura');
      return a && t ? t * POL * (2 * a * POL - t * POL) * DENSIDADE : null;
    }
    case 'tubo_retangular': {
      const a = valor(p, 'lado', 0); const b = valor(p, 'lado', 1); const t = chapaMm(p);
      return a && b && t ? (2 * t * (a + b) - 4 * t * t) * DENSIDADE : null;
    }
    case 'tubo_redondo': {
      const d = valor(p, 'diametro'); const t = chapaMm(p);
      return d && t ? Math.PI * t * (d * POL - t) * DENSIDADE : null;
    }
    case 'perfil_u': {
      const alma = valor(p, 'alma'); const aba = valor(p, 'aba'); const t = chapaMm(p);
      return alma && aba && t ? t * (alma + 2 * aba - 2 * t) * DENSIDADE : null;
    }
    case 'perfil_u_enrijecido': {
      const alma = valor(p, 'alma'); const aba = valor(p, 'aba'); const e = valor(p, 'enrijecimento') ?? 0; const t = chapaMm(p);
      return alma && aba && t ? t * (alma + 2 * aba + 2 * e - 4 * t) * DENSIDADE : null;
    }
    case 'chapa': {
      const t = chapaMm(p); const a = valor(p, 'dimensao', 0); const b = valor(p, 'dimensao', 1);
      return t && a && b ? t * a * b * 7.85 : null;
    }
  }
}

export interface HipoteseDePeso { familia: string; comprimento_m: number | null; explicados: number; total: number; descricao: string }

/** O peso do ERP na hipótese: kg por peça de L metros (comprimento do próprio produto quando ele tem). */
function esperado(f: Familia, p: ProdutoV2, porMetro: number, comprimento: number): number {
  if (f.peso?.formula === 'chapa') return porMetro;
  const proprio = valor(p, 'comprimento');
  return porMetro * (proprio && comprimento !== 1 ? proprio : comprimento);
}

/** Descobre, por família, a unidade do peso do ERP que explica a maioria dos produtos. */
export function hipotesesDePeso(catalogo: CatalogoV2): Map<string, HipoteseDePeso> {
  const saida = new Map<string, HipoteseDePeso>();
  for (const f of FAMILIAS) {
    if (!f.peso) continue;
    const produtos = (catalogo.porFamilia.get(f.id) ?? []).filter(p => p.peso_kg && pesoCalculado(f, p) !== null);
    if (!produtos.length) continue;
    const comprimentos = f.peso.formula === 'chapa' ? [1] : f.peso.comprimentos_m ?? [1];
    let melhor: HipoteseDePeso | null = null;
    for (const L of comprimentos) {
      const explicados = produtos.filter(p => {
        const e = esperado(f, p, pesoCalculado(f, p)!, L);
        return Math.abs(p.peso_kg! - e) / e <= TOLERANCIA_DO_PESO;
      }).length;
      const descricao = f.peso.formula === 'chapa' ? 'kg por folha' : L === 1 ? 'kg por metro' : `kg por peça de ${L} m`;
      if (!melhor || explicados > melhor.explicados) melhor = { familia: f.id, comprimento_m: L, explicados, total: produtos.length, descricao };
    }
    if (melhor && melhor.explicados * 2 <= melhor.total) melhor = { ...melhor, comprimento_m: null, descricao: `nenhuma hipótese explica a maioria (melhor: ${melhor.descricao}, ${melhor.explicados}/${melhor.total})` };
    if (melhor) saida.set(f.id, melhor);
  }
  return saida;
}

export interface Auditoria {
  saude: Map<string, SaudeDoProduto>;
  hipoteses: Map<string, HipoteseDePeso>;
  gemeos: ProdutoV2[][];
  divergencias: { codigo: string; descricao: string; erp: number; calculado: number; diferenca: number }[];
}

export function auditarCatalogo(catalogo: CatalogoV2): Auditoria {
  const saude = new Map<string, SaudeDoProduto>();
  const marcar = (codigo: string, motivo: string, suspeito: boolean): void => {
    const s = saude.get(codigo) ?? { codigo, status: 'ok' as const, motivos: [] };
    s.motivos.push(motivo);
    if (suspeito) s.status = 'suspeito';
    saude.set(codigo, s);
  };
  for (const p of catalogo.produtos) saude.set(p.codigo, { codigo: p.codigo, status: 'ok', motivos: [] });

  for (const falha of catalogo.falhas) marcar(falha.codigo, `descrição não lida: ${falha.motivo}`, true);
  for (const c of CORRECOES) if (catalogo.porCodigo.has(c.codigo)) marcar(c.codigo, `cadastro com descrição errada; é ${c.rotulo} (${c.id})`, true);
  for (const p of catalogo.porFamilia.get('perfil_medida_especial') ?? []) {
    if (!CORRECOES.some(c => c.codigo === p.codigo)) marcar(p.codigo, 'código ME: nome no cadastro errado, não confirmado pelo vendedor (regras.md, 30/09)', true);
  }

  const hipoteses = hipotesesDePeso(catalogo);
  const divergencias: Auditoria['divergencias'] = [];
  for (const f of FAMILIAS) {
    const h = hipoteses.get(f.id);
    if (!h || h.comprimento_m === null) continue;
    for (const p of catalogo.porFamilia.get(f.id) ?? []) {
      const porMetro = pesoCalculado(f, p);
      if (!p.peso_kg || porMetro === null) continue;
      const e = esperado(f, p, porMetro, h.comprimento_m);
      const diferenca = (p.peso_kg - e) / e;
      if (Math.abs(diferenca) > TOLERANCIA_DO_PESO) {
        divergencias.push({ codigo: p.codigo, descricao: p.descricao, erp: p.peso_kg, calculado: Math.round(e * 100) / 100, diferenca });
        marcar(p.codigo, `peso do ERP ${p.peso_kg} kg x calculado ${e.toFixed(2)} kg (${(diferenca * 100).toFixed(0)}%, ${h.descricao})`, true);
      }
    }
  }

  const chave = (p: ProdutoV2): string => `${p.familia}|${[...p.medidas].map(m => `${m.etiqueta}=${m.valor}`).sort().join(',')}|${Object.entries(p.atributos).sort().map(e => e.join('=')).join(',')}`;
  const grupos = new Map<string, ProdutoV2[]>();
  const porDescricao = new Set(FAMILIAS.filter(f => f.medidas_da_descricao).map(f => f.id));
  for (const p of catalogo.produtos) {
    // Família sem molde se distingue pelas palavras da descrição, não pelos números.
    if (porDescricao.has(p.familia) || (!p.medidas.length && !Object.keys(p.atributos).length)) continue;
    const k = chave(p);
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k)!.push(p);
  }
  const gemeos = [...grupos.values()].filter(g => g.length > 1);
  for (const g of gemeos) for (const p of g) marcar(p.codigo, `gêmeo de ${g.filter(x => x !== p).map(x => x.codigo).join(', ')} (mesmas medidas lidas)`, false);

  return { saude, hipoteses, gemeos, divergencias };
}

export { iguais };

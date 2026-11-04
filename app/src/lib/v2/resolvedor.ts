// O resolvedor (Fase E): decide, sem IA, o que fazer com um item que a IA
// etiquetou. A IA não escolhe código; ela devolve família, medidas copiadas e
// qualificadores, e aqui o código:
//
//   1. normaliza as medidas para a unidade da família (conversao.ts);
//   2. aplica não vende, correções de cadastro e perguntas obrigatórias;
//   3. busca os candidatos: família + todas as medidas explícitas (ordem
//      livre quando o molde deixa) + os atributos que o cliente disse;
//   4. com mais de um, aplica os padrões de escopo exato;
//   5. testa outras leituras (quantidade ↔ medida, medidas trocadas): se
//      outra leitura também dá produto, o item é ambíguo;
//   6. confere as 7 travas. Só com todas passando o item sai `resolvido`.
//
// Ex.: "10 metalon 50x30x18" → família metalon, lados 50 e 30, chapa 18 →
// um candidato (700154) → resolvido, se a família estiver liberada; senão,
// confirmar com o cliente.

import { CONVERSAO, normalizarMedida } from './conversao';
import { familiaDoTexto, lerQualificador } from './dicionario';
import { FAMILIAS, familia as familiaPorId } from './familias';
import { formatar, lerValor, limpar, limparDescricao } from './numeros';
import { FAMILIAS_LIBERADAS, NAO_VENDE, OBRIGATORIO_PERGUNTAR, PADROES, type FiltroDeOpcao, type Padrao } from './regras';
import type { CatalogoV2 } from './catalogo';
import { CORRECOES, mmDaChapa } from './saude';
import type {
  Candidato, Conferencia, Familia, ItemExtraido, MedidaCanonica, MedidaDoMolde, ProdutoV2, ResultadoResolucao,
  SaudeDoProduto, Travas, ValorResolvido,
} from './tipos';

/** Acima disso, a pergunta é pelo atributo que separa, não produto por produto. */
export const MAX_OPCOES = 4;
const MAX_PROXIMOS = 3;

export interface ContextoDoResolvedor {
  catalogo: CatalogoV2;
  saude: Map<string, SaudeDoProduto>;
  /** Default: dados/familias-liberadas.json. A bancada passa todas para medir o potencial. */
  liberadas?: string[];
  /** O texto da linha do cliente (dicionário da trava 1 e regras com texto). */
  textoOriginal: string;
  /** Resultado das conferências da Fase D para este item. */
  conferencias?: Conferencia[];
  /** Só o pedaço deste item, quando a linha tem vários sem separador (áudio). A gíria que corrige a família olha só ele. */
  textoDoItem?: string;
  /** Uso interno: já é a leitura noutra família, não tenta outras de novo. */
  semAlternativas?: boolean;
}

/** Uma medida do item depois da normalização. */
export interface MedidaDoItem extends MedidaCanonica {
  bruto: string;
  origem: 'cliente' | 'conversao';
  regras: string[];
  /** A etiqueta da IA não existe no molde: a medida casa com qualquer etiqueta da mesma unidade. */
  etiquetaLivre?: boolean;
}

// ── medidas ──

function definicaoDaMedida(f: Familia, etiqueta: string): MedidaDoMolde | undefined {
  return f.medidas?.find(m => m.etiqueta === etiqueta);
}

/**
 * "4 metros e meio" e "4 e meio metros" viram "4.5 metros". Teste de 20/10: a
 * IA copiou "4 metros e meio" inteiro como valor, nada leu o número e a telha
 * de 4,5 m (701946) foi para o vendedor.
 */
export function juntarMeio(valor: string): string {
  const t = limpar(valor);
  const unidadeNoMeio = t.match(/^(\d+)\s*(m|mt|mts|metros?|cm|mm|polegadas?|pol)\.?\s+e\s+meio$/);
  if (unidadeNoMeio) return `${unidadeNoMeio[1]}.5 ${unidadeNoMeio[2]}`;
  const unidadeNoFim = t.match(/^(\d+)\s+e\s+meio\s+(m|mt|mts|metros?|cm|mm|polegadas?|pol)\.?$/);
  if (unidadeNoFim) return `${unidadeNoFim[1]}.5 ${unidadeNoFim[2]}`;
  return valor;
}

export function normalizarMedidasDoItem(f: Familia, item: ItemExtraido): { medidas: MedidaDoItem[]; erros: string[] } {
  const medidas: MedidaDoItem[] = [];
  const erros: string[] = [];
  for (const extraida of item.medidas) {
    const m = { ...extraida, valor: juntarMeio(extraida.valor) };
    if (f.medidas_da_descricao) {
      const lido = lerValor(m.valor);
      if (lido) medidas.push({ etiqueta: 'numero', valor: formatar(lido.valor), bruto: m.valor, origem: 'cliente', regras: [] });
      else erros.push(`"${m.valor}" não é um número`);
      continue;
    }
    const def = definicaoDaMedida(f, m.etiqueta);
    if (def) {
      const n = normalizarMedida(f, def, m.valor, m.unidade_escrita);
      if (n.valor === null) erros.push(`${m.etiqueta} "${m.valor}": ${n.erro}`);
      else medidas.push({ etiqueta: m.etiqueta, valor: n.valor, bruto: m.valor, origem: n.regras.length ? 'conversao' : 'cliente', regras: n.regras });
      continue;
    }
    // Etiqueta fora do molde: tenta as medidas do molde na ordem; a conferência de molde já registrou a falha.
    const tentativa = (f.medidas ?? []).map(d => ({ d, n: normalizarMedida(f, d, m.valor, m.unidade_escrita) })).find(x => x.n.valor !== null);
    if (tentativa) medidas.push({ etiqueta: tentativa.d.etiqueta, valor: tentativa.n.valor!, bruto: m.valor, origem: 'cliente', regras: tentativa.n.regras, etiquetaLivre: true });
    else erros.push(`etiqueta "${m.etiqueta}" não existe em ${f.id} e "${m.valor}" não converte`);
  }
  // A mesma medida duas vezes ("6,3mm (1/4)" dá 6.3 e 6.3): fica uma.
  const unicas = medidas.filter((m, i) => {
    const repetida = medidas.findIndex(x => x.etiqueta === m.etiqueta && x.valor === m.valor) !== i;
    const cabe = (f.medidas ?? []).filter(d => d.etiqueta === m.etiqueta).length;
    return !(repetida && medidas.filter(x => x.etiqueta === m.etiqueta).length > cabe);
  });
  // Molde com UMA medida dessa etiqueta e a IA mandou duas, "4" e "1/2": é 4 1/2 (disco 4"1/2).
  // Barra chata e cantoneira têm duas medidas: lá "1" 1/4" continua sendo 1 x 1/4.
  for (const d of f.medidas ?? []) {
    if ((f.medidas ?? []).filter(x => x.etiqueta === d.etiqueta).length !== 1) continue;
    const doItem = unicas.filter(m => m.etiqueta === d.etiqueta);
    if (doItem.length !== 2) continue;
    const [a, b] = doItem.map(m => lerValor(m.bruto));
    if (a?.forma === 'inteiro' && b?.forma === 'fracao' && b.valor < 1) {
      const junto = normalizarMedida(f, d, `${a.texto} ${b.texto}`, d.unidade === 'pol' ? '"' : null);
      if (junto.valor !== null) {
        unicas.splice(unicas.indexOf(doItem[1]), 1);
        doItem[0].valor = junto.valor;
        doItem[0].bruto = `${doItem[0].bruto} ${doItem[1].bruto}`;
      }
    }
  }
  return { medidas: unicas, erros };
}

/** Grupo de ordem livre de uma etiqueta (ou a própria etiqueta). */
function grupoDe(f: Familia, etiqueta: string): string {
  return f.medidas?.find(m => m.etiqueta === etiqueta)?.ordem_livre ?? etiqueta;
}

interface Casamento { casa: boolean; trocada: boolean; casadas: number }

/** As medidas do item estão todas no produto? (cada medida do produto serve a uma só) */
export function casarMedidas(f: Familia, p: ProdutoV2, medidas: MedidaCanonica[]): Casamento {
  const livres = [...p.medidas];
  let trocada = false;
  let casadas = 0;
  for (const m of medidas) {
    const mesmaEtiqueta = livres.findIndex(x => x.etiqueta === m.etiqueta && x.valor === m.valor);
    if (mesmaEtiqueta >= 0) { livres.splice(mesmaEtiqueta, 1); casadas++; continue; }
    const grupo = grupoDe(f, m.etiqueta);
    const outra = livres.findIndex(x => x.valor === m.valor && (f.medidas_da_descricao || (grupoDe(f, x.etiqueta) === grupo && x.etiqueta !== m.etiqueta && grupo !== m.etiqueta)));
    if (outra >= 0) { livres.splice(outra, 1); casadas++; trocada = true; continue; }
    return { casa: false, trocada, casadas };
  }
  return { casa: true, trocada, casadas };
}

// ── atributos e palavras ──

interface Qualificadores {
  atributos: Record<string, string>;
  naoReconhecidos: string[];
  ignorados: string[];
  /** Palavras de família sem molde, que filtram pela descrição. */
  palavras: string[];
}

const raiz = (p: string): string => p.replace(/(?:oes|aes|es|as|os|s)$/, '');

function lerQualificadores(f: Familia, item: ItemExtraido): Qualificadores {
  const q: Qualificadores = { atributos: {}, naoReconhecidos: [], ignorados: [], palavras: [] };
  for (const texto of item.qualificadores) {
    const lido = lerQualificador(f.id, texto);
    if (lido.atributo && lido.valor) q.atributos[lido.atributo] = lido.valor;
    else if (lido.ignorado) q.ignorados.push(texto);
    else if (f.medidas_da_descricao) q.palavras.push(texto);
    else q.naoReconhecidos.push(texto);
  }
  return q;
}

function temPalavras(p: ProdutoV2, palavras: string[]): boolean {
  const desc = new Set(limpar(p.descricao).split(/[^a-z0-9]+/).filter(Boolean).map(raiz));
  return palavras.every(w => limpar(w).split(/[^a-z0-9]+/).filter(x => x.length >= 2).every(x => desc.has(raiz(x))));
}

// ── busca ──

interface Busca { candidatos: ProdutoV2[]; trocada: boolean }

function buscar(f: Familia, catalogo: CatalogoV2, medidas: MedidaCanonica[], atributos: Record<string, string>, palavras: string[]): Busca {
  let trocada = false;
  const candidatos = (catalogo.porFamilia.get(f.id) ?? []).filter(p => {
    const c = casarMedidas(f, p, medidas);
    if (!c.casa) return false;
    for (const [a, v] of Object.entries(atributos)) if (p.atributos[a] !== v) return false;
    if (palavras.length && !temPalavras(p, palavras)) return false;
    if (c.trocada) trocada = true;
    return true;
  });
  return { candidatos, trocada };
}

/** Valor de uma medida como número comparável (chapa vira a espessura em mm). */
function comoNumero(etiqueta: string, valor: string): number | null {
  if (etiqueta === 'chapa') return mmDaChapa(valor);
  const v = lerValor(valor)?.valor;
  return v === undefined ? null : v;
}

/**
 * Os mais próximos quando nada bate, para OFERECER (nunca escolher): cada
 * medida pedida contra a mais perto do produto, no mesmo grupo, pela diferença
 * relativa. Atributo pedido que o produto não tem pesa; atributo "ausente por
 * padrão" que o produto tem, e o cliente não pediu, pesa um pouco.
 * Ex.: calha de 5,5 m → as de 6 m; metalon 80x80 ch 18 → o 80x80 ch 14.
 */
function maisProximos(f: Familia, catalogo: CatalogoV2, medidas: MedidaCanonica[], atributos: Record<string, string>): ProdutoV2[] {
  if (!medidas.length) return [];
  const daFamilia = catalogo.porFamilia.get(f.id) ?? [];
  const distancia = (p: ProdutoV2): number => {
    let total = 0;
    const livres = [...p.medidas];
    for (const m of medidas) {
      const alvo = comoNumero(m.etiqueta, m.valor);
      let melhor = -1;
      let menor = 1;
      livres.forEach((x, i) => {
        if (grupoDe(f, x.etiqueta) !== grupoDe(f, m.etiqueta)) return;
        if (x.valor === m.valor) { if (menor > 0) { menor = 0; melhor = i; } return; }
        const v = comoNumero(x.etiqueta, x.valor);
        if (alvo === null || v === null) return;
        const d = Math.abs(alvo - v) / Math.max(alvo, v, 1e-9);
        if (d < menor) { menor = d; melhor = i; }
      });
      total += menor;
      if (melhor >= 0) livres.splice(melhor, 1);
    }
    for (const [a, v] of Object.entries(atributos)) if (p.atributos[a] !== v) total += 0.5;
    for (const a of f.atributos ?? []) if (a.ausente_por_padrao && !atributos[a.nome] && p.atributos[a.nome]) total += 0.2;
    return total;
  };
  const avaliados = daFamilia.map(p => ({ p, d: distancia(p) })).filter(x => x.d < medidas.length * 0.5).sort((a, b) => a.d - b.d || a.p.codigo.localeCompare(b.p.codigo));
  return avaliados.slice(0, MAX_PROXIMOS).map(x => x.p);
}

// ── padrões ──

interface Reducao { candidatos: ProdutoV2[]; regras: string[]; medidasDoPadrao: MedidaCanonica[] }

function informouEtiqueta(medidas: MedidaCanonica[], etiqueta: string): boolean {
  return medidas.some(m => m.etiqueta === etiqueta);
}

/** Atributo ou medida "ausente por padrão": sem o cliente dizer, ficam os produtos sem ela. */
function aplicarAusentes(f: Familia, candidatos: ProdutoV2[], medidas: MedidaCanonica[], atributos: Record<string, string>): Reducao {
  let lista = candidatos;
  const regras: string[] = [];
  for (const a of f.atributos ?? []) {
    if (!a.ausente_por_padrao || atributos[a.nome]) continue;
    const sem = lista.filter(p => !p.atributos[a.nome]);
    if (sem.length && sem.length < lista.length) { lista = sem; regras.push(a.ausente_por_padrao); }
  }
  for (const m of f.medidas ?? []) {
    if (!m.ausente_por_padrao || informouEtiqueta(medidas, m.etiqueta)) continue;
    const sem = lista.filter(p => !informouEtiqueta(p.medidas, m.etiqueta));
    if (sem.length && sem.length < lista.length) { lista = sem; regras.push(m.ausente_por_padrao); }
  }
  return { candidatos: lista, regras: [...new Set(regras)], medidasDoPadrao: [] };
}

const iguaisComoMulticonjunto = (a: string[], b: string[]): boolean => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

/** O escopo do padrão casa EXATAMENTE com o item? */
export function escopoCasa(p: Padrao, familiaId: string, medidas: MedidaCanonica[], atributos: Record<string, string>, texto: string): boolean {
  const e = p.escopo;
  if (e.familia && e.familia !== familiaId) return false;
  if (e.familias && !e.familias.includes(familiaId)) return false;
  if (e.valores && !iguaisComoMulticonjunto(e.valores, medidas.map(m => m.valor))) return false;
  if (e.medidas_informadas !== undefined && medidas.length !== e.medidas_informadas) return false;
  if (e.etiquetas_informadas && !iguaisComoMulticonjunto(e.etiquetas_informadas, medidas.map(m => m.etiqueta))) return false;
  for (const [a, v] of Object.entries(e.atributos_presentes ?? {})) if (atributos[a] !== v) return false;
  for (const a of e.atributos_ausentes ?? []) if (atributos[a]) return false;
  if (e.texto && !new RegExp(e.texto).test(limpar(texto))) return false;
  return true;
}

/** Sem (I), EXTRA e espaços: duas descrições iguais assim são o mesmo produto. */
const descricaoBase = (d: string): string => limparDescricao(d).replace(/\(I\)|\bEXTRA\b|-/g, '').replace(/\s+/g, ' ').trim();

function aplicarPadroes(candidatos: ProdutoV2[], familiaId: string, medidas: MedidaCanonica[], atributos: Record<string, string>, texto: string): Reducao {
  let lista = candidatos;
  const regras: string[] = [];
  const medidasDoPadrao: MedidaCanonica[] = [];
  for (const p of PADROES) {
    if (lista.length <= 1) break;
    if (p.escopo.gemeos_de_descricao) {
      // Teste de campo de 21/10: dois códigos do mesmo disco apareceram como duas opções. Cada produto
      // fica com o primeiro código, mesmo quando a lista tem outros produtos além dos gêmeos.
      const grupos = new Map<string, ProdutoV2[]>();
      for (const c of lista) grupos.set(descricaoBase(c.descricao), [...(grupos.get(descricaoBase(c.descricao)) ?? []), c]);
      if ([...grupos.values()].some(g => g.length > 1)) {
        lista = [...grupos.values()].map(g => [...g].sort((x, y) => x.codigo.localeCompare(y.codigo))[0]);
        regras.push(p.id);
      }
      continue;
    }
    if (!escopoCasa(p, familiaId, medidas, atributos, texto)) continue;
    let filtrada = lista;
    if (p.resultado.codigo) filtrada = lista.filter(c => c.codigo === p.resultado.codigo);
    if (p.resultado.atributos) filtrada = filtrada.filter(c => Object.entries(p.resultado.atributos!).every(([a, v]) => c.atributos[a] === v));
    if (p.resultado.medidas) {
      const f = familiaPorId(familiaId)!;
      filtrada = filtrada.filter(c => casarMedidas(f, c, p.resultado.medidas!).casa);
    }
    if (filtrada.length && filtrada.length < lista.length) {
      lista = filtrada;
      regras.push(p.id);
      medidasDoPadrao.push(...(p.resultado.medidas ?? []));
    }
  }
  return { candidatos: lista, regras, medidasDoPadrao };
}

// ── perguntas ──

function diferencaEntre(f: Familia, candidatos: ProdutoV2[]): { atributo: string | null; diferencas: Map<string, string> } {
  const diferencas = new Map<string, string>();
  const etiquetas = [...new Set(candidatos.flatMap(p => p.medidas.map(m => m.etiqueta)))];
  const atributos = [...new Set(candidatos.flatMap(p => Object.keys(p.atributos)).concat((f.atributos ?? []).map(a => a.nome)))];
  const valoresDe = (p: ProdutoV2, e: string): string => p.medidas.filter(m => m.etiqueta === e).map(m => m.valor).sort().join(' x ');
  const separaE = etiquetas.filter(e => new Set(candidatos.map(p => valoresDe(p, e))).size > 1);
  const separaA = atributos.filter(a => new Set(candidatos.map(p => p.atributos[a] ?? '')).size > 1);
  for (const p of candidatos) {
    const partes = [...separaE.map(e => `${e} ${valoresDe(p, e) || '—'}`), ...separaA.map(a => `${a.replace(/_/g, ' ')} ${p.atributos[a]?.replace(/_/g, ' ') ?? 'comum'}`)];
    diferencas.set(p.codigo, partes.join(', ') || 'mesma medida (códigos diferentes)');
  }
  return { atributo: separaE[0] ?? separaA[0] ?? null, diferencas };
}

function candidatosComDiferenca(f: Familia, lista: ProdutoV2[]): { candidatos: Candidato[]; atributo: string | null } {
  const { atributo, diferencas } = diferencaEntre(f, lista);
  return { candidatos: lista.map(p => ({ codigo: p.codigo, descricao: rotulo(p), diferenca: diferencas.get(p.codigo) ?? '' })), atributo };
}

/** O nome que o cliente vê: a descrição do ERP, ou a corrigida quando o cadastro está errado. */
export function rotulo(p: ProdutoV2): string {
  return CORRECOES.find(c => c.codigo === p.codigo)?.rotulo ?? p.descricao;
}

function opcoesPorAtributo(f: Familia, lista: ProdutoV2[], atributo: string): { rotulo: string; codigos: string[] }[] {
  const ehMedida = (f.medidas ?? []).some(m => m.etiqueta === atributo);
  const grupos = new Map<string, string[]>();
  for (const p of lista) {
    const valor = ehMedida ? p.medidas.filter(m => m.etiqueta === atributo).map(m => m.valor).join(' x ') : (p.atributos[atributo] ?? 'comum');
    if (!grupos.has(valor)) grupos.set(valor, []);
    grupos.get(valor)!.push(p.codigo);
  }
  // Prego se pede por 17x21 e ninguém diz "bitola" (Vendedor 1, 22/10): a opção mostra as medidas inteiras.
  if (f.id === 'prego' && atributo === 'bitola') {
    return [...grupos.entries()].map(([valor, codigos]) => {
      const inteiras = [...new Set(lista.filter(p => codigos.includes(p.codigo)).map(p => p.medidas.find(m => m.etiqueta === 'comprimento')?.valor).filter((c): c is string => !!c))];
      const mostradas = inteiras.slice(0, 4).map(c => `${valor}x${c}`).join(', ');
      return { rotulo: mostradas ? `${valor} (${mostradas}${inteiras.length > 4 ? '...' : ''})` : valor, codigos };
    });
  }
  return [...grupos.entries()].map(([valor, codigos]) => ({ rotulo: `${atributo.replace(/_/g, ' ')} ${valor.replace(/_/g, ' ')}`, codigos }));
}

function filtrar(lista: ProdutoV2[], filtro: FiltroDeOpcao, outra: ProdutoV2[], f: Familia): ProdutoV2[] {
  let r = filtro.familia ? outra : lista;
  if (filtro.codigos) r = r.filter(p => filtro.codigos!.includes(p.codigo));
  if (filtro.atributos) r = r.filter(p => Object.entries(filtro.atributos!).every(([a, v]) => p.atributos[a] === v));
  if (filtro.medidas) r = r.filter(p => casarMedidas(f, p, Object.entries(filtro.medidas!).map(([etiqueta, valor]) => ({ etiqueta, valor }))).casa);
  return r;
}

// ── quantidade ──

const UNIDADES_ESCRITAS: [RegExp, 'kg' | 'peca' | 'rolo' | 'caixa' | 'metro' | 'lata'][] = [
  [/\b(?:kg|k|kgs|quilos?|kilos?)\b|\d\s*k\b/, 'kg'],
  [/\b(?:un|und|unid|unidades?|pc|pcs|pecas?|barras?|varas?|vergas?|br|chapas?|telhas?)\b/, 'peca'],
  [/\brolos?\b|\brl\b/, 'rolo'],
  [/\b(?:cx|caixas?)\b/, 'caixa'],
  [/\blatas?\b|\bgaloes?\b|\bgl\b/, 'lata'],
];

/** A unidade do ERP (catalogo_produtos.unidade) na língua da quantidade escrita. */
const UNIDADE_DO_ERP: Record<string, 'kg' | 'peca' | 'rolo' | 'caixa' | 'metro' | 'lata'> = {
  KG: 'kg', UN: 'peca', P: 'peca', PC: 'peca', PN: 'peca', CH: 'peca', VR: 'peca', FX: 'peca', SC: 'peca',
  RL: 'rolo', CT: 'caixa', LT: 'lata', GL: 'lata', MT: 'metro',
};

/**
 * Trava 7: a quantidade é um número dentro da faixa da família e, quando o
 * cliente escreveu a unidade, ela é a do produto (do ERP; sem produto único,
 * a da família). "10 kg" de metalon, que é vendido por peça, confirma.
 */
export function checarQuantidade(f: Familia, quantidade: ItemExtraido['quantidade'], unidadeDoProduto?: string | null, descricaoDoProduto?: string | null): { ok: boolean; falta: boolean; motivo: string | null } {
  if (!quantidade || !quantidade.valor) return { ok: true, falta: true, motivo: null };
  const n = lerValor(quantidade.valor)?.valor;
  if (n === undefined || !Number.isFinite(n)) return { ok: false, falta: false, motivo: `quantidade "${quantidade.valor}" não é número` };
  const [min, max] = f.faixa_quantidade;
  if (n < min || n > max) return { ok: false, falta: false, motivo: `quantidade ${n} fora da faixa de ${f.id} (${min} a ${max})` };
  const t = limpar(quantidade.trecho);
  const escrita = UNIDADES_ESCRITAS.find(([r]) => r.test(t))?.[1];
  const vendida = (unidadeDoProduto && UNIDADE_DO_ERP[unidadeDoProduto.toUpperCase()]) || f.unidade_venda;
  // Rolo de arame de 1 kg (trançado, rolinho): kg e rolo são a mesma conta (dicionario.md §1).
  const roloDeUmQuilo = f.id === 'arame' && vendida === 'rolo' && escrita === 'kg' && !!descricaoDoProduto && /TRANCADO|ROLINHO|R1KG/.test(descricaoDoProduto);
  if (escrita && escrita !== vendida && !roloDeUmQuilo) return { ok: false, falta: false, motivo: `quantidade em ${escrita} num produto vendido por ${vendida}` };
  return { ok: true, falta: false, motivo: null };
}

// ── o resolvedor ──

const TRAVAS_ABERTAS: Travas = { familia: false, conferencias: false, termos: false, unico: false, cadastro: false, familia_liberada: false, quantidade: false };

/** Opções com o mesmo rótulo e um código só cada são o mesmo produto com dois códigos: fica o menor (teste de 21/10: "D.CORTE NORTON 4.1/2 X 7/8 STANDARD" duas vezes). */
export function semOpcoesRepetidas(opcoes: ResultadoResolucao['opcoes']): ResultadoResolucao['opcoes'] {
  const vistas = new Map<string, ResultadoResolucao['opcoes'][number]>();
  const saida: ResultadoResolucao['opcoes'] = [];
  for (const o of opcoes) {
    const anterior = vistas.get(o.rotulo);
    if (!anterior) { vistas.set(o.rotulo, o); saida.push(o); continue; }
    if (anterior.codigos.length === 1 && o.codigos.length === 1 && o.codigos[0] < anterior.codigos[0]) anterior.codigos = o.codigos;
    else if (anterior.codigos.length !== 1 || o.codigos.length !== 1) saida.push(o);
  }
  return saida;
}

function resultado(status: ResultadoResolucao['status'], motivo: string, extra: Partial<ResultadoResolucao> = {}): ResultadoResolucao {
  return { status, codigo: null, candidatos: [], atributo_a_perguntar: null, opcoes: [], medidas: {}, regras_aplicadas: [], travas: { ...TRAVAS_ABERTAS }, motivo, ...extra, ...(extra.opcoes ? { opcoes: semOpcoesRepetidas(extra.opcoes) } : {}) };
}

function medidasResolvidas(medidas: MedidaDoItem[], doPadrao: MedidaCanonica[], regrasDoPadrao: string[], produto: ProdutoV2 | null): Record<string, ValorResolvido> {
  const saida: Record<string, ValorResolvido> = {};
  const chave = (e: string): string => { let k = e; let i = 2; while (saida[k]) k = `${e}_${i++}`; return k; };
  for (const m of medidas) saida[chave(m.etiqueta)] = { valor: m.valor, origem: m.origem, ...(m.regras[0] ? { regra_id: m.regras[0] } : {}) };
  for (const m of doPadrao) if (!medidas.some(x => x.etiqueta === m.etiqueta && x.valor === m.valor)) saida[chave(m.etiqueta)] = { valor: m.valor, origem: 'padrao', regra_id: regrasDoPadrao[0] };
  if (produto) {
    const usadas = [...medidas, ...doPadrao];
    for (const m of produto.medidas) {
      const i = usadas.findIndex(u => u.valor === m.valor);
      if (i >= 0) { usadas.splice(i, 1); continue; }
      saida[chave(m.etiqueta)] = { valor: m.valor, origem: 'padrao', ...(regrasDoPadrao[0] ? { regra_id: regrasDoPadrao[0] } : {}) };
    }
  }
  return saida;
}

/** Busca + ausentes + padrões: o miolo, reaproveitado pelo teste de troca de etiquetas. */
function reduzir(f: Familia, ctx: ContextoDoResolvedor, medidas: MedidaCanonica[], q: Qualificadores): { busca: Busca; reducao: Reducao } {
  const busca = buscar(f, ctx.catalogo, medidas, q.atributos, q.palavras);
  if (busca.candidatos.length <= 1) return { busca, reducao: { candidatos: busca.candidatos, regras: [], medidasDoPadrao: [] } };
  const ausentes = aplicarAusentes(f, busca.candidatos, medidas, q.atributos);
  const padroes = aplicarPadroes(ausentes.candidatos, f.id, medidas, q.atributos, `${ctx.textoOriginal} ${[...q.ignorados, ...q.palavras].join(' ')}`);
  // Depois das regras do vendedor, a medida no lugar que o cliente disse vale mais que a troca de lugar: "perfil de 50 na
  // 2mm" é o 50X25X14 (alma 50), não os seis de aba 50, e "perfil de 75 enrijecido" é o 75X40, não o 200X75 (áudio de
  // 25/10 à noite). Só sem nenhum assim a troca entra.
  const noLugar = padroes.candidatos.filter(p => !casarMedidas(f, p, medidas).trocada);
  const preferiu = noLugar.length > 0 && noLugar.length < padroes.candidatos.length;
  return {
    busca: preferiu ? { ...busca, trocada: false } : busca,
    reducao: {
      candidatos: preferiu ? noLugar : padroes.candidatos,
      regras: [...ausentes.regras, ...padroes.regras, ...(preferiu ? ['medida_no_lugar_dito'] : [])],
      medidasDoPadrao: padroes.medidasDoPadrao,
    },
  };
}

/**
 * Quantidade e medida podem trocar de papel? Só quando nada no texto separa
 * as duas: se a palavra do produto fica entre elas ("4 discos 7"), a posição
 * já diz quem é quem. Sem achar os dois números no texto, não há como trocar.
 */
export function trocaPlausivel(texto: string, trechoDaQuantidade: string, trechoDaMedida: string): boolean {
  const t = limpar(texto);
  const iq = t.indexOf(limpar(trechoDaQuantidade));
  const im = t.indexOf(limpar(trechoDaMedida));
  if (iq < 0 || im < 0 || !trechoDaQuantidade.trim() || !trechoDaMedida.trim()) return false;
  const [de, ate] = iq < im ? [iq, im] : [im, iq];
  const entre = t.slice(de, ate);
  return !/[a-z]{3,}/.test(entre.replace(/\b(?:de|da|do|com|por|mm|cm|ch|un|kg|pol|mts?)\b/g, ''));
}

/**
 * Só quando nada foi achado: cada medida lida com uma etiqueta do molde que o
 * item não usou ("75X40X17" lido como chapa 17 → enrijecimento 17).
 */
function etiquetasNaoUsadas(f: Familia, medidas: MedidaDoItem[]): { medidas: MedidaCanonica[]; descricao: string }[] {
  const leituras: { medidas: MedidaCanonica[]; descricao: string }[] = [];
  const usadas = new Set(medidas.map(m => m.etiqueta));
  for (const [i, m] of medidas.entries()) {
    for (const d of f.medidas ?? []) {
      if (usadas.has(d.etiqueta)) continue;
      const v = normalizarMedida(f, d, m.bruto, null).valor;
      if (v === null) continue;
      leituras.push({ medidas: medidas.map((x, k) => (k === i ? { etiqueta: d.etiqueta, valor: v } : { etiqueta: x.etiqueta, valor: x.valor })), descricao: `${m.bruto} como ${d.etiqueta}` });
    }
  }
  return leituras;
}

/** Outras leituras do mesmo item: quantidade ↔ medida e medidas de etiquetas trocadas. */
function outrasLeituras(f: Familia, item: ItemExtraido, medidas: MedidaDoItem[], texto: string): { medidas: MedidaCanonica[]; descricao: string }[] {
  const leituras: { medidas: MedidaCanonica[]; descricao: string }[] = [];
  const qtd = item.quantidade?.valor ? lerValor(item.quantidade.valor) : null;
  if (qtd && !f.medidas_da_descricao) {
    for (let i = 0; i < medidas.length; i++) {
      const def = definicaoDaMedida(f, medidas[i].etiqueta);
      if (!def) continue;
      const trechoDaMedida = item.medidas.find(m => m.valor === medidas[i].bruto)?.trecho ?? medidas[i].bruto;
      if (!trocaPlausivel(texto, item.quantidade!.trecho || item.quantidade!.valor, trechoDaMedida)) continue;
      // A medida só vira quantidade se puder ser quantidade: "3/8" ou "5.0" não são número de peças (por kg, decimal pode).
      const comoQuantidade = lerValor(medidas[i].bruto);
      if (!comoQuantidade || comoQuantidade.forma === 'fracao' || (comoQuantidade.forma === 'decimal' && f.unidade_venda !== 'kg')) continue;
      const n = normalizarMedida(f, def, item.quantidade!.valor, null);
      if (n.valor === null || n.valor === medidas[i].valor) continue;
      const nova = medidas.map((m, j) => (j === i ? { etiqueta: m.etiqueta, valor: n.valor! } : { etiqueta: m.etiqueta, valor: m.valor }));
      leituras.push({ medidas: nova, descricao: `quantidade ${item.quantidade!.valor} como ${medidas[i].etiqueta} e ${medidas[i].bruto} como quantidade` });
    }
  }
  for (let i = 0; i < medidas.length; i++) {
    for (let j = i + 1; j < medidas.length; j++) {
      const [a, b] = [medidas[i], medidas[j]];
      if (a.etiqueta === b.etiqueta || grupoDe(f, a.etiqueta) === grupoDe(f, b.etiqueta)) continue;
      const da = definicaoDaMedida(f, b.etiqueta);
      const db = definicaoDaMedida(f, a.etiqueta);
      if (!da || !db) continue;
      const va = normalizarMedida(f, da, a.bruto, null).valor;
      const vb = normalizarMedida(f, db, b.bruto, null).valor;
      if (va === null || vb === null) continue;
      const nova = medidas.map((m, k) => (k === i ? { etiqueta: b.etiqueta, valor: va } : k === j ? { etiqueta: a.etiqueta, valor: vb } : { etiqueta: m.etiqueta, valor: m.valor }));
      leituras.push({ medidas: nova, descricao: `${a.bruto} como ${b.etiqueta} e ${b.bruto} como ${a.etiqueta}` });
    }
  }
  return leituras;
}

/**
 * O mesmo item lido noutra família: cada medida fica com a etiqueta de mesmo
 * nome, se a família tiver; senão, com a próxima livre de mesma unidade.
 * Ex.: perfil simples (alma 75, aba 40, chapa 17) → enrijecido (alma 75,
 * aba 40, chapa 17); o teste de troca acha o enrijecimento 17.
 */
function comEtiquetasDe(g: Familia, item: ItemExtraido): ItemExtraido {
  const livres = [...(g.medidas ?? [])];
  const deOrigem = familiaPorId(item.familia);
  const medidas = item.medidas.map(m => {
    let i = livres.findIndex(d => d.etiqueta === m.etiqueta);
    const unidade = deOrigem?.medidas?.find(d => d.etiqueta === m.etiqueta)?.unidade;
    if (i < 0) i = livres.findIndex(d => d.unidade === unidade);
    if (i < 0) i = 0;
    const etiqueta = g.medidas_da_descricao ? 'numero' : livres[i]?.etiqueta ?? m.etiqueta;
    if (livres[i]) livres.splice(i, 1);
    return { ...m, etiqueta };
  });
  return { ...item, familia: g.id, medidas };
}

/**
 * O produto único bate em tudo com o que o cliente escreveu: o texto nomeia a
 * família, cada medida do produto foi dita pelo cliente (em qualquer ordem) e
 * nenhuma veio de conversão ou padrão. "barra chata 3/8" (a espessura 1/8 é
 * inferida) ou "barra redonda 3/8" (convertida para 10 mm) não batem.
 */
function bateTudo(f: Familia, p: ProdutoV2, medidas: MedidaDoItem[], reducao: Reducao, regrasDeConversao: string[], familiasDoTexto: string[]): boolean {
  if (!familiasDoTexto.includes(f.id)) return false;
  // Conversão que é regra do vendedor (eletrodo "2/5" é 2,5; disco 4 é 4.1/2) não conta como medida inferida.
  const semConfirmar = new Set(CONVERSAO.especiais.filter(e => e.sem_confirmar === true).map(e => e.id));
  if (regrasDeConversao.some(r => !semConfirmar.has(r)) || reducao.medidasDoPadrao.length) return false;
  if (reducao.regras.some(r => PADROES.some(x => x.id === r))) return false;
  if (!medidas.length || medidas.some(m => m.etiquetaLivre || (m.origem !== 'cliente' && m.regras.some(r => !semConfirmar.has(r))))) return false;
  return p.medidas.length === medidas.length && casarMedidas(f, p, medidas).casa;
}

/**
 * Calha é vendida em peça (2, 4 ou 6 m). Um comprimento maior que a maior peça
 * é o total em metros ("12 metros de calha", Vendedor 1 22/10: são 2 peças de 6 m):
 * sai da medida, e `quantidadeDeVenda` converte em peças.
 */
export const METROS_DA_PECA_DE_CALHA = 6;
function semMetrosDeCalha(item: ItemExtraido): ItemExtraido {
  if (item.familia !== 'calha') return item;
  const medidas = item.medidas.filter(m => !(m.etiqueta === 'comprimento' && Number(String(m.valor).replace(',', '.')) > METROS_DA_PECA_DE_CALHA));
  return medidas.length === item.medidas.length ? item : { ...item, medidas };
}

/**
 * Na família corrigida, o número que a IA deixou sem papel (ela não achou onde pôr: "400" no
 * arame comum) ocupa a primeira medida que ficou vazia. Teste de 22/10: "2 rolo de arame
 * 400mts" virou farpado, mas sem o 400 perguntou o comprimento.
 */
function comAuxiliaresComoMedida(g: Familia, item: ItemExtraido): ItemExtraido {
  const vazias = (g.medidas ?? []).filter(d => !item.medidas.some(m => m.etiqueta === d.etiqueta));
  const soltos = item.numeros_auxiliares.filter(a => a.papel === 'outro');
  if (!vazias.length || !soltos.length) return item;
  const usados = soltos.slice(0, vazias.length);
  return {
    ...item,
    medidas: [...item.medidas, ...usados.map((a, i) => ({ etiqueta: vazias[i].etiqueta, valor: a.valor, trecho: a.trecho, unidade_escrita: null }))],
    numeros_auxiliares: item.numeros_auxiliares.filter(a => !usados.includes(a)),
  };
}

export function resolverItem(itemDaIa: ItemExtraido, ctx: ContextoDoResolvedor): ResultadoResolucao {
  const liberadas = ctx.liberadas ?? FAMILIAS_LIBERADAS;
  const texto = ctx.textoOriginal;
  const dic = familiaDoTexto(texto);
  let item = semMetrosDeCalha(itemDaIa);
  let f = familiaPorId(item.familia);
  // Teste de campo de 20/10: "1 rolo 250" veio como arame comum. A gíria que corrige vale mais que a IA.
  // No áudio de 25/10 a "telha 043" corrigia também os perfis da mesma frase: com vários itens, vale o pedaço do item.
  const corrige = ctx.textoDoItem !== undefined ? familiaDoTexto(ctx.textoDoItem).corrige : dic.corrige;
  const corrigida = corrige && corrige !== f?.id ? familiaPorId(corrige) : undefined;
  if (corrigida) {
    item = comAuxiliaresComoMedida(corrigida, comEtiquetasDe(corrigida, item));
    f = corrigida;
  }
  if (!f || f.id === 'nao_identificado') return resultado('vendedor', 'não sei que produto é: vou confirmar com o vendedor');
  if (f.sob_medida) return resultado('vendedor', 'item feito sob medida (corte e dobra): o peso é calculado à parte');

  const conferencias = ctx.conferencias ?? [];
  const travas: Travas = {
    familia: dic.familias.length ? dic.familias.includes(f.id) : liberadas.includes(f.id),
    conferencias: conferencias.filter(c => c.nome !== 'familia').every(c => c.ok),
    termos: true, unico: false, cadastro: false,
    familia_liberada: liberadas.includes(f.id),
    quantidade: true,
  };

  // 2. não vende (antes da busca: não importa a medida)
  const textoLimpo = limpar(texto);
  const { medidas, erros } = normalizarMedidasDoItem(f, item);
  for (const nv of NAO_VENDE) {
    if (nv.familia !== f.id) continue;
    if (nv.termo && !new RegExp(nv.termo).test(textoLimpo)) continue;
    if (nv.condicao) {
      const m = medidas.find(x => x.etiqueta === nv.condicao!.etiqueta);
      if (!m || !(Number(m.valor) > nv.condicao.maior_que)) continue;
    }
    return resultado('nao_vende', 'a loja não trabalha com esse produto', { regras_aplicadas: [nv.id], travas });
  }

  if (erros.length) {
    return resultado('conflito', `medida que não sei converter: ${erros.join('; ')}`, { travas: { ...travas, conferencias: false } });
  }

  const q = lerQualificadores(f, item);
  // Número sem papel claro ("outro": preço, código, um "2" solto) também segura o item: pode ser medida que a IA não etiquetou.
  const numerosSoltos = item.numeros_auxiliares
    .filter(x => x.papel === 'outro' && !lerQualificador(f.id, x.valor).ignorado && !lerQualificador(f.id, x.trecho).ignorado)
    .map(x => x.trecho || x.valor);
  travas.termos = !q.naoReconhecidos.length && !item.termos_nao_reconhecidos.length && !numerosSoltos.length;
  const qtd = checarQuantidade(f, item.quantidade);
  travas.quantidade = qtd.ok;
  const regrasDeConversao = [...new Set(medidas.flatMap(m => m.regras))];

  // 3. busca e padrões (as perguntas obrigatórias usam a lista já reduzida)
  const { busca, reducao } = reduzir(f, ctx, medidas, q);

  // 4. pergunta obrigatória
  for (const op of OBRIGATORIO_PERGUNTAR) {
    if (op.familia !== f.id) continue;
    const c = op.condicao;
    if (c.atributo_nao_informado && q.atributos[c.atributo_nao_informado]) continue;
    if (c.etiqueta_nao_informada && medidas.some(m => m.etiqueta === c.etiqueta_nao_informada)) continue;
    if (c.texto && !new RegExp(c.texto).test(limpar(`${texto} ${item.qualificadores.join(' ')}`))) continue;
    if (c.qualificador && !item.qualificadores.some(x => new RegExp(c.qualificador!).test(limpar(x)))) continue;
    if (c.sem_medidas && medidas.length) continue;
    const base = reducao.candidatos;
    const outras = new Map<string, ProdutoV2[]>();
    const opcoes = op.opcoes.map(o => {
      let outra: ProdutoV2[] = [];
      if (o.filtro.familia) {
        const fo = familiaPorId(o.filtro.familia);
        if (!outras.has(o.filtro.familia)) outras.set(o.filtro.familia, fo ? buscar(fo, ctx.catalogo, medidas.map(m => ({ ...m, etiqueta: fo.medidas?.[0]?.etiqueta ?? m.etiqueta })), {}, []).candidatos : []);
        outra = outras.get(o.filtro.familia)!;
      }
      // Opção que os padrões tiraram da lista (ex.: o trançado, que é "ausente por padrão") volta pela busca inteira.
      const reduzida = filtrar(base, o.filtro, outra, f);
      const produtos = reduzida.length ? reduzida : filtrar(busca.candidatos, o.filtro, outra, f);
      const vazioMasValido = o.filtro.familia === 'corte_e_dobra';
      return { rotulo: o.rotulo, codigos: produtos.map(p => p.codigo), valida: produtos.length > 0 || vazioMasValido };
    }).filter(o => o.valida).map(({ rotulo: r, codigos }) => ({ rotulo: r, codigos }));
    if (!opcoes.length) continue;
    const todos = [...new Set(opcoes.flatMap(o => o.codigos))].map(c => ctx.catalogo.porCodigo.get(c)!).filter(Boolean);
    const { candidatos } = candidatosComDiferenca(f, todos);
    const status = opcoes.length === 1 && opcoes[0].codigos.length === 1 ? 'confirmar' : 'ambiguo';
    return resultado(status, op.pergunta, {
      candidatos, atributo_a_perguntar: op.atributo, opcoes, regras_aplicadas: [op.id, ...regrasDeConversao, ...reducao.regras],
      medidas: medidasResolvidas(medidas, reducao.medidasDoPadrao, reducao.regras, null), travas,
    });
  }

  if (!busca.candidatos.length) {
    if (!(ctx.catalogo.porFamilia.get(f.id) ?? []).length) return resultado('vendedor', `não temos ${f.nome} no catálogo: vou confirmar com o vendedor`, { travas });
    // Antes de dizer que não tem: outra leitura (etiquetas trocadas, quantidade ↔ medida) acha produto?
    // Então pode ser só a etiqueta errada: pergunta com o que essa leitura achou, nunca resolve sozinho.
    for (const leitura of [...outrasLeituras(f, item, medidas, texto), ...etiquetasNaoUsadas(f, medidas)]) {
      const r = reduzir(f, ctx, leitura.medidas, q);
      if (!r.reducao.candidatos.length) continue;
      const lista = r.reducao.candidatos.slice(0, MAX_OPCOES);
      return resultado('ambiguo', `do jeito que li não temos; lendo ${leitura.descricao}, temos estes`, {
        candidatos: candidatosComDiferenca(f, lista).candidatos, atributo_a_perguntar: 'leitura',
        opcoes: lista.map(p => ({ rotulo: rotulo(p), codigos: [p.codigo] })), medidas: medidasResolvidas(medidas, [], [], null),
        regras_aplicadas: [...regrasDeConversao, ...r.reducao.regras], travas,
      });
    }
    // A IA pode ter errado a família. Antes de dizer que não tem, tenta as outras que o texto aponta
    // ("PERFIL U 75X40X17" é enrijecido, não simples) e, se o texto não diz nenhuma, as de molde parecido
    // ("6 tubos 1.1/4 x16": tubo preto ou galvanizado). O que achar vira pergunta, nunca resolve sozinho.
    if (!ctx.semAlternativas) {
      const unidades = (x: Familia): string => (x.medidas ?? []).map(m => m.unidade).sort().join(',');
      const outras = dic.familias.length
        ? dic.familias.filter(g => g !== f.id).map(g => familiaPorId(g)).filter((g): g is Familia => !!g)
        : FAMILIAS.filter(g => g.id !== f.id && !g.fora_da_extracao && g.medidas?.length && unidades(g) === unidades(f));
      const achados: ProdutoV2[] = [];
      for (const g of outras) {
        const r = resolverItem(comEtiquetasDe(g, item), { ...ctx, semAlternativas: true });
        if (['resolvido', 'confirmar', 'ambiguo'].includes(r.status)) achados.push(...r.candidatos.map(c => ctx.catalogo.porCodigo.get(c.codigo)!).filter(Boolean));
      }
      if (achados.length) {
        const lista = [...new Map(achados.map(p => [p.codigo, p])).values()].slice(0, MAX_OPCOES);
        return resultado('ambiguo', `do jeito que li não temos; como ${[...new Set(lista.map(p => familiaPorId(p.familia)?.nome ?? p.familia))].join(' ou ')}, temos estes`, {
          candidatos: lista.map(p => ({ codigo: p.codigo, descricao: rotulo(p), diferenca: p.familia })), atributo_a_perguntar: 'família',
          opcoes: lista.map(p => ({ rotulo: rotulo(p), codigos: [p.codigo] })), medidas: medidasResolvidas(medidas, [], [], null),
          regras_aplicadas: regrasDeConversao, travas,
        });
      }
    }
    const proximos = maisProximos(f, ctx.catalogo, medidas, q.atributos);
    const naoReconhecido = q.naoReconhecidos.length ? ` (não reconheci: ${q.naoReconhecidos.join(', ')})` : '';
    return resultado('nao_encontrado', `não temos essa medida${naoReconhecido}`, {
      candidatos: candidatosComDiferenca(f, proximos).candidatos, opcoes: proximos.map(p => ({ rotulo: rotulo(p), codigos: [p.codigo] })),
      medidas: medidasResolvidas(medidas, [], [], null), regras_aplicadas: regrasDeConversao, travas,
    });
  }
  const lista = reducao.candidatos;
  const regras = [...regrasDeConversao, ...reducao.regras];

  // 5. outras leituras: se alguma também acha produto (e outro), o item é ambíguo
  const alternativas: string[] = [];
  for (const leitura of outrasLeituras(f, item, medidas, texto)) {
    const r = reduzir(f, ctx, leitura.medidas, q);
    const codigos = r.reducao.candidatos.map(p => p.codigo);
    if (codigos.length && codigos.some(c => !lista.some(p => p.codigo === c))) alternativas.push(leitura.descricao);
  }

  // 6. travas
  travas.unico = lista.length === 1 && !alternativas.length;
  const produto = lista.length === 1 ? lista[0] : null;
  travas.cadastro = !!produto && ctx.saude.get(produto.codigo)?.status !== 'suspeito';
  // A unidade escrita confere com a do produto, agora que ele é um só (rolo de trançado é RL; rolo de arame 12, que é KG, confirma).
  const qtdDoProduto = produto ? checarQuantidade(f, item.quantidade, produto.unidade, produto.descricao) : qtd;
  travas.quantidade = qtdDoProduto.ok;
  const medidasFinais = medidasResolvidas(medidas, reducao.medidasDoPadrao, reducao.regras, produto);

  if (lista.length > 1 || alternativas.length) {
    const { candidatos, atributo } = candidatosComDiferenca(f, lista);
    const opcoes = lista.length <= MAX_OPCOES ? lista.map(p => ({ rotulo: rotulo(p), codigos: [p.codigo] })) : opcoesPorAtributo(f, lista, atributo ?? 'produto');
    const motivo = alternativas.length ? `o texto pode ser lido de outro jeito: ${alternativas.join('; ')}` : `${lista.length} produtos servem: falta ${atributo?.replace(/_/g, ' ') ?? 'saber qual'}`;
    return resultado('ambiguo', motivo, { candidatos, atributo_a_perguntar: alternativas.length ? 'leitura' : atributo, opcoes, medidas: medidasFinais, regras_aplicadas: regras, travas });
  }

  const p = produto!;
  // T8 (teste de 20/10): um candidato só, que bate em tudo com o que o cliente escreveu, não vira
  // pergunta mesmo em família não liberada nem com as medidas em outra ordem ("barra chata 3/8 x
  // 1.1/2" é a 1 1/2 X 3/8). Medida inferida (padrão, conversão, medida que o cliente não deu)
  // continua confirmando.
  const bate = bateTudo(f, p, medidas, reducao, regrasDeConversao, dic.familias);
  const confirmaOrdem = busca.trocada && !!f.confirmar_ordem_trocada && !bate;
  const motivos: string[] = [];
  if (!travas.familia) motivos.push(dic.familias.length ? `o texto aponta ${dic.familias.join(' ou ')}, não ${f.id}` : `o dicionário não reconhece a família ${f.id}`);
  if (!travas.conferencias) motivos.push(`conferência falhou: ${conferencias.filter(c => !c.ok).map(c => c.nome).join(', ')}`);
  if (!travas.termos) motivos.push(`termo ou número não reconhecido: ${[...q.naoReconhecidos, ...item.termos_nao_reconhecidos, ...numerosSoltos].join(', ')}`);
  if (!travas.cadastro) motivos.push(`cadastro em quarentena (${ctx.saude.get(p.codigo)?.motivos[0] ?? 'suspeito'})`);
  if (!travas.familia_liberada && !bate) motivos.push(`família ${f.id} ainda não liberada para resolver sozinha`);
  if (!travas.quantidade) motivos.push(qtdDoProduto.motivo ?? 'quantidade');
  if (confirmaOrdem) motivos.push('medidas escritas na ordem inversa do catálogo');
  if (dic.confirmar) motivos.push('o nome que o cliente usou pede confirmação');

  const tudoPassa = Object.entries(travas).every(([nome, ok]) => ok || (nome === 'familia_liberada' && bate)) && !confirmaOrdem && !dic.confirmar;
  const candidatos = [{ codigo: p.codigo, descricao: rotulo(p), diferenca: '' }];
  if (tudoPassa) {
    return resultado('resolvido', regras.length ? `um produto bate (regras: ${regras.join(', ')})` : 'um produto bate em tudo', {
      codigo: p.codigo, candidatos, medidas: medidasFinais, regras_aplicadas: regras, travas,
    });
  }
  // A IA e o dicionário discordam da família ("barras de ferro 3/8": a IA leu barra redonda, o
  // dicionário diz vergalhão): a pergunta oferece as duas leituras, a do dicionário primeiro. Só
  // quando a outra família aponta um produto só ("arrebite para calha" não vira lista de calhas).
  if (!travas.familia && dic.familias.length && !ctx.semAlternativas) {
    const doDicionario: ProdutoV2[] = [];
    for (const g of dic.familias.map(id => familiaPorId(id)).filter((g): g is Familia => !!g && g.id !== f.id)) {
      const r = resolverItem(comEtiquetasDe(g, item), { ...ctx, semAlternativas: true });
      if (['resolvido', 'confirmar'].includes(r.status)) doDicionario.push(...r.candidatos.map(c => ctx.catalogo.porCodigo.get(c.codigo)!).filter(Boolean));
    }
    const lista = [...new Map([...doDicionario, p].map(x => [x.codigo, x])).values()].slice(0, MAX_OPCOES);
    if (lista.length > 1) {
      return resultado('ambiguo', motivos.join('; '), {
        candidatos: lista.map(x => ({ codigo: x.codigo, descricao: rotulo(x), diferenca: x.familia })), atributo_a_perguntar: 'família',
        opcoes: lista.map(x => ({ rotulo: rotulo(x), codigos: [x.codigo] })), medidas: medidasFinais, regras_aplicadas: regras, travas,
      });
    }
  }
  return resultado('confirmar', motivos.join('; '), {
    candidatos, opcoes: [{ rotulo: rotulo(p), codigos: [p.codigo] }], atributo_a_perguntar: 'confirmação', medidas: medidasFinais, regras_aplicadas: regras, travas,
  });
}

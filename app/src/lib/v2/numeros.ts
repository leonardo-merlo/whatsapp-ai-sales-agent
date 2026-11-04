// Leitura de um valor como o cliente escreveu: "3/8", "1.1/4", "1 e 1/4",
// "4\"1/2", "2 e meio", "12,5 mm", "ch18", "#18", "0,90mm". Só lê: a
// conversão para a unidade da família é de conversao.ts.

import type { Unidade } from './tipos';

export type Forma = 'fracao' | 'decimal' | 'inteiro';

export interface ValorLido {
  valor: number;
  forma: Forma;
  /** A unidade escrita junto do número, se havia. "kg" fica de fora: é da quantidade. */
  unidade: Unidade | null;
  /** O texto numérico depois da limpeza ("1.1/4", "12.5"). */
  texto: string;
}

const DENOMINADORES = new Set([2, 4, 8, 16, 32, 64]);

/** Sem acento, minúsculo, espaço simples. */
export function limpar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Sem acento, maiúsculo: como as descrições do catálogo são comparadas. */
export function limparDescricao(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const UNIDADES: [RegExp, Unidade][] = [
  [/^(?:"|''|”|“|pol|pols|polegadas?|p)$/, 'pol'],
  [/^mm$/, 'mm'],
  [/^cm$/, 'cm'],
  [/^(?:m|mt|mts|metros?)$/, 'm'],
  [/^(?:l|lt|lts|litros?)$/, 'l'],
];

/** "mm" → mm, "\"" → pol. Desconhecida: null. */
export function lerUnidade(texto: string | null | undefined): Unidade | null {
  if (!texto) return null;
  const t = limpar(texto).replace(/\.$/, '');
  if (/^(?:ch|ch\.|chapa|#)$/.test(t)) return 'chapa';
  for (const [r, u] of UNIDADES) if (r.test(t)) return u;
  return null;
}

/** Fração de polegada de verdade: "3/8" sim, "50/30" não. */
export function ehFracao(numerador: number, denominador: number): boolean {
  return DENOMINADORES.has(denominador) && numerador > 0 && numerador < denominador;
}

const IGUAL = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
export const iguais = IGUAL;

/** Número por extenso que aparece em pedido ("um kilo", "meia polegada"). */
const POR_EXTENSO: Record<string, string> = {
  um: '1', uma: '1', dois: '2', duas: '2', tres: '3', quatro: '4', cinco: '5', seis: '6', sete: '7', oito: '8', nove: '9', dez: '10', meia: '1/2', meio: '1/2',
};

const UNIDADES_POR_EXTENSO: Record<string, number> = {
  dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19,
};
const DEZENAS_POR_EXTENSO: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

/**
 * O texto (já sem acento e minúsculo) com os números por extenso em algarismo:
 * "tres vezes" → "3 vezes", "vinte e oito dias" → "28 dias". "um" e "uma"
 * ficam: são artigo na maioria das vezes ("uma vez" já é lido onde precisa).
 */
export function numerosPorExtenso(texto: string): string {
  const unidades = Object.keys(UNIDADES_POR_EXTENSO).filter(u => UNIDADES_POR_EXTENSO[u] < 10).join('|');
  return texto
    .replace(new RegExp(`\\b(${Object.keys(DEZENAS_POR_EXTENSO).join('|')})(?: e (${unidades}|um|uma))?\\b`, 'g'),
      (_m, dezena: string, unidade?: string) => String(DEZENAS_POR_EXTENSO[dezena] + (unidade ? (UNIDADES_POR_EXTENSO[unidade] ?? 1) : 0)))
    .replace(new RegExp(`\\b(${Object.keys(UNIDADES_POR_EXTENSO).join('|')})\\b`, 'g'), (p: string) => String(UNIDADES_POR_EXTENSO[p]));
}

const NUMERADORES: Record<string, number> = { um: 1, uma: 1, tres: 3, cinco: 5, sete: 7, nove: 9, onze: 11, treze: 13, quinze: 15 };
const DENOMINADORES_FALADOS: Record<string, number> = { meio: 2, terco: 3, quarto: 4, oitavo: 8, 'dezesseis avo': 16, 'trinta e dois avo': 32 };

/**
 * O texto do cliente com os números falados em algarismo, para conferir o que a IA leu
 * de um áudio transcrito (22/10): "três oitavos" → "3/8", "cinco quilos" → "5 quilos",
 * "meia polegada" → "1/2 polegada", "um kilo" → "1 kilo" (só no começo: no meio, "um" é artigo).
 */
export function numerosEscritos(texto: string): string {
  const fracoes = limpar(texto)
    .replace(new RegExp(`\\b(${Object.keys(NUMERADORES).join('|')}) (${Object.keys(DENOMINADORES_FALADOS).join('|')})s?\\b`, 'g'),
      (_m, n: string, d: string) => `${NUMERADORES[n]}/${DENOMINADORES_FALADOS[d]}`)
    .replace(/\bmeia polegada\b/g, '1/2 polegada');
  return numerosPorExtenso(fracoes).replace(/^(?:um|uma)\b/, '1');
}

/**
 * Lê um valor. Devolve null quando o texto não é UM número (ex.: "50x30", que
 * são dois). Aceita a unidade colada antes ou depois.
 */
export function lerValor(bruto: string): ValorLido | null {
  let t = limpar(bruto)
    .replace(/[“”]/g, '"')
    .replace(/(\d)\s*''/g, '$1"');
  let unidade: Unidade | null = null;
  const extenso = t.match(/^([a-z]+)(s+.*)?$/);
  if (extenso && POR_EXTENSO[extenso[1]]) t = `${POR_EXTENSO[extenso[1]]}${extenso[2] ?? ''}`;

  // chapa antes: "ch18", "ch 18", "chapa 3/16", "#18"
  const chapa = t.match(/^(?:ch\.?|chapa|#)\s*(.+)$/);
  if (chapa) { unidade = 'chapa'; t = chapa[1].trim(); }
  // ø antes: bitola em mm
  const fi = t.match(/^[øo]\s*(\d.*)$/);
  if (fi && /ø/.test(bruto)) { unidade = 'mm'; t = fi[1].trim(); }

  // 4"1/2 → 4 1/2 polegadas. Com espaço depois das aspas (1" 1/4) são duas medidas (vendedor, 30/09): não é lido aqui.
  const polMeio = t.match(/^(\d+)\s*"(\d+\/\d+)"?$/);
  if (polMeio) { t = `${polMeio[1]} ${polMeio[2]}`; unidade = 'pol'; }

  // unidade no fim
  const fim = t.match(/^(.*?\d)\s*(mm|cm|m|mt|mts|metros?|"|pol|pols|polegadas?|l|lt|lts|litros?)\.?$/);
  if (fim && !polMeio) { t = fim[1].trim(); unidade = unidade ?? lerUnidade(fim[2]); }

  // "2 e meio", "3,meio" → 2,5
  t = t.replace(/^(\d+)\s*(?:e|,)\s*meio$/, '$1.5');
  // "1 e 1/4", "1-1/4", "1/1/4" (vendedor, 30/09), "1 1/4" → 1.1/4
  t = t.replace(/^(\d)\s*(?:e|-|\/)\s*(\d+\/\d+)$/, '$1.$2').replace(/^(\d) (\d+\/\d+)$/, '$1.$2');

  const misto = t.match(/^(\d+)\.(\d+)\/(\d+)$/);
  if (misto) {
    const [n, d] = [Number(misto[2]), Number(misto[3])];
    if (!ehFracao(n, d)) return null;
    return { valor: Number(misto[1]) + n / d, forma: 'fracao', unidade, texto: t };
  }
  const fracao = t.match(/^(\d+)\/(\d+)$/);
  if (fracao) {
    const [n, d] = [Number(fracao[1]), Number(fracao[2])];
    // "2/5" não é fração de polegada (5 não é denominador): quem decide é a conversão da família
    if (!d) return null;
    return { valor: n / d, forma: 'fracao', unidade, texto: t };
  }
  const decimal = t.match(/^(\d+)[.,](\d+)$/);
  if (decimal) return { valor: Number(`${decimal[1]}.${decimal[2]}`), forma: 'decimal', unidade, texto: `${decimal[1]}.${decimal[2]}` };
  if (/^\d+$/.test(t)) return { valor: Number(t), forma: 'inteiro', unidade, texto: t };
  return null;
}

/** Valor canônico como texto: 10, 12.5, 0.375 (até 4 casas, sem zeros à direita). */
export function formatar(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** Todos os números de um texto (para a conferência de cobertura): "50x30x18" → 50, 30, 18; "1.1/4" → um só. */
export function numerosDoTexto(texto: string): string[] {
  const t = limpar(texto).replace(/[“”]/g, '"');
  const achados = t.match(/\d+(?:[.,]\d+\/\d+|\s\d\/\d{1,2}(?!\d)|\/\d+(?:\/\d+)?|[.,]\d+)?/g) ?? [];
  const saida: string[] = [];
  for (const a of achados) {
    // "50/30/18" são três; "3/8" é um; "1/1/4" é um (1 1/4)
    const partes = a.split('/');
    if (partes.length === 2 && ehFracao(Number(partes[0].replace(/^.*[.,\s]/, '')), Number(partes[1]))) saida.push(a);
    else if (partes.length === 3 && ehFracao(Number(partes[1]), Number(partes[2]))) saida.push(a);
    else if (/\s/.test(a)) saida.push(a);
    else saida.push(...partes);
  }
  return saida.filter(Boolean);
}

/**
 * O mesmo número? Compara pelo valor lido ("3,8" = "3.8", "1 1/4" = "1.1/4",
 * "08" = "8"). Texto que não é número compara como texto limpo.
 */
export function mesmoNumero(a: string, b: string): boolean {
  const la = lerValor(a);
  const lb = lerValor(b);
  if (la && lb) return IGUAL(la.valor, lb.valor) || la.texto === lb.texto;
  return limpar(a).replace(/[\s.,]/g, '') === limpar(b).replace(/[\s.,]/g, '');
}

// Normalização: o que o cliente escreveu e o que a descrição diz viram números
// comparáveis (parte B do fiscal, prompt-nova-sessao-fiscal.md).
//
// O cliente escreve `50 varas de ferro 3.8`, `2 50x30 ch18`, `eletrodo 2 e meio`;
// o catálogo guarda `bitola 3/8 · 10.0 mm`, `50X30X18`, `2.50`. Nenhuma das duas
// pontas está errada: falam línguas diferentes. Aqui as duas viram listas de
// números, e um número "bate" com outro quando são o mesmo valor ou equivalentes
// pela tabela de bitolas (3/8 = 10.0 mm).
//
// **A conta é do código, não da IA** (pesquisa de 30/09: conversão de polegada
// e milímetro é onde o modelo erra). O que este arquivo NÃO faz é decidir se o
// produto serve: isso é do fiscal (parte C), que usa estas peças.
//
// As traduções próprias da Distribuidora Exemplo (apelidos, `3/16`, `3.8`) vêm do
// dicionário (exemplo/catalogo/dicionario.md) e estão marcadas com a origem.

export type Unidade = 'pol' | 'mm' | 'chapa' | null;

export interface Numero {
  /** Como estava escrito, depois da limpeza ("3/8", "12.5", "18"). */
  texto: string;
  unidade: Unidade;
  /** O valor e os equivalentes: "3/8" → [0.375, 10]. */
  valores: number[];
  /** Espessura em milímetro que é uma chapa da tabela ("0,90mm" → 20). Só bate com coluna de chapa. */
  chapa?: number;
}

export interface PedidoNormalizado {
  /** O texto limpo: minúsculo, sem acento, com os apelidos trocados. */
  texto: string;
  /** Os moldes que o texto aponta ("metalon", "vergalhão CA50"...). Vazio: não deu para saber. */
  familias: string[];
  numeros: Numero[];
}

// ── bitolas: a tabela do dicionário §2 ──
// Polegada comercial → milímetro como a Distribuidora Exemplo escreve. Não é 25,4 × a
// polegada (3/8" daria 9,525): é o nome comercial da bitola.
const BITOLAS: [number, number][] = [
  [0.25, 6.3], [0.3125, 8.0], [0.375, 10.0], [0.5, 12.5], [0.625, 16.0], [0.75, 20.0], [1, 25.0],
];
/**
 * Espessura em milímetro → chapa, pela tabela da chapa preta do catálogo (700054 a 700286:
 * "CHAPA PRETA 20 (0.90MM)"). O vendedor confirmou em 30/09 que vale igual no metalon
 * ("20x20x0,90mm" é a chapa 20). Só valores exatos da tabela: 1,6 mm não está nela.
 */
const MM_DA_CHAPA: [number, number][] = [
  [0.45, 26], [0.6, 24], [0.75, 22], [0.9, 20], [1.2, 18], [1.5, 16], [2.0, 14], [2.65, 12], [3.0, 1 / 8], [4.75, 3 / 16],
];
/** A chapa 13 e a 12 aparecem também em milímetro (2.25 e 2.65). */
const CHAPAS_EM_MM: [number, number][] = [[13, 2.25], [12, 2.65]];

const IGUAL = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const DENOMINADORES = new Set([2, 4, 8, 16, 32, 64]);

/** "3/8" é fração; "50/30" não (30 não é denominador de polegada, e 50 > 30). */
function ehFracao(numerador: number, denominador: number): boolean {
  return DENOMINADORES.has(denominador) && numerador < denominador;
}

/**
 * O valor de um número escrito: "3/8" → 0.375, "1 1/4" e "1.1/4" → 1.25,
 * "2,25" → 2.25, "18" → 18. Texto que não é número: null.
 */
export function lerNumero(bruto: string): number | null {
  const t = bruto.trim().replace(',', '.');
  const misto = t.match(/^(\d+)[ .](\d+)\/(\d+)$/);
  if (misto) return Number(misto[1]) + Number(misto[2]) / Number(misto[3]);
  const fracao = t.match(/^(\d+)\/(\d+)$/);
  if (fracao) return Number(fracao[2]) ? Number(fracao[1]) / Number(fracao[2]) : null;
  return /^\d+(?:\.\d+)?$/.test(t) ? Number(t) : null;
}

/** O número com os equivalentes pela tabela de bitolas (ou de chapa). */
export function criarNumero(texto: string, unidade: Unidade): Numero | null {
  const valor = lerNumero(texto);
  if (valor === null) return null;
  const valores = [valor];
  const temFracao = texto.includes('/');
  const temDecimal = /[.,]/.test(texto) && !temFracao;
  if (unidade === 'chapa') {
    for (const [chapa, mm] of CHAPAS_EM_MM) {
      if (IGUAL(valor, chapa)) valores.push(mm);
      if (IGUAL(valor, mm)) valores.push(chapa);
    }
  } else if (unidade === 'pol' || temFracao) {
    const mm = BITOLAS.find(([pol]) => IGUAL(pol, valor))?.[1];
    if (mm !== undefined) valores.push(mm);
  } else if (unidade === 'mm' || temDecimal) {
    const pol = BITOLAS.find(([, mm]) => IGUAL(mm, valor))?.[0];
    if (pol !== undefined) valores.push(pol);
    const chapa = unidade === 'mm' ? MM_DA_CHAPA.find(([mm]) => IGUAL(mm, valor))?.[1] : undefined;
    if (chapa !== undefined) return { texto, unidade, valores, chapa };
    // Milímetro grande escrito pelo cliente vira a polegada mais perto, de meia
    // em meia, se ficar a menos de 4%: "saída de 100 mm" é a boquilha de 4"
    // (dicionário §6), "guia de 50 mm" é a de 2".
    if (unidade === 'mm' && valor >= 25) {
      const polegada = Math.round((valor / 25.4) * 2) / 2;
      if (Math.abs(polegada * 25.4 - valor) / valor < 0.04 && !valores.some(v => IGUAL(v, polegada))) valores.push(polegada);
    }
  }
  // Inteiro sem unidade ("20", "50") fica sem equivalente: é medida de metalon,
  // chapa, comprimento. Converter 20 em 3/4" faria 50x30x20 bater com 3/4.
  return { texto, unidade: unidade ?? (temFracao ? 'pol' : null), valores };
}

/** Dois números batem quando algum valor de um é igual a algum do outro. */
export function numerosBatem(a: Numero, b: Numero): boolean {
  // Milímetro que é chapa ("0,90mm") bate com a coluna de chapa pelo número da chapa.
  if (a.chapa !== undefined && b.unidade === 'chapa' && b.valores.some(y => IGUAL(a.chapa!, y))) return true;
  if (b.chapa !== undefined && a.unidade === 'chapa' && a.valores.some(x => IGUAL(b.chapa!, x))) return true;
  if (a.unidade === 'chapa' && b.unidade !== 'chapa' && b.unidade !== null) return false;
  return a.valores.some(x => b.valores.some(y => IGUAL(x, y)));
}

// ── o lado do catálogo ──

/** Colunas que não são medida comparável. */
const COLUNAS_SEM_NUMERO = new Set(['chapa_origem', 'chapa_do_grupo', 'tipo', 'marca', 'modelo', 'peca']);
const UNIDADE_DA_COLUNA: Record<string, Unidade> = { mm: 'mm', chapa: 'chapa', polegada: 'pol' };

/** As medidas de um produto (`catalogo_produtos.medidas`) como números comparáveis. */
export function numerosDoProduto(medidas: Record<string, string>): Numero[] {
  const numeros: Numero[] = [];
  for (const [coluna, valor] of Object.entries(medidas)) {
    if (COLUNAS_SEM_NUMERO.has(coluna)) continue;
    const n = criarNumero(valor, UNIDADE_DA_COLUNA[coluna] ?? null);
    if (n) numeros.push(n);
  }
  return numeros;
}

// ── o lado do cliente ──

/** Sem acento, minúsculo, espaço simples. */
export function limparTexto(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Tira a quantidade que a IA já mandou à parte: "2 50x30" → "50x30",
 * "5.0mm: 350 barras" → "5.0mm: barras". Só o número sai: a palavra do lado
 * fica ("160 varas 3/8" → "varas 3/8"), porque é ela que diz a família.
 *
 * Sai a primeira ocorrência solta, de preferência a do começo. Número colado
 * numa medida ("50x30", "10mm", "ch 18") é medida, não quantidade.
 */
function tirarQuantidade(texto: string, quantidade: number | null): string {
  if (quantidade === null) return texto;
  const candidatos = [...texto.matchAll(/\d+(?:[.,]\d+)?/g)].filter(achou => {
    const antes = texto.slice(0, achou.index);
    const depois = texto.slice(achou.index + achou[0].length);
    return IGUAL(Number(achou[0].replace(',', '.')), quantidade)
      && !/[\d.,/]$/.test(antes) && !/(?:\bx|\bpor|[/*]|\bch\.?|\bchapa|#|\bna)\s*$/.test(antes)
      && !/^[\d.,/]/.test(depois) && !/^\s*(?:x\b|x\d|por\b|[/*]|mm\b|cm\b|pol)|^"/.test(depois);
  });
  if (!candidatos.length) return texto;
  const achou = candidatos[0];
  const resto = (texto.slice(0, achou.index) + texto.slice(achou.index + achou[0].length)).replace(/\s+/g, ' ').trim();
  return resto || texto;
}

export interface Dicionario {
  /** Grafia do cliente → palavra do catálogo, aplicadas no texto limpo. */
  apelidos: [RegExp, string][];
  /** Palavra (já trocada) → moldes que ela aponta. */
  familias: [RegExp, string[]][];
  /** Ajuste do texto depois de saber a família (ex.: "3/16" em vergalhão = CA60 5.0). */
  ajustes?: (texto: string, familias: string[]) => string;
  /** O que a loja não vende ou não trabalha mais, no texto limpo (parte D: nunca um "não temos" seco). */
  naoTrabalhamos?: RegExp[];
}

/** O cliente pediu algo da lista do que a loja não vende? */
export function lojaNaoTrabalha(textoDoCliente: string, dicionario: Dicionario | null): boolean {
  const texto = limparTexto(textoDoCliente);
  return (dicionario?.naoTrabalhamos ?? []).some(r => r.test(texto));
}

/** Quão longe dois números estão (0 = iguais), pela diferença relativa entre os valores. */
function distancia(a: Numero, b: Numero): number {
  let menor = Infinity;
  for (const x of a.valores) for (const y of b.valores) menor = Math.min(menor, Math.abs(x - y) / Math.max(x, y, 1e-9));
  return menor;
}

/**
 * Os produtos mais próximos do que o cliente escreveu, para quando a medida
 * pedida não existe ("barra redonda 7/8" → 3/4 e 1). Cada número do cliente
 * casa com o número mais perto do produto (cada um usado uma vez); a nota do
 * produto é a soma das distâncias. Só produtos com medidas entram.
 */
export function maisProximos<P extends { medidas: Record<string, string> | null }>(pedido: PedidoNormalizado, produtos: P[], quantos = 3): P[] {
  if (!pedido.numeros.length) return [];
  const notas: { produto: P; nota: number }[] = [];
  for (const produto of produtos) {
    if (!produto.medidas) continue;
    const livres = numerosDoProduto(produto.medidas);
    if (!livres.length) continue;
    let nota = 0;
    for (const numero of pedido.numeros) {
      if (!livres.length) { nota += 1; continue; }
      let melhor = 0;
      for (let i = 1; i < livres.length; i++) if (distancia(numero, livres[i]) < distancia(numero, livres[melhor])) melhor = i;
      nota += distancia(numero, livres[melhor]);
      livres.splice(melhor, 1);
    }
    notas.push({ produto, nota });
  }
  return notas.sort((a, b) => a.nota - b.nota).slice(0, quantos).map(n => n.produto);
}

/**
 * O pedido de um item como números comparáveis.
 *
 * `quantidade` é a que a IA mandou à parte: quando o texto a traz ("2 50x30
 * ch18", "10.0 mm -> 7 barras"), ela sai, para não virar medida.
 */
export function normalizarPedido(textoDoCliente: string, quantidade: number | null, dicionario: Dicionario | null): PedidoNormalizado {
  let texto = limparTexto(textoDoCliente)
    // o sinal de vezes do celular: "70×30" é "70x30"
    .replace(/×/g, 'x')
    // palavra grudada no número: "solda2/5", "metalon70x30", "10kg" (o "x" de
    // "50x30" fica grudado: é separador de medida)
    .replace(/([a-wyz])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z]{2,})/g, '$1 $2')
    // 4"1/2 é 4 1/2 polegadas
    .replace(/(\d+)\s*"\s*(\d+\/\d+)"?/g, '$1 $2"')
    // "2 e meio", "3,meio" → 2,5 · 3,5 (dicionário §6)
    .replace(/(\d+)\s*(?:e|,)\s*meio\b/g, '$1,5')
    // "1 e 1/4" é 1 1/4 polegada, que a Distribuidora Exemplo escreve "1.1/4" (a parte
    // inteira de polegada tem um dígito só)
    .replace(/(?<![\d/.,])(\d)\s+e\s+(\d\/\d{1,2})(?![\d/])/g, '$1.$2')
    // "ø 12.5": o símbolo é bitola em milímetro (dicionário §2)
    .replace(/[øØ]\s*(\d+(?:[.,]\d+)?)/g, '$1 mm');
  texto = tirarQuantidade(texto, quantidade);
  for (const [padrao, troca] of dicionario?.apelidos ?? []) texto = texto.replace(padrao, troca);

  const familias = [...new Set((dicionario?.familias ?? []).filter(([p]) => p.test(texto)).flatMap(([, f]) => f))];
  if (dicionario?.ajustes) texto = dicionario.ajustes(texto, familias);

  return { texto, familias, numeros: numerosDoTexto(texto) };
}

const NUM = String.raw`\d+(?:[ .]\d+\/\d+|\/\d+|[.,]\d+)?`;

/** Os números de um texto já limpo, com a unidade quando ela está escrita. */
export function numerosDoTexto(texto: string): Numero[] {
  const numeros: Numero[] = [];
  // "1 1/4" é um número só; o espaço confunde com dois. Vira "1.1/4", que é como
  // a Distribuidora Exemplo também escreve. A parte inteira de polegada nunca passa de um
  // dígito: "100 3/8" são dois números.
  let resto = texto.replace(/\b(\d) (\d+)\/(\d+)\b/g, (todo: string, inteiro: string, a: string, b: string) =>
    (ehFracao(Number(a), Number(b)) ? `${inteiro}.${a}/${b}` : todo));

  // chapa escrita: "ch18", "ch 18", "chapa 3/16", "#18"
  resto = resto.replace(new RegExp(String.raw`(?:\bch\.?|\bchapa|#)\s*(${NUM})`, 'g'), (_, n: string) => {
    const numero = criarNumero(n, 'chapa');
    if (numero) numeros.push(numero);
    return ' ';
  });

  // milímetro escrito: "12.5 mm", "100mm"
  resto = resto.replace(new RegExp(String.raw`(${NUM})\s*mm\b`, 'g'), (_, n: string) => {
    const numero = criarNumero(n, 'mm');
    if (numero) numeros.push(numero);
    return ' ';
  });

  // polegada escrita: 7", 2 pol, 4 polegadas
  resto = resto.replace(new RegExp(String.raw`(${NUM})\s*(?:"|''|pol(?:egadas?)?\b)`, 'g'), (_, n: string) => {
    const numero = criarNumero(n, 'pol');
    if (numero) numeros.push(numero);
    return ' ';
  });

  // o resto: medidas soltas ou em grupo ("50x30", "50/30/18", "17 por 21").
  // A barra só é fração quando parece polegada (3/8, 5/16); senão separa.
  const partes = resto.split(/\s*(?:x|por|\*)\s*|\s+/).flatMap(p => separarBarras(p.replace(/^[^\d]+|[^\d]+$/g, '')));
  for (const limpa of partes) {
    if (!limpa) continue;
    const numero = criarNumero(limpa, null);
    if (numero) numeros.push(numero);
  }
  return numeros;
}

/** "50/30/18" → ["50", "30", "18"]; "3/8" fica; "1.1/2" fica. */
function separarBarras(parte: string): string[] {
  if (!parte.includes('/')) return [parte];
  const pedacos = parte.split('/');
  if (pedacos.length === 2) {
    const [a, b] = pedacos;
    const inteiro = a.match(/^(?:\d+\.)?(\d+)$/);
    if (inteiro && /^\d+$/.test(b) && ehFracao(Number(inteiro[1]), Number(b))) return [parte];
  }
  return pedacos;
}

/**
 * Os números que o cliente escreveu e o produto não tem. Vazio: tudo que ele
 * escreveu está no produto, em qualquer ordem ("30x50" bate com 50X30X18) e
 * podendo faltar medida ("100/40/14" bate com 100X40X17X14, o cliente não
 * escreve a aba). Quem decide o que fazer com a sobra é o fiscal.
 */
export function numerosQueNaoBatem(pedido: PedidoNormalizado, medidas: Record<string, string>): Numero[] {
  const livres = numerosDoProduto(medidas);
  const sobra: Numero[] = [];
  for (const numero of pedido.numeros) {
    // Cada número do produto serve a um número do pedido só: "20x20" não pode
    // bater duas vezes com o 20 de um 20X30.
    const i = livres.findIndex(p => numerosBatem(numero, p));
    if (i === -1) sobra.push(numero);
    else livres.splice(i, 1);
  }
  return sobra;
}

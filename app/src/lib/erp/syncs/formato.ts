// O formato das duas listas que a Distribuidora Exemplo manda nos syncs (contrato v4).
//
// Puro: corpo entra, lista validada sai. A regra que governa tudo aqui vem da
// regra do catálogo ("produto ausente é desativado"): se um item veio, mas
// incompleto, ele **não pode** ser tratado como ausente — o sistema deles
// mandou. Por isso o item incompleto que tem id sai em `idsIncompletos`: não é
// gravado, e também não é desativado.

export interface ProdutoDoSync {
  produto_id: string;
  descricao: string;
  unidade_venda: string;
  peso_kg: number;
  grupo: string;
  /** Filiais onde o produto existe (veio a mais em 30/09), sem repetição. */
  empresas: string[];
}

export interface CidadeDaRegiao { cidade: string; uf: string }

export interface RegiaoDoSync {
  regiao_id: string;
  nome: string;
  cidades: CidadeDaRegiao[];
  /** Os grupos do sync diário entregues aqui (proposta da v4). */
  grupos: string[] | null;
  /** A alternativa, se a regra deles for por produto. */
  produto_ids: string[] | null;
}

export type LeituraDoSync<T> =
  | {
    ok: true;
    itens: T[];
    problemas: string[];
    idsIncompletos: string[];
    /** O `falhas` da raiz: partes do sistema deles que não responderam. Lista
     *  com falha está incompleta, e lista incompleta não desativa nada. */
    falhasDoErp: string[];
    /** O `sincronizado_em` da raiz: quando eles montaram a lista. */
    geradaEm: string | null;
  }
  | { ok: false; motivo: string };

// Parte dos textos deles chega com dupla codificação (30/09): "VERGALHÃƒO" é o
// UTF-8 de "VERGALHÃO" lido como Windows-1252 e codificado de novo. A volta é
// devolver cada caractere ao seu byte no Windows-1252 e ler como UTF-8.
const WINDOWS_1252: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95,
  '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};
const utf8Estrito = new TextDecoder('utf-8', { fatal: true });

/** Texto certo passa intacto: só troca quando a volta dá UTF-8 válido. Assim,
 *  quando a Distribuidora Exemplo corrigir do lado dela, nada muda do nosso. */
export function consertarAcentos(valor: string): string {
  if (!/[ÂÃ][\u0080-¿Œ-™]/.test(valor)) return valor;
  const bytes: number[] = [];
  for (const c of valor) {
    const codigo = c.codePointAt(0)!;
    const byte = codigo <= 0xff ? codigo : WINDOWS_1252[c];
    if (byte === undefined) return valor;
    bytes.push(byte);
  }
  try {
    return utf8Estrito.decode(new Uint8Array(bytes));
  } catch {
    return valor;
  }
}

const texto = (v: unknown): string =>
  (typeof v === 'string' ? consertarAcentos(v.trim()) : typeof v === 'number' ? String(v) : '');

function lerRaiz(corpo: unknown): { falhasDoErp: string[]; geradaEm: string | null } {
  const r = (corpo ?? {}) as { falhas?: unknown; sincronizado_em?: unknown };
  return {
    falhasDoErp: Array.isArray(r.falhas) ? r.falhas.map(f => texto(f) || JSON.stringify(f)) : [],
    geradaEm: typeof r.sincronizado_em === 'string' ? r.sincronizado_em : null,
  };
}

/** Número, ou texto com número ("7,4" também). `null` quando não é. */
function numero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const limpo = v.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null;
  return Number(limpo);
}

const listaDeTextos = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.map(texto).filter(Boolean) : null;

export function lerProdutosDoSync(corpo: unknown): LeituraDoSync<ProdutoDoSync> {
  const lista = (corpo as { produtos?: unknown } | null)?.produtos;
  if (!Array.isArray(lista)) return { ok: false, motivo: 'A resposta não tem a lista "produtos".' };

  const itens: ProdutoDoSync[] = [];
  const problemas: string[] = [];
  const idsIncompletos: string[] = [];
  lista.forEach((bruto, i) => {
    const b = (bruto ?? {}) as Record<string, unknown>;
    const id = texto(b.produto_id);
    if (!id) {
      problemas.push(`item ${i}: sem produto_id`);
      return;
    }
    const descricao = texto(b.descricao);
    const unidade = texto(b.unidade_venda);
    const grupo = texto(b.grupo);
    const peso = numero(b.peso_kg);
    const faltando = [
      !descricao && 'descricao', !unidade && 'unidade_venda', !grupo && 'grupo', peso === null && 'peso_kg',
    ].filter(Boolean);
    if (faltando.length) {
      problemas.push(`${id}: ${faltando.join(', ')} ausente ou inválido`);
      idsIncompletos.push(id);
      return;
    }
    const empresas = [...new Set(listaDeTextos(b.empresas) ?? [])];
    itens.push({ produto_id: id, descricao, unidade_venda: unidade, peso_kg: peso!, grupo, empresas });
  });
  return { ok: true, itens, problemas, idsIncompletos, ...lerRaiz(corpo) };
}

export function lerRegioesDoSync(corpo: unknown): LeituraDoSync<RegiaoDoSync> {
  const lista = (corpo as { regioes?: unknown } | null)?.regioes;
  if (!Array.isArray(lista)) return { ok: false, motivo: 'A resposta não tem a lista "regioes".' };

  const itens: RegiaoDoSync[] = [];
  const problemas: string[] = [];
  const idsIncompletos: string[] = [];
  lista.forEach((bruto, i) => {
    const b = (bruto ?? {}) as Record<string, unknown>;
    const id = texto(b.regiao_id);
    if (!id) {
      problemas.push(`região ${i}: sem regiao_id`);
      return;
    }
    const nome = texto(b.nome);
    const cidadesBrutas = Array.isArray(b.cidades) ? b.cidades as Record<string, unknown>[] : [];
    const cidades = cidadesBrutas.map(c => ({ cidade: texto(c?.cidade), uf: texto(c?.uf).toUpperCase() }));
    const cidadesValidas = cidades.length > 0 && cidades.every(c => c.cidade && /^[A-Z]{2}$/.test(c.uf));
    const grupos = listaDeTextos(b.grupos);
    const produtoIds = listaDeTextos(b.produto_ids);
    // Grupos e produto_ids são opcionais: em 30/09 vieram só as cidades. A
    // região diz ONDE se entrega; o QUE, fica para produto × filial no orçamento.
    const faltando = [!nome && 'nome', !cidadesValidas && 'cidades'].filter(Boolean);
    if (faltando.length) {
      problemas.push(`${id}: ${faltando.join(', ')} ausente ou inválido`);
      idsIncompletos.push(id);
      return;
    }
    itens.push({ regiao_id: id, nome, cidades, grupos, produto_ids: produtoIds });
  });
  return { ok: true, itens, problemas, idsIncompletos, ...lerRaiz(corpo) };
}

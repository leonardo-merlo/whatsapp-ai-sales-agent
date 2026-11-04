// O dicionário (v2_girias) em uso: a família que o texto do cliente aponta
// (trava 1) e o que cada qualificador da IA quer dizer no produto.
//
// Ex.: "50 varas de ferro 3.8" → vergalhão; na família disco, "inox" é o
// tipo corte; na família arame, "liso" não distingue nada (é o comum).

import { familia as familiaPorId } from './familias';
import { limpar } from './numeros';
import { GIRIAS } from './regras';

export interface FamiliaDoDicionario {
  familias: string[];
  /** Ids das gírias que casaram. */
  girias: string[];
  /** Alguma gíria que casou pede confirmação (ex.: "saída" é a boquilha, confirme). */
  confirmar: boolean;
  /** A família de uma gíria que corrige a leitura da IA, quando só uma casou. */
  corrige: string | null;
}

/** As famílias que o texto aponta, pelas gírias. Vazio: o dicionário não sabe (silencioso). */
export function familiaDoTexto(texto: string): FamiliaDoDicionario {
  const t = limpar(texto);
  const casadas = GIRIAS.familias.filter(g => new RegExp(g.termo).test(t) && !(g.ignorar_se && new RegExp(g.ignorar_se).test(t)));
  // A gíria de uma família só ganha da genérica que a inclui: "perfil simples"
  // casa com g_perfil_simples e com g_perfil; fica só a simples.
  const unicas = new Set(casadas.filter(g => g.familias.length === 1).map(g => g.familias[0]));
  const familias = new Set<string>();
  for (const g of casadas) {
    const restritas = g.familias.length > 1 && g.familias.some(f => unicas.has(f)) ? g.familias.filter(f => unicas.has(f)) : g.familias;
    for (const f of restritas) familias.add(f);
  }
  const corrigem = [...new Set(casadas.filter(g => g.corrige_familia && g.familias.length === 1).map(g => g.familias[0]))];
  return { familias: [...familias], girias: casadas.map(g => g.id), confirmar: casadas.some(g => g.confirmar), corrige: corrigem.length === 1 ? corrigem[0] : null };
}

export interface QualificadorLido {
  texto: string;
  /** Atributo e valor do produto que ele aponta. */
  atributo?: string;
  valor?: string;
  /** Palavra que não distingue produto nesta família. */
  ignorado?: boolean;
  regra?: string;
}

const casaFamilia = (lista: string, familia: string): boolean => lista === '*' || lista.split('|').includes(familia);

/** O que um qualificador da IA quer dizer na família. Sem `atributo` nem `ignorado`: não reconhecido. */
export function lerQualificador(familiaId: string, qualificador: string): QualificadorLido {
  const t = limpar(qualificador).replace(/[.,;:]$/, '');
  for (const g of GIRIAS.qualificadores) {
    if (g.familia === familiaId && new RegExp(g.termo).test(t)) return { texto: qualificador, atributo: g.atributo, valor: g.valor, regra: g.id };
  }
  const f = familiaPorId(familiaId);
  const chave = t.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  for (const a of f?.atributos ?? []) {
    for (const [valor, regex] of Object.entries(a.valores)) {
      if (chave === valor || new RegExp(regex, 'i').test(t.toUpperCase())) return { texto: qualificador, atributo: a.nome, valor };
    }
  }
  for (const g of GIRIAS.ignorar) {
    if (casaFamilia(g.familia, familiaId) && new RegExp(g.termo).test(t)) return { texto: qualificador, ignorado: true, regra: g.id };
  }
  // O próprio nome da família ("simples", "barra chata") não é qualificador. Só
  // vale se, tirado o nome, não sobrar palavra: "barra roscada" sobra "roscada".
  let resto = ` ${t} `;
  for (const g of GIRIAS.familias) if (g.familias.includes(familiaId)) resto = resto.replace(new RegExp(g.termo, 'g'), ' ');
  const sobra = resto.split(/[^a-z0-9]+/).filter(p => p && !/^(?:de|da|do|para|com|em|p)$/.test(p));
  if (resto.trim() !== t && !sobra.length) return { texto: qualificador, ignorado: true, regra: 'nome_da_familia' };
  return { texto: qualificador };
}

/** O vocabulário que vai no prompt da extração: família → palavras do cliente. */
export function vocabularioDoPrompt(): string {
  const linhas: string[] = [];
  for (const g of GIRIAS.familias) {
    const exemplo = g.positivo.replace(/"/g, '\\"');
    linhas.push(`- ${g.familias.join(' ou ')}: ex. "${exemplo}"`);
  }
  return linhas.join('\n');
}

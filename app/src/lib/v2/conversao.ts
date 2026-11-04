// Conversão de uma medida para a unidade canônica da família (Fase E, passo 1).
//
// Ex.: vergalhão "3/8" → 10 (mm, tabela comercial); metalon "0,90mm" → chapa 20;
// roldana "100" → 4 (polegada); barra chata "1 e 1/4" → 1.25 (polegada).
//
// A conta é do código, não da IA. O que não tem conversão na tabela não é
// inventado: volta com `erro`, e o item não se resolve sozinho.

import conversaoJson from './dados/conversao.json' with { type: 'json' };
import { formatar, iguais, lerUnidade, lerValor, type ValorLido } from './numeros';
import type { Familia, MedidaDoMolde, Unidade } from './tipos';

interface Tabela { id: string; tipo: 'pol_para_mm' | 'mm_para_chapa' | 'mm_para_pol'; familias: string[]; pares: [string, string][] }
interface Especial { id: string; familia: string; etiqueta: string; de: string; de_forma: 'fracao' | 'decimal' | 'inteiro_ou_decimal'; para: string }

export const CONVERSAO = conversaoJson as unknown as { versao: string; tabelas: (Tabela & Record<string, unknown>)[]; especiais: (Especial & Record<string, unknown>)[]; gerais: Record<string, unknown>[] };

export interface MedidaNormalizada {
  valor: string | null;
  /** Ids das linhas de conversão usadas. */
  regras: string[];
  erro?: string;
}

const valorDe = (texto: string): number => lerValor(texto)?.valor ?? Number.NaN;

function tabela(tipo: Tabela['tipo'], familia: string): Tabela | undefined {
  return CONVERSAO.tabelas.find(t => t.tipo === tipo && (t.familias.includes('*') || t.familias.includes(familia)));
}

function procurar(t: Tabela | undefined, valor: number, lado: 0 | 1): string | null {
  if (!t) return null;
  const par = t.pares.find(p => iguais(valorDe(p[lado]), valor));
  return par ? par[lado === 0 ? 1 : 0] : null;
}

/** Chapa como código: 18 → "18"; 1/8 → "1/8"; 1.8 → "1.8". */
function codigoDeChapa(lido: ValorLido): string {
  if (lido.forma === 'fracao') {
    const f = lido.texto.match(/^(\d+)\/(\d+)$/);
    return f ? `${Number(f[1])}/${Number(f[2])}` : lido.texto;
  }
  return formatar(lido.valor);
}

function especial(familia: string, etiqueta: string, lido: ValorLido): Especial | undefined {
  return CONVERSAO.especiais.find(e => {
    if (e.familia !== familia || e.etiqueta !== etiqueta) return false;
    const de = lerValor(e.de);
    if (!de) return false;
    if (e.de_forma === 'fracao') return lido.forma === 'fracao' && lido.texto === de.texto;
    if (e.de_forma === 'decimal') return lido.forma === 'decimal' && iguais(lido.valor, de.valor);
    return lido.forma !== 'fracao' && iguais(lido.valor, de.valor);
  });
}

/**
 * Normaliza um valor escrito para a unidade da medida do molde.
 * `unidadeEscrita` é a que a IA copiou à parte; a colada no valor também vale.
 */
export function normalizarMedida(familia: Familia, medida: MedidaDoMolde, bruto: string, unidadeEscrita: string | null = null): MedidaNormalizada {
  const lido = lerValor(bruto);
  if (!lido) return { valor: null, regras: [], erro: `"${bruto}" não é um número` };
  const regras: string[] = [];
  const unidade: Unidade | null = lido.unidade ?? lerUnidade(unidadeEscrita);

  const e = especial(familia.id, medida.etiqueta, lido);
  if (e) return { valor: formatar(valorDe(e.para)), regras: [e.id] };

  switch (medida.unidade) {
    case 'mm': {
      if (unidade === 'pol' || (unidade === null && lido.forma === 'fracao')) {
        const mm = procurar(tabela('pol_para_mm', familia.id), lido.valor, 0);
        if (mm === null) return { valor: null, regras, erro: `sem conversão de ${lido.texto}" para mm em ${familia.id}` };
        return { valor: formatar(valorDe(mm)), regras: ['bitola_comercial'] };
      }
      if (unidade === 'cm') return { valor: formatar(lido.valor * 10), regras };
      if (unidade && unidade !== 'mm') return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera mm` };
      return { valor: formatar(lido.valor), regras };
    }
    case 'pol': {
      if (unidade === 'mm' || (unidade === null && lido.forma !== 'fracao' && lido.valor >= 25)) {
        if (unidade === null) regras.push('numero_grande_em_polegada_e_mm');
        const pol = procurar(tabela('mm_para_pol', familia.id), lido.valor, 0);
        if (pol === null) return { valor: null, regras, erro: `sem conversão de ${lido.texto} mm para polegada em ${familia.id}` };
        return { valor: formatar(valorDe(pol)), regras: [...regras, 'mm_para_pol_roldana_guia'] };
      }
      if (unidade && unidade !== 'pol') return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera polegada` };
      return { valor: formatar(lido.valor), regras };
    }
    case 'chapa': {
      if (unidade === 'mm' || (lido.forma === 'decimal' && unidade !== 'chapa')) {
        const chapa = procurar(tabela('mm_para_chapa', familia.id), lido.valor, 0);
        if (chapa !== null) return { valor: chapa, regras: ['mm_para_chapa'] };
        if (unidade === 'mm') return { valor: null, regras, erro: `${lido.texto} mm não está na tabela de chapas` };
      }
      if (lido.forma === 'decimal') {
        // 2.25 e 2.65 escritos como chapa também são a 13 e a 12
        const chapa = procurar(tabela('mm_para_chapa', familia.id), lido.valor, 0);
        if (chapa !== null) return { valor: chapa, regras: ['mm_para_chapa'] };
      }
      if (unidade && unidade !== 'chapa') return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera chapa` };
      return { valor: codigoDeChapa(lido), regras };
    }
    case 'm': {
      if (unidade === 'cm') return { valor: formatar(lido.valor / 100), regras };
      if (unidade === 'mm') return { valor: formatar(lido.valor / 1000), regras };
      if (unidade && unidade !== 'm') return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera metro` };
      return { valor: formatar(lido.valor), regras };
    }
    case 'cm': {
      if (unidade === 'm') return { valor: formatar(lido.valor * 100), regras };
      if (unidade === 'mm') return { valor: formatar(lido.valor / 10), regras };
      if (unidade && unidade !== 'cm') return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera cm` };
      return { valor: formatar(lido.valor), regras };
    }
    default: {
      if (unidade && unidade !== medida.unidade && !(medida.unidade === 'l' && unidade === null)) {
        return { valor: null, regras, erro: `${bruto}: unidade ${unidade} onde se espera ${medida.unidade}` };
      }
      return { valor: formatar(lido.valor), regras };
    }
  }
}

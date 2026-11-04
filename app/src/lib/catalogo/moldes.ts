// As medidas de cada produto, lidas da descrição por molde.
//
// Parte A do fiscal (prompt-nova-sessao-fiscal.md, decisões do Leonardo em
// 01/10): um molde por grupo do ERP sabe onde ficam os números na descrição
// daquele grupo. O resultado vai para `catalogo_produtos.molde`/`medidas`,
// recalculado a cada importação (CSV ou sync diário). A descrição nunca muda.
//
// **Três estados, e o painel mostra o do meio:**
//   - `molde` nulo: o grupo não tem medida (fechadura, tinta) ou a organização
//     não tem moldes. Nada para conferir.
//   - `molde` preenchido e `medidas` nulo: o grupo tem molde e a descrição veio
//     escrita de um jeito que ele não lê. É a lista "sem medidas": crescer é
//     sinal de que a empresa mudou o jeito de cadastrar. Sem IA aqui: o produto
//     segue funcionando só pela descrição, como antes.
//   - os dois preenchidos: as colunas, como estão escritas ("3/8", "10.0").
//
// **A chave é a lista abaixo.** Organização fora dela não ganha coluna nenhuma.

import { MOLDES_EXEMPLO } from './moldes-exemplo';
import { DICIONARIO_EXEMPLO } from './dicionario-exemplo';
import type { Dicionario } from './normalizar';

export interface Molde {
  nome: string;
  /** Casa com o nome do grupo do ERP. */
  grupo: RegExp;
  /** Casam com a descrição inteira; os grupos de captura nomeados são as colunas. */
  descricao: RegExp[];
}

export const MOLDES_POR_ORG: Record<string, Molde[]> = {
  'e8e00000-0000-4000-8000-0000000000e1': MOLDES_EXEMPLO, // Distribuidora Exemplo
};

/** O dicionário de cada organização para normalizar o que o cliente escreve. Mesma chave dos moldes. */
export const DICIONARIO_POR_ORG: Record<string, Dicionario> = {
  'e8e00000-0000-4000-8000-0000000000e1': DICIONARIO_EXEMPLO, // Distribuidora Exemplo
};

export interface MedidasDoProduto {
  molde: string | null;
  medidas: Record<string, string> | null;
}

const SEM_MOLDE: MedidasDoProduto = { molde: null, medidas: null };

function normalizar(texto: string): string {
  return texto.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** A chapa que o nome do grupo diz ("TUBOS QUAD. E RETANG. CH. 18" → 18). */
export function chapaDoGrupo(grupo: string): string | null {
  const achou = normalizar(grupo).match(/CH\. ?(\d+\/\d+|\d+(?:\.\d+)?)$/);
  return achou ? achou[1] : null;
}

/** A chapa 13 e a 12 aparecem na descrição em milímetro (2.25 e 2.65). */
const CHAPA_EM_MM: Record<string, string[]> = { 13: ['13', '2.25', '2,25'], 12: ['12', '2.65', '2,65'] };

function mesmaChapa(doGrupo: string, daDescricao: string): boolean {
  return (CHAPA_EM_MM[doGrupo] ?? [doGrupo]).includes(daDescricao);
}

/**
 * As medidas de um produto.
 *
 * A chapa: quando a descrição traz, vale a da descrição (decisão de 01/10: é o
 * texto do ERP, o que vai para o cliente e para o orçamento). Quando não traz
 * (o perfil de chapa 1.8), vem do nome do grupo, com `chapa_origem: 'grupo'`.
 * Quando as duas existem e não batem (701730, tubo 5/8 X 18 no grupo CH. 1/8),
 * a do grupo fica guardada em `chapa_do_grupo`, para o painel mostrar.
 */
export function lerMedidas(orgId: string, grupo: string, descricao: string): MedidasDoProduto {
  const moldes = MOLDES_POR_ORG[orgId];
  if (!moldes) return SEM_MOLDE;
  const molde = moldes.find(x => x.grupo.test(normalizar(grupo)));
  if (!molde) return SEM_MOLDE;

  for (const padrao of molde.descricao) {
    const achou = normalizar(descricao).match(padrao);
    if (!achou) continue;
    const medidas: Record<string, string> = {};
    for (const [nome, valor] of Object.entries(achou.groups ?? {})) if (valor !== undefined) medidas[nome] = valor;

    const doGrupo = chapaDoGrupo(grupo);
    if (doGrupo && !medidas.chapa) {
      medidas.chapa = doGrupo;
      medidas.chapa_origem = 'grupo';
    } else if (doGrupo && medidas.chapa && !mesmaChapa(doGrupo, medidas.chapa)) {
      medidas.chapa_do_grupo = doGrupo;
    }
    return { molde: molde.nome, medidas };
  }
  return { molde: molde.nome, medidas: null };
}


/** O nome de cada coluna como aparece na tela. Coluna fora daqui sai com o próprio nome. */
const ROTULO_DA_MEDIDA: Record<string, string> = {
  diametro: 'diâmetro', polegada: 'pol', numero: 'nº', metros: 'rolo', peca: 'peça',
};
/** Colunas que o sistema usa e a pessoa não precisa ver. */
const MEDIDAS_INTERNAS = new Set(['chapa_origem', 'chapa_do_grupo']);

/** As medidas numa linha curta: "bitola 3/8 · 10.0 mm". */
export function textoDasMedidas(medidas: Record<string, string>): string {
  return Object.entries(medidas)
    .filter(([nome]) => !MEDIDAS_INTERNAS.has(nome))
    .map(([nome, valor]) => (nome === 'mm' ? `${valor} mm` : `${ROTULO_DA_MEDIDA[nome] ?? nome} ${valor}`))
    .join(' · ');
}

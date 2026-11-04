// A chave da máquina de estados: MAQUINA_ORCAMENTO=ligado. Padrão: desligada.
//
// Só vale no roteiro de vendas e só com a v2 ligada (PIPELINE_VERSION=v2),
// porque a etapa dos itens É a v2. Qualquer outro valor (vazio, erro de
// digitação) deixa o motor exatamente como estava.

import { usaPipelineV2 } from '../../v2/pipeline';

export function maquinaLigada(valor: string | undefined = process.env.MAQUINA_ORCAMENTO): boolean {
  return valor?.trim() === 'ligado';
}

/** A máquina conduz esta conversa? */
export function usaMaquina(
  roteiro: string | null | undefined,
  chaves: { maquina?: string; pipeline?: string } = {},
): boolean {
  return maquinaLigada(chaves.maquina ?? process.env.MAQUINA_ORCAMENTO)
    && usaPipelineV2(roteiro, chaves.pipeline ?? process.env.PIPELINE_VERSION);
}

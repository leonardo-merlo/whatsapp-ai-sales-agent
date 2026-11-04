// As abas da seção Desenvolvimento, no mesmo molde de `config-tabs.ts`.
//
// A seção inteira é de admin (`verDesenvolvimento`): quem filtra por papel é a
// página, não este módulo — aqui não há aba que um papel veja e outro não.
export type DesenvolvimentoTabKey = 'chamadas' | 'fluxo' | 'medidas' | 'configuracao';

export const DESENVOLVIMENTO_TABS: { key: DesenvolvimentoTabKey; label: string; desc: string }[] = [
  { key: 'chamadas', label: 'Chamadas', desc: 'Tudo que saiu para o sistema de gestão e tudo que voltou' },
  { key: 'fluxo', label: 'Fluxo', desc: 'O que o agente faz, em que ordem, e o que ele chama em cada passo' },
  { key: 'medidas', label: 'Medidas', desc: 'Produtos que o sistema não conseguiu medir pela descrição' },
  { key: 'configuracao', label: 'Configuração', desc: 'Endereço e chave de acesso do sistema de gestão' },
];

/**
 * O pedaço de URL de cada aba.
 *
 * Chamadas não tem pedaço nenhum: ela mora na raiz da seção, porque é a tela
 * que se abre dezenas de vezes por dia durante a homologação e `/desenvolvimento`
 * é o endereço que se digita de memória. As outras abas ganham sufixo.
 */
export const SLUG_DA_ABA: Record<DesenvolvimentoTabKey, string> = {
  chamadas: '',
  fluxo: 'fluxo',
  medidas: 'medidas',
  configuracao: 'configuracao',
};

export function caminhoDaAba(key: DesenvolvimentoTabKey): string {
  const slug = SLUG_DA_ABA[key];
  return slug ? `/desenvolvimento/${slug}` : '/desenvolvimento';
}

/** `undefined` quando o endereço não corresponde a aba nenhuma. */
export function abaDoSlug(slug: string): DesenvolvimentoTabKey | undefined {
  if (!slug) return undefined;
  return DESENVOLVIMENTO_TABS.find(t => SLUG_DA_ABA[t.key] === slug)?.key;
}

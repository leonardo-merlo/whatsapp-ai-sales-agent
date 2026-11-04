// Embalagem de venda: produto que só sai em caixa fechada. A quantidade que o
// cliente pediu arredonda para cima, para um total que dê para montar com as
// caixas, e o cliente fica sabendo. Por enquanto só parafuso (Vendedor 1, teste de
// campo de 20/10: pediu 150 e a caixa é de 100 ou 200). Outro produto entra
// como mais uma linha em EMBALAGENS.

export interface RegraDeEmbalagem {
  id: string;
  /** Famílias da v2 em que a regra vale. */
  familias: string[];
  /** Ou o rótulo do produto (sem acento, maiúsculo) bate com isto. */
  rotulo: RegExp;
  /** Como o produto aparece no aviso: "Parafuso". */
  nome: string;
  /** Tamanhos de caixa, em unidades. */
  caixas: number[];
  origem: string;
}

export const EMBALAGENS: RegraDeEmbalagem[] = [
  {
    id: 'parafuso_caixa', familias: ['parafuso_auto_brocante', 'parafuso_outros'], rotulo: /\bPARAFUSOS?\b/, nome: 'Parafuso', caixas: [100, 200],
    origem: 'Vendedor 1, teste de campo de 20/10 (T9): parafuso só em caixa de 100 ou 200',
  },
];

export function regraDeEmbalagem(familia: string | null | undefined, rotulo: string | null | undefined): RegraDeEmbalagem | null {
  return EMBALAGENS.find(r => (!!familia && r.familias.includes(familia)) || (!!rotulo && r.rotulo.test(rotulo.toUpperCase()))) ?? null;
}

/** O menor total, a partir da quantidade, que dá para montar com as caixas: 150 → 200, 600 → 600. */
export function totalEmCaixas(quantidade: number, caixas: number[]): number {
  const tamanhos = caixas.filter(c => Number.isInteger(c) && c > 0);
  if (!tamanhos.length || quantidade <= 0) return quantidade;
  const alvo = Math.ceil(quantidade);
  const limite = alvo + Math.max(...tamanhos);
  const alcanca = new Array<boolean>(limite + 1).fill(false);
  alcanca[0] = true;
  for (let s = 1; s <= limite; s++) alcanca[s] = tamanhos.some(c => c <= s && alcanca[s - c]);
  for (let s = alvo; s <= limite; s++) if (alcanca[s]) return s;
  return quantidade;
}

/** "100 ou 200", "50, 100 ou 200". */
function caixasPorExtenso(caixas: number[]): string {
  return caixas.length > 1 ? `${caixas.slice(0, -1).join(', ')} ou ${caixas.at(-1)}` : String(caixas[0]);
}

/** `aviso`: a frase própria do ajuste, quando não é de caixa (calha em peças). */
export interface AjusteDeEmbalagem { regra: RegraDeEmbalagem; pedido: number; ajustado: number; aviso?: string }

/** Calha pedida em metros vira peças (conversa.ts, `pecasDeCalha`). Não entra em EMBALAGENS: não é caixa. */
export const CALHA_EM_PECAS: RegraDeEmbalagem = {
  id: 'calha_em_pecas', familias: ['calha'], rotulo: /\bCALHA\b/, nome: 'Calha', caixas: [],
  origem: 'Vendedor 1, 22/10: 12 metros de calha são 2 peças de 6 m',
};

/** O aviso ao cliente, uma linha por regra: "Parafuso vem em caixa de 100 ou 200, então coloquei 200." */
export function avisosDeEmbalagem(ajustes: AjusteDeEmbalagem[]): string[] {
  const porRegra = new Map<string, AjusteDeEmbalagem[]>();
  for (const a of ajustes) if (!a.aviso) porRegra.set(a.regra.id, [...(porRegra.get(a.regra.id) ?? []), a]);
  return [...ajustes.filter(a => a.aviso).map(a => a.aviso!), ...[...porRegra.values()].map(lista => {
    const r = lista[0].regra;
    const totais = lista.map(a => String(a.ajustado));
    const coloquei = totais.length > 1 ? `${totais.slice(0, -1).join(', ')} e ${totais.at(-1)}` : totais[0];
    return `${r.nome} vem em caixa de ${caixasPorExtenso(r.caixas)}, então coloquei ${coloquei}.`;
  })];
}

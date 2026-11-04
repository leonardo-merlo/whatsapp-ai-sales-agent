// A lista do cliente conta em unidades ("200 parafusos"); o ERP da Distribuidora Exemplo
// conta na unidade de venda do produto. Teste de campo de 21/10: o parafuso é
// vendido em "CT" (cento), e mandar 200 cotou 200 centos (R$ 13.904).

/** Quantas unidades da lista cabem em uma unidade do ERP. */
const UNIDADES_POR_UNIDADE_DO_ERP: Record<string, number> = { CT: 100 };

export function quantidadeNaUnidadeDoErp(quantidade: number, unidade: string | null | undefined): number {
  const porUnidade = unidade ? UNIDADES_POR_UNIDADE_DO_ERP[unidade.trim().toUpperCase()] : undefined;
  return porUnidade ? Math.ceil(quantidade / porUnidade) : quantidade;
}

// Soma um período (mensal/anual) a uma data ISO (YYYY-MM-DD), em UTC.
// Usado para calcular até quando um plano fica válido (periodo_fim).

export type Intervalo = 'mensal' | 'anual';

export function somaIntervalo(dataIso: string, intervalo: Intervalo): string {
  const d = new Date(`${dataIso}T00:00:00Z`);
  if (intervalo === 'anual') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Crédito proporcional ao tempo NÃO usado do período atual — o valor pago vezes
// a fração de dias que ainda restam até o fim do período (0 se já venceu).
export function creditoProporcional(
  valorPagoCentavos: number, periodoInicioIso: string, periodoFimIso: string, hojeIso: string,
): number {
  const inicio = Date.parse(`${periodoInicioIso}T00:00:00Z`);
  const fim = Date.parse(`${periodoFimIso}T00:00:00Z`);
  const hoje = Date.parse(`${hojeIso}T00:00:00Z`);
  const total = fim - inicio;
  const restante = fim - hoje;
  if (!Number.isFinite(total) || total <= 0 || restante <= 0) return 0;
  return Math.round(valorPagoCentavos * Math.min(restante / total, 1));
}

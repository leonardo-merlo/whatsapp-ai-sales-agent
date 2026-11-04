// Fuso horário de exibição.
//
// Todo horário que o usuário lê é o de São Paulo. O servidor da Vercel roda em
// UTC, e os dados iniciais das telas são montados lá (`fetchInitialData`), então
// formatar sem `timeZone` mostra tudo 3 h adiantado: uma mensagem das 18:26
// aparecia como 21:26. Por isso nenhum formatador de data/hora do app chama
// `toLocale*` direto — passa por aqui.
//
// Vale também para as comparações: "hoje", "ontem" e o dia do gráfico têm que
// ser o dia em São Paulo, não o dia em UTC (das 21 h à meia-noite os dois
// diferem).

export const FUSO_EXIBICAO = 'America/Sao_Paulo';

type Instante = string | number | Date;

/** Dia em São Paulo, no formato ISO `2026-09-13`. Serve para comparar dias. */
export function diaEmSP(instante: Instante = new Date()): string {
  return new Date(instante).toLocaleDateString('en-CA', { timeZone: FUSO_EXIBICAO });
}

/** Hoje em São Paulo, `2026-09-13`. */
export function hojeEmSP(): string {
  return diaEmSP(new Date());
}

/** Hora do relógio de São Paulo, `18:26`. */
export function horaEmSP(instante: Instante): string {
  return new Date(instante).toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: FUSO_EXIBICAO,
  });
}

/** Dia e mês em São Paulo, `13/09`. */
export function diaMesEmSP(instante: Instante): string {
  return new Date(instante).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: FUSO_EXIBICAO,
  });
}

/** Data completa em São Paulo, `13/09/2026`. */
export function dataBRemSP(instante: Instante): string {
  return new Date(instante).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: FUSO_EXIBICAO,
  });
}

/** Hora cheia do relógio de São Paulo (0 a 23), para agrupar por faixa. */
export function horaDoDiaEmSP(instante: Instante): number {
  return Number(new Date(instante).toLocaleString('en-GB', {
    hour: '2-digit', hour12: false, timeZone: FUSO_EXIBICAO,
  }).slice(0, 2));
}

/**
 * Dia da semana (0 = domingo) do dia ISO informado, sem passar pelo fuso do
 * ambiente: o dia já está resolvido, só falta saber que dia da semana é.
 */
export function diaDaSemanaDoISO(diaISO: string): number {
  return new Date(`${diaISO}T12:00:00Z`).getUTCDay();
}

/**
 * Formata um dia ISO (`2026-09-13`, sem hora) para exibição. Não converte fuso
 * de propósito: coluna `date` não tem hora, converter só faria o dia andar.
 */
export function fmtDiaISO(diaISO: string, opcoes: Intl.DateTimeFormatOptions): string {
  return new Date(`${diaISO}T12:00:00Z`).toLocaleDateString('pt-BR', { ...opcoes, timeZone: 'UTC' });
}

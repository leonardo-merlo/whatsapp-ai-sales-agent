// Quando a IA de vendas PODE ficar em silêncio.
//
// A instrução do painel manda ficar calada fora de pedido de orçamento, mas a
// decisão não pode ser só do modelo. Em 21/09 de manhã, na conversa de teste do
// Leonardo, ela ficou calada também em "quero um orçamento" — justamente o que
// ela existe para atender. Esta regra é a trava: o modelo pode escolher o
// silêncio, e o código só aceita quando é seguro.

/** Palavras que dizem que o cliente está no assunto do trabalho da IA. */
const ASSUNTO_DE_ORCAMENTO = /or[çc]ament|or[çc]ar|cota[çc]|\bcotar|pre[çc]o|pedido|comprar|\bcnpj\b|\bcpf\b|\d{11,}|\d{2,3}\.\d{3}\.\d{3}/i;

/** Até quanto tempo depois uma pergunta da IA ainda está esperando resposta. */
export const MINUTOS_DE_PERGUNTA_PENDENTE = 10;

export function silencioPermitido(entrada: {
  /** O que o cliente escreveu desde a última fala da IA. */
  falaDoCliente: string;
  /** A última fala da IA hoje nesta conversa, se houver. */
  ultimaFalaDaIa: string | null;
  /** Há quantos minutos foi essa fala. */
  minutosDesdeAFalaDaIa: number | null;
  usouFerramenta: boolean;
}): boolean {
  if (entrada.usouFerramenta) return false;
  if (ASSUNTO_DE_ORCAMENTO.test(entrada.falaDoCliente)) return false;
  // A IA fez uma pergunta há pouco e o cliente está respondendo: calar agora é
  // largar o cliente no meio do fluxo. Pergunta antiga não conta: um bom dia
  // quinze minutos depois é conversa nova.
  if (entrada.ultimaFalaDaIa?.trim().endsWith('?')
    && (entrada.minutosDesdeAFalaDaIa ?? Infinity) <= MINUTOS_DE_PERGUNTA_PENDENTE) return false;
  return true;
}

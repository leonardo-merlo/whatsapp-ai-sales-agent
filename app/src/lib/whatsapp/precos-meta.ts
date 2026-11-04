// Preço por mensagem que a Meta cobra no Brasil, em reais.
//
// Consultado em 2026-09-25 em https://developers.facebook.com/docs/whatsapp/pricing
// (tabela "effective July 1, 2026", linha Brazil, coluna BRL; a tabela de
// 01/10/2026 repete os mesmos valores e acrescenta Serviço). Preço muda com o
// tempo: confira a página antes de mexer aqui, e troque a data junto.
//
// Quem paga é o cliente, direto à Meta. A Wappia só mostra o número para ele
// não tomar susto na fatura.

export const PRECOS_META_CONSULTADOS_EM = '25/09/2026';
export const FONTE_PRECOS_META = 'https://developers.facebook.com/docs/whatsapp/pricing';

export const PRECO_POR_MENSAGEM_BRL: Record<'MARKETING' | 'UTILITY' | 'AUTHENTICATION', number> = {
  MARKETING: 0.3217,
  UTILITY: 0.035,
  AUTHENTICATION: 0.035,
};

/** A partir de 01/10/2026 a resposta dentro da janela deixa de ser grátis
 *  sem limite: 1.000 por mês por número, depois este valor cada. */
export const PRECO_SERVICO_BRL_A_PARTIR_DE_OUT_2026 = 0.035;
export const SERVICO_GRATIS_POR_MES = 1000;

export function reaisPorMensagem(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

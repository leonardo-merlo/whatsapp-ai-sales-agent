// O "sim" que vale para as ações sem volta: fechar a lista, cancelar o
// orçamento. Válvula de escape de 22/10: "sim, mas tira o prego" confirmava a
// lista com o prego. Usado pela lista da v2 e pela máquina.

import { limpar } from './numeros';

const SIM_INTEIRO = /^(?:(?:sim|s|ok|okay|isso|isso mesmo|isso ai|exato|exatamente|certo|correto|perfeito|confirmo|confirmado|pode|pode sim|pode ser|pode fechar|pode seguir|pode mandar|pode cancelar|fechado|fechou|fecha|beleza|blz|show|tudo certo|ta certo|esta certo|ta bom|esta bom)[\s,.!]*)+$/;

/** A mensagem INTEIRA é um sim ("ok", "pode fechar", "sim sim 👍")? */
export function simClaro(texto: string): boolean {
  if (texto.includes('?')) return false;
  return SIM_INTEIRO.test(limpar(texto).replace(/[^\p{L}\p{N}\s,.!]/gu, '').trim());
}

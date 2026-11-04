// O dicionário da Distribuidora Exemplo (empresa fictícia da demo) para a
// normalização: grafias do cliente, a família que cada palavra aponta e o que a
// loja não trabalha. Os nomes das famílias são os nomes dos moldes
// (moldes-exemplo.ts).

import type { Dicionario } from './normalizar';

const VERGALHAO = ['vergalhão CA50', 'vergalhão CA60'];

export const DICIONARIO_EXEMPLO: Dicionario = {
  apelidos: [
    [/\barrames?\b/g, 'arame'],
    [/\bmetalons\b/g, 'metalon'],
    [/\b(?:varas|vara|vergas|verga|vergalhoes|vergalhao)\b/g, 'vergalhao'],
    [/\bauto ?brocantes?\b/g, 'auto brocante'],
  ],
  familias: [
    [/\bvergalhao\b|\bferro\b(?! chato\b)|\bbarras?\b(?! chatas?\b)/, VERGALHAO],
    [/\bmetalon\b/, ['metalon']],
    [/\bbarras? chatas?\b/, ['barra chata']],
    [/\bpregos?\b/, ['prego']],
    [/\bfarpado\b/, ['arame farpado']],
    [/\barame\b(?!.*\bfarpado\b)/, ['arame']],
    [/\bparafusos?\b|\bauto brocante\b/, ['parafuso auto brocante']],
    [/\btelhas?\b/, ['telha']],
    [/\bcalhas?\b/, ['calha']],
    [/\bdiscos?\b/, ['disco']],
  ],
  // "3/16" em vergalhão é o CA60 5.0 no balcão.
  ajustes: (texto, familias) => (familias.some(f => VERGALHAO.includes(f)) ? texto.replace(/\b3\/16\b/g, '5.0 mm') : texto),
  naoTrabalhamos: [/\bareia\b/, /\bbrita\b/, /\btijolos?\b/, /\bcimento\b/],
};

// Os moldes da Distribuidora Exemplo (empresa fictícia da demo): para cada grupo
// do ERP com medida, o padrão que lê a descrição INTEIRA e tira dela as colunas
// (bitola, largura, chapa...).
//
// Ex.: grupo "TUBO METALON CH. 18", `TUBO METALON 30X20X18` → largura 30,
// altura 20, chapa 18. Os valores saem como estão escritos ("3/8", "10.0"); a
// conversão de polegada e milímetro é da normalização, não daqui.

import type { Molde } from './moldes';

/** Fração de polegada: 3/8, 1 1/4, 1.1/2, 2. */
const F = String.raw`\d+(?:[ .]\d+\/\d+)?|\d+\/\d+`;
/** Número com decimal opcional: 12.5, 2,25, 6. */
const D = String.raw`\d+(?:[.,]\d+)?`;
/** Chapa: número de bitola (18), fração (1/8) ou milímetro (2.25). */
const CH = String.raw`\d+\/\d+|\d+(?:[.,]\d+)?`;

const m = (fonte: string): RegExp => new RegExp(`^${fonte}$`);

export const MOLDES_EXEMPLO: Molde[] = [
  { nome: 'vergalhão CA50', grupo: /^ACO CA50$/, descricao: [m(`VERGALHAO CA50 (?<bitola>${F}) \\((?<mm>${D}) MM\\)`)] },
  { nome: 'vergalhão CA60', grupo: /^ACO CA60$/, descricao: [m(`VERGALHAO CA60 (?<mm>${D}) ?MM`)] },
  { nome: 'metalon', grupo: /^TUBO METALON/, descricao: [m(`TUBO METALON (?<largura>${D})X(?<altura>${D})X(?<chapa>${CH})`)] },
  { nome: 'barra chata', grupo: /^BARRA CHATA$/, descricao: [m(`BARRA CHATA (?<largura>${F}) X (?<espessura>${F})`)] },
  { nome: 'prego', grupo: /^PREGOS$/, descricao: [m(`PREGO (?<bitola>\\d+)X(?<comprimento>\\d+)(?: C\\/ CABECA| GALVANIZADO)`)] },
  { nome: 'arame', grupo: /^ARAMES$/, descricao: [m(`ARAME (?:RECOZIDO|GALVANIZADO) (?<bitola>\\d+) BWG`)] },
  { nome: 'arame farpado', grupo: /^ARAMES FARPADOS$/, descricao: [m(`ARAME FARPADO [A-Z]+ (?<comprimento>\\d+)M`)] },
  { nome: 'parafuso auto brocante', grupo: /^PARAFUSOS AUTO BROCANTES$/, descricao: [m(`PARAFUSO AUTO BROCANTE (?<diametro>${F})X(?<comprimento>${F}) \\(CX \\d+\\)`)] },
  { nome: 'telha', grupo: /^TELHAS GALVALUME$/, descricao: [m(`TELHA GALVALUME (?:TRAPEZOIDAL|ONDULADA) (?<espessura>${D})MM \\((?<comprimento>${D})MT\\)`)] },
  { nome: 'calha', grupo: /^CALHAS$/, descricao: [m(`CALHA GALVANIZADA (?<largura>\\d+)CM \\((?<comprimento>${D})MT\\)`)] },
  { nome: 'disco', grupo: /^DISCOS$/, descricao: [m(`DISCO DE (?:CORTE|DESBASTE) (?<diametro>${F}) X (?<furo>${F}) [A-Z]+`)] },
];

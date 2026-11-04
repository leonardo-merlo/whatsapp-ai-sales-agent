// O catálogo da Distribuidora Exemplo, a empresa fictícia da vitrine: produtos,
// preços e clientes inventados. É a fonte única do ERP fictício: os testes, o
// simulador (`scripts/simulador-erp.mjs`), as amostras de sync e o seed da demo
// (`supabase/seeds/001_distribuidora_exemplo.sql`) saem daqui.

import type { ClienteDoErp } from '../../src/lib/erp/contrato';
import type { ProdutoDoErp } from '../../src/lib/erp/simulador';

export const ORG_EXEMPLO = 'e8e00000-0000-4000-8000-0000000000e1';

export interface ProdutoExemplo extends ProdutoDoErp {
  grupo: string;
  /** Peso de uma unidade de venda, em kg (barra de 12 m, peça de 6 m...). Nulo quando não se vende por peso. */
  peso_kg: number | null;
}

const p = (codigo: string, grupo: string, descricao: string, unidade: string, preco: number, peso_kg: number | null = null): ProdutoExemplo =>
  ({ codigo, grupo, descricao, unidade, preco, peso_kg });

export const PRODUTOS_EXEMPLO: ProdutoExemplo[] = [
  p('100001', 'ACO CA50', 'VERGALHAO CA50 1/4 (6.3 MM)', 'VR', 21.9, 2.95),
  p('100002', 'ACO CA50', 'VERGALHAO CA50 5/16 (8.0 MM)', 'VR', 33.4, 4.74),
  p('100003', 'ACO CA50', 'VERGALHAO CA50 3/8 (10.0 MM)', 'VR', 51.8, 7.4),
  p('100004', 'ACO CA50', 'VERGALHAO CA50 1/2 (12.5 MM)', 'VR', 79.9, 11.56),
  p('100005', 'ACO CA50', 'VERGALHAO CA50 5/8 (16.0 MM)', 'VR', 128.5, 18.94),
  p('100011', 'ACO CA60', 'VERGALHAO CA60 4.2 MM', 'VR', 12.7, 1.31),
  p('100012', 'ACO CA60', 'VERGALHAO CA60 5.0 MM', 'VR', 17.2, 1.85),
  p('100101', 'TUBO METALON CH. 18', 'TUBO METALON 20X20X18', 'PC', 58.3, 6.6),
  p('100102', 'TUBO METALON CH. 18', 'TUBO METALON 30X20X18', 'PC', 72.6, 8.3),
  p('100103', 'TUBO METALON CH. 18', 'TUBO METALON 30X30X18', 'PC', 86.4, 10),
  p('100104', 'TUBO METALON CH. 18', 'TUBO METALON 50X30X18', 'PC', 112.9, 13.4),
  p('100111', 'TUBO METALON CH. 20', 'TUBO METALON 20X20X20', 'PC', 46.1, 5),
  p('100112', 'TUBO METALON CH. 20', 'TUBO METALON 30X20X20', 'PC', 57.5, 6.3),
  p('100201', 'BARRA CHATA', 'BARRA CHATA 1 X 1/8', 'PC', 39.8, 3.8),
  p('100202', 'BARRA CHATA', 'BARRA CHATA 1.1/4 X 1/8', 'PC', 48.6, 4.74),
  p('100203', 'BARRA CHATA', 'BARRA CHATA 1.1/2 X 3/16', 'PC', 86.2, 8.53),
  p('100301', 'PREGOS', 'PREGO 15X15 C/ CABECA', 'KG', 16.4),
  p('100302', 'PREGOS', 'PREGO 17X21 C/ CABECA', 'KG', 15.9),
  p('100303', 'PREGOS', 'PREGO 18X27 C/ CABECA', 'KG', 15.5),
  p('100304', 'PREGOS', 'PREGO 17X21 GALVANIZADO', 'KG', 24.8),
  p('100401', 'ARAMES', 'ARAME RECOZIDO 18 BWG', 'KG', 17.3),
  p('100402', 'ARAMES', 'ARAME GALVANIZADO 14 BWG', 'KG', 19.9),
  p('100403', 'ARAMES', 'ARAME GALVANIZADO 16 BWG', 'KG', 20.6),
  p('100501', 'ARAMES FARPADOS', 'ARAME FARPADO TOURO 250M', 'RL', 289),
  p('100502', 'ARAMES FARPADOS', 'ARAME FARPADO TOURO 500M', 'RL', 549),
  p('100503', 'ARAMES FARPADOS', 'ARAME FARPADO CAMPEIRO 250M', 'RL', 259),
  p('100601', 'PARAFUSOS AUTO BROCANTES', 'PARAFUSO AUTO BROCANTE 1/4X3/4 (CX 100)', 'CX', 48.9),
  p('100602', 'PARAFUSOS AUTO BROCANTES', 'PARAFUSO AUTO BROCANTE 1/4X1 (CX 100)', 'CX', 54.9),
  p('100701', 'TELHAS GALVALUME', 'TELHA GALVALUME TRAPEZOIDAL 0.43MM (6.0MT)', 'PC', 189.9),
  p('100702', 'TELHAS GALVALUME', 'TELHA GALVALUME TRAPEZOIDAL 0.50MM (6.0MT)', 'PC', 219.9),
  p('100703', 'TELHAS GALVALUME', 'TELHA GALVALUME ONDULADA 0.43MM (3.0MT)', 'PC', 99.9),
  p('100801', 'CALHAS', 'CALHA GALVANIZADA 30CM (6MT)', 'PC', 119),
  p('100802', 'CALHAS', 'CALHA GALVANIZADA 40CM (6MT)', 'PC', 149),
  p('100901', 'DISCOS', 'DISCO DE CORTE 4.1/2 X 7/8 BRASA', 'PC', 6.5),
  p('100902', 'DISCOS', 'DISCO DE DESBASTE 4.1/2 X 7/8 BRASA', 'PC', 11.9),
  p('100903', 'DISCOS', 'DISCO DE CORTE 7 X 7/8 BRASA', 'PC', 14.9),
  p('101001', 'TINTAS', 'TINTA ZARCAO 3.6L', 'GL', 89.9),
  p('101002', 'TINTAS', 'TINTA ESMALTE PRETO 3.6L', 'GL', 97.5),
];

export const CLIENTES_EXEMPLO: ClienteDoErp[] = [
  { id: 'CLI-1001', documento: '11222333000181', tipo: 'PJ', nome: 'Serralheria Horizonte Ltda', cidade: 'Jundiaí', uf: 'SP', vendedor_id: 'V-01' },
  { id: 'CLI-1002', documento: '45723174000110', tipo: 'PJ', nome: 'Construtora Pedra Azul Ltda', cidade: 'Itatiba', uf: 'SP', vendedor_id: 'V-02' },
  { id: 'CLI-1003', documento: '52998224725', tipo: 'PF', nome: 'Carlos Pereira', cidade: 'Jundiaí', uf: 'SP', vendedor_id: 'V-01' },
];

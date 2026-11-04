// Gera as amostras de sync do ERP fictício (test/apoio/amostras-erp/) a partir
// do catálogo da Distribuidora Exemplo. As amostras imitam o que um ERP real
// manda: acento com dupla codificação (UTF-8 lido como Latin-1) e a lista de
// filiais que falharam na raiz.
//
//   node --experimental-strip-types app/scripts/gerar-amostras-erp.mts

import { writeFileSync } from 'node:fs';
import { PRODUTOS_EXEMPLO } from '../test/apoio/catalogo-exemplo.ts';

const quebrar = (texto: string): string => Buffer.from(texto, 'utf8').toString('latin1');
const comAcento = (descricao: string): string => descricao.replace(/^VERGALHAO/, 'VERGALHÃO').replace(/ZARCAO/, 'ZARCÃO');

const produtos = {
  produtos: PRODUTOS_EXEMPLO.map((p, i) => ({
    produto_id: p.codigo,
    descricao: i % 2 === 0 ? quebrar(comAcento(p.descricao)) : comAcento(p.descricao),
    unidade_venda: p.unidade,
    peso_kg: p.peso_kg ?? 1,
    grupo: p.grupo,
    empresas: i % 3 === 0 ? ['EXEMPLO CENTRO', 'EXEMPLO NORTE'] : ['EXEMPLO CENTRO'],
  })),
  sincronizado_em: '2026-09-30T15:43:30-03:00',
  filtro_atualizados_apos: 'nao_suportado',
  falhas: ['EXEMPLO NORTE: tempo esgotado', 'CORTE DOBRA CENTRO: tempo esgotado'],
};

const regioes = {
  regioes: [
    { regiao_id: '001', nome: 'CENTRO', cidades: ['JUNDIAÍ', 'ITATIBA', 'LOUVEIRA', 'VINHEDO'] },
    { regiao_id: '002', nome: 'NORTE', cidades: ['ITUPEVA', 'CABREÚVA', 'JARINU'] },
    { regiao_id: '003', nome: 'SERRA', cidades: ['ATIBAIA', 'BRAGANÇA PAULISTA', 'NAZARÉ PAULISTA'] },
  ].map((r, i) => ({ ...r, cidades: r.cidades.map(c => ({ cidade: i === 1 ? quebrar(c) : c, uf: 'SP' })) })),
  sincronizado_em: '2026-09-30T15:43:28-03:00',
};

const destino = new URL('../test/apoio/amostras-erp/', import.meta.url);
writeFileSync(new URL('produtos-2026-09-30.json', destino), `${JSON.stringify(produtos, null, 1)}\n`);
writeFileSync(new URL('regioes-2026-09-30.json', destino), `${JSON.stringify(regioes, null, 1)}\n`);
console.log(`${produtos.produtos.length} produtos, ${regioes.regioes.length} regiões`);

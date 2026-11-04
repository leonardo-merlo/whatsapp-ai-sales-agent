// O ERP fictício da Distribuidora Exemplo: o catálogo é lido inteiro pelos
// moldes, as regras citam só códigos que existem, o resolvedor acha os produtos
// e o simulador cota e cria o orçamento. Tudo sem banco e sem IA.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lerMedidas } from '@/lib/catalogo/moldes';
import { montarCatalogo } from '@/lib/v2/catalogo';
import { NAO_VENDE, OBRIGATORIO_PERGUNTAR, PADROES } from '@/lib/v2/regras';
import { resolverItem } from '@/lib/v2/resolvedor';
import type { ItemExtraido, ProdutoDoCatalogo } from '@/lib/v2/tipos';
import { criarSimuladorExemplo, responderComoFetch } from '@/lib/erp/simulador';
import { CLIENTES_EXEMPLO, ORG_EXEMPLO, PRODUTOS_EXEMPLO } from './apoio/catalogo-exemplo';

const SEM_MEDIDA = new Set(['TINTAS']);

const linhas: ProdutoDoCatalogo[] = PRODUTOS_EXEMPLO.map(p => ({
  codigo: p.codigo, descricao: p.descricao, unidade: p.unidade ?? null, grupo: p.grupo, peso_kg: p.peso_kg,
  ...lerMedidas(ORG_EXEMPLO, p.grupo, p.descricao),
}));
const catalogo = montarCatalogo(linhas);

const item = (familia: string, quantidade: string, medidas: [string, string][]): ItemExtraido => ({
  familia,
  quantidade: { valor: quantidade, trecho: quantidade },
  medidas: medidas.map(([etiqueta, valor]) => ({ etiqueta, valor, unidade_escrita: null, trecho: valor })),
  numeros_auxiliares: [], qualificadores: [], termos_nao_reconhecidos: [], idem_resolvido_de_linha: null,
} as unknown as ItemExtraido);

const resolver = (i: ItemExtraido, texto: string) => resolverItem(i, { catalogo, saude: new Map(), textoOriginal: texto });

describe('catálogo fictício', () => {
  test('todo produto de grupo com molde tem as medidas lidas da descrição', () => {
    const semLeitura = linhas.filter(l => !SEM_MEDIDA.has(l.grupo!) && (!l.molde || !l.medidas)).map(l => l.descricao);
    assert.deepEqual(semLeitura, []);
  });

  test('a v2 monta o catálogo sem nenhuma falha de leitura', () => {
    assert.deepEqual(catalogo.falhas, []);
  });

  test('as regras só citam códigos que existem no catálogo', () => {
    const citados = [...PADROES, ...NAO_VENDE, ...OBRIGATORIO_PERGUNTAR]
      .flatMap(r => [r.positivo?.espera?.codigo, r.negativo?.espera?.codigo])
      .filter((c): c is string => Boolean(c));
    assert.deepEqual(citados.filter(c => !catalogo.porCodigo.has(c)), []);
  });
});

describe('resolvedor contra o catálogo fictício', () => {
  test('"10 barras de 3/8" é o vergalhão CA50 de 10 mm', () => {
    const r = resolver(item('vergalhao', '10', [['bitola', '3/8']]), '10 barras de 3/8');
    assert.deepEqual([r.status, r.codigo], ['resolvido', '100003']);
  });

  test('"metalon 30x20 chapa 18" acha o tubo pelas duas medidas e a chapa', () => {
    const r = resolver(item('metalon', '6', [['lado', '30'], ['lado', '20'], ['chapa', '18']]), '6 metalon 30x20 chapa 18');
    assert.deepEqual([r.status, r.codigo], ['resolvido', '100102']);
  });

  test('metalon sem a chapa não é escolhido sozinho', () => {
    const r = resolver(item('metalon', '6', [['lado', '30'], ['lado', '20']]), '6 metalon 30x20');
    assert.notEqual(r.status, 'resolvido');
  });
});

describe('simulador com o catálogo fictício', () => {
  const CHAVE = 'chave-de-homologacao';
  const BASE = 'https://erp.distribuidora-exemplo.test';
  const sim = criarSimuladorExemplo({ produtos: PRODUTOS_EXEMPLO, clientes: CLIENTES_EXEMPLO, chave: CHAVE });
  const chamar = async (caminho: string, corpo: unknown) => {
    const resposta = await responderComoFetch(sim, BASE, `${BASE}${caminho}`, {
      method: 'POST', headers: { authorization: `Bearer ${CHAVE}`, 'content-type': 'application/json' }, body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: await resposta.json() };
  };

  test('acha o cliente fictício pelo CNPJ', async () => {
    const r = await chamar('/clientes/consulta', { documento: '11.222.333/0001-81' });
    assert.deepEqual([r.status, r.corpo.cliente_id], [200, 'CLI-1001']);
  });

  test('cria o orçamento com o total calculado pelo ERP', async () => {
    const r = await chamar('/orcamentos', {
      cliente_id: 'CLI-1001', vendedor_id: 'V-01', canal: 'whatsapp',
      itens: [{ produto_codigo: '100003', quantidade: 10 }, { produto_codigo: '100302', quantidade: 8 }],
    });
    assert.deepEqual([r.status, r.corpo.orcamento.valor_total], [201, 645.2]);
  });
});

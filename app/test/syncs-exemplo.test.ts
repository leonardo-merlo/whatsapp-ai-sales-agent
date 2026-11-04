// Os syncs da Distribuidora Exemplo: produtos (diário) e regiões (mensal), contrato v4.
//
// Spec: docs/superpowers/specs/2026-09-27-syncs-exemplo-design.md.
//
// Rodam contra o simulador da Distribuidora Exemplo (o mesmo dos outros testes do ERP) e
// o Supabase falso. **O simulador responde também as recusas** — sem chave,
// fora do ar, lista vazia, item incompleto —, porque um dublê mais bonzinho que
// o sistema de verdade foi o que escondeu os dois bugs de 17/09.

import { describe, test, beforeEach, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { consertarAcentos, lerProdutosDoSync, lerRegioesDoSync } from '@/lib/erp/syncs/formato';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';
import { sincronizarProdutos } from '@/lib/erp/syncs/sincronizar-produtos';
import { sincronizarRegioes } from '@/lib/erp/syncs/sincronizar-regioes';
import type { ConexaoComOErp } from '@/lib/erp/cliente-http';
import type { ProdutoDoSync, RegiaoDoSync } from '@/lib/erp/syncs/formato';

const ORG = '33333333-3333-4333-8333-333333333333';
const BASE = 'https://erp.syncs.teste/api/agente';
const CHAVE = 'chave-dos-syncs';
const CAMINHOS = { produtos: '/produtos_sync.php', regioes: '/regioes_sync.php' };

const produto = (id: string, grupo = 'Vergalhões', descricao = `Produto ${id}`): ProdutoDoSync => ({
  produto_id: id, descricao, unidade_venda: 'BARRA', peso_kg: 7.4, grupo, empresas: [],
});

/** O que a Distribuidora Exemplo respondeu em 30/09, cru (a chave não vem no corpo). */
const amostra = (nome: 'produtos' | 'regioes'): unknown =>
  JSON.parse(readFileSync(`test/apoio/amostras-erp/${nome}-2026-09-30.json`, 'utf8'));

const ACENTO_QUEBRADO = /[ÂÃ][\u0080-¿Œ-™]/;

describe('formato do sync de produtos', () => {
  test('item completo entra', () => {
    const r = lerProdutosDoSync({ produtos: [produto('P1')] });
    assert.deepEqual(r.ok && r.itens, [produto('P1')]);
  });

  test('item sem grupo vira problema e fica guardado como incompleto', () => {
    const r = lerProdutosDoSync({ produtos: [{ ...produto('P1'), grupo: '' }] });
    assert.deepEqual(r.ok && [r.itens.length, r.idsIncompletos, r.problemas.length], [0, ['P1'], 1]);
  });

  test('item sem produto_id é ignorado, sem virar incompleto', () => {
    const r = lerProdutosDoSync({ produtos: [{ ...produto('P1'), produto_id: '' }] });
    assert.deepEqual(r.ok && [r.itens.length, r.idsIncompletos, r.problemas.length], [0, [], 1]);
  });

  test('peso em texto com vírgula é aceito', () => {
    const r = lerProdutosDoSync({ produtos: [{ ...produto('P1'), peso_kg: '7,4' }] });
    assert.equal(r.ok && r.itens[0].peso_kg, 7.4);
  });

  test('peso que não é número vira problema', () => {
    const r = lerProdutosDoSync({ produtos: [{ ...produto('P1'), peso_kg: 'sete' }] });
    assert.deepEqual(r.ok && r.idsIncompletos, ['P1']);
  });

  test('corpo sem a lista é recusado', () => {
    assert.equal(lerProdutosDoSync({ itens: [] }).ok, false);
  });

  test('guarda as filiais sem repetição', () => {
    const r = lerProdutosDoSync({ produtos: [{ ...produto('P1'), empresas: ['EXEMPLO CENTRO', 'EXEMPLO CENTRO', 'EXEMPLO NORTE'] }] });
    assert.deepEqual(r.ok && r.itens[0].empresas, ['EXEMPLO CENTRO', 'EXEMPLO NORTE']);
  });

  test('lê as falhas e a data da lista, que vêm na raiz', () => {
    const r = lerProdutosDoSync({ produtos: [produto('P1')], falhas: ['CORTE DOBRA CENTRO: erro'], sincronizado_em: '2026-09-30T15:43:30-03:00' });
    assert.deepEqual(r.ok && [r.falhasDoErp, r.geradaEm], [['CORTE DOBRA CENTRO: erro'], '2026-09-30T15:43:30-03:00']);
  });

  test('lê inteira a resposta real de 30/09', () => {
    const r = lerProdutosDoSync(amostra('produtos'));
    assert.deepEqual(r.ok && [r.itens.length, r.idsIncompletos.length, r.falhasDoErp.length], [734, 0, 5]);
  });

  test('na resposta real não sobra acento quebrado', () => {
    const r = lerProdutosDoSync(amostra('produtos'));
    assert.deepEqual(r.ok && r.itens.filter(p => ACENTO_QUEBRADO.test(p.descricao + p.grupo)), []);
  });
});

describe('acentos com dupla codificação', () => {
  test('conserta o que chega quebrado', () => {
    assert.deepEqual(['VERGALHÃƒO', 'AÃ‡UDE', 'PINGO DÂ´AGUA'].map(consertarAcentos), ['VERGALHÃO', 'AÇUDE', 'PINGO D´AGUA']);
  });

  test('não mexe no que já está certo', () => {
    const certos = ['VERGALHÃO', 'AÇÃO', 'São João', 'VERGALHAO'];
    assert.deepEqual(certos.map(consertarAcentos), certos);
  });
});

describe('formato do sync de regiões', () => {
  const regiao: RegiaoDoSync = {
    regiao_id: 'SP-SE', nome: 'Região Serrana', cidades: [{ cidade: 'Jundiaí', uf: 'MG' }], grupos: ['Vergalhões'], produto_ids: null,
  };

  test('região completa entra', () => {
    const r = lerRegioesDoSync({ regioes: [regiao] });
    assert.deepEqual(r.ok && r.itens, [regiao]);
  });

  test('região por produto (produto_ids) também é aceita', () => {
    const r = lerRegioesDoSync({ regioes: [{ ...regiao, grupos: undefined, produto_ids: ['P1'] }] });
    assert.deepEqual(r.ok && [r.itens[0].grupos, r.itens[0].produto_ids], [null, ['P1']]);
  });

  test('região só com cidades, sem grupos nem produto_ids, é aceita', () => {
    const r = lerRegioesDoSync({ regioes: [{ ...regiao, grupos: undefined }] });
    assert.deepEqual(r.ok && [r.itens.length, r.itens[0].grupos, r.itens[0].produto_ids], [1, null, null]);
  });

  test('lê inteira a resposta real de 30/09, sem acento quebrado', () => {
    const r = lerRegioesDoSync(amostra('regioes'));
    const quebradas = r.ok ? r.itens.flatMap(x => x.cidades).filter(c => ACENTO_QUEBRADO.test(c.cidade)) : null;
    assert.deepEqual(r.ok && [r.itens.length, r.idsIncompletos.length, quebradas], [54, 0, []]);
  });

  test('região sem cidades vira problema', () => {
    const r = lerRegioesDoSync({ regioes: [{ ...regiao, cidades: [] }] });
    assert.deepEqual(r.ok && [r.itens.length, r.idsIncompletos], [0, ['SP-SE']]);
  });

  test('cidade com UF de três letras vira problema', () => {
    const r = lerRegioesDoSync({ regioes: [{ ...regiao, cidades: [{ cidade: 'Jundiaí', uf: 'MGG' }] }] });
    assert.deepEqual(r.ok && r.idsIncompletos, ['SP-SE']);
  });
});

// ── contra o simulador e o Supabase falso ──

let banco: Banco;
let supabase: ReturnType<typeof criarSupabaseFalso>['client'];
let erp: SimuladorExemplo;
let produtosDoErp: ProdutoDoSync[];
let regioesDoErp: RegiaoDoSync[];

before(() => {
  const original = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith(BASE)) return responderComoFetch(erp, BASE, entrada, init);
    return original(entrada, init);
  }) as typeof fetch;
});

beforeEach(() => {
  banco = {
    catalogo_grupos: [
      { id: 'g-1', organization_id: ORG, codigo: '4101', nome: 'VERGALHÕES', ativo: true },
    ],
    catalogo_produtos: [
      { id: 'p-velho', organization_id: ORG, grupo_id: 'g-1', codigo: 'P-VELHO', descricao: 'Sai do catálogo',
        unidade: 'PC', preco: 10, dados: {}, ativo: true },
      { id: 'p-1', organization_id: ORG, grupo_id: 'g-1', codigo: 'P1', descricao: 'Descrição antiga',
        unidade: 'PC', preco: 112.40, dados: { gíria: 'ferro' }, ativo: true },
    ],
    catalogo_config: [],
    erp_regioes: [],
    erp_chamadas: [],
  };
  supabase = criarSupabaseFalso(banco, {
    unicos: {
      catalogo_grupos: [['organization_id', 'codigo']],
      catalogo_produtos: [['organization_id', 'codigo']],
      erp_regioes: [['organization_id', 'regiao_id']],
    },
  }).client;
  produtosDoErp = [produto('P1'), produto('P2'), produto('P3', 'Telhas')];
  regioesDoErp = [{
    regiao_id: 'SP-SE', nome: 'Região Serrana', cidades: [{ cidade: 'Jundiaí', uf: 'MG' }, { cidade: 'Juniaí', uf: 'MG' }],
    grupos: ['Vergalhões', 'Telhas'], produto_ids: null,
  }];
  erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS } });
});

const conexao = (): ConexaoComOErp => ({ enderecoBase: BASE, token: CHAVE });
const produtoNoBanco = (codigo: string) => banco.catalogo_produtos.find(p => p.codigo === codigo)!;

/** Só dá nome à espera. O caso do 503 espera de verdade as retentativas do
 *  transporte (1 s e 3 s): é o comportamento que está sendo provado. */
const rodar = <T>(promessa: Promise<T>): Promise<T> => promessa;

describe('sincronizar produtos', () => {
  test('cria o que é novo e atualiza o que já existe', async () => {
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P2')?.ativo, produtoNoBanco('P1').descricao], ['aplicado', true, 'Produto P1']);
  });

  test('desativa o produto que sumiu da lista, sem apagar', async () => {
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal(produtoNoBanco('P-VELHO').ativo, false);
  });

  test('reaproveita o grupo de mesmo nome, sem diferença de maiúscula e acento', async () => {
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal(produtoNoBanco('P2').grupo_id, 'g-1');
  });

  test('grupo que não existe nasce com o próprio nome como código', async () => {
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    const telhas = banco.catalogo_grupos.find(g => g.codigo === 'Telhas');
    assert.equal(produtoNoBanco('P3').grupo_id, telhas?.id);
  });

  test('mantém o preço do CSV e junta peso e unidade aos dados', async () => {
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    const p1 = produtoNoBanco('P1');
    assert.deepEqual([p1.preco, p1.dados], [112.40, { gíria: 'ferro', peso_kg: '7.4', unidade_venda: 'BARRA' }]);
  });

  test('item incompleto com produto_id não é desativado', async () => {
    produtosDoErp.push({ ...produto('P-VELHO'), grupo: '' });
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS } });
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([produtoNoBanco('P-VELHO').ativo, r.problemas.length], [true, 1]);
  });

  test('rodar duas vezes não duplica produto nem grupo', async () => {
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([banco.catalogo_produtos.length, banco.catalogo_grupos.length], [4, 2]);
  });

  test('guarda as filiais nos dados', async () => {
    produtosDoErp[0] = { ...produto('P1'), empresas: ['EXEMPLO CENTRO', 'EXEMPLO NORTE'] };
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal((produtoNoBanco('P1').dados as Record<string, string>).empresas, 'EXEMPLO CENTRO, EXEMPLO NORTE');
  });

  test('grupo com espaço repetido reaproveita o existente', async () => {
    produtosDoErp[2] = produto('P3', 'VERGALHÕES  DE  AÇO');
    banco.catalogo_grupos.push({ id: 'g-2', organization_id: ORG, codigo: '2002', nome: 'VERGALHÕES DE AÇO', ativo: true });
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal(produtoNoBanco('P3').grupo_id, 'g-2');
  });

  test('lista com falhas deles grava o que veio e não desativa nada', async () => {
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS, falhas: ['PERFILADOS NORTE: erro'] } });
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, r.desativados, produtoNoBanco('P-VELHO').ativo, r.falhasDoErp], ['aplicado', 0, true, ['PERFILADOS NORTE: erro']]);
  });

  test('lista com falhas deles é gravada mesmo muito menor que a anterior', async () => {
    banco.catalogo_produtos.push(...Array.from({ length: 20 }, (_, i) => `A${i}`).map(c => ({
      id: `p-${c}`, organization_id: ORG, grupo_id: 'g-1', codigo: c, descricao: c, unidade: 'PC', preco: 1, dados: {}, ativo: true,
    })));
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS, falhas: ['x'] } });
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P2')?.ativo, produtoNoBanco('A0').ativo], ['aplicado', true, true]);
  });

  test('grupo que ficou sem produto é desativado, mesmo com lista parcial', async () => {
    banco.catalogo_grupos.push({ id: 'g-velho', organization_id: ORG, codigo: '3101', nome: 'CHAPA GALVANIZADA 22', ativo: true });
    banco.catalogo_produtos.push({ id: 'p-chapa', organization_id: ORG, grupo_id: 'g-velho', codigo: 'P3', descricao: 'Chapa', unidade: 'PC', preco: 5, dados: {}, ativo: true });
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS, falhas: ['x'] } });
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([banco.catalogo_grupos.find(g => g.id === 'g-velho')?.ativo, produtoNoBanco('P-VELHO').ativo], [false, true]);
  });

  test('catálogo com mais de 1000 produtos mantém o preço de todos', async () => {
    const codigos = Array.from({ length: 1200 }, (_, i) => `M${String(i).padStart(4, '0')}`);
    banco.catalogo_produtos.push(...codigos.map(c => ({
      id: `p-${c}`, organization_id: ORG, grupo_id: 'g-1', codigo: c, descricao: c, unidade: 'PC', preco: 9.9, dados: {}, ativo: true,
    })));
    produtosDoErp.push(...codigos.map(c => produto(c)));
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual(codigos.filter(c => produtoNoBanco(c).preco !== 9.9), []);
  });

  test('catálogo com mais de 1000 produtos desativa o ausente que está depois do milésimo', async () => {
    const codigos = Array.from({ length: 1200 }, (_, i) => `M${String(i).padStart(4, '0')}`);
    banco.catalogo_produtos.push(...codigos.map(c => ({
      id: `z-${c}`, organization_id: ORG, grupo_id: 'g-1', codigo: c, descricao: c, unidade: 'PC', preco: 1, dados: {}, ativo: true,
    })));
    produtosDoErp.push(...codigos.slice(0, 1199).map(c => produto(c)));
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal(produtoNoBanco('M1199').ativo, false);
  });

  test('lista vazia não é aplicada', async () => {
    erp.definirFalha('sync-vazio');
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P-VELHO').ativo], ['recusado_por_seguranca', true]);
  });

  test('queda de mais de 30% dos ativos (e de mais de 10 produtos) não é aplicada', async () => {
    banco.catalogo_produtos.push(...Array.from({ length: 20 }, (_, i) => `A${i}`).map(c => ({
      id: `p-${c}`, organization_id: ORG, grupo_id: 'g-1', codigo: c, descricao: c, unidade: 'PC', preco: 1, dados: {}, ativo: true,
    })));
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('A0').ativo], ['recusado_por_seguranca', true]);
  });

  test('corpo malformado não mexe no catálogo', async () => {
    erp.definirFalha('sync-malformado');
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P1').descricao], ['formato_invalido', 'Descrição antiga']);
  });

  test('chave recusada (401) não mexe no catálogo', async () => {
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, { enderecoBase: BASE, token: 'errada' }, CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P1').descricao], ['falhou', 'Descrição antiga']);
  });

  test('sistema fora do ar (503) não mexe no catálogo', async () => {
    erp.definirFalha('fora-do-ar');
    const r = await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.deepEqual([r.status, produtoNoBanco('P-VELHO').ativo], ['falhou', true]);
  });

  test('a chamada é um GET no caminho configurado, registrada como sync_produtos', async () => {
    const registros: string[] = [];
    await rodar(sincronizarProdutos(supabase as never, ORG, { ...conexao(), observador: r => registros.push(r.operacao ?? '') }, CAMINHOS.produtos));
    assert.deepEqual([erp.chamadas[0].metodo, erp.chamadas[0].caminho, registros], ['GET', CAMINHOS.produtos, ['sync_produtos']]);
  });
});

describe('sincronizar regiões', () => {
  test('cria a região com cidades e grupos', async () => {
    await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    const r = banco.erp_regioes[0];
    assert.deepEqual([r.regiao_id, r.ativo, (r.cidades as unknown[]).length, r.grupos], ['SP-SE', true, 2, ['Vergalhões', 'Telhas']]);
  });

  test('atualiza a que já existe, sem duplicar', async () => {
    await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    regioesDoErp[0] = { ...regioesDoErp[0], nome: 'Região Serrana MG' };
    await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    assert.deepEqual(banco.erp_regioes.map(r => r.nome), ['Região Serrana MG']);
  });

  test('desativa a região que sumiu', async () => {
    banco.erp_regioes.push({ id: 'r-velha', organization_id: ORG, regiao_id: 'ES-SUL', nome: 'Sul do ES', cidades: [], grupos: [], ativo: true });
    await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    assert.equal(banco.erp_regioes.find(r => r.regiao_id === 'ES-SUL')?.ativo, false);
  });

  test('região só com cidades é gravada, com grupos nulos', async () => {
    regioesDoErp[0] = { ...regioesDoErp[0], grupos: null };
    await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    assert.deepEqual([banco.erp_regioes.length, banco.erp_regioes[0].grupos], [1, null]);
  });

  test('queda grande de regiões grava o que veio e não desativa nenhuma', async () => {
    banco.erp_regioes.push(...Array.from({ length: 20 }, (_, i) => ({
      id: `r-${i}`, organization_id: ORG, regiao_id: `R${i}`, nome: `R${i}`, cidades: [], grupos: [], ativo: true,
    })));
    const r = await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    assert.deepEqual([r.status, r.desativados, banco.erp_regioes.find(x => x.regiao_id === 'R0')?.ativo], ['aplicado', 0, true]);
  });

  test('lista vazia não é aplicada', async () => {
    banco.erp_regioes.push({ id: 'r-velha', organization_id: ORG, regiao_id: 'ES-SUL', nome: 'Sul do ES', cidades: [], grupos: [], ativo: true });
    erp.definirFalha('sync-vazio');
    const r = await rodar(sincronizarRegioes(supabase as never, ORG, conexao(), CAMINHOS.regioes));
    assert.deepEqual([r.status, banco.erp_regioes[0].ativo], ['recusado_por_seguranca', true]);
  });
});

describe('a rota do cron', () => {
  const URL_DO_CRON = 'https://www.wappia.com.br/api/cron/sincronizar-erp';
  const chamarCron = async (tipo: string) => {
    const { GET } = await import('@/app/api/cron/sincronizar-erp/route');
    return GET(new Request(`${URL_DO_CRON}?tipo=${tipo}`, { headers: { authorization: 'Bearer segredo-do-cron' } }));
  };

  before(() => {
    process.env.CRON_SECRET = 'segredo-do-cron';
    mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase } });
  });

  beforeEach(() => {
    banco.organization_integrations = [{
      id: 'int-1', organization_id: ORG, tipo: 'erp', endereco_base: BASE, ativo: true,
      config: { syncs: CAMINHOS },
    }];
    banco.erp_sync_execucoes = [];
    supabase = criarSupabaseFalso(banco, {
      unicos: {
        catalogo_grupos: [['organization_id', 'codigo']],
        catalogo_produtos: [['organization_id', 'codigo']],
        erp_regioes: [['organization_id', 'regiao_id']],
      },
      funcoes: { credencial_da_integracao: () => CHAVE },
    }).client;
  });

  test('sem o segredo do cron, 401', async () => {
    const { GET } = await import('@/app/api/cron/sincronizar-erp/route');
    const r = await GET(new Request(`${URL_DO_CRON}?tipo=produtos`));
    assert.equal(r.status, 401);
  });

  test('roda o sync da organização e registra o desfecho', async () => {
    await chamarCron('produtos');
    const [execucao] = banco.erp_sync_execucoes;
    assert.deepEqual([execucao.tipo, execucao.status, execucao.gravados], ['produtos', 'aplicado', 3]);
  });

  test('lista parcial fica registrada com as falhas deles', async () => {
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: produtosDoErp, regioes: regioesDoErp, caminhos: CAMINHOS, falhas: ['PERFILADOS NORTE: erro'] } });
    await chamarCron('produtos');
    assert.deepEqual(banco.erp_sync_execucoes[0].falhas_do_erp, ['PERFILADOS NORTE: erro']);
  });

  test('sistema deles fora do ar fica registrado e não mexe no catálogo', async () => {
    erp.definirFalha('fora-do-ar');
    await chamarCron('regioes');
    assert.deepEqual([banco.erp_sync_execucoes[0].status, banco.erp_regioes.length], ['falhou', 0]);
  });

  test('a chamada aparece em erp_chamadas como sync_regioes', async () => {
    await chamarCron('regioes');
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(banco.erp_chamadas.map(c => c.operacao), ['sync_regioes']);
  });

  test('organização sem caminho configurado é pulada sem chamar ninguém', async () => {
    banco.organization_integrations[0].config = {};
    const corpo = await (await chamarCron('produtos')).json();
    assert.deepEqual([corpo.resultados[0].status, erp.chamadas.length], ['pulado', 0]);
  });
});

describe('medidas por molde no sync de produtos', () => {
  const EXEMPLO = 'e8e00000-0000-4000-8000-0000000000e1';
  const METALON = 'TUBOS QUAD. E RETANG. CH. 18';
  const comLista = (lista: ProdutoDoSync[]) => {
    erp = criarSimuladorExemplo({ chave: CHAVE, syncs: { produtos: lista, regioes: regioesDoErp, caminhos: CAMINHOS } });
  };

  test('grava o molde e as medidas lidas da descrição na Distribuidora Exemplo', async () => {
    comLista([produto('M1', METALON, 'TUBO METALON 30X20X18')]);
    await rodar(sincronizarProdutos(supabase as never, EXEMPLO, conexao(), CAMINHOS.produtos));
    const m1 = produtoNoBanco('M1');
    assert.deepEqual([m1.molde, m1.medidas], ['metalon', { largura: '30', altura: '20', chapa: '18' }]);
  });

  test('refaz as medidas quando a descrição muda', async () => {
    comLista([produto('M1', METALON, 'TUBO METALON 30X20X18')]);
    await rodar(sincronizarProdutos(supabase as never, EXEMPLO, conexao(), CAMINHOS.produtos));
    comLista([produto('M1', METALON, 'TUBO METALON 40X20X18')]);
    await rodar(sincronizarProdutos(supabase as never, EXEMPLO, conexao(), CAMINHOS.produtos));
    assert.equal((produtoNoBanco('M1').medidas as Record<string, string>).largura, '40');
  });

  test('não manda as colunas de medida para organização sem moldes', async () => {
    comLista([...produtosDoErp, produto('M1', METALON, 'TUBO METALON 30X20X18')]);
    await rodar(sincronizarProdutos(supabase as never, ORG, conexao(), CAMINHOS.produtos));
    assert.equal('medidas' in produtoNoBanco('M1'), false);
  });
});

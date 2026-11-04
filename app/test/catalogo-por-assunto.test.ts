// C6, item 2: o catálogo sai do prompt e vira consulta.
//
// A pergunta que estes testes respondem é sempre a mesma, de três ângulos:
// **a IA consegue citar um produto que não existe?** No prompt vai só a lista
// de assuntos; o produto só chega a ela pela ferramenta, que só devolve linha
// lida do banco. Se algum dos três caminhos vazar o catálogo inteiro para o
// prompt, ou devolver produto de outra organização, a resposta passa a ser
// "consegue" — e um item errado num orçamento custa uma entrega.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';

type Cliente = SupabaseClient<Database>;
import { lerCatalogoCSV, pareceCatalogoDeSistema } from '@/lib/catalogo/ler-csv';
import { importarCatalogo } from '@/lib/catalogo/importar';
import { buscarProdutosPorGrupo, catalogoParaPrompt, resumoDoCatalogo } from '@/lib/catalogo/consultar';
import { ferramentasDoRoteiro } from '@/lib/agente/ferramentas';
import { buildSystemPrompt } from '@/lib/simulador/build-prompt';

const ORG = '11111111-1111-4111-8111-111111111111';
const OUTRA_ORG = '22222222-2222-4222-8222-222222222222';

// Um pedaço fiel do catálogo da Distribuidora Exemplo: cabeçalho fora da nossa ordem,
// coluna extra (empresa, peso, preço por quilo) e preço com ponto decimal.
const CSV_EXEMPLO = [
  'codigo,empresa,grupo,grupo_nome,descricao,peso_kg,preco_kg,preco_tabela',
  '"700008","padrao","4101","VERGALHOES CA50","CA50 1 (25.0 MM)","47.16","9.78","461.3"',
  '"700005","padrao","4101","VERGALHOES CA50","CA50 1/2 (12.5 MM)","11.6","10","112.40"',
  '"700004","padrao","4101","VERGALHOES CA50","CA50 3/8 (10.0 MM)","7.4","9.93","73.50"',
  '"700113","padrao","4900","PREGOS","PREGO 17 X 21","","","17.6"',
].join('\n');

/** Catálogo acima do teto de `MAX_PRODUTOS_NO_PROMPT`, para exercitar o caminho
 *  do índice. O que decide é o TAMANHO, não o roteiro (mudança de 14/09). */
const CSV_GRANDE = [
  'codigo,grupo,grupo_nome,descricao,preco_tabela',
  ...Array.from({ length: 45 }, (_, i) =>
    `"${String(i + 1).padStart(6, '0')}","4101","VERGALHOES CA50","CA50 ITEM ${i + 1}","${(10 + i).toFixed(2)}"`),
].join('\n');

let banco: Banco;
let supabase: { client: Cliente };

before(() => {
  banco = {};
  supabase = criarSupabaseFalso(banco, {
    unicos: {
      catalogo_grupos: [['organization_id', 'codigo']],
      catalogo_produtos: [['organization_id', 'codigo']],
      catalogo_config: [['organization_id']],
    },
  }) as { client: Cliente };
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.catalogo_grupos = [];
  banco.catalogo_produtos = [];
  banco.catalogo_config = [];
  banco.organizations = [{ id: ORG, nome: 'Distribuidora Exemplo' }, { id: OUTRA_ORG, nome: 'Outra' }];
});

async function importarExemplo(csv = CSV_EXEMPLO, nome = 'tabela-111.csv') {
  const { linhas, erros } = lerCatalogoCSV(csv);
  assert.deepEqual(erros, [], 'o CSV de exemplo não pode ter erro de leitura');
  return importarCatalogo(supabase.client, ORG, linhas, nome);
}

describe('ler o CSV', () => {
  test('lê o catálogo da Distribuidora Exemplo como ele é, sem exigir ordem de coluna', () => {
    const { linhas, erros, colunasExtras } = lerCatalogoCSV(CSV_EXEMPLO);

    assert.deepEqual(erros, []);
    assert.equal(linhas.length, 4);
    assert.deepEqual(linhas[0], {
      codigo: '700008',
      grupoCodigo: '4101',
      grupoNome: 'VERGALHOES CA50',
      descricao: 'CA50 1 (25.0 MM)',
      unidade: null,
      preco: 461.3,
      dados: { empresa: 'padrao', peso_kg: '47.16', preco_kg: '9.78' },
    });
    // A coluna que não conhecemos não se perde: vai inteira para `dados`.
    assert.deepEqual(colunasExtras.sort(), ['empresa', 'peso_kg', 'preco_kg']);
  });

  test('aceita cabeçalho com acento, maiúscula e ponto e vírgula do Excel', () => {
    const { linhas, erros } = lerCatalogoCSV([
      'Código;Categoria;Descrição;Preço de Tabela;Unidade',
      '001;Tintas;ZARCAO VERMELHO 3,6L;R$ 89,90;lata',
    ].join('\n'));

    assert.deepEqual(erros, []);
    assert.equal(linhas[0].codigo, '001');
    assert.equal(linhas[0].grupoNome, 'Tintas');
    assert.equal(linhas[0].preco, 89.9, 'preço em português vira número');
    assert.equal(linhas[0].unidade, 'lata');
  });

  test('falta de coluna obrigatória para tudo, com o nome do que falta', () => {
    const { linhas, erros } = lerCatalogoCSV('descricao,preco\nProduto,10');
    assert.equal(linhas.length, 0);
    assert.equal(erros.length, 2);
    assert.match(erros.join(' '), /código do produto/);
    assert.match(erros.join(' '), /grupo/);
  });

  test('linha sem código e código repetido são apontados, e o resto entra', () => {
    const { linhas, erros } = lerCatalogoCSV([
      'codigo,grupo,descricao',
      '001,A,Primeiro',
      ',A,Sem codigo',
      '001,A,Repetido',
      '002,A,Segundo',
    ].join('\n'));

    assert.deepEqual(linhas.map(l => l.codigo), ['001', '002']);
    assert.equal(erros.length, 2);
    assert.match(erros[0], /Linha 3/);
    assert.match(erros[1], /Linha 4.*001.*primeira/);
  });
});

describe('importar', () => {
  test('grava grupos e produtos, e conta o que entrou', async () => {
    const resumo = await importarExemplo();

    assert.deepEqual(resumo, { grupos: 2, produtos: 4, desativados: 0 });
    assert.equal(banco.catalogo_grupos.length, 2);
    assert.equal(banco.catalogo_produtos.length, 4);

    const prego = banco.catalogo_produtos.find(p => p.codigo === '700113')!;
    assert.equal(prego.descricao, 'PREGO 17 X 21');
    assert.equal(prego.preco, 17.6);
    // Coluna vazia no CSV não vira string vazia em `dados`.
    assert.deepEqual(prego.dados, { empresa: 'padrao' });
  });

  test('subir o CSV de novo NÃO troca os ids dos produtos', async () => {
    await importarExemplo();
    const idsAntes = Object.fromEntries(banco.catalogo_produtos.map(p => [p.codigo, p.id]));

    await importarExemplo();

    assert.equal(banco.catalogo_produtos.length, 4, 'nada foi duplicado');
    for (const p of banco.catalogo_produtos) {
      assert.equal(p.id, idsAntes[String(p.codigo)], `o id do produto ${p.codigo} mudou — é o bug do business_prices de volta`);
    }
  });

  test('produto que sai do CSV novo é desativado, não apagado', async () => {
    await importarExemplo();
    const idDoPrego = banco.catalogo_produtos.find(p => p.codigo === '700113')!.id;

    const semPrego = CSV_EXEMPLO.split('\n').filter(l => !l.includes('700113')).join('\n');
    const resumo = await importarExemplo(semPrego);

    assert.equal(resumo.desativados, 1);
    const prego = banco.catalogo_produtos.find(p => p.codigo === '700113');
    assert.ok(prego, 'a linha continua no banco');
    assert.equal(prego!.id, idDoPrego, 'com o mesmo id');
    assert.equal(prego!.ativo, false);
    // E o grupo que ficou sem produto também sai da lista de assuntos.
    assert.equal(banco.catalogo_grupos.find(g => g.codigo === '4900')!.ativo, false);
  });

  test('produto que volta ao CSV é reativado', async () => {
    const semPrego = CSV_EXEMPLO.split('\n').filter(l => !l.includes('700113')).join('\n');
    await importarExemplo();
    await importarExemplo(semPrego);
    await importarExemplo();

    assert.equal(banco.catalogo_produtos.find(p => p.codigo === '700113')!.ativo, true);
    assert.equal(banco.catalogo_grupos.find(g => g.codigo === '4900')!.ativo, true);
  });

  test('o resumo diz quantos, de qual arquivo e quando', async () => {
    await importarExemplo(CSV_EXEMPLO, 'tabela-111-2026-09-01.csv');
    const resumo = await resumoDoCatalogo(supabase.client, ORG);

    assert.equal(resumo.produtos, 4);
    assert.equal(resumo.grupos, 2);
    assert.equal(resumo.importadoNome, 'tabela-111-2026-09-01.csv');
    assert.ok(resumo.importadoEm, 'a data da importação fica registrada');
  });
});

describe('buscar por assunto', () => {
  test('devolve só os produtos do assunto pedido', async () => {
    await importarExemplo();
    const { produtos, gruposEncontrados, naoEncontrados } =
      await buscarProdutosPorGrupo(supabase.client, ORG, ['4101']);

    assert.deepEqual(produtos.map(p => p.codigo).sort(), ['700004', '700005', '700008']);
    assert.deepEqual(gruposEncontrados.map(g => g.nome), ['VERGALHOES CA50']);
    assert.deepEqual(naoEncontrados, []);
  });

  test('o nome do assunto também casa, sem acento e sem caixa', async () => {
    await importarExemplo();
    const { produtos } = await buscarProdutosPorGrupo(supabase.client, ORG, ['pregos']);
    assert.deepEqual(produtos.map(p => p.codigo), ['700113']);
  });

  test('assunto que não existe é dito, sem inventar produto', async () => {
    await importarExemplo();
    const { produtos, naoEncontrados } =
      await buscarProdutosPorGrupo(supabase.client, ORG, ['telhas de vidro']);

    assert.deepEqual(produtos, []);
    assert.deepEqual(naoEncontrados, ['telhas de vidro']);
  });

  test('o catálogo de uma organização não vaza para a outra', async () => {
    await importarExemplo();
    const { produtos, naoEncontrados } =
      await buscarProdutosPorGrupo(supabase.client, OUTRA_ORG, ['4101']);

    assert.deepEqual(produtos, []);
    assert.deepEqual(naoEncontrados, ['4101']);
  });
});

describe('a ferramenta que a IA usa', () => {
  const ferramenta = () =>
    ferramentasDoRoteiro('vendas').find(f => f.definicao.name === 'buscar_produtos')!;
  const ctx = () => ({ supabase: supabase.client, orgId: ORG, conversationId: 'c1', contactId: null, waNumberId: null });

  test('o roteiro de vendas ganha a busca no catálogo; o de atendimento, nada', () => {
    // **A ordem mudou em 21/09, e a mudança é o objeto deste teste.**
    //
    // A busca no catálogo vinha PRIMEIRO, com o comentário afirmando que achar
    // o produto era o primeiro passo do fluxo comercial. Não é: o fluxo
    // acordado com a Distribuidora Exemplo é cadastro → região de entrega → produto. Como o
    // modelo lê a lista de cima para baixo e a trata como roteiro, a lista
    // antiga o mandava caçar produto antes de saber quem era o cliente — foi o
    // que aconteceu no teste real de 20/09.
    assert.deepEqual(
      ferramentasDoRoteiro('vendas').map(f => f.definicao.name),
      ['consultar_cliente', 'cadastrar_cliente', 'buscar_produtos', 'consultar_preco', 'criar_orcamento'],
      'a ordem da lista É o roteiro que o modelo lê — ela tem que ser a do fluxo comercial',
    );
    assert.deepEqual(ferramentasDoRoteiro('atendimento'), []);
    assert.deepEqual(ferramentasDoRoteiro('copiloto'), []);
  });

  // Desde 14/09 o atendimento pode receber UMA ferramenta — e só quando o
  // catálogo é grande demais para caber no prompt. É o preço de a regra passar
  // a ser o tamanho: sem a ferramenta, o índice apontaria para produtos que
  // ninguém consegue abrir.
  test('atendimento com catálogo grande ganha a busca — e SÓ ela', () => {
    const lista = ferramentasDoRoteiro('atendimento', { produtosPorIndice: true });
    assert.deepEqual(lista.map(f => f.definicao.name), ['buscar_produtos'],
      'nada de ERP no atendimento: cadastro, cotação e orçamento são do fluxo comercial');
  });

  test('atendimento com catálogo pequeno continua sem ferramenta nenhuma', () => {
    // É esta linha que garante que a requisição do Wappia Atendimento sai sem o
    // campo `tools`, byte a byte igual à de antes do laço.
    assert.deepEqual(ferramentasDoRoteiro('atendimento', { produtosPorIndice: false }), []);
  });

  test('o copiloto não ganha ferramenta nem com catálogo grande', () => {
    assert.deepEqual(ferramentasDoRoteiro('copiloto', { produtosPorIndice: true }), [],
      'ninguém conversa com a IA pelo copiloto');
  });

  test('devolve as linhas do assunto e manda não trocar a medida pedida', async () => {
    await importarExemplo();
    const saida = await ferramenta().executar({ assuntos: ['4101'] }, ctx());

    assert.match(saida, /700005 \| CA50 1\/2 \(12\.5 MM\) \| R\$ 112,40/);
    assert.match(saida, /peso_kg: 11\.6/, 'as colunas extras do CSV chegam ao modelo');
    assert.doesNotMatch(saida, /PREGO/, 'produto de outro assunto não entra');
    assert.match(saida, /NUNCA troque a medida pedida/);
  });

  test('vários assuntos de uma vez, porque o cliente mistura famílias', async () => {
    await importarExemplo();
    const saida = await ferramenta().executar({ assuntos: ['4101', '4900'] }, ctx());

    assert.match(saida, /CA50 3\/8/);
    assert.match(saida, /PREGO 17 X 21/);
  });

  test('assunto inexistente volta como recado, não como erro', async () => {
    await importarExemplo();
    const saida = await ferramenta().executar({ assuntos: ['telha de vidro'] }, ctx());

    assert.match(saida, /Não existe assunto no catálogo com: telha de vidro/);
  });

  test('entrada vazia não quebra a ferramenta', async () => {
    const saida = await ferramenta().executar({}, ctx());
    assert.match(saida, /Nenhum assunto informado/);
  });
});

describe('o índice que entra no prompt', () => {
  test('leva os assuntos, o dicionário e as regras — e nenhum produto', async () => {
    await importarExemplo();
    banco.catalogo_config[0].dicionario = 'ø 12.5 = CA50 1/2';
    banco.catalogo_config[0].regras = 'A medida pedida não se troca.';

    const indice = await catalogoParaPrompt(supabase.client, ORG);

    assert.ok(indice);
    assert.equal(indice!.produtos, 4);
    assert.deepEqual(indice!.grupos.map(g => g.codigo), ['4101', '4900']);
    assert.equal(indice!.dicionario, 'ø 12.5 = CA50 1/2');
    // A prova de que o catálogo não vai inteiro: o índice não tem descrição de
    // produto nenhuma.
    assert.doesNotMatch(JSON.stringify(indice), /CA50 1\/2 \(12\.5 MM\)/);
  });

  test('sem catálogo cadastrado devolve nulo — e aí o prompt segue como sempre foi', async () => {
    assert.equal(await catalogoParaPrompt(supabase.client, ORG), null);
  });
});

describe('o prompt de cada roteiro', () => {
  // Um banco à parte: aqui o que se mede é o texto do prompt, e ele precisa de
  // organização, configuração do agente e a lista de produtos da aba Empresa
  // para haver o que comparar.
  function cenarioComProdutos() {
    const proprio: Banco = {
      organizations: [{ id: ORG, nome: 'Distribuidora Exemplo', nome_fantasia: 'Distribuidora Exemplo', descricao: null, endereco: null, telefone: null }],
      ai_agent_config: [
        { id: 'cfg-org', organization_id: ORG, wa_number_id: null, roteiro: 'atendimento', ativo: true,
          prompt: 'Você atende a Distribuidora Exemplo.', tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
          fallback_mode: 'transferir', fallback_atendente_id: null, welcome_msg: '' },
        { id: 'cfg-vendedor', organization_id: ORG, wa_number_id: 'num-1', roteiro: 'vendas', ativo: true,
          prompt: 'Você é o assistente do vendedor João.', tom: 'direto', limitacoes: null, info_adicional: null,
          sucessos: null, fallback_mode: 'transferir', fallback_atendente_id: null, welcome_msg: '' },
      ],
      business_prices: [{ id: 'p1', organization_id: ORG, procedimento: 'Vergalhão avulso', valor: 'R$ 29,80', descricao: null, estoque: null, observacoes: null, controla_estoque: false, estoque_qtd: null, estoque_minimo: null }],
      business_hours: [], business_faqs: [], business_qualification_questions: [], business_triggers: [],
      appointments: [], availability: [],
      catalogo_grupos: [], catalogo_produtos: [], catalogo_config: [],
    };
    return { proprio, cliente: criarSupabaseFalso(proprio).client as Cliente };
  }

  test('com catálogo grande, vai só o índice — e isso não depende do roteiro', async () => {
    const { proprio, cliente } = cenarioComProdutos();
    const { linhas } = lerCatalogoCSV(CSV_GRANDE);
    await importarCatalogo(cliente, ORG, linhas, 'tabela.csv');
    proprio.catalogo_config[0].dicionario = 'ø 12.5 = CA50 1/2';

    const { systemPrompt, roteiro } = await buildSystemPrompt(cliente, ORG, 'num-1');

    assert.equal(roteiro, 'vendas');
    assert.match(systemPrompt, /## Catálogo de produtos/);
    assert.match(systemPrompt, /- 4101 — VERGALHOES CA50/);
    assert.match(systemPrompt, /ø 12\.5 = CA50 1\/2/);
    // O que NÃO pode estar lá: nenhuma linha de produto do catálogo...
    assert.doesNotMatch(systemPrompt, /CA50 1\/2 \(12\.5 MM\)/);
    // ...nem a lista da aba Empresa, que o catálogo substituiu.
    assert.doesNotMatch(systemPrompt, /## Produtos e serviços/);
  });

  test('com catálogo pequeno, ele vai INTEIRO no prompt, linha por linha', async () => {
    const { cliente } = cenarioComProdutos();
    const { linhas } = lerCatalogoCSV(CSV_EXEMPLO); // 4 produtos, abaixo do teto
    await importarCatalogo(cliente, ORG, linhas, 'tabela.csv');

    const { systemPrompt, produtosPorIndice } = await buildSystemPrompt(cliente, ORG, 'num-1');

    assert.equal(produtosPorIndice, false);
    assert.match(systemPrompt, /## Produtos e serviços/);
    assert.match(systemPrompt, /CA50 1\/2 \(12\.5 MM\) \(código 700005\): R\$ 112,40/,
      'catálogo pequeno não vira índice: as linhas entram como estão');
    assert.doesNotMatch(systemPrompt, /## Catálogo de produtos/);
  });

  // A lista DIGITADA não tem código, e sem código o sistema do cliente não cota
  // nada. Num número de vendas COM catálogo ela não pode aparecer: numa
  // conversa de teste em 14/09 o modelo propôs um prego dela e o ERP casou com
  // outro — PREGO 22 X 48 no lugar do 17 X 21.
  test('vendas com catálogo NÃO vê a lista digitada', async () => {
    const { cliente } = cenarioComProdutos();
    const { linhas } = lerCatalogoCSV(CSV_EXEMPLO);
    await importarCatalogo(cliente, ORG, linhas, 'tabela.csv');

    const { systemPrompt, usaListaDigitada } = await buildSystemPrompt(cliente, ORG, 'num-1');

    assert.equal(usaListaDigitada, false, 'e a ferramenta recebe a mesma decisão');
    assert.doesNotMatch(systemPrompt, /Vergalhão avulso/);
  });

  test('o número de ATENDIMENTO da mesma empresa continua vendo a lista digitada', async () => {
    const { cliente } = cenarioComProdutos();
    const { linhas } = lerCatalogoCSV(CSV_EXEMPLO);
    await importarCatalogo(cliente, ORG, linhas, 'tabela.csv');

    const { systemPrompt, usaListaDigitada } = await buildSystemPrompt(cliente, ORG, null);

    assert.equal(usaListaDigitada, true);
    assert.match(systemPrompt, /Vergalhão avulso/);
  });

  test('o número de atendimento com catálogo grande também recebe só o índice', async () => {
    const { cliente } = cenarioComProdutos();
    const { linhas } = lerCatalogoCSV(CSV_GRANDE);
    await importarCatalogo(cliente, ORG, linhas, 'tabela.csv');

    const { systemPrompt, produtosPorIndice } = await buildSystemPrompt(cliente, ORG, null);

    assert.equal(produtosPorIndice, true);
    assert.match(systemPrompt, /## Catálogo de produtos/);
    // E a lista digitada não some: ela entra no índice, pelo nome.
    assert.match(systemPrompt, /- Vergalhão avulso/);
    assert.doesNotMatch(systemPrompt, /## Produtos e serviços/);
  });

  // Decisão do C6 que segue valendo: catálogo vazio nunca pode virar "a empresa
  // não vende nada".
  test('roteiro de vendas SEM catálogo cadastrado usa a lista de sempre', async () => {
    const { cliente } = cenarioComProdutos();

    const { systemPrompt, usaListaDigitada } = await buildSystemPrompt(cliente, ORG, 'num-1');

    assert.equal(usaListaDigitada, true);
    assert.match(systemPrompt, /## Produtos e serviços/);
    assert.match(systemPrompt, /Vergalhão avulso/);
    assert.doesNotMatch(systemPrompt, /## Catálogo de produtos/);
  });

  // Agenda, qualificação, regras de transferência e mensagem de fechamento
  // descrevem o trabalho de um ATENDENTE. Num número de vendas elas pararam a
  // IA no meio do orçamento para perguntar "retirada ou entrega?", e a agenda
  // listava horários de consultório para quem compra vergalhão.
  test('o número de vendas não recebe agenda nem questionário', async () => {
    const { cliente } = cenarioComProdutos();

    const { systemPrompt } = await buildSystemPrompt(cliente, ORG, 'num-1');

    assert.doesNotMatch(systemPrompt, /## Agenda e disponibilidade/);
    assert.doesNotMatch(systemPrompt, /## Qualificação do cliente/);
    assert.doesNotMatch(systemPrompt, /## Como concluir o atendimento/);
  });

  test('o número de atendimento continua recebendo os quatro', async () => {
    const { cliente } = cenarioComProdutos();

    const { systemPrompt } = await buildSystemPrompt(cliente, ORG, null);

    assert.match(systemPrompt, /## Agenda e disponibilidade/);
  });
});

describe('o formato da planilha é reconhecido pelo cabeçalho', () => {
  // A seção Produtos tem UM botão de importar, não dois. Se a detecção errar, o
  // cliente sobe a planilha do sistema dele e ela é lida como lista simples —
  // silenciosamente, com o código virando nome de produto.
  test('catálogo de sistema: tem código e grupo', () => {
    assert.equal(pareceCatalogoDeSistema(CSV_EXEMPLO), true);
    assert.equal(pareceCatalogoDeSistema('codigo;categoria;descricao;preco\n1;Tintas;Zarcão;89,90'), true);
  });

  test('lista simples: nome e preço, sem código nem grupo', () => {
    assert.equal(pareceCatalogoDeSistema('Produto;Preço;Descrição\nLimpeza;R$ 90;Profilaxia'), false);
  });

  test('só o código, sem grupo, ainda é lista simples', () => {
    // Sem grupo não há assunto, e sem assunto o índice do prompt não existe:
    // essa planilha não é um catálogo de sistema, é uma lista com código.
    assert.equal(pareceCatalogoDeSistema('codigo;descricao;preco\n1;Limpeza;90'), false);
  });

  test('arquivo vazio não é catálogo', () => {
    assert.equal(pareceCatalogoDeSistema(''), false);
  });
});

describe('o termo que não é assunto é um pedaço do nome do produto', () => {
  // **O pior erro possível nesta ferramenta é dizer que a loja não vende o que
  // ela vende.** Numa conversa de verdade em 14/09 o modelo pediu "prego
  // 17x21", que não é nome de grupo nenhum — e a IA respondeu ao cliente que
  // não tinha, quando o produto existe dentro do assunto PREGOS.
  test('acha o produto pela descrição quando o termo não casa com nenhum assunto', async () => {
    await importarExemplo();

    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['PREGO 17 X 21']);

    assert.deepEqual(r.produtos.map(p => p.codigo), ['700113']);
    assert.deepEqual(r.gruposEncontrados.map(g => g.nome), ['PREGOS'],
      'o assunto do produto achado vem junto, para a saída sair organizada');
  });

  test('acha pelo código também', async () => {
    await importarExemplo();
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['700005']);
    assert.deepEqual(r.produtos.map(p => p.codigo), ['700005']);
  });

  test('o caminho normal — pelo código do assunto — continua igual', async () => {
    await importarExemplo();
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['4900']);
    assert.deepEqual(r.produtos.map(p => p.codigo), ['700113']);
    assert.deepEqual(r.naoEncontrados, []);
  });

  test('termo curto demais não vira busca por texto', async () => {
    // "17" está dentro de "PREGO 17 X 21", mas dois caracteres casariam com
    // meio catálogo e a IA escolheria dentro do lixo.
    await importarExemplo();
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['17']);
    assert.deepEqual(r.produtos, []);
    assert.deepEqual(r.naoEncontrados, ['17']);
  });

  test('o que não existe mesmo continua não existindo', async () => {
    await importarExemplo();
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['telha de barro']);
    assert.deepEqual(r.produtos, []);
    assert.deepEqual(r.naoEncontrados, ['telha de barro']);
  });

  // O ERP da Distribuidora Exemplo escreve do jeito dele: VERGALHAO sem acento num código e
  // com acento nos outros, TAMPAPARACALHA tudo junto. A IA pede como gente
  // escreve; comparar letra por letra dizia "não tem" para produto que existe.
  const CSV_ERP = [
    'codigo,grupo,grupo_nome,descricao,preco_tabela',
    '"700004","4101","VERGALHOES CA50","VERGALHAO CA50 3/8 (10.0 MM)","73.50"',
    '"700005","4101","VERGALHOES CA50","VERGALHÃO CA50 1/2 (12.5 MM)","112.40"',
    '"701886","3100","ACESSORIOS CALHAS SUPORTE","TAMPAPARACALHA COLONIAL 40CM","20"',
  ].join('\n');

  test('acha com ou sem acento', async () => {
    await importarExemplo(CSV_ERP);
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['vergalhão ca50']);
    assert.deepEqual(r.produtos.map(p => p.codigo), ['700004', '700005']);
  });

  test('acha quando o catálogo escreve as palavras grudadas', async () => {
    await importarExemplo(CSV_ERP);
    const r = await buscarProdutosPorGrupo(supabase.client, ORG, ['Tampa para calha']);
    assert.deepEqual(r.produtos.map(p => p.codigo), ['701886']);
  });

  test('a busca por texto não atravessa a fronteira da organização', async () => {
    await importarExemplo();
    const r = await buscarProdutosPorGrupo(supabase.client, OUTRA_ORG, ['PREGO 17 X 21']);
    assert.deepEqual(r.produtos, []);
  });
});

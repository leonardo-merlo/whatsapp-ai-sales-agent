// A máquina de estados do orçamento, valendo (fases 2 e 3), até a lista
// confirmada. `passo` é puro: etapa e evento entram, etapa, ação e fala saem.
// Uma transição, um teste, como pede o spec.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pareceRespostaDoItem, passo, trechoDosProdutos, type Evento, type MensagemDoCliente } from '@/lib/agente/maquina/transicoes';
import { faltaParaAEtapa, LEITURA_VAZIA, type ClienteDoOrcamento, type EstadoDoOrcamento, type Leitura } from '@/lib/agente/maquina/tipos';
import { validarCampo } from '@/lib/agente/maquina/cadastro';
import { cidadesParecidas, estadosAtendidos, regioesDaCidade } from '@/lib/agente/maquina/cidades';

const CNPJ = '11222333000181';
const OUTRO_CNPJ = '45723174000110';

function msg(id: string, texto: string, leitura: Partial<Leitura> = {}, extra: Partial<MensagemDoCliente> = {}): Evento {
  return { tipo: 'mensagem', mensagem: { mensagemId: id, texto, documento: null, documentoInvalido: false, leitura: { ...LEITURA_VAZIA, ...leitura }, ...extra } };
}

const CLIENTE: ClienteDoOrcamento = {
  id: 'Z00002/01', nome: 'EMPRESA TESTE AGENTE LTDA', cidade: 'JUNDIAI', uf: 'MG',
  situacao: 'BLOQUEADO', pode_faturar: false, confirmado: false, origem: 'erp',
};

const em = (etapa: EstadoDoOrcamento['etapa'], extra: Partial<EstadoDoOrcamento> = {}): EstadoDoOrcamento => ({
  etapa, pergunta: null, desdeMensagem: 'm0', dados: { documento: { valor: CNPJ, origem: 'cliente' } }, ...extra,
});

const regiao = em('confirmando_regiao', { pergunta: 'confirmar_cliente', dados: { documento: { valor: CNPJ, origem: 'cliente' }, cliente: CLIENTE } });
const perguntandoCidade = em('confirmando_regiao', {
  pergunta: 'cidade', dados: { documento: { valor: CNPJ, origem: 'cliente' }, cliente: { ...CLIENTE, confirmado: true } },
});
const itens = em('levantando_itens', {
  pergunta: 'produtos',
  dados: { documento: { valor: CNPJ, origem: 'cliente' }, cliente: { ...CLIENTE, confirmado: true }, entrega: { cidade: 'JUNDIAI', uf: 'MG', regioes: ['M01'], origem: 'cliente' } },
});

describe('abrir o orçamento', () => {
  test('T1: sem orçamento, pedido de orçamento abre em aguardando_documento', () => {
    const p = passo(null, msg('m1', 'quero um orçamento', { intencao: 'pedir_orcamento' }), 'm1');
    assert.deepEqual([p.estado?.etapa, p.fala], ['aguardando_documento', { tipo: 'fixa', chave: 'pedir_documento' }]);
  });

  test('sem orçamento, cumprimento não abre nada e a IA responde livre', () => {
    const p = passo(null, msg('m1', 'bom dia', { intencao: 'outro_assunto' }), 'm1');
    assert.deepEqual([p.estado, p.fala], [null, { tipo: 'livre', depois: null }]);
  });

  test('T1 + T2: o documento na primeira mensagem já manda consultar', () => {
    const p = passo(null, msg('m1', `cnpj ${CNPJ}`, {}, { documento: CNPJ }), 'm1');
    assert.deepEqual([p.estado?.etapa, p.transicoes, p.acao], ['consultando_cadastro', ['T1', 'T2'], { tipo: 'consultar_cliente', documento: CNPJ }]);
  });

  test('os produtos que chegaram com o CNPJ ficam guardados, sem pular etapa', () => {
    const p = passo(null, msg('m1', `cnpj ${CNPJ}, quero 10 vergalhões`, { produtosCitados: true }, { documento: CNPJ }), 'm1');
    assert.equal(p.estado?.dados.produtos_guardados, `cnpj ${CNPJ}, quero 10 vergalhões`);
  });
});

describe('o trecho dos produtos guardados', () => {
  const fala = 'Opa, cnpj 11222333000181, entrega em Juniaí, preciso de 20 kg de prego 17x21';
  const m = (produtosTexto: string | null): MensagemDoCliente =>
    ({ mensagemId: 'm1', texto: fala, documento: CNPJ, documentoInvalido: false, leitura: { ...LEITURA_VAZIA, produtosCitados: true, produtosTexto } });

  test('guarda só o trecho que a IA separou, quando ele está na fala', () => {
    assert.equal(trechoDosProdutos(m('20 kg de prego 17x21')), '20 kg de prego 17x21');
  });

  test('trecho que não está na fala (a IA reescreveu) cai na fala inteira', () => {
    assert.equal(trechoDosProdutos(m('20kg prego 17 x 21')), fala);
  });
});

describe('aguardando_documento', () => {
  const aguardando = em('aguardando_documento', { pergunta: 'documento', dados: {} });

  test('T2: documento válido → consultando_cadastro', () => {
    const p = passo(aguardando, msg('m2', CNPJ, {}, { documento: CNPJ }), 'm2');
    assert.deepEqual([p.estado?.etapa, p.acao?.tipo], ['consultando_cadastro', 'consultar_cliente']);
  });

  test('documento com dígito errado: pede de novo, sem chamar o ERP', () => {
    const p = passo(aguardando, msg('m2', '11.222.333/0001-00', {}, { documentoInvalido: true }), 'm2');
    assert.deepEqual([p.estado?.etapa, p.acao, p.fala], ['aguardando_documento', null, { tipo: 'fixa', chave: 'documento_invalido' }]);
  });

  test('outro assunto: a IA responde e o código repete o pedido do documento', () => {
    const p = passo(aguardando, msg('m2', 'vocês abrem sábado?', { intencao: 'outro_assunto' }), 'm2');
    assert.deepEqual(p.fala, { tipo: 'livre', depois: 'pedir_documento' });
  });
});

describe('consultando_cadastro', () => {
  test('T3: ERP achou → confirmando_regiao, perguntando se é o cadastro', () => {
    const p = passo(em('consultando_cadastro'), { tipo: 'erp_consulta', resultado: 'encontrado', cliente: CLIENTE }, 'm2');
    assert.deepEqual([p.estado?.etapa, p.estado?.pergunta, p.estado?.dados.cliente?.confirmado], ['confirmando_regiao', 'confirmar_cliente', false]);
  });

  test('T4: ERP não achou → coletando_cadastro', () => {
    const p = passo(em('consultando_cadastro'), { tipo: 'erp_consulta', resultado: 'nao_encontrado' }, 'm2');
    assert.deepEqual([p.estado?.etapa, p.fala], ['coletando_cadastro', { tipo: 'fixa', chave: 'pedir_dados_do_cadastro' }]);
  });

  test('X5: ERP fora do ar → fica na etapa e avisa que vai confirmar', () => {
    const p = passo(em('consultando_cadastro'), { tipo: 'erp_consulta', resultado: 'falhou' }, 'm2');
    assert.deepEqual([p.estado?.etapa, p.fala], ['consultando_cadastro', { tipo: 'fixa', chave: 'vou_confirmar' }]);
  });

  test('depois de uma falha, a mensagem nova tenta consultar de novo', () => {
    const p = passo(em('consultando_cadastro'), msg('m3', 'e aí?'), 'm3');
    assert.equal(p.acao?.tipo, 'consultar_cliente');
  });
});

describe('coletando e criando o cadastro', () => {
  const coletando = em('coletando_cadastro', {
    pergunta: 'dados_do_cadastro',
    dados: { documento: { valor: CNPJ, origem: 'cliente' }, cadastro_novo: { campos: {}, faltando: ['nome', 'logradouro', 'numero', 'cidade', 'uf', 'cep'] } },
  });
  const completos = { nome: 'Serralheria X', logradouro: 'Rua A', numero: '10', cidade: 'Jundiaí', uf: 'mg', cep: '36880-000' };

  test('T5: dados parciais ficam guardados e a fala pede só o que falta', () => {
    const p = passo(coletando, msg('m3', 'Serralheria X, Rua A 10', { campos: { nome: 'Serralheria X', logradouro: 'Rua A', numero: '10' } }), 'm3');
    assert.deepEqual(p.estado?.dados.cadastro_novo?.faltando, ['cidade', 'uf', 'cep']);
  });

  test('T5: CEP curto e UF de 3 letras não entram', () => {
    const p = passo(coletando, msg('m3', '...', { campos: { ...completos, cep: '3688', uf: 'MGG' } }), 'm3');
    assert.deepEqual(p.estado?.dados.cadastro_novo?.faltando, ['uf', 'cep']);
  });

  test('T6: dados completos → criando_cadastro e manda cadastrar', () => {
    const p = passo(coletando, msg('m3', '...', { campos: completos }), 'm3');
    assert.deepEqual([p.estado?.etapa, p.acao?.tipo], ['criando_cadastro', 'cadastrar_cliente']);
  });

  const criando = em('criando_cadastro', { dados: { documento: { valor: CNPJ, origem: 'cliente' }, cadastro_novo: { campos: { ...completos, uf: 'MG', cep: '36880000' }, faltando: [] } } });

  test('T8: ERP criou → confirmando_regiao, já confirmado, perguntando a cidade', () => {
    const p = passo(criando, { tipo: 'erp_cadastro', resultado: 'criado', cliente: { ...CLIENTE, cidade: null, uf: null } }, 'm3');
    assert.deepEqual([p.estado?.pergunta, p.estado?.dados.cliente?.confirmado, p.estado?.dados.cliente?.cidade], ['cidade', true, 'Jundiaí']);
  });

  test('T7: documento já cadastrado → consulta de novo', () => {
    const p = passo(criando, { tipo: 'erp_cadastro', resultado: 'ja_existe' }, 'm3');
    assert.deepEqual([p.estado?.etapa, p.acao?.tipo], ['consultando_cadastro', 'consultar_cliente']);
  });

  test('T9: ERP recusou o CEP → volta a coletar, pedindo o CEP', () => {
    const p = passo(criando, { tipo: 'erp_cadastro', resultado: 'recusado', campo: 'endereco.cep' }, 'm3');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.cadastro_novo?.faltando], ['coletando_cadastro', ['cep']]);
  });
});

describe('confirmando_regiao', () => {
  test('T10a: confirmou o cadastro → pergunta a cidade', () => {
    const p = passo(regiao, msg('m3', 'sim', { intencao: 'confirma' }), 'm3');
    assert.deepEqual([p.estado?.pergunta, p.estado?.dados.cliente?.confirmado, p.fala], ['cidade', true, { tipo: 'fixa', chave: 'pedir_cidade' }]);
  });

  test('G-fala: a mesma mensagem que mostrou o cadastro não vale como confirmação', () => {
    const p = passo(regiao, msg('m0', 'sim', { intencao: 'confirma' }), 'm0');
    assert.deepEqual([p.estado?.dados.cliente?.confirmado, p.fala], [false, { tipo: 'fixa', chave: 'confirmar_cliente' }]);
  });

  test('"sim, Jundiaí" confirma e já manda conferir a cidade', () => {
    const p = passo(regiao, msg('m3', 'sim, Jundiaí', { intencao: 'confirma', cidade: { cidade: 'Jundiaí', uf: null } }), 'm3');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'Jundiaí', uf: null });
  });

  test('X1b: "não sou eu" volta a pedir o documento', () => {
    const p = passo(regiao, msg('m3', 'não, é outra empresa', { intencao: 'nega' }), 'm3');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.cliente], ['aguardando_documento', undefined]);
  });

  test('T10: cidade atendida → levantando_itens, pedindo os produtos', () => {
    const p = passo(perguntandoCidade, { tipo: 'cidade_conferida', cidade: 'Jundiaí', uf: 'MG', regioes: ['M01'] }, 'm4');
    assert.deepEqual([p.estado?.etapa, p.fala], ['levantando_itens', { tipo: 'fixa', chave: 'pedir_produtos' }]);
  });

  test('T10 com lista já em montagem (voltou depois de trocar de CNPJ): mostra a lista de novo', () => {
    const comLista = { ...perguntandoCidade, dados: { ...perguntandoCidade.dados, v2_pedido_id: 'p1' } };
    const p = passo(comLista, { tipo: 'cidade_conferida', cidade: 'Jundiaí', uf: 'MG', regioes: ['M01'] }, 'm4');
    assert.deepEqual(p.acao, { tipo: 'v2_lista', pedidoId: 'p1' });
  });

  test('cidade não atendida: não segue e diz qual cidade', () => {
    const p = passo(perguntandoCidade, { tipo: 'cidade_conferida', cidade: 'Recife', uf: 'PE', regioes: [] }, 'm4');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.cidade_recusada, p.fala], ['confirmando_regiao', 'Recife', { tipo: 'fixa', chave: 'cidade_nao_atendida' }]);
  });

  test('T10 com produtos guardados: vão direto para a v2', () => {
    const comProdutos = { ...perguntandoCidade, dados: { ...perguntandoCidade.dados, produtos_guardados: '10 vergalhões 3/8' } };
    const p = passo(comProdutos, { tipo: 'cidade_conferida', cidade: 'Jundiaí', uf: 'MG', regioes: ['M01'] }, 'm4');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: '10 vergalhões 3/8', pedidoId: null });
  });

  test('a cidade citada junto com o CNPJ vale depois do "sim"', () => {
    const comCidade = { ...regiao, dados: { ...regiao.dados, cidade_citada: { cidade: 'Juniaí', uf: 'MG' } } };
    const p = passo(comCidade, msg('m3', 'isso', { intencao: 'confirma' }), 'm3');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'Juniaí', uf: 'MG' });
  });
});

describe('levantando_itens', () => {
  test('T12: produtos vão para a v2 e a fala é a dela', () => {
    const p1 = passo(itens, msg('m5', '10 vergalhões 3/8', { intencao: 'produtos' }), 'm5');
    const p2 = passo(p1.estado, { tipo: 'v2', pedidoId: 'p1', texto: 'Anotei: ...', confirmados: null }, 'm5');
    assert.deepEqual([p1.acao?.tipo, p2.fala, p2.estado?.dados.v2_pedido_id], ['v2', { tipo: 'v2', texto: 'Anotei: ...' }, 'p1']);
  });

  test('com pedido aberto na v2, toda mensagem vai para ela', () => {
    const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
    const p = passo(aberto, msg('m6', '1'), 'm6');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: '1', pedidoId: 'p1' });
  });

  test('T14: lista confirmada sem as formas de pagamento do cliente → consulta o cadastro de novo', () => {
    const confirmados = [{ item_id: 'i1', codigo: '700123', descricao: 'VERGALHAO', quantidade: '10' }];
    const p = passo(itens, { tipo: 'v2', pedidoId: 'p1', texto: '', confirmados }, 'm7');
    assert.deepEqual([p.estado?.etapa, p.acao], ['definindo_pagamento', { tipo: 'buscar_formas', documento: CNPJ }]);
  });

  test('X1: outro CNPJ no meio dos itens volta a consultar e mantém o pedido da v2', () => {
    const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
    const p = passo(aberto, msg('m6', `é para o ${OUTRO_CNPJ}`, {}, { documento: OUTRO_CNPJ }), 'm6');
    assert.deepEqual([p.estado?.etapa, p.estado?.dados.cliente, p.estado?.dados.v2_pedido_id], ['consultando_cadastro', undefined, 'p1']);
  });
});

describe('R1: o mínimo de cada etapa', () => {
  test('levantando_itens sem cliente confirmado é recusado', () => {
    assert.equal(faltaParaAEtapa({ ...itens, dados: { ...itens.dados, cliente: CLIENTE } }), 'cliente não confirmado');
  });

  test('confirmando_regiao sem cliente do ERP é recusado', () => {
    assert.equal(faltaParaAEtapa(em('confirmando_regiao')), 'sem cliente do ERP');
  });

  test('a etapa com tudo que precisa passa', () => {
    assert.equal(faltaParaAEtapa(itens), null);
  });
});

describe('forma dos campos e cidades', () => {
  test('CEP com traço vira 8 dígitos; UF em minúscula vira maiúscula', () => {
    assert.deepEqual([validarCampo('cep', '36880-000'), validarCampo('uf', 'mg')], ['36880000', 'MG']);
  });

  const REGIOES = [
    { regiao_id: 'M01', cidades: [{ cidade: 'JUNDIAI', uf: 'MG' }] },
    { regiao_id: 'I02', cidades: [{ cidade: 'ALEGRE', uf: 'ES' }, { cidade: 'ALEGRE', uf: 'RJ' }] },
  ];

  test('"Jundiaí" acha JUNDIAI, sem acento e sem maiúscula', () => {
    assert.deepEqual(regioesDaCidade(REGIOES, 'jundiaí', null), ['M01']);
  });

  test('cidade fora da lista não acha região', () => {
    assert.deepEqual(regioesDaCidade(REGIOES, 'Recife', 'PE'), []);
  });

  test('os estados atendidos saem por extenso, o mais frequente primeiro', () => {
    const regioes = [
      { regiao_id: 'M01', cidades: [{ cidade: 'JUNDIAI', uf: 'MG' }, { cidade: 'JUNIAI', uf: 'MG' }] },
      { regiao_id: 'I01', cidades: [{ cidade: 'VINHEDO', uf: 'RJ' }] },
    ];
    assert.deepEqual(estadosAtendidos(regioes), ['Minas Gerais', 'Rio de Janeiro']);
  });
});

describe('teste do Leonardo de 08/10', () => {
  const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };

  test('outro assunto no meio da lista é respondido e a lista volta', () => {
    const p = passo(aberto, msg('m6', 'vocês abrem sábado?', { intencao: 'outro_assunto' }), 'm6');
    assert.deepEqual([p.acao, p.fala], [null, { tipo: 'livre_e_lista', pedidoId: 'p1' }]);
  });

  test('correção do item vai para a v2 mesmo lida como outro assunto', () => {
    const p = passo(aberto, msg('m6', 'não, é vergalhão 5/16', { intencao: 'outro_assunto' }), 'm6');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: 'não, é vergalhão 5/16', pedidoId: 'p1' });
  });

  test('resposta curta ("5.0", "2", "sim") é do item', () => {
    assert.deepEqual(['5.0', '2', 'sim', 'opção 1', 'vocês abrem sábado?'].map(pareceRespostaDoItem), [true, true, true, true, false]);
  });

  test('cidade digitada errado guarda as parecidas', () => {
    const p = passo(perguntandoCidade, { tipo: 'cidade_conferida', cidade: 'Jundiaé', uf: null, regioes: [], parecidas: ['JUNDIAI', 'JUNIAI'] }, 'm4');
    assert.deepEqual([p.estado?.dados.cidade_recusada, p.estado?.dados.cidades_parecidas], ['Jundiaé', ['JUNDIAI', 'JUNIAI']]);
  });

  test('cidade aceita depois limpa as parecidas', () => {
    const recusada = { ...perguntandoCidade, dados: { ...perguntandoCidade.dados, cidade_recusada: 'Jundiaé', cidades_parecidas: ['JUNDIAI'] } };
    const p = passo(recusada, { tipo: 'cidade_conferida', cidade: 'Juniaí', uf: null, regioes: ['M01'] }, 'm5');
    assert.equal(p.estado?.dados.cidades_parecidas, undefined);
  });

  test('a lista das cidades parecidas pega o erro de digitação', () => {
    const regioes = [{ regiao_id: 'M01', cidades: [{ cidade: 'JUNDIAI', uf: 'MG' }, { cidade: 'JUNIAI', uf: 'MG' }, { cidade: 'ITUPEVA', uf: 'MG' }] }];
    assert.deepEqual([cidadesParecidas(regioes, 'Jundiaé'), cidadesParecidas(regioes, 'Recife')], [['JUNDIAI', 'JUNIAI'], []]);
  });
});

describe('T20: mesmo cliente, segundo orçamento no dia (teste de campo de 20/10)', () => {
  const anterior = { documento: CNPJ, cliente: { ...CLIENTE, confirmado: true } };
  const perguntando = em('aguardando_documento', { pergunta: 'mesmo_cadastro', desdeMensagem: 'm1', dados: { cadastro_anterior: anterior } });

  test('com orçamento do mesmo cliente hoje, pergunta se é o mesmo cadastro em vez de pedir o documento', () => {
    const p = passo(null, msg('m1', 'quero outro orçamento', { intencao: 'pedir_orcamento' }, { cadastroAnterior: anterior }), 'm1');
    assert.deepEqual([p.estado?.etapa, p.estado?.pergunta, p.fala], ['aguardando_documento', 'mesmo_cadastro', { tipo: 'fixa', chave: 'confirmar_mesmo_cadastro' }]);
  });

  test('"sim": segue com aquele cliente, já confirmado, e pula para a cidade de entrega', () => {
    const p = passo(perguntando, msg('m2', 'sim', { intencao: 'confirma' }), 'm2');
    assert.deepEqual(
      [p.estado?.etapa, p.estado?.pergunta, p.estado?.dados.cliente?.confirmado, p.estado?.dados.documento?.valor, p.acao, p.fala, p.transicoes],
      ['confirmando_regiao', 'cidade', true, CNPJ, null, { tipo: 'fixa', chave: 'pedir_cidade' }, ['T20']],
    );
  });

  test('"sim" com a cidade já citada: confere a cidade direto', () => {
    const p = passo(perguntando, msg('m2', 'sim, entrega em Jundiaí', { intencao: 'confirma', cidade: { cidade: 'Jundiaí', uf: null } }), 'm2');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'Jundiaí', uf: null });
  });

  test('"não": pede o CPF ou CNPJ normalmente', () => {
    const p = passo(perguntando, msg('m2', 'não', { intencao: 'nega' }), 'm2');
    assert.deepEqual(
      [p.estado?.etapa, p.estado?.pergunta, p.estado?.dados.cadastro_anterior, p.fala],
      ['aguardando_documento', 'documento', undefined, { tipo: 'fixa', chave: 'pedir_outro_documento' }],
    );
  });

  test('outro CNPJ em vez de responder: consulta o novo', () => {
    const p = passo(perguntando, msg('m2', OUTRO_CNPJ, {}, { documento: OUTRO_CNPJ }), 'm2');
    assert.deepEqual([p.estado?.etapa, p.acao, p.estado?.dados.cadastro_anterior], ['consultando_cadastro', { tipo: 'consultar_cliente', documento: OUTRO_CNPJ }, undefined]);
  });

  test('o estado de "sim" passa na regra do mínimo da etapa (R1)', () => {
    const p = passo(perguntando, msg('m2', 'sim', { intencao: 'confirma' }), 'm2');
    assert.equal(faltaParaAEtapa(p.estado!), null);
  });
});

describe('teste do Leonardo de 21/10 às 21h', () => {
  const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
  test('pergunta no meio da lista é respondida pela IA mesmo sem ser lida como outro assunto', () => {
    const p = passo(aberto, msg('m7', 'pode me dizer o prazo de entrega?', { intencao: 'responde' }), 'm7');
    assert.deepEqual([p.acao, p.fala], [null, { tipo: 'livre_e_lista', pedidoId: 'p1' }]);
  });
  test('pergunta com produto continua indo para a lista', () => {
    const p = passo(aberto, msg('m7', 'tem metalon 50x30?', { intencao: 'produtos', produtosCitados: true }), 'm7');
    assert.equal(p.acao?.tipo, 'v2');
  });
});

describe('teste de voz de 21/10: "você quis dizer Jundiaí?"', () => {
  const sugeriu = passo(perguntandoCidade, { tipo: 'cidade_conferida', cidade: 'Muriá', uf: null, regioes: [], parecidas: ['JUNDIAI'] }, 'm4').estado!;
  test('"isso mesmo" aceita a cidade sugerida', () => {
    const p = passo(sugeriu, msg('m5', 'Isso mesmo.', { intencao: 'confirma' }), 'm5');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'JUNDIAI', uf: null });
  });
  test('"sim, quis dizer Muriá" (a mesma cidade de novo) aceita a sugerida', () => {
    const p = passo(sugeriu, msg('m5', 'Sim, quis dizer, Muriá é.', { intencao: 'confirma', cidade: { cidade: 'Muriá', uf: null } }), 'm5');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'JUNDIAI', uf: null });
  });
  test('outra cidade dita confere a outra', () => {
    const p = passo(sugeriu, msg('m5', 'é Juniaí', { cidade: { cidade: 'Juniaí', uf: null } }), 'm5');
    assert.deepEqual(p.acao, { tipo: 'conferir_cidade', cidade: 'Juniaí', uf: null });
  });
});

// B4/D (22/10): "Arame", sem pergunta, foi para a IA livre, que disse "vou tirar os dois" e não fez nada.
describe('frase sobre a lista nunca vai para a IA livre (teste do Vendedor 1 de 22/10)', () => {
  const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
  const FIXA = { tipo: 'fixa_e_lista', chave: 'lista_nao_entendi', pedidoId: 'p1' };

  for (const frase of ['Arame', 'é só 5 kg', 'o perfil de 68 na chapa 1.8', 'perfil trançado']) {
    test(`responde com a frase fixa e a lista a "${frase}"`, () => {
      assert.deepEqual(passo(aberto, msg('m7', frase, { intencao: 'outro_assunto' }), 'm7').fala, FIXA);
    });
  }
  for (const frase of ['obrigado', 'vou ver com o pedreiro', 'vocês abrem sábado?', 'qual o prazo de entrega?']) {
    test(`deixa "${frase}" para a IA livre, que só conversa`, () => {
      assert.equal(passo(aberto, msg('m7', frase, { intencao: 'outro_assunto' }), 'm7').fala.tipo, 'livre_e_lista');
    });
  }
});

describe('cliente que volta com um orçamento parado há mais de um dia (teste de 25/10)', () => {
  // Quinta 17:23 a lista ficou confirmada e o pagamento não foi escolhido; na segunda, a lista nova somou à de quinta.
  const parado = em('definindo_pagamento', { pergunta: 'pagamento', dados: { ...itens.dados, v2_pedido_id: 'p7' } });
  const pedido = '3 lambri ondulado 2x1\n1 kg de prego';
  const comPergunta = passo(parado, msg('m1', pedido, { produtosCitados: true }, { orcamentoParado: true }), 'm1');
  const perguntado = comPergunta.estado!;

  test('pergunta se continua o orçamento ou faz um novo, sem mexer na lista', () => {
    assert.deepEqual([comPergunta.fala, comPergunta.acao, perguntado.etapa], [{ tipo: 'fixa', chave: 'continuar_ou_novo' }, null, 'definindo_pagamento']);
  });

  test('"novo" fecha este orçamento e leva a mensagem dos produtos para o próximo', () => {
    const p = passo(perguntado, msg('m2', 'novo'), 'm2');
    assert.deepEqual([p.acao, p.estado?.dados.recomecar_com?.texto], [{ tipo: 'fechar_v2', pedidoId: 'p7', recomecar: true }, pedido]);
  });

  test('"pode continuar" segue com os produtos guardados neste orçamento', () => {
    const p = passo(perguntado, msg('m2', 'pode continuar'), 'm2');
    assert.deepEqual([p.transicoes, p.acao], [['T14b'], { tipo: 'v2', texto: pedido, pedidoId: 'p7' }]);
  });

  test('cancelar no lugar da pergunta continua sendo cancelar', () => {
    const p = passo(parado, msg('m1', 'cancela o orçamento', {}, { orcamentoParado: true }), 'm1');
    assert.deepEqual(p.fala, { tipo: 'fixa', chave: 'confirmar_cancelamento' });
  });
});

describe('frase sobre a lista com as operações ligadas (V2_OPERACOES, teste de 25/10)', () => {
  const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
  const frase = 'eu preciso de um arame trançado';

  test('vai para a v2, que lê a frase vendo a lista', () => {
    const p = passo(aberto, msg('m1', frase, { intencao: 'outro_assunto' }, { operacoes: true }), 'm1');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: frase, pedidoId: 'p1' });
  });

  test('desligada, continua a resposta fixa de antes', () => {
    const p = passo(aberto, msg('m1', frase, { intencao: 'outro_assunto' }), 'm1');
    assert.deepEqual(p.fala, { tipo: 'fixa_e_lista', chave: 'lista_nao_entendi', pedidoId: 'p1' });
  });
});

describe('"quero fechar o orçamento" com a lista aberta (teste de 25/10 à tarde)', () => {
  test('vai para a lista, que pede o sim final, e não responde "vamos seguir com o orçamento"', () => {
    const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
    const p = passo(aberto, msg('m1', 'quero fechar o orçamento, só isso', { intencao: 'pedir_orcamento' }), 'm1');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: 'quero fechar o orçamento, só isso', pedidoId: 'p1' });
  });
});

describe('outro CPF no meio, com produtos na mesma mensagem (áudio de cliente real, 25/10)', () => {
  const aberto = { ...itens, dados: { ...itens.dados, v2_pedido_id: 'p1' } };
  const audio = `meu CPF ${OUTRO_CNPJ}, preciso de perfil de 75 enrijecido na 2mm`;
  const trocou = passo(aberto, msg('m6', audio, { produtosCitados: true, produtosTexto: 'perfil de 75 enrijecido na 2mm' }, { documento: OUTRO_CNPJ }), 'm6').estado!;

  test('guarda os produtos ao trocar de cadastro', () => {
    assert.equal(trocou.dados.produtos_guardados, 'perfil de 75 enrijecido na 2mm');
  });

  test('depois da cidade, os produtos guardados entram na lista que já estava aberta', () => {
    const naCidade = { ...trocou, etapa: 'confirmando_regiao' as const, pergunta: 'cidade' as const, dados: { ...trocou.dados, cliente: { ...CLIENTE, confirmado: true } } };
    const p = passo(naCidade, { tipo: 'cidade_conferida', cidade: 'Jundiaí', uf: 'MG', regioes: ['M01'] }, 'm8');
    assert.deepEqual(p.acao, { tipo: 'v2', texto: 'perfil de 75 enrijecido na 2mm', pedidoId: 'p1' });
  });
});

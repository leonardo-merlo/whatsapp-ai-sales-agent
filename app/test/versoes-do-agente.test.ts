// Item 9, caminho B (29/09): cada salvamento guarda uma cópia, e voltar para
// uma cópia preenche a tela sem mexer no estoque de agora.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { abasQueMudaram, conteudoDaVersao, produtosComEstoqueAtual, type ConteudoDaVersao } from '../src/lib/agente/versoes.ts';
import type { AgenteConfigPayload } from '../src/lib/data/mutations.ts';
import { SUCESSOS_PADRAO } from '../src/lib/types.ts';

const BASE: AgenteConfigPayload = {
  ativo: true, welcomeMsg: 'Oi', agentPrompt: 'Atenda bem', limitacoes: '', tom: 'simpatico',
  fallbackMode: 'mensagem', fallbackMsg: '', fallbackAtendente: '', horarioVinculaAgenda: false,
  nomeNegocio: 'Clínica', descricaoNegocio: '', endereco: '',
  precos: [{ id: 'p1', proc: 'Consulta', valor: 'R$ 200', controlaEstoque: true, estoqueQtd: 10 }],
  faqs: [], perguntas: [], gatilhos: [], sucessos: SUCESSOS_PADRAO, infoAdicional: '',
};

describe('o que a cópia guarda', () => {
  test('deixa de fora o liga e desliga, que tem botão próprio', () => {
    assert.ok(!('ativo' in conteudoDaVersao(BASE)));
  });
});

describe('voltar para uma cópia', () => {
  test('mantém o estoque de agora, não o da cópia', () => {
    const atuais = [{ ...BASE.precos[0], estoqueQtd: 3 }];
    assert.equal(produtosComEstoqueAtual(BASE.precos, atuais)[0].estoqueQtd, 3);
  });

  test('produto que saiu depois volta com o saldo da cópia', () => {
    assert.equal(produtosComEstoqueAtual(BASE.precos, [])[0].estoqueQtd, 10);
  });

  test('traz o preço da cópia', () => {
    const atuais = [{ ...BASE.precos[0], valor: 'R$ 250' }];
    assert.equal(produtosComEstoqueAtual(BASE.precos, atuais)[0].valor, 'R$ 200');
  });
});

describe('o que mudou entre duas cópias', () => {
  const antes: ConteudoDaVersao = conteudoDaVersao(BASE);

  test('aponta a aba Agente quando a instrução muda', () => {
    assert.deepEqual(abasQueMudaram({ ...antes, agentPrompt: 'Nova' }, antes), ['Agente']);
  });

  test('estoque que baixou com venda não conta como mudança', () => {
    const depois = { ...antes, precos: [{ ...antes.precos[0], estoqueQtd: 1 }] };
    assert.deepEqual(abasQueMudaram(depois, antes), []);
  });

  test('a ordem das chaves que o banco devolve não conta como mudança', () => {
    const doBanco = { ...antes, sucessos: { contato: antes.sucessos.contato, venda: antes.sucessos.venda, agendamento: antes.sucessos.agendamento } };
    assert.deepEqual(abasQueMudaram(doBanco, antes), []);
  });
});

describe('dicionário e regras do catálogo nas cópias', () => {
  const antes: ConteudoDaVersao = { ...conteudoDaVersao(BASE), textosDoCatalogo: { dicionario: 'vara = barra', regras: 'pergunte a espessura' } };

  test('dicionário novo aponta a aba Produtos', () => {
    const depois = { ...antes, textosDoCatalogo: { ...antes.textosDoCatalogo!, dicionario: 'vara = barra de 12 m' } };
    assert.deepEqual(abasQueMudaram(depois, antes), ['Produtos']);
  });

  test('regra nova aponta a aba Agente', () => {
    const depois = { ...antes, textosDoCatalogo: { ...antes.textosDoCatalogo!, regras: 'nunca troque a medida' } };
    assert.deepEqual(abasQueMudaram(depois, antes), ['Agente']);
  });
});

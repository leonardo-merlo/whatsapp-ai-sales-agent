// A aba Fluxo, da seção Desenvolvimento.
//
// O primeiro bloco é a guarda contra desvio, e é o motivo de este arquivo
// existir: a ordem das ferramentas em `lib/agente/ferramentas/index.ts` é o
// roteiro que o modelo lê, e em 20/09 ela contradizia o fluxo comercial sem
// ninguém conseguir ver. A tela mostra essa ordem; se a tela e o motor
// divergirem, ela passa a mentir — e este teste quebra antes disso.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentasDoRoteiro } from '@/lib/agente/ferramentas';
import { CAMINHOS_PADRAO } from '@/lib/erp/caminhos';
import {
  destinoDaOperacao,
  exemploDaOperacao,
  fluxosDaOrganizacao,
  PASSOS_DE_ATENDIMENTO,
  PASSOS_DE_VENDAS,
  ateOCadastro,
  type PassoDeSistema,
} from '@/lib/fluxo/passos';
import { FERRAMENTAS_ATE_O_CADASTRO, ORGS_SO_ATE_O_CADASTRO, consertosDoCadastro, soAteOCadastro } from '@/lib/agente/so-ate-o-cadastro';
import { AVISO_DO_TEXTO_DO_CODIGO, cartoesDoRoteiro, type CartaoDeSistema } from '@/lib/fluxo/cartoes';

const nomesDasFerramentas = ferramentasDoRoteiro('vendas').map(f => f.definicao.name);
const passosDeSistema = PASSOS_DE_VENDAS.filter((p): p is PassoDeSistema => p.tipo === 'sistema');

describe('a guarda: passos.ts e o motor não podem divergir', () => {
  test('toda ferramenta de vendas tem um passo', () => {
    const declaradas = new Set(passosDeSistema.map(p => p.ferramenta));
    assert.deepEqual(nomesDasFerramentas.filter(n => !declaradas.has(n)), []);
  });

  test('todo passo de sistema aponta para uma ferramenta que existe', () => {
    assert.deepEqual(passosDeSistema.map(p => p.ferramenta).filter(n => !nomesDasFerramentas.includes(n)), []);
  });

  test('a ordem dos passos de sistema é a ordem em que o modelo lê as ferramentas', () => {
    assert.deepEqual(passosDeSistema.map(p => p.ferramenta), nomesDasFerramentas);
  });
});

describe('o card de um passo de sistema', () => {
  test('mostra o caminho configurado pela organização quando existe', () => {
    const destino = destinoDaOperacao('cotar', { caminhos: { cotar: '/api/v2/precos' } });
    assert.deepEqual(destino, { caminho: '/api/v2/precos', padrao: false });
  });

  test('mostra o caminho padrão quando a organização não configurou nenhum', () => {
    assert.deepEqual(destinoDaOperacao('cotar', null), { caminho: CAMINHOS_PADRAO.cotar, padrao: true });
  });

  test('mostra o estado vazio, e não um exemplo, quando a operação nunca foi chamada', () => {
    assert.deepEqual(exemploDaOperacao('criar_orcamento', {}), { tipo: 'vazio' });
  });

  test('lê descrição e campos obrigatórios da própria ferramenta', () => {
    const cartao = cartoesDoRoteiro('vendas').find(c => c.id === 'consultar-cliente') as CartaoDeSistema;
    const ferramenta = ferramentasDoRoteiro('vendas').find(f => f.definicao.name === 'consultar_cliente');
    assert.equal(cartao.descricao, ferramenta?.definicao.description);
    assert.deepEqual(cartao.campos.filter(c => c.obrigatorio).map(c => c.nome), ['documento']);
  });

  test('criar_orcamento avisa que a mensagem de valores é escrita pelo código', () => {
    const cartao = cartoesDoRoteiro('vendas').find(c => c.id === 'criar-orcamento') as CartaoDeSistema;
    assert.equal(cartao.avisoDoTexto, AVISO_DO_TEXTO_DO_CODIGO);
  });

  test('consultar_cliente não carrega o aviso, porque não escreve ao cliente', () => {
    const cartao = cartoesDoRoteiro('vendas').find(c => c.id === 'consultar-cliente') as CartaoDeSistema;
    assert.equal(cartao.avisoDoTexto, null);
  });
});

describe('roteiro de atendimento', () => {
  test('não tem passo de sistema', () => {
    assert.deepEqual(PASSOS_DE_ATENDIMENTO.filter(p => p.tipo === 'sistema'), []);
  });

  test('organização só de atendimento vê só o fluxo de atendimento', () => {
    assert.deepEqual(fluxosDaOrganizacao(['atendimento', 'atendimento']), ['atendimento']);
  });

  test('organização sem configuração nenhuma vê o fluxo de atendimento', () => {
    assert.deepEqual(fluxosDaOrganizacao([]), ['atendimento']);
  });

  test('organização de vendas com copiloto vê só o fluxo de vendas', () => {
    assert.deepEqual(fluxosDaOrganizacao(['vendas', 'copiloto']), ['vendas']);
  });
});

describe('organização que vai só até o cadastro', () => {
  const EXEMPLO = 'e8e00000-0000-4000-8000-0000000000e1';

  test('as ferramentas que ficam existem e são as primeiras da lista de vendas', () => {
    assert.deepEqual(nomesDasFerramentas.slice(0, FERRAMENTAS_ATE_O_CADASTRO.length), FERRAMENTAS_ATE_O_CADASTRO);
  });

  // Reescrito em 01/10 com autorização: a Distribuidora Exemplo saiu da lista por decisão do
  // Leonardo. A regra testada continua a mesma, com uma organização posta na
  // lista só durante o teste.
  test('vale só no roteiro de vendas da organização listada', () => {
    ORGS_SO_ATE_O_CADASTRO.add('org-listada');
    try {
      assert.deepEqual(
        [soAteOCadastro('org-listada', 'vendas'), soAteOCadastro('org-listada', 'atendimento'), soAteOCadastro('outra-org', 'vendas')],
        [true, false, false],
      );
    } finally {
      ORGS_SO_ATE_O_CADASTRO.delete('org-listada');
    }
  });

  test('a Distribuidora Exemplo sai da trava do produto e fica com os consertos do cadastro', () => {
    assert.deepEqual(
      [soAteOCadastro(EXEMPLO, 'vendas'), consertosDoCadastro(EXEMPLO, 'vendas'), consertosDoCadastro(EXEMPLO, 'atendimento')],
      [false, true, false],
    );
  });

  test('a tela corta os passos no cadastro', () => {
    assert.deepEqual(ateOCadastro(PASSOS_DE_VENDAS).map(p => p.id),
      ['entender-o-pedido', 'pedir-documento', 'consultar-cliente', 'cadastrar-cliente']);
  });
});

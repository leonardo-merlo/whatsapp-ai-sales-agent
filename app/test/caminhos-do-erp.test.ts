// Onde cada operação bate no sistema do cliente, quando isso passa a ser
// configuração em vez de código.
//
// O teste que resume o arquivo é o primeiro: **config vazia tem que bater nos
// mesmos endereços de sempre.** Toda organização que existe hoje está nessa
// situação, e um caminho que mudasse sozinho seria uma integração quebrada sem
// ninguém ter tocado em nada.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMINHOS_PADRAO, caminhoValido, caminhosDaIntegracao, caminhosParaGravar,
} from '@/lib/erp/caminhos';
import { chamarErp, type ConexaoComOErp } from '@/lib/erp/cliente-http';
import type { RegistroDaChamada } from '@/lib/erp/registro-de-chamadas';
import { operacaoDoCaminho } from '@/lib/erp/registro-de-chamadas';

const BASE = 'https://erp.teste.local/api';

let urlsChamadas: string[] = [];
let fetchOriginal: typeof globalThis.fetch;

beforeEach(() => {
  urlsChamadas = [];
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL) => {
    urlsChamadas.push(typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url);
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = fetchOriginal; });

function conexao(extra: Partial<ConexaoComOErp> = {}): ConexaoComOErp {
  return { enderecoBase: BASE, token: 'CHAVE', ...extra };
}

describe('comportamento antigo é o padrão', () => {
  test('conexão sem caminhos bate nos quatro endereços de sempre', async () => {
    await chamarErp(conexao(), { metodo: 'POST', operacao: 'consultar_cliente' });
    await chamarErp(conexao(), { metodo: 'POST', operacao: 'criar_cliente' });
    await chamarErp(conexao(), { metodo: 'POST', operacao: 'cotar' });
    await chamarErp(conexao(), { metodo: 'POST', operacao: 'criar_orcamento' });

    assert.deepEqual(urlsChamadas, [
      `${BASE}/clientes/consulta`,
      `${BASE}/clientes/novo`,
      `${BASE}/cotacoes`,
      `${BASE}/orcamentos`,
    ]);
  });

  test('config vazia resolve para os padrões', () => {
    assert.deepEqual(caminhosDaIntegracao({}), CAMINHOS_PADRAO);
    assert.deepEqual(caminhosDaIntegracao(null), CAMINHOS_PADRAO);
    assert.deepEqual(caminhosDaIntegracao({ permite_http: true }), CAMINHOS_PADRAO);
    assert.deepEqual(caminhosDaIntegracao({ caminhos: {} }), CAMINHOS_PADRAO);
  });
});

describe('o caminho configurado é o que vai para a rede', () => {
  test('o que foi configurado substitui; o resto segue no padrão', async () => {
    const caminhos = caminhosDaIntegracao({ caminhos: { criar_orcamento: '/v2/pedidos/orcamento' } });

    await chamarErp(conexao({ caminhos }), { metodo: 'POST', operacao: 'criar_orcamento' });
    await chamarErp(conexao({ caminhos }), { metodo: 'POST', operacao: 'cotar' });

    assert.equal(urlsChamadas[0], `${BASE}/v2/pedidos/orcamento`);
    assert.equal(urlsChamadas[1], `${BASE}/cotacoes`, 'a operação não configurada não mudou');
  });

  test('o registro continua dizendo QUAL operação é, mesmo com o caminho trocado', async () => {
    // A armadilha desta entrega: o nome de negócio era deduzido do caminho. Com
    // caminho configurável, deduzir faria a tela de Chamadas perder o rótulo e
    // o filtro em silêncio, justo no cliente que configurou alguma coisa.
    const registros: RegistroDaChamada[] = [];
    const caminhos = caminhosDaIntegracao({ caminhos: { criar_orcamento: '/ws/ORCAMENTO_INCLUIR' } });

    await chamarErp(
      conexao({ caminhos, observador: r => { registros.push(r); } }),
      { metodo: 'POST', operacao: 'criar_orcamento' },
    );

    assert.equal(registros[0].operacao, 'criar_orcamento');
    assert.equal(registros[0].caminho, '/ws/ORCAMENTO_INCLUIR', 'e o caminho de verdade está lá');
    // A dedução antiga não daria conta — é por isso que ela deixou de ser a
    // fonte e virou só o plano B.
    assert.notEqual(operacaoDoCaminho('/ws/ORCAMENTO_INCLUIR'), 'criar_orcamento');
  });
});

describe('caminho que não serve', () => {
  test('sem barra, com host ou com espaço é recusado', () => {
    assert.equal(caminhoValido('/clientes/novo'), true);
    assert.equal(caminhoValido('/v2/clientes/consulta'), true);
    assert.equal(caminhoValido('clientes/novo'), false, 'sem barra grudaria no endereço base');
    assert.equal(caminhoValido('https://outro.com/x'), false);
    assert.equal(caminhoValido('/x http://outro.com'), false);
    assert.equal(caminhoValido('//outro.com/x'), false, 'barra dupla vira outro host no navegador');
    assert.equal(caminhoValido(''), false);
  });

  test('caminho inválido gravado à mão no banco cai no padrão', () => {
    // Uma linha editada direto no banco não passa pela validação da rota. Cair
    // no padrão é o que o sistema fazia antes de a configuração existir —
    // melhor que derrubar as quatro operações da empresa inteira.
    const caminhos = caminhosDaIntegracao({ caminhos: { cotar: 'https://outro.com/preco' } });
    assert.equal(caminhos.cotar, '/cotacoes');
  });

  test('tipo errado no jsonb é ignorado', () => {
    assert.deepEqual(caminhosDaIntegracao({ caminhos: { cotar: 42, criar_cliente: null } }), CAMINHOS_PADRAO);
    assert.deepEqual(caminhosDaIntegracao({ caminhos: 'texto' }), CAMINHOS_PADRAO);
  });
});

describe('o que vai para o banco', () => {
  test('só o que foge do padrão é guardado', () => {
    const guardar = caminhosParaGravar({
      consultar_cliente: '/clientes/consulta',
      criar_cliente: '  ',
      cotar: '/v2/precos',
    });
    assert.deepEqual(guardar, { cotar: '/v2/precos' });
  });

  test('campo apagado some da config, e a operação volta ao padrão', () => {
    const guardar = caminhosParaGravar({ cotar: '' });
    assert.deepEqual(guardar, {});
    assert.equal(caminhosDaIntegracao({ caminhos: guardar }).cotar, '/cotacoes');
  });
});

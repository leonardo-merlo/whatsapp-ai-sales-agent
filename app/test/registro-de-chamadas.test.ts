// O registro de toda chamada ao sistema do cliente — o que alimenta a tela
// Integração.
//
// O que se mede aqui é o que o desenvolvedor do cliente vai olhar durante a
// homologação: saiu registro? veio com o corpo que foi enviado, o status e o
// desfecho? E, principalmente: **uma falha no registro não pode derrubar a
// venda.** Esse último é o teste que importa — é fácil escrever um log que
// funciona e difícil escrever um que nunca atrapalha.
//
// Roda contra o simulador pelo `fetch` de verdade, igual a `erp-cliente-http`:
// nada aqui dubla a montagem do corpo.

import { describe, test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';
import { consultarClientePorDocumento } from '@/lib/erp/operacoes/consultar-cliente';
import { chamarErp, type ConexaoComOErp } from '@/lib/erp/cliente-http';
import { operacaoDoCaminho, type RegistroDaChamada } from '@/lib/erp/registro-de-chamadas';

const BASE = 'https://erp.exemplo/v1';
const CHAVE = 'chave-de-homologacao';

const ENDERECO = {
  logradouro: 'Avenida Getulio Vargas', numero: '1250', complemento: null, bairro: 'Centro',
  cidade: 'Jundiai', uf: 'MG', cep: '36880000',
};
const CLIENTE = {
  id: 'Z06586/01', documento: '12345678000190', tipo: 'PJ' as const,
  nome: 'Construtora Aurora Ltda', endereco: ENDERECO,
  cidade: 'Jundiai', uf: 'MG', vendedor_id: 'V-07',
  situacao: 'ATIVO', podeFaturar: true,
};

let sim: SimuladorExemplo;
let fetchOriginal: typeof globalThis.fetch;
let registros: RegistroDaChamada[];

/** A conexão com observador, que é o que a tela Integração usa em produção. */
function conexaoObservada(): ConexaoComOErp {
  return {
    enderecoBase: BASE,
    token: CHAVE,
    observador: r => { registros.push(r); },
  };
}

beforeEach(() => {
  registros = [];
  sim = criarSimuladorExemplo({ produtos: [], clientes: [{ ...CLIENTE }], chave: CHAVE });
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) =>
    responderComoFetch(sim, BASE, entrada, init)) as typeof fetch;
});

afterEach(() => { globalThis.fetch = fetchOriginal; });

describe('registro das chamadas ao ERP', () => {
  test('a chamada que deu certo vira um registro com corpo, status e desfecho', async () => {
    const r = await consultarClientePorDocumento(conexaoObservada(), CLIENTE.documento);

    assert.equal(r.ok, true);
    assert.equal(registros.length, 1, 'a chamada não foi registrada');

    const [registro] = registros;
    assert.equal(registro.ok, true);
    assert.equal(registro.metodo, 'POST');
    assert.equal(registro.caminho, '/clientes/consulta');
    assert.equal(registro.statusHttp, 200);
    assert.equal(registro.tentativas, 1);
    // É por este campo que o desenvolvedor do cliente confere o que foi enviado.
    assert.deepEqual(registro.requisicao, { documento: CLIENTE.documento });
    assert.ok(registro.resposta, 'a resposta do ERP não foi guardada');
  });

  test('a recusa também é registrada, com o codigo que o ERP devolveu', async () => {
    // Documento que não passa na nossa validação nem chega ao ERP; para pegar
    // uma recusa DELE, pede-se um documento válido de um cliente que não existe.
    const r = await consultarClientePorDocumento(conexaoObservada(), '11222333000181');

    assert.equal(r.ok, true, 'não encontrado é resposta, não falha');
    assert.equal(registros.length, 1);
    assert.equal(registros[0].statusHttp !== null, true, 'o status HTTP não foi guardado');
  });

  test('a credencial NUNCA aparece no registro', async () => {
    // O corpo é gravado; os cabeçalhos, não — e é neles que a chave viaja. Este
    // teste existe porque a tabela é lida por gente de fora da Wappia.
    await consultarClientePorDocumento(conexaoObservada(), CLIENTE.documento);

    const texto = JSON.stringify(registros);
    assert.equal(texto.includes(CHAVE), false, 'a chave da API vazou para o registro');
  });

  test('o sistema fora do ar vira UM registro, com as três tentativas', async () => {
    // 5xx repete: são três idas no total, e uma chamada precisa continuar sendo
    // UM registro — senão a tela mostra três falhas para um problema só, e o
    // desenvolvedor do cliente vai caçar três bugs que não existem.
    sim.definirFalha('fora-do-ar');

    const r = await chamarErp(conexaoObservada(), {
      metodo: 'POST',
      operacao: 'consultar_cliente',
      corpo: { documento: CLIENTE.documento },
    });

    assert.equal(r.ok, false);
    assert.equal(registros.length, 1, 'uma chamada é UM registro, mesmo com retentativa');
    assert.equal(registros[0].tentativas, 3, 'o registro não contou as retentativas');
    assert.equal(registros[0].ok, false);
    assert.ok(registros[0].duracaoMs >= 0);
  });

  test('a chave invalida e registrada como problema de credencial', async () => {
    // É o erro que o cliente final NUNCA pode ver, e que o painel precisa
    // mostrar bem visível — é sempre configuração nossa ou chave trocada.
    sim.definirFalha('chave-invalida');

    const r = await consultarClientePorDocumento(conexaoObservada(), CLIENTE.documento);

    assert.equal(r.ok, false);
    assert.equal(registros.length, 1);
    assert.equal(registros[0].motivo, 'credencial');
    assert.equal(registros[0].ok, false);
  });

  test('observador que estoura NÃO derruba a chamada', async () => {
    // O teste que mais importa: perder uma linha de log é aceitável, perder a
    // venda do cliente não é.
    const conexao: ConexaoComOErp = {
      enderecoBase: BASE,
      token: CHAVE,
      observador: () => { throw new Error('banco fora do ar'); },
    };

    const r = await consultarClientePorDocumento(conexao, CLIENTE.documento);

    assert.equal(r.ok, true, 'a falha do registro derrubou a consulta');
  });

  test('conexão sem observador se comporta como antes', async () => {
    // Todo teste existente monta a conexão sem observador. Se isso passasse a
    // exigir alguma coisa, o campo teria deixado de ser opcional de verdade.
    const r = await consultarClientePorDocumento({ enderecoBase: BASE, token: CHAVE }, CLIENTE.documento);

    assert.equal(r.ok, true);
    assert.equal(registros.length, 0);
  });
});

describe('nome de negócio de cada caminho', () => {
  test('os quatro caminhos do contrato têm nome', () => {
    assert.equal(operacaoDoCaminho('/clientes/consulta'), 'consultar_cliente');
    assert.equal(operacaoDoCaminho('/clientes/novo'), 'criar_cliente');
    assert.equal(operacaoDoCaminho('/cotacoes'), 'cotar');
    assert.equal(operacaoDoCaminho('/orcamentos'), 'criar_orcamento');
  });

  test('caminho que a Distribuidora Exemplo ainda não definiu entra pelo proprio nome', () => {
    // As operações 3 e 4 ainda estão "A DEFINIR" no contrato v3. Quando o
    // caminho mudar, o registro não pode sumir da tela — entra sem rótulo.
    assert.equal(operacaoDoCaminho('/pedidos_novo.php'), 'pedidos_novo');
    assert.equal(operacaoDoCaminho('/'), 'desconhecida');
  });
});

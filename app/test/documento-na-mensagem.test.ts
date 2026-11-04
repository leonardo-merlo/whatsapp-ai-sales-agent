// Achar o CPF/CNPJ que o cliente citou, e saber quando ele trocou de cadastro.
//
// O caso que criou o arquivo, no teste do Leonardo em 20/09: a conversa já
// tinha um cliente identificado, ele escreveu "na verdade esse orçamento é para
// o outro cnpj, 45.723.174/0001-10", e o agente ignorou — não consultou o
// cadastro e cotou com o cliente antigo.
//
// O outro lado importa tanto quanto: **um telefone tem os mesmos 11 dígitos de
// um CPF**, e acusar troca de cadastro toda vez que alguém manda o celular faria
// o agente consultar à toa e perguntar de novo o que já sabia.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { citouOutroDocumento, documentoCitado } from '@/lib/agente/documento-na-mensagem';

const CNPJ_A = '45723174000110';
const CNPJ_B = '44455566000183';

describe('acha o documento na mensagem', () => {
  test('a mensagem exata do teste de 20/09', () => {
    assert.equal(
      documentoCitado('na verdade esse orçamento é para o outro cnpj, 45.723.174/0001-10'),
      CNPJ_A,
    );
  });

  test('aceita as formas que o cliente escreve', () => {
    assert.equal(documentoCitado('45723174000110'), CNPJ_A);
    assert.equal(documentoCitado('meu cnpj é 45.723.174/0001-10, pode anotar'), CNPJ_A);
    assert.equal(documentoCitado('CNPJ 45 723 174 0001 10'), CNPJ_A);
  });

  test('acha um CPF também', () => {
    // CPF válido de teste (dígitos conferidos).
    assert.equal(documentoCitado('meu cpf é 529.982.247-25'), '52998224725');
  });

  test('não acha onde não tem', () => {
    assert.equal(documentoCitado('preciso de 50 barras de vergalhão 12.5'), null);
    assert.equal(documentoCitado('o cep é 36880-000'), null);
    assert.equal(documentoCitado('quero 100 de 12.5 e 200 de 10'), null);
    assert.equal(documentoCitado(''), null);
  });

  test('número inventado com o tamanho certo NÃO passa', () => {
    // É o dígito verificador fazendo o trabalho: sem ele, qualquer sequência de
    // 11 dígitos viraria documento.
    assert.equal(documentoCitado('11111111111'), null);
    assert.equal(documentoCitado('12345678901234'), null);
  });

  test('telefone de 11 dígitos não vira documento', () => {
    // A armadilha principal: celular e CPF têm 11 dígitos.
    assert.equal(documentoCitado('meu zap é 32 98765-4321'), null);
    assert.equal(documentoCitado('pode chamar no 11987654321'), null);
  });
});

describe('trocou de cadastro?', () => {
  test('citou outro documento — é o caso de 20/09', () => {
    assert.equal(
      citouOutroDocumento('na verdade esse orçamento é para o outro cnpj, 45.723.174/0001-10', CNPJ_B),
      true,
    );
  });

  test('citou o MESMO documento não é troca', () => {
    assert.equal(citouOutroDocumento('confirma meu cnpj 45.723.174/0001-10', CNPJ_A), false);
    // E nem quando ele escreve com pontuação diferente da guardada.
    assert.equal(citouOutroDocumento('45723174000110', CNPJ_A), false);
  });

  test('sem cadastro em uso não há troca', () => {
    // O fluxo normal já manda consultar; não existe cliente anterior para
    // contradizer.
    assert.equal(citouOutroDocumento('meu cnpj é 45.723.174/0001-10', null), false);
    assert.equal(citouOutroDocumento('meu cnpj é 45.723.174/0001-10', ''), false);
  });

  test('mensagem sem documento nenhum não é troca', () => {
    assert.equal(citouOutroDocumento('pode fechar, 50 barras', CNPJ_A), false);
    assert.equal(citouOutroDocumento('meu zap é 32 98765-4321', CNPJ_A), false);
  });
});

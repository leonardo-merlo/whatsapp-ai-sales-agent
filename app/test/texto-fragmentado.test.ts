// O detector de resposta picada em fronteira de token.
//
// O caso que criou o arquivo chegou ao cliente no primeiro teste real do
// Leonardo, em 20/09. O que importa aqui são os dois lados: pegar a resposta
// estragada, e **não** acusar texto legítimo — mandar o modelo repetir uma
// resposta boa custa segundos na cara do cliente.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pareceTextoFragmentado } from '@/lib/agente/texto-fragmentado';

describe('pega o que saiu picado', () => {
  test('a mensagem que o cliente recebeu em 20/09', () => {
    assert.equal(pareceTextoFragmentado(
      ' O cad as tro foi fe i to. Ag ora vo u c onfirmar os v al ores com o vend edor e já m ando o or çam ent o p ara você . ',
    ), true);
  });

  test('a segunda ocorrência, com UM pedaço só — 20/09 às 19:41', () => {
    // Escapou da primeira versão do detector, que exigia três pedaços. Uma letra
    // solta que não é palavra já é sinal suficiente.
    assert.equal(pareceTextoFragmentado(' O me t alon 30x30 tem em chapa 16 e chapa 18. Qual você quer?'), true);
  });

  test('outro picote com pedaços de uma e duas letras', () => {
    // O detector olha pedaços de ATÉ DUAS letras: é o que o artefato produz em
    // quantidade, e é o único corte que não acusa palavra legítima.
    assert.equal(pareceTextoFragmentado('Vo u c onfirmar os v al ores com o vendedor'), true);
  });
});

describe('não acusa texto legítimo', () => {
  const boas = [
    'Bom dia, Léo. Tudo certo? O que você precisa?',
    'Certo. Vou precisar do seu CPF ou CNPJ para fazer o orçamento.',
    'Achei aqui: WAPPIA TESTE 2 LTDA — é esse mesmo?',
    'O metalon 30x30x1,20 mm sai em barra de 6 m, R$ 64,00 a barra de tabela.',
    'Você quer o CA50 1/2 em vara de 12 m ou cortado e dobrado?',
    'Consigo sim. A entrega é em Jundiaí ou você vai retirar no balcão?',
    // Cheia de palavra curta de verdade, que é o caso que mais arrisca falso
    // positivo em português.
    'Vou ao RJ e já te falo o que deu, mas o que eu sei é que o kg do CA 50 subiu.',
  ];
  for (const texto of boas) {
    test(`"${texto.slice(0, 38)}…"`, () => {
      assert.equal(pareceTextoFragmentado(texto), false);
    });
  }
});

describe('resposta curta não é julgada', () => {
  test('"ok", "sim" e afins passam', () => {
    assert.equal(pareceTextoFragmentado('ok'), false);
    assert.equal(pareceTextoFragmentado('Sim, consigo.'), false);
    assert.equal(pareceTextoFragmentado(''), false);
  });
});

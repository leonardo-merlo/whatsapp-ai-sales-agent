// T11: a foto da lista de 20/10 chegou DEITADA e virou "4 - 1/2 DIA DE / FERRO /
// 7E FERRO...", sem nenhuma linha marcada ilegível. Medido em 21/10 nas 4 fotos
// do teste de campo (scripts/medir-transcricao-de-foto.mts): Haiku 4.5 acertou
// 2 a 5 de 26 linhas; Haiku 5.5 com o prompt novo e esforço baixo, 25 de 26.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODELO_DA_TRANSCRICAO, pedidoDeTranscricao, PROMPT_VERSION_TRANSCRICAO, SYSTEM_DA_TRANSCRICAO,
} from '@/lib/v2/transcricao';
import { calcularCustoUsd } from '@/lib/agente/precos-ia';

const pedido = pedidoDeTranscricao({ base64: 'AAAA', tipo: 'image/jpeg' });

describe('prompt da transcrição de foto', () => {
  test('manda achar a orientação do texto em foto girada', () => {
    assert.match(SYSTEM_DA_TRANSCRICAO, /girada/);
    assert.match(SYSTEM_DA_TRANSCRICAO, /orientação/);
  });

  test('manda marcar ilegível em vez de adivinhar', () => {
    assert.match(SYSTEM_DA_TRANSCRICAO, /ilegivel=true/);
    assert.match(SYSTEM_DA_TRANSCRICAO, /adivinhar/);
  });

  test('manda ignorar cabeçalho de tabela e desenho, e não perder a quantidade', () => {
    assert.match(SYSTEM_DA_TRANSCRICAO, /cabeçalho de tabela/);
    assert.match(SYSTEM_DA_TRANSCRICAO, /desenhos/);
    assert.match(SYSTEM_DA_TRANSCRICAO, /nunca deixe a quantidade de fora/);
  });

  test('troca a versão do prompt, para o cache não devolver a leitura antiga', () => {
    assert.notEqual(PROMPT_VERSION_TRANSCRICAO, 'transcricao-2026-10-05.1');
  });
});

describe('modelo da transcrição de foto', () => {
  test('usa o Haiku 5.5 com esforço baixo, que ganhou a medição', () => {
    assert.equal(MODELO_DA_TRANSCRICAO, 'claude-haiku-5-5');
    assert.equal(pedido.model, 'claude-haiku-5-5');
    assert.equal((pedido.output_config as { effort?: string }).effort, 'low');
  });

  test('deixa espaço para o raciocínio, que conta no max_tokens', () => {
    assert.ok((pedido.max_tokens as number) >= 8000);
  });

  test('o modelo da foto tem preço cadastrado, senão o custo vai zero para o ai_usage', () => {
    assert.ok(calcularCustoUsd(MODELO_DA_TRANSCRICAO, { input_tokens: 1_000_000, output_tokens: 0 }) > 0);
  });
});

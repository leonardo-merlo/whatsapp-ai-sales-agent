// Teste de banco que falha não pode imprimir a senha do banco. O erro do Node
// repetia o comando do psql inteiro, com a URL e a senha dentro (29/09).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consultar, urlDoBanco } from './apoio/psql.mts';

const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';

test('o erro do psql mostra o problema e esconde a senha', { skip: motivoDoPulo ?? false }, () => {
  const senha = new URL(urlDoBanco()!).password;
  let mensagem = '';
  try {
    consultar('SELECT * FROM tabela_que_nao_existe;');
  } catch (e) {
    mensagem = String((e as Error).message);
  }
  assert.ok(mensagem.includes('tabela_que_nao_existe') && !mensagem.includes(senha));
});

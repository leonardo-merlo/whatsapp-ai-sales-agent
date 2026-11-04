// Acesso ao Postgres de verdade pelo psql, para o teste que não faz sentido
// contra um dublê — RLS é política do banco, não código nosso: dublar seria
// testar a própria imitação.
//
// Só existe um banco neste projeto, o de produção. Por isso TUDO aqui roda
// dentro de `BEGIN … ROLLBACK`, e o que o teste faz é leitura mais uma
// tentativa de escrita que precisa ser barrada. Nada é confirmado.

import { execFileSync } from 'node:child_process';

const SEPARADOR = '|';

export function urlDoBanco(): string | null {
  return process.env.SUPABASE_DB_URL?.trim() || null;
}

/** Roda o SQL e devolve as linhas já separadas em colunas.
 *  `-q` é obrigatório e não é detalhe: sem ele o psql imprime os rótulos de
 *  comando (`BEGIN`, `SET`, `ROLLBACK`) no meio das linhas de resultado, e a
 *  primeira linha lida deixa de ser a do SELECT. */
export function consultar(sql: string): string[][] {
  const url = urlDoBanco();
  if (!url) throw new Error('SUPABASE_DB_URL não definida.');
  let saida: string;
  try {
    saida = execFileSync('psql', ['-X', '-q', '-A', '-t', '-F', SEPARADOR, '-v', 'ON_ERROR_STOP=1', url, '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    // O erro do Node repete o comando inteiro, e o comando leva a URL com a
    // senha do banco. Sem isto, todo teste de banco que falha imprime a senha.
    const e = err as { stderr?: string; message?: string };
    const esconder = (texto: string) => texto.split(url).join('<SUPABASE_DB_URL>');
    throw new Error(esconder(`psql falhou: ${e.stderr?.trim() || e.message || 'erro desconhecido'}`));
  }
  return saida
    .split('\n')
    .map(linha => linha.trim())
    .filter(Boolean)
    .map(linha => linha.split(SEPARADOR));
}

/** Envolve o SQL em BEGIN/ROLLBACK com o papel `authenticated` e o `sub` do JWT
 *  de um usuário — é assim que `auth.uid()` responde dentro das policies. */
export function comoUsuario(userId: string, sql: string): string[][] {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error(`user_id fora do formato uuid: ${userId}`);
  return consultar(
    [
      'BEGIN;',
      'SET LOCAL ROLE authenticated;',
      `SET LOCAL request.jwt.claims = '{"sub":"${userId}","role":"authenticated"}';`,
      sql,
      'ROLLBACK;',
    ].join('\n'),
  );
}

// Preparação do processo de teste. Carregado com `--import` antes de tudo.
//
// 1. Registra o hook que ensina o Node a resolver o alias `@/` e a completar a
//    extensão `.ts` — sem ele nenhum arquivo de produção importa.
// 2. Lê do `.env.local` apenas o que os testes de integração precisam. A lista
//    é curta de propósito: segredo de produção não tem por que entrar num
//    processo de teste, e cada teste define os seus próprios valores falsos.

import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

register('./resolve-hook.mts', import.meta.url);

const VARIAVEIS_DE_INTEGRACAO = ['SUPABASE_DB_URL'];

const envLocal = path.resolve(fileURLToPath(import.meta.url), '..', '..', '.env.local');
try {
  for (const linha of readFileSync(envLocal, 'utf8').split('\n')) {
    const casa = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(linha);
    if (!casa) continue;
    const [, nome, bruto] = casa;
    if (!VARIAVEIS_DE_INTEGRACAO.includes(nome) || process.env[nome]) continue;
    process.env[nome] = bruto.trim().replace(/^["']|["']$/g, '');
  }
} catch {
  /* sem .env.local: os testes de integração se marcam como pulados sozinhos */
}

// Hook de resolução para rodar os testes com `node --experimental-strip-types`.
// O Node puro não conhece o alias `@/` do tsconfig nem completa a extensão `.ts`
// de um import extensionless — os dois são coisas do bundler do Next. Sem este
// hook, importar qualquer arquivo de produção quebra no primeiro import interno.
// Traduzir aqui é o que permite testar o código como ele está, sem tocar nele.

import { statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const raizDoApp = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const raizDoSrc = path.join(raizDoApp, 'src');
const sufixos = ['', '.ts', '.tsx', '.mts', '/index.ts', '/index.tsx'];

function ehArquivo(caminho: string): boolean {
  try {
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
}

function resolverComExtensao(base: string): string | null {
  for (const sufixo of sufixos) {
    const tentativa = base + sufixo;
    if (ehArquivo(tentativa)) return tentativa;
  }
  return null;
}

type Contexto = { parentURL?: string };
type Proximo = (especificador: string, contexto: Contexto) => Promise<unknown>;

export async function resolve(especificador: string, contexto: Contexto, proximo: Proximo) {
  if (especificador.startsWith('@/')) {
    const alvo = resolverComExtensao(path.join(raizDoSrc, especificador.slice(2)));
    if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
  }
  if (especificador.startsWith('.') && contexto.parentURL?.startsWith('file:')) {
    const base = path.resolve(path.dirname(fileURLToPath(contexto.parentURL)), especificador);
    const alvo = resolverComExtensao(base);
    if (alvo) return proximo(pathToFileURL(alvo).href, contexto);
  }
  try {
    return await proximo(especificador, contexto);
  } catch (err) {
    // `next/server` não resolve sozinho no Node puro (o Next conta com o
    // resolvedor do bundler). Tentar o arquivo direto resolve, e vale para
    // qualquer subcaminho de pacote no mesmo caso.
    if ((err as { code?: string })?.code === 'ERR_MODULE_NOT_FOUND' && !especificador.startsWith('.')) {
      return proximo(`${especificador}.js`, contexto);
    }
    throw err;
  }
}

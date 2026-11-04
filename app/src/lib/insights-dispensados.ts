'use client'; // depende do localStorage do browser

import { useSyncExternalStore } from 'react';

// Insight dispensado é preferência de leitura de uma pessoa, não estado do
// negócio — fica no navegador, sem tabela nem migration. Mesmo padrão de
// useIsMobile: store externa via useSyncExternalStore, para não cair no
// setState-dentro-de-effect.

const CHAVE = 'wappia-insights-dispensados';
const VAZIO: string[] = [];

// A memória é a fonte de verdade depois da primeira leitura: getSnapshot tem de
// devolver a mesma referência enquanto nada muda, senão o React re-renderiza em
// laço. E se o storage estiver bloqueado, dispensar continua valendo na sessão.
let cache: string[] | null = null;
const ouvintes = new Set<() => void>();

function notificar(): void {
  ouvintes.forEach(fn => fn());
}

function subscribe(onChange: () => void): () => void {
  ouvintes.add(onChange);
  const aoMudarStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== CHAVE) return;
    cache = null; // outra aba dispensou: relê na próxima leitura
    onChange();
  };
  window.addEventListener('storage', aoMudarStorage);
  return () => {
    ouvintes.delete(onChange);
    window.removeEventListener('storage', aoMudarStorage);
  };
}

function getSnapshot(): string[] {
  if (cache) return cache;
  try {
    const bruto = localStorage.getItem(CHAVE);
    const lido: unknown = bruto ? JSON.parse(bruto) : [];
    cache = Array.isArray(lido) ? lido.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    cache = [];
  }
  return cache;
}

function getServerSnapshot(): string[] {
  return VAZIO;
}

export function useInsightsDispensados(): string[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function dispensarInsight(id: string): void {
  const atual = getSnapshot();
  if (atual.includes(id)) return;
  cache = [...atual, id];
  try {
    localStorage.setItem(CHAVE, JSON.stringify(cache));
  } catch {
    /* storage bloqueado: vale só nesta sessão */
  }
  notificar();
}

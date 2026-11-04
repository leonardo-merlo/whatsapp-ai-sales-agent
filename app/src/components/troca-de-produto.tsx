'use client'; // botões de troca com estado de carregamento e recarga da página

import { useState } from 'react';
import { useOrg } from '@/lib/org-context';
import { NOME_DO_PRODUTO, type Produto } from '@/lib/produtos';

/**
 * Troca entre Atendimento e Vendas, quando a empresa contratou os dois.
 * Com um produto só não renderiza nada.
 *
 * Recarrega a página pelo mesmo motivo da troca de empresa: menu, cor e dados
 * iniciais são montados no servidor a partir do produto ativo.
 */
export function TrocaDeProduto() {
  const org = useOrg();
  const [trocando, setTrocando] = useState<Produto | null>(null);

  if (org.produtos.length < 2) return null;

  async function trocar(produto: Produto) {
    if (produto === org.produtoAtivo || trocando) return;
    setTrocando(produto);
    try {
      const resposta = await fetch('/api/produto/ativo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ produto }),
      });
      if (!resposta.ok) throw new Error('Não foi possível trocar de produto');
      window.location.assign('/');
    } catch {
      setTrocando(null);
    }
  }

  return (
    <div role="group" aria-label="Produto" style={{ display: 'flex', gap: 2, padding: 2, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)' }}>
      {org.produtos.map(p => {
        const ativo = p === org.produtoAtivo;
        return (
          <button key={p} onClick={() => void trocar(p)} aria-pressed={ativo} disabled={trocando !== null}
            style={{
              flex: 1, border: 'none', borderRadius: 7, padding: '6px 8px', fontSize: 12, fontWeight: 700,
              cursor: trocando ? 'wait' : 'pointer',
              background: ativo ? 'var(--bg)' : 'transparent',
              color: ativo ? 'var(--primary-t)' : 'var(--text3)',
              boxShadow: ativo ? 'var(--sh-raised)' : 'none',
            }}>
            {trocando === p ? 'Trocando…' : NOME_DO_PRODUTO[p]}
          </button>
        );
      })}
    </div>
  );
}

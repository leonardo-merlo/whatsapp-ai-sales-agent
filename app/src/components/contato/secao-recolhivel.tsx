'use client'; // guarda aberto/fechado no navegador (localStorage)

// Uma seção da ficha do contato que abre e fecha pelo título. Pedido do
// Leonardo em 08/10: a ficha não precisa mostrar tudo sempre. Começa fechada, e
// o que a pessoa abriu fica aberto na próxima ficha (é preferência dela, então
// mora no navegador).

import { useState, type ReactNode } from 'react';

const CHAVE = 'wappia-ficha-secoes';

function lerAbertas(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(CHAVE) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}

export default function SecaoRecolhivel({ id, titulo, contagem, acao, children }: {
  id: string;
  titulo: string;
  contagem?: number;
  acao?: ReactNode;
  children: ReactNode;
}) {
  // A ficha só existe no navegador (abre num clique), então ler o localStorage aqui é seguro.
  const [aberta, setAberta] = useState(() => typeof window !== 'undefined' && !!lerAbertas()[id]);

  function alternar(): void {
    const nova = !aberta;
    setAberta(nova);
    try { localStorage.setItem(CHAVE, JSON.stringify({ ...lerAbertas(), [id]: nova })); } catch { /* sem armazenamento: só nesta tela */ }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <button
          onClick={alternar}
          aria-expanded={aberta}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text3)' }}
        >
          <span aria-hidden style={{ fontSize: 10, width: 10, display: 'inline-block', transform: aberta ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▶</span>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{titulo}</span>
          {contagem !== undefined && <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{contagem}</span>}
        </button>
        {aberta && acao}
      </div>
      {aberta && children}
    </div>
  );
}

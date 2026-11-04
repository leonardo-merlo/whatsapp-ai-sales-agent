'use client'; // menu de troca com estado aberto/fechado e recarga da página

import { useState } from 'react';
import { useOrg } from '@/lib/org-context';

/**
 * Troca a organização ativa, quando o usuário está em mais de uma.
 *
 * Com uma só — o caso de quase todo mundo — este componente **não renderiza
 * nada**: quem tem uma empresa não precisa saber que existe troca.
 *
 * A troca recarrega a página em vez de atualizar o estado. É de propósito: a
 * carga inicial de todas as telas é feita no servidor a partir da organização
 * ativa, e trocar sem recarregar deixaria conversa, agenda e painel da empresa
 * anterior na tela.
 */
export function TrocaDeOrganizacao() {
  const org = useOrg();
  const [aberto, setAberto] = useState(false);
  const [trocando, setTrocando] = useState(false);

  if (org.organizacoes.length < 2) return null;

  async function trocar(organizationId: string) {
    if (organizationId === org.orgId) { setAberto(false); return; }
    setTrocando(true);
    try {
      const resposta = await fetch('/api/org/ativa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      });
      if (!resposta.ok) throw new Error('Não foi possível trocar de organização');
      window.location.assign('/');
    } catch {
      setTrocando(false);
      setAberto(false);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setAberto(a => !a)}
        disabled={trocando}
        title="Trocar de organização"
        style={{
          display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none',
          padding: 0, cursor: trocando ? 'wait' : 'pointer', color: 'var(--text3)', fontSize: 11,
          fontWeight: 600, lineHeight: 1.25,
        }}
      >
        {trocando ? 'Trocando…' : 'Trocar empresa'}
        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {aberto && !trocando && (
        <>
          {/* Clique fora fecha. Fica atrás do menu e cobre a tela toda. */}
          <button
            onClick={() => setAberto(false)}
            aria-label="Fechar"
            style={{ position: 'fixed', inset: 0, background: 'transparent', border: 'none', cursor: 'default', zIndex: 40 }}
          />
          <div style={{
            position: 'absolute', top: '100%', left: 0, marginTop: 6, zIndex: 41,
            background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 4, minWidth: 190,
          }}>
            {org.organizacoes.map(o => (
              <button
                key={o.id}
                onClick={() => void trocar(o.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
                  background: 'none', border: 'none', borderRadius: 'var(--r-ctrl)', padding: '8px 10px',
                  fontSize: 13, fontWeight: o.id === org.orgId ? 700 : 500, color: 'var(--text)', cursor: 'pointer',
                }}
                className="hs"
              >
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: o.id === org.orgId ? 'var(--primary)' : 'transparent',
                }} />
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.nome}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

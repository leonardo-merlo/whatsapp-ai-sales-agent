'use client'; // confirmação digitada e chamada à rota de apagar

import { useState } from 'react';
import { useApp } from '@/lib/app-context';
import { PALAVRA_DE_CONFIRMACAO } from '@/lib/lgpd/dados-do-paciente';

/**
 * Exportar e apagar os dados de um contato (LGPD, S9). Só aparece para admin;
 * a rota confere de novo.
 */
export default function DadosDoTitular({ contactId, rotulo }: { contactId: string; rotulo: string }) {
  const { showToast } = useApp();
  const [confirmando, setConfirmando] = useState(false);
  const [texto, setTexto] = useState('');
  const [apagando, setApagando] = useState(false);

  async function apagar() {
    setApagando(true);
    try {
      const resp = await fetch(`/api/contatos/${contactId}/dados`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacao: texto }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      if (!resp.ok) { showToast(json.error ?? 'Não foi possível apagar.'); setApagando(false); return; }
      // Conversas, agenda e contatos mudam juntos: recarregar é o jeito certo
      // de a tela não mostrar nada do que foi apagado.
      window.location.reload();
    } catch {
      showToast('Não foi possível apagar.');
      setApagando(false);
    }
  }

  const pronto = texto.trim().toUpperCase() === PALAVRA_DE_CONFIRMACAO;

  return (
    <div data-testid="dados-do-titular" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>{rotulo}</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href={`/api/contatos/${contactId}/dados`} download
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '8px 13px', fontSize: 12.5, fontWeight: 600, textDecoration: 'none' }} className="hs">
          Exportar dados
        </a>
        {!confirmando && (
          <button onClick={() => setConfirmando(true)}
            style={{ background: 'var(--surface)', border: '1px solid var(--red-bb)', color: 'var(--red-t)', borderRadius: 'var(--r-ctrl)', padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hr">
            Apagar dados
          </button>
        )}
      </div>
      {confirmando && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--red-b)', border: '1px solid var(--red-bb)', borderRadius: 'var(--r-ctrl)', padding: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
            Apaga contato, conversas e consultas. Não tem volta. Digite {PALAVRA_DE_CONFIRMACAO}.
          </span>
          <input value={texto} onChange={e => setTexto(e.target.value)} aria-label="Confirmação"
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)' }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setConfirmando(false); setTexto(''); }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
            <button onClick={() => void apagar()} disabled={!pronto || apagando}
              style={{ background: pronto ? 'var(--red-t)' : 'var(--gray-b)', border: 'none', color: pronto ? '#fff' : 'var(--text3)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px', fontSize: 12.5, fontWeight: 700, cursor: pronto ? 'pointer' : 'not-allowed' }}>
              {apagando ? 'Apagando…' : 'Apagar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

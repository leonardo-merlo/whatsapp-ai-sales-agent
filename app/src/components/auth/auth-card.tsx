'use client'; // usado por páginas de auth interativas

import { useId, useState } from 'react';
import Image from 'next/image';

// Páginas de auth não têm AppProvider (dark mode só existe após login) — sempre tema claro aqui.
export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 'min(36px, 7vw) min(40px, 6vw)', width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: 22, boxShadow: '0 8px 40px rgba(0,0,0,.1)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
            <Image src="/brand/wappia-verde.png" alt="Wappia" width={30} height={24} style={{ objectFit: 'contain', flexShrink: 0 }} priority />
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Wappia</div>
            </div>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em' }}>{title}</h1>
          <span style={{ fontSize: 13.5, color: 'var(--text3)' }}>{subtitle}</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function AuthField({ label, type, id, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const idAutomatico = useId();
  const idCampo = id ?? idAutomatico;
  const ehSenha = type === 'password';
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  // Só o `type` alterna; o valor e o autoComplete continuam vindo de quem usa o campo.
  const tipoEfetivo = ehSenha && senhaVisivel ? 'text' : type;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label htmlFor={idCampo} style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      <div style={{ position: 'relative', display: 'flex' }}>
        <input {...props} id={idCampo} type={tipoEfetivo}
          style={{ flex: 1, minWidth: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: ehSenha ? '10px 42px 10px 13px' : '10px 13px', fontSize: 14, color: 'var(--text)' }} />
        {ehSenha && (
          <button type="button" onClick={() => setSenhaVisivel(v => !v)}
            aria-label={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={senhaVisivel}
            title={senhaVisivel ? 'Ocultar senha' : 'Mostrar senha'}
            style={{ position: 'absolute', top: 4, right: 4, bottom: 4, width: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 0 }}
            className="hs">
            {senhaVisivel
              ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M10.7 5.1A9.9 9.9 0 0 1 12 5c6.5 0 10 7 10 7a13.4 13.4 0 0 1-2.2 3.2" /><path d="M6.6 6.6A13.4 13.4 0 0 0 2 12s3.5 7 10 7a9.9 9.9 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m2 2 20 20" /></svg>
              : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>}
          </button>
        )}
      </div>
    </div>
  );
}

export function AuthButton({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={loading}
      style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', marginTop: 4, opacity: loading ? 0.7 : 1 }}
      className="hp">
      {loading ? 'Aguarde…' : children}
    </button>
  );
}

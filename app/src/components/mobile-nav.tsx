'use client'; // navegação ativa, folha "Mais" e logout são interativos

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { createClient } from '@/lib/supabase/client';
import { navPara, SETTINGS_NAV, Icon } from './sidebar';
import { configTabsPara } from '@/lib/config-tabs';
import { permissoesDe } from '@/lib/permissoes';
import SinoNotificacoes from './notificacoes-sino';
import { TrocaDeProduto } from './troca-de-produto';

interface ItemNav { href: string; label: string; icon: string }

// No celular a navegação vira barra inferior com os 3 destinos mais quentes;
// o resto fica na folha "Mais".
const PRINCIPAIS = ['/painel', '/conversas', '/conhecimento'];

export default function MobileNav() {
  const { state, dispatch } = useApp();
  const org = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const [maisOpen, setMaisOpen] = useState(false);
  const [saindo, setSaindo] = useState(false);

  // A barra tem sempre 3 destinos: os preferidos que o papel enxerga, e o que
  // faltar é completado com o próximo da navegação (o atendente não vê Painel).
  const disponiveis = navPara(org.memberRole, org.secoesOcultas);
  const perms = permissoesDe(org.memberRole);
  const preferidos = PRINCIPAIS
    .map(href => disponiveis.find(n => n.href === href))
    .filter((n): n is ItemNav => n !== undefined);
  const principais = [...preferidos, ...disponiveis.filter(n => !PRINCIPAIS.includes(n.href))].slice(0, 3);
  const secundarios: ItemNav[] = [
    ...disponiveis.filter(n => !principais.includes(n)),
    ...(configTabsPara(org.memberRole).length > 0 ? [SETTINGS_NAV] : []),
  ];
  const unread = state.conversas.filter(c => c.status === 'aberta' && c.unread > 0).reduce((a, c) => a + c.unread, 0);
  const maisAtivo = secundarios.some(n => pathname === n.href || pathname.startsWith(n.href + '/'));

  async function handleLogout() {
    if (saindo) return;
    setSaindo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const itemStyle = (active: boolean): React.CSSProperties => ({
    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
    padding: '8px 0 6px', background: 'none', border: 'none', cursor: 'pointer',
    color: active ? 'var(--primary-t)' : 'var(--text3)', fontSize: 10.5, fontWeight: active ? 800 : 600,
    textDecoration: 'none', position: 'relative',
  });

  return (
    <>
      {maisOpen && (
        <div onClick={() => setMaisOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', zIndex: 70 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 62, background: 'var(--bg)', borderRadius: 'var(--r-shell) var(--r-shell) 0 0', boxShadow: 'var(--sh-pop)', padding: '14px 12px calc(10px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 2, animation: 'cm-pop .18s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px 10px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
              <div style={{ width: 32, height: 32, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                {org.memberName.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 800, letterSpacing: '-0.2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.orgName}</div>
                <div style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.userEmail}</div>
              </div>
            </div>
            {org.produtos.length > 1 && (
              <div style={{ padding: '0 8px 8px' }}><TrocaDeProduto /></div>
            )}
            {secundarios.map(n => {
              const active = pathname === n.href || pathname.startsWith(n.href + '/');
              return (
                <Link key={n.href} href={n.href} onClick={() => setMaisOpen(false)}
                  style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 10px', borderRadius: 'var(--r-ctrl)', textDecoration: 'none', background: active ? 'var(--primary-soft)' : 'transparent', color: active ? 'var(--primary-t)' : 'var(--text2)', fontSize: 13.5, fontWeight: 600 }} className={active ? '' : 'hs'}>
                  <Icon path={n.icon} size={18} />
                  {n.label}
                </Link>
              );
            })}
            <div style={{ height: 1, background: 'var(--border)', margin: '6px 10px' }} />
            {/* Entra na folha "Mais" em vez de virar um 5º ícone na barra: a barra
                inferior fica com os destinos de navegação, e o sino é uma ação. */}
            {perms.aprovarVendas && (
              <div style={{ padding: '0 2px' }}>
                <SinoNotificacoes />
              </div>
            )}
            <button onClick={() => dispatch({ type: 'SET_DARK', dark: !state.dark })}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 10px', borderRadius: 'var(--r-ctrl)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }} className="hs">
              {state.dark
                ? <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/></svg>
                : <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>}
              {state.dark ? 'Modo claro' : 'Modo escuro'}
            </button>
            <button onClick={handleLogout}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 10px', borderRadius: 'var(--r-ctrl)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red-t)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }} className="hs">
              <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              {saindo ? 'Saindo…' : 'Sair'}
            </button>
          </div>
        </div>
      )}

      <nav style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 65, display: 'flex', background: 'var(--bg)', borderTop: '1px solid var(--border)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        {principais.map(n => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/');
          return (
            <Link key={n.href} href={n.href} style={itemStyle(active)} onClick={() => setMaisOpen(false)}>
              <span style={{ position: 'relative', display: 'flex' }}>
                <Icon path={n.icon} size={21} />
                {n.href === '/conversas' && unread > 0 && (
                  <span className="mono" style={{ position: 'absolute', top: -4, right: -10, background: 'var(--primary)', color: 'var(--on-primary)', fontSize: 9.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '1px 5px', minWidth: 15, textAlign: 'center' }}>{unread}</span>
                )}
              </span>
              {n.label}
            </Link>
          );
        })}
        <button onClick={() => setMaisOpen(o => !o)} style={itemStyle(maisOpen || maisAtivo)}>
          <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round"><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>
          Mais
        </button>
      </nav>
    </>
  );
}

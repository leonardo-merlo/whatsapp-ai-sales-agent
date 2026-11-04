'use client'; // navegação ativa, collapse e menu do usuário são interativos

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { createClient } from '@/lib/supabase/client';
import { caminhoDaAba, configTabsPara } from '@/lib/config-tabs';
import { permissoesDe, type PapelMembro } from '@/lib/permissoes';
import SinoNotificacoes from './notificacoes-sino';
import { TrocaDeOrganizacao } from './troca-de-organizacao';
import { TrocaDeProduto } from './troca-de-produto';
import { NOME_DO_PRODUTO } from '@/lib/produtos';

export const NAV: { href: string; label: string; icon: string }[] = [
  { href: '/painel', label: 'Painel', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
  // Conhecimento, e não Agente: a seção engloba Empresa, Produtos e Agente, e
  // tudo que está lá é o que a IA sabe. O ícone é um livro aberto pelo mesmo
  // motivo.
  { href: '/conhecimento', label: 'Conhecimento', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253' },
  { href: '/agenda', label: 'Agenda', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
  { href: '/contatos', label: 'Contatos', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  { href: '/conversas', label: 'Conversas', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
  { href: '/campanhas', label: 'Campanhas', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
  // Desenvolvimento aparece para todo admin — ver `navPara`. Ícone de elos, que
  // é o que a seção é: o que sai daqui e o que volta de lá.
  { href: '/desenvolvimento', label: 'Desenvolvimento', icon: 'M13.828 10.172a4 4 0 010 5.656l-3 3a4 4 0 01-5.656-5.656l1.5-1.5M10.172 13.828a4 4 0 010-5.656l3-3a4 4 0 015.656 5.656l-1.5 1.5' },
];

export const SETTINGS_NAV = { href: '/configuracoes', label: 'Configurações', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' };

// Painel é a visão consolidada do negócio — some para o atendente.
// Desenvolvimento é só para admin, porque a tela mostra CPF e CNPJ dos clientes;
// ela aparece para **todo** admin, tenha a organização sistema de gestão ligado
// ou não (decisão do Leonardo em 20/09: é lá que o sistema se cadastra, e um
// item que só aparece depois de configurado esconde a própria porta de entrada).
// O restante da navegação é operação do dia a dia e continua igual para os 3
// papéis.
export function navPara(papel: PapelMembro, secoesOcultas: string[] = []) {
  const perms = permissoesDe(papel);
  return NAV.filter(n => {
    // O que a organização não usa some antes de qualquer regra de papel: não é
    // permissão, é o negócio dela. Uma distribuidora de aço não marca horário
    // com ninguém, e a Agenda no menu é a primeira coisa que faz o painel
    // parecer que não foi feito para ela. Lista vazia — o padrão de todas —
    // mostra tudo, exatamente como antes desta regra existir.
    if (secoesOcultas.includes(n.href.replace(/^\//, ''))) return false;
    if (n.href === '/painel') return perms.verPainel;
    if (n.href === '/desenvolvimento') return perms.verDesenvolvimento;
    return true;
  });
}

export function Icon({ path, size = 20 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {path.split('M').filter(Boolean).map((seg, i) => <path key={i} d={`M${seg}`} />)}
    </svg>
  );
}

export default function Sidebar() {
  const { state, dispatch } = useApp();
  const org = useOrg();
  const pathname = usePathname();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const [settingsAncora, setSettingsAncora] = useState<{ left: number; bottom: number } | null>(null);
  const [saindo, setSaindo] = useState(false);

  // O menu precisa ser `fixed`: a sidebar e o shell flutuante tem overflow
  // hidden e um popover `absolute` sai cortado. Como `fixed` e relativo a
  // janela, a posicao vem de medir o botao — mesmo padrao do sino.
  useEffect(() => {
    if (!settingsMenuOpen) return;
    function medir() {
      const r = settingsBtnRef.current?.getBoundingClientRect();
      if (r) setSettingsAncora({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    }
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [settingsMenuOpen]);
  const collapsed = state.sidebarCollapsed;
  const unread = state.conversas.filter(c => c.status === 'aberta' && c.unread > 0).reduce((a, c) => a + c.unread, 0);
  const perms = permissoesDe(org.memberRole);
  const nav = navPara(org.memberRole, org.secoesOcultas);
  const abasConfig = configTabsPara(org.memberRole);

  const width = collapsed ? 64 : 248;

  async function handleLogout() {
    if (saindo) return;
    setSaindo(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside style={{ width, minHeight: '100%', background: 'var(--surface)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, transition: 'width .18s ease', overflow: 'hidden' }}>
      {/* logo + collapse toggle */}
      <div style={{ padding: collapsed ? '18px 0 14px' : '20px 16px 16px', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', gap: 8 }}>
        {!collapsed && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <Image src={state.dark ? '/brand/logo-white.png' : org.produtoAtivo === 'atendimento' ? '/brand/wappia-azul.png' : '/brand/wappia-verde.png'} alt="Wappia" width={32} height={26} style={{ objectFit: 'contain', flexShrink: 0 }} priority />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 13.5, letterSpacing: '-0.2px', color: 'var(--text)', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{org.orgName}</div>
              {/* Com uma organização só, a troca não renderiza nada e fica só
                  a marca, como sempre foi. */}
              {org.organizacoes.length > 1
                ? <TrocaDeOrganizacao />
                : <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text3)', lineHeight: 1.25, whiteSpace: 'nowrap' }}>Wappia {NOME_DO_PRODUTO[org.produtoAtivo]}</div>}
            </div>
          </div>
        )}
        <button onClick={() => dispatch({ type: 'SET', key: 'sidebarCollapsed', value: !collapsed })}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 7, display: 'flex', flexShrink: 0 }} className="hs"
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            {collapsed
              ? <><path d="m9 18 6-6-6-6" /></>
              : <><path d="m15 18-6-6 6-6" /></>
            }
          </svg>
        </button>
      </div>

      {!collapsed && org.produtos.length > 1 && (
        <div style={{ padding: '0 12px 10px' }}><TrocaDeProduto /></div>
      )}

      {/* nav */}
      <nav style={{ flex: 1, padding: collapsed ? '4px 8px' : '4px 12px' }}>
        {nav.map(n => {
          const active = pathname === n.href || pathname.startsWith(n.href + '/');
          return (
            <div key={n.href} style={{ position: 'relative' }}>
              <Link href={n.href} data-tour={n.href}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? 0 : 11, padding: collapsed ? '9px 0' : '9px 11px', borderRadius: 'var(--r-ctrl)', border: `1px solid ${active ? 'var(--primary-bb)' : 'transparent'}`, cursor: 'pointer', marginBottom: 2, background: active ? 'var(--primary-soft)' : 'transparent', color: active ? 'var(--primary-t)' : 'var(--text2)', fontWeight: 600, fontSize: 13.5, textAlign: 'left', transition: 'background .15s', position: 'relative', textDecoration: 'none', boxSizing: 'border-box' }}
                className={active ? '' : 'hs'}
                title={collapsed ? n.label : undefined}>
                <Icon path={n.icon} size={18} />
                {!collapsed && <span style={{ flex: 1 }}>{n.label}</span>}
                {n.href === '/conversas' && unread > 0 && (
                  <span className="mono" style={{ background: 'var(--primary)', color: 'var(--on-primary)', fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '1px 6px', minWidth: 18, textAlign: 'center', ...(collapsed ? { position: 'absolute', top: 5, right: 5, padding: '1px 4px', fontSize: 9.5 } : {}) }}>{unread}</span>
                )}
              </Link>
            </div>
          );
        })}
      </nav>

      {/* agent status */}
      {!collapsed && (
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 11px', borderRadius: 'var(--r-ctrl)', border: `1px solid ${state.agenteAtivo ? 'var(--green-bb)' : 'var(--border)'}`, background: state.agenteAtivo ? 'var(--green-b)' : 'var(--surface2)' }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: state.agenteAtivo ? 'var(--green-t)' : 'var(--text3)', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: state.agenteAtivo ? 'var(--green-t)' : 'var(--text3)', fontWeight: 600 }}>
              {state.agenteAtivo ? 'Agente ativo' : 'Agente inativo'}
            </span>
          </div>
        </div>
      )}

      {/* O sino é aprovação de venda e alerta de estoque — a RLS de notificacoes
          já é is_admin_of, então para atendente ele viria sempre vazio. */}
      {perms.aprovarVendas && (
        <div style={{ padding: collapsed ? '0 8px' : '0 12px' }}>
          <SinoNotificacoes colapsado={collapsed} />
        </div>
      )}

      {/* bottom: configurações + user profile */}
      <div style={{ padding: collapsed ? '10px 4px' : '10px 12px', borderTop: '1px solid var(--border)', position: 'relative' }}>
        {/* settings — fixado no rodapé, fora da navegação principal; abre menu com as seções.
            Some por inteiro quando o papel não tem nenhuma aba visível. */}
        {abasConfig.length > 0 && (
        <div style={{ padding: collapsed ? '0 4px 4px' : '0 0 4px', position: 'relative' }}>
          {(() => {
            const active = pathname === SETTINGS_NAV.href || pathname.startsWith(SETTINGS_NAV.href + '/');
            return (
              <button ref={settingsBtnRef} onClick={() => { setSettingsMenuOpen(o => !o); setUserMenuOpen(false); }} data-tour={SETTINGS_NAV.href}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-start', gap: collapsed ? 0 : 11, padding: collapsed ? '9px 0' : '9px 11px', borderRadius: 'var(--r-ctrl)', border: `1px solid ${(active || settingsMenuOpen) ? 'var(--primary-bb)' : 'transparent'}`, cursor: 'pointer', background: (active || settingsMenuOpen) ? 'var(--primary-soft)' : 'transparent', color: (active || settingsMenuOpen) ? 'var(--primary-t)' : 'var(--text2)', fontWeight: 600, fontSize: 13.5, textAlign: 'left', boxSizing: 'border-box' }}
                className={(active || settingsMenuOpen) ? '' : 'hs'}
                title={collapsed ? SETTINGS_NAV.label : undefined}>
                <Icon path={SETTINGS_NAV.icon} size={18} />
                {!collapsed && <span style={{ flex: 1 }}>{SETTINGS_NAV.label}</span>}
              </button>
            );
          })()}

          {settingsMenuOpen && (
            <>
              <div onClick={() => setSettingsMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              {/* Abre para cima, alinhado ao botão, igual ao sino de notificações. */}
            <div style={{ position: 'fixed', bottom: settingsAncora?.bottom ?? 72, visibility: settingsAncora ? 'visible' : 'hidden', left: settingsAncora?.left ?? 0, width: 240, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-pop)', overflow: 'hidden', zIndex: 50, animation: 'cm-pop .15s ease' }}>
              {abasConfig.map(t => {
                  // Quem diz qual aba está aberta é o endereço, não o estado:
                  // as duas coisas andam juntas, e o endereço é o que sobrevive
                  // a um F5.
                  const tActive = pathname === caminhoDaAba(t.key);
                  return (
                    <button key={t.key}
                      onClick={() => {
                        dispatch({ type: 'SET', key: 'configTab', value: t.key });
                        setSettingsMenuOpen(false);
                        router.push(caminhoDaAba(t.key));
                      }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: tActive ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', fontSize: 12.5, fontWeight: tActive ? 700 : 600, color: tActive ? 'var(--primary-t)' : 'var(--text2)', textAlign: 'left' }}
                      className={tActive ? '' : 'hs'}>
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        )}
        {/* dark mode toggle (collapsed) */}
        {collapsed && (
          <button onClick={() => dispatch({ type: 'SET_DARK', dark: !state.dark })}
            style={{ width: '100%', display: 'flex', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: '8px 0', borderRadius: 'var(--r-ctrl)' }} className="hs"
            title={state.dark ? 'Modo claro' : 'Modo escuro'}>
            {state.dark
              ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
              : <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            }
          </button>
        )}
        {collapsed && (
          <button onClick={handleLogout}
            style={{ width: '100%', display: 'flex', justifyContent: 'center', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red-t)', padding: '8px 0', borderRadius: 'var(--r-ctrl)', marginTop: 2 }} className="hs"
            title="Sair">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        )}

        {!collapsed && (
          <>
            <button onClick={() => setUserMenuOpen(o => !o)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '6px 6px', borderRadius: 'var(--r-ctrl)', textAlign: 'left' }} className="hs">
              <div style={{ width: 30, height: 30, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', fontSize: 10.5, fontWeight: 800, flexShrink: 0 }}>
                {org.memberName.slice(0, 2).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.memberName}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{org.userEmail}</div>
              </div>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text3)', flexShrink: 0 }}><path d="m18 15-6-6-6 6"/></svg>
            </button>

            {userMenuOpen && (
              <>
              {/* clicar em qualquer lugar fecha, igual ao menu de Configurações */}
              <div onClick={() => setUserMenuOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 49 }} />
              <div style={{ position: 'absolute', bottom: '100%', left: 8, right: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-pop)', overflow: 'hidden', marginBottom: 4, zIndex: 50 }}>
                <button onClick={() => dispatch({ type: 'SET_DARK', dark: !state.dark })}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', textAlign: 'left' }} className="hs">
                  {state.dark
                    ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/></svg>
                    : <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                  }
                  {state.dark ? 'Modo claro' : 'Modo escuro'}
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '0 10px' }} />
                {/* Fica aqui, e não dentro da troca de empresa: a troca só
                    aparece para quem JÁ tem duas, então lá dentro este atalho
                    seria uma porta trancada por dentro. */}
                <a href="/setup?nova=1" onClick={() => setUserMenuOpen(false)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer', padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', textAlign: 'left', textDecoration: 'none' }} className="hs">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M10 12h4"/><path d="M10 16h4"/></svg>
                  Criar outra empresa
                </a>
                <div style={{ height: 1, background: 'var(--border)', margin: '0 10px' }} />
                <button onClick={() => { setUserMenuOpen(false); handleLogout(); }}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 9, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 14px', fontSize: 12.5, fontWeight: 600, color: 'var(--red-t)', textAlign: 'left' }} className="hr">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  {saindo ? 'Saindo…' : 'Sair'}
                </button>
              </div>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}

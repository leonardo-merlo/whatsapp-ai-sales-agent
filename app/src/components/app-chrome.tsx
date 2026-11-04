'use client'; // shell interativo: sidebar, tema e toasts

import { AppProvider, useApp } from '@/lib/app-context';
import { OrgProvider, useOrg, type OrgInfo } from '@/lib/org-context';
import type { InitialData } from '@/lib/types';
import { useIsMobile } from '@/lib/use-is-mobile';
import Sidebar from './sidebar';
import MobileNav from './mobile-nav';
import GuidedTour from './onboarding/guided-tour';
import { useNotificacoesRealtime } from './notificacoes-sino';

function ToastBar({ isMobile }: { isMobile: boolean }) {
  const { state, dispatch } = useApp();
  if (!state.toast) return null;
  const { msg, action } = state.toast;
  return (
    <div style={{ position: 'fixed', bottom: isMobile ? 76 : 'calc(var(--shell-inset) + 28px)', left: '50%', transform: 'translateX(-50%)', maxWidth: 'calc(100vw - 24px)', display: 'flex', alignItems: 'center', gap: 14, background: 'var(--text)', color: '#fff', padding: '10px 18px', borderRadius: 'var(--r-ctrl)', fontSize: 13.5, fontWeight: 600, zIndex: 9999, boxShadow: 'var(--sh-pop)', animation: 'cm-pop .22s ease' }}>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
      {action && (
        <button onClick={() => { action.run(); dispatch({ type: 'TOAST', toast: null }); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-t)', fontSize: 13.5, fontWeight: 700, padding: 0, flexShrink: 0, filter: 'brightness(1.6)' }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const isMobile = useIsMobile();
  const { produtoAtivo } = useOrg();
  // Fica no shell, e não no componente do sino: o toast de venda nova precisa
  // subir em qualquer tela, mesmo com o painel do sino fechado.
  useNotificacoesRealtime();
  return (
    // O painel não ocupa a janela inteira: flutua sobre um gradiente verde, como
    // na referência. No celular o respiro é 0 e os cantos ficam retos.
    // data-produto troca as variáveis da marca (azul no Atendimento, verde no Vendas).
    <div data-produto={produtoAtivo} style={{ height: '100%', padding: 'var(--shell-inset)', background: 'var(--page-grad)', color: 'var(--text)', fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', height: '100%', background: 'var(--bg)', borderRadius: isMobile ? 0 : 'var(--r-shell)', boxShadow: isMobile ? 'none' : 'var(--sh-pop)', overflow: 'hidden' }}>
        {!isMobile && <Sidebar />}
        <main style={{ flex: 1, minWidth: 0, overflow: 'auto', paddingBottom: isMobile ? 58 : 0 }}>{children}</main>
      </div>
      {isMobile && <MobileNav />}
      <ToastBar isMobile={isMobile} />
      {!isMobile && <GuidedTour />}
    </div>
  );
}

export default function AppChrome({ org, initial, children }: { org: OrgInfo; initial: InitialData; children: React.ReactNode }) {
  return (
    <OrgProvider value={org}>
      <AppProvider initial={initial}>
        <Shell>{children}</Shell>
      </AppProvider>
    </OrgProvider>
  );
}

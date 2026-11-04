'use client'; // tour interativo: estado, medição de layout e persistência em localStorage

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useOrg } from '@/lib/org-context';
import { navPara, SETTINGS_NAV } from '../sidebar';
import { configTabsPara } from '@/lib/config-tabs';

const STORAGE_KEY = 'wappia-onboarding-v1';

interface TourStep { sel: string; title: string; body: string; }

// Cada passo destaca um item da sidebar (data-tour = href). Como a sidebar fica
// sempre visível, o tour não precisa navegar entre telas.
const STEPS: TourStep[] = [
  { sel: '/painel', title: 'Painel', body: 'Aqui você acompanha os resultados do agente: conversas, contatos e desempenho ao longo do tempo.' },
  { sel: '/conhecimento', title: 'Conhecimento', body: 'Tudo o que a IA sabe: os dados da empresa, os produtos e como ela fala. Use "Testar" para conversar com ela antes de publicar.' },
  { sel: '/agenda', title: 'Agenda', body: 'Seus horários e disponibilidade. O agente usa isso para oferecer e marcar horários automaticamente.' },
  { sel: '/contatos', title: 'Contatos', body: 'Sua base de clientes, com ficha, etiquetas, histórico e próximos compromissos.' },
  { sel: '/conversas', title: 'Conversas', body: 'As conversas do WhatsApp em tempo real. Você pode assumir uma conversa da IA quando quiser.' },
  { sel: '/campanhas', title: 'Campanhas', body: 'Dispare mensagens em massa com modelos aprovados para reengajar e avisar seus clientes.' },
  { sel: '/configuracoes', title: 'Configurações', body: 'Dados do negócio, conexão do WhatsApp, plano e equipe ficam aqui. Prontinho — bom trabalho! 🎉' },
];

type Phase = 'off' | 'intro' | 'tour';

export default function GuidedTour() {
  const { memberRole } = useOrg();
  const [phase, setPhase] = useState<Phase>('off');
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  // Cada passo aponta para um item da sidebar. Se o papel não vê o item, o
  // passo destacaria o vazio — então sai do tour.
  const steps = useMemo(() => {
    const visiveis = new Set(navPara(memberRole).map(n => n.href));
    if (configTabsPara(memberRole).length > 0) visiveis.add(SETTINGS_NAV.href);
    return STEPS.filter(s => visiveis.has(s.sel));
  }, [memberRole]);

  // Dispara a pergunta inicial só uma vez, no desktop, e não colide com o
  // simulador que abre logo após o setup (/conhecimento?testar=1).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 768px)').matches) return;
    let seen = '';
    try { seen = localStorage.getItem(STORAGE_KEY) ?? ''; } catch {}
    if (seen) return;
    if (new URLSearchParams(window.location.search).get('testar') === '1') return;
    const t = setTimeout(() => setPhase('intro'), 700);
    return () => clearTimeout(t);
  }, []);

  const target = phase === 'tour' ? steps[step] : null;

  useLayoutEffect(() => {
    if (!target) return; // fora do tour o componente já não renderiza o rect
    const sel = target.sel;
    function measure() {
      const el = document.querySelector(`[data-tour="${sel}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [target, step]);

  function finish(mark: 'done' | 'skipped') {
    try { localStorage.setItem(STORAGE_KEY, mark); } catch {}
    setStep(0);
    setPhase('off');
  }

  if (phase === 'off') return null;

  if (phase === 'intro') {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(15,18,25,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, animation: 'cm-pop .18s ease' }}>
        <div style={{ background: 'var(--surface)', borderRadius: 'var(--r-card)', width: 'min(420px, 100%)', padding: 26, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: 'var(--sh-pop)', alignItems: 'center', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 'var(--r-card)', background: 'var(--primary-soft)', color: 'var(--primary-t)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
            <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></svg>
          </div>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Quer um tour rápido?</span>
          <span style={{ fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.55 }}>Em {steps.length} passos a gente mostra onde fica cada coisa no Wappia. Leva menos de um minuto.</span>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, width: '100%' }}>
            <button onClick={() => finish('skipped')} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '11px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hs">Agora não</button>
            <button onClick={() => { setStep(0); setPhase('tour'); }} style={{ flex: 1, background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', padding: '11px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hp">Fazer o tour</button>
          </div>
        </div>
      </div>
    );
  }

  // phase === 'tour'
  if (!target) return null;
  const total = steps.length;
  const pad = 6;
  const cardW = 300;
  const cardLeft = rect ? Math.min(rect.right + 14, window.innerWidth - cardW - 12) : 90;
  const cardTop = rect ? Math.min(Math.max(rect.top - 8, 12), window.innerHeight - 230) : 80;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }}>
      {/* Captura cliques do fundo para não navegar sem querer durante o tour. */}
      <div style={{ position: 'fixed', inset: 0 }} />
      {/* Destaque (spotlight) com borda verde grossa e o resto escurecido. */}
      {rect && (
        <div style={{ position: 'fixed', top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, border: '3px solid var(--green-t)', borderRadius: 'var(--r-card)', boxShadow: '0 0 0 9999px rgba(15,18,25,.55)', pointerEvents: 'none', transition: 'top .2s ease, left .2s ease, width .2s ease, height .2s ease' }} />
      )}
      <div style={{ position: 'fixed', top: cardTop, left: cardLeft, width: cardW, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-pop)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10, animation: 'cm-pop .18s ease' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>{target.title}</span>
          <button onClick={() => finish('done')} title="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 2, display: 'flex' }} className="hs">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <span style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55 }}>{target.body}</span>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 4 }}>
          <button onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0} style={{ background: 'none', border: 'none', color: step === 0 ? 'var(--text3)' : 'var(--text2)', fontSize: 13, fontWeight: 600, cursor: step === 0 ? 'default' : 'pointer', opacity: step === 0 ? 0.45 : 1, padding: '6px 4px' }}>Voltar</button>
          <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 600 }}>{step + 1} de {total}</span>
          {step < total - 1 ? (
            <button onClick={() => setStep(s => Math.min(total - 1, s + 1))} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Avançar</button>
          ) : (
            <button onClick={() => finish('done')} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Concluir</button>
          )}
        </div>
      </div>
    </div>
  );
}

'use client'; // sino com badge, painel e assinatura Realtime

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { createClient } from '@/lib/supabase/client';
import { aprovarVenda, descartarVenda, dispensarNotificacao, marcarNotificacoesLidas } from '@/lib/data/mutations';
import type { Notificacao } from '@/lib/types';
import type { Tables } from '@/lib/supabase/database.types';

/** Assina as notificações da org. Fica montado no shell do app (não no painel do
 *  sino) para o aviso aparecer em qualquer tela, com a aba aberta.
 *
 *  A linha que chega pelo Realtime não traz os itens da venda — só a notificação.
 *  Isso é suficiente para acender o badge e subir o toast; o detalhe dos itens vem
 *  no refresh, que é disparado logo em seguida. Evita uma segunda consulta por
 *  evento e mantém a fonte de verdade num lugar só (fetchInitialData). */
export function useNotificacoesRealtime() {
  const { dispatch, showToast } = useApp();
  const org = useOrg();
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`notificacoes-${org.orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notificacoes', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'notificacoes'>;
        dispatch({
          type: 'RT_NOTIF_INSERIDA',
          notificacao: {
            id: row.id,
            tipo: row.tipo,
            titulo: row.titulo,
            corpo: row.corpo,
            criadaEm: row.created_at,
            lida: false,
            saleId: row.sale_id,
            contatoNome: null,
            itens: [],
          },
        });
        showToast(row.titulo);
        router.refresh();
      })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Realtime Notificações:', status); });
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.orgId]);
}

function tempoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const horas = Math.floor(min / 60);
  if (horas < 24) return `${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias === 1 ? 'ontem' : `${dias} dias`;
}

function centavos(v: number): string {
  return (v / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function CardNotificacao({ n, onResolvida }: { n: Notificacao; onResolvida: (id: string) => void }) {
  const { showToast } = useApp();
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  const totalItens = n.itens.reduce((soma, i) => soma + i.valorUnitCentavos * i.quantidade, 0);
  const semCatalogo = n.itens.some(i => i.produtoId === null);

  async function executar(acao: () => Promise<void>, sucesso: string) {
    if (ocupado) return;
    setOcupado(true);
    try {
      await acao();
      onResolvida(n.id);
      showToast(sucesso);
      // O saldo de estoque vive nos dados carregados no servidor; sem o refresh a
      // aba Empresa continuaria mostrando a quantidade antiga.
      router.refresh();
    } catch {
      showToast('Não foi possível concluir. Tente novamente.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', borderBottom: '1px solid var(--border)', background: n.lida ? 'transparent' : 'var(--primary-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 15, flexShrink: 0, lineHeight: 1.3 }}>
          {n.tipo === 'venda_baixa_estoque' ? '🛒' : n.tipo === 'estoque_minimo' ? '📦' : n.tipo === 'numero_pagamento_falhou' ? '💳'
            : n.tipo === 'limite_do_plano' ? '⏳' : n.tipo === 'consulta_desmarcada' ? '📅' : '📄'}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{n.titulo}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{n.corpo}</span>
        </div>
        <span className="mono" style={{ fontSize: 10.5, color: 'var(--text3)', flexShrink: 0 }}>{tempoRelativo(n.criadaEm)}</span>
      </div>

      {n.itens.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px' }}>
          {n.itens.map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
              <span style={{ color: 'var(--text2)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <span className="mono">{it.quantidade}x</span> {it.nome}
              </span>
              <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 600, color: it.produtoId === null ? 'var(--red-t)' : it.controlaEstoque ? 'var(--text3)' : 'var(--text3)' }}>
                {it.produtoId === null
                  ? 'fora do catálogo'
                  : !it.controlaEstoque
                    ? 'sem controle de estoque'
                    : it.estoqueAtual === null
                      ? 'estoque não informado'
                      : `estoque ${it.estoqueAtual} → ${Math.max(0, it.estoqueAtual - it.quantidade)}`}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 4, marginTop: 2, fontSize: 12 }}>
            <span style={{ color: 'var(--text3)', fontWeight: 600 }}>Total</span>
            <span className="mono" style={{ fontWeight: 600 }}>{centavos(totalItens)}</span>
          </div>
        </div>
      )}

      {n.saleId ? (
        <div style={{ display: 'flex', gap: 8 }}>
          <button disabled={ocupado} onClick={() => executar(() => descartarVenda(n.saleId!), 'Venda descartada')}
            style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: ocupado ? 'wait' : 'pointer' }} className="hs">
            Não foi venda
          </button>
          <button disabled={ocupado} onClick={() => executar(() => aprovarVenda(n.saleId!), semCatalogo ? 'Venda confirmada (itens fora do catálogo não tiveram baixa)' : 'Venda confirmada e estoque atualizado')}
            style={{ flex: 1, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: ocupado ? 'wait' : 'pointer', opacity: ocupado ? 0.7 : 1 }} className="hp">
            {ocupado ? 'Confirmando…' : 'Confirmar e dar baixa'}
          </button>
        </div>
      ) : (
        <button disabled={ocupado} onClick={() => executar(() => dispensarNotificacao(n.id), 'Aviso dispensado')}
          style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12.5, fontWeight: 600, cursor: ocupado ? 'wait' : 'pointer', padding: 0 }}>
          Entendi, dispensar
        </button>
      )}
    </div>
  );
}

export default function SinoNotificacoes({ colapsado = false }: { colapsado?: boolean }) {
  const { state, dispatch } = useApp();
  const isMobile = useIsMobile();
  const [aberto, setAberto] = useState(false);
  const botaoRef = useRef<HTMLButtonElement>(null);
  const [ancora, setAncora] = useState<{ left: number; bottom: number } | null>(null);

  const naoLidas = state.notificacoes.filter(n => !n.lida).length;

  // O painel precisa ser `fixed`: a sidebar e o shell flutuante têm overflow
  // hidden, e um popover `absolute` sai cortado na borda da sidebar. Como
  // `fixed` é relativo à janela, a posição vem de medir o botão.
  useEffect(() => {
    if (!aberto || isMobile) return;
    function medir() {
      const r = botaoRef.current?.getBoundingClientRect();
      if (r) setAncora({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    }
    medir();
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [aberto, isMobile]);

  // Abrir o sino zera o badge, mas não resolve nada: a venda continua pendente
  // de aprovação até o dono clicar em confirmar ou descartar.
  async function abrir() {
    setAberto(true);
    const ids = state.notificacoes.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    dispatch({ type: 'NOTIF_MARCAR_LIDAS' });
    try { await marcarNotificacoesLidas(ids); } catch { /* badge é cosmético; não vale erro na tela */ }
  }

  const painelStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', left: 8, right: 8, bottom: 70, maxHeight: '70vh', zIndex: 80 }
    : { position: 'fixed', left: ancora?.left ?? 0, bottom: ancora?.bottom ?? 84, width: 340, maxHeight: 460, zIndex: 80, visibility: ancora ? 'visible' : 'hidden' };

  return (
    <div style={{ position: 'relative' }}>
      <button ref={botaoRef} onClick={() => (aberto ? setAberto(false) : abrir())}
        title="Notificações"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: colapsado ? 0 : 11, justifyContent: colapsado ? 'center' : 'flex-start', background: 'none', border: 'none', cursor: 'pointer', padding: colapsado ? '9px 0' : '9px 11px', borderRadius: 'var(--r-ctrl)', color: 'var(--text2)', fontSize: 13.5, fontWeight: 600, textAlign: 'left' }}
        className="hs">
        <span style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {naoLidas > 0 && (
            <span className="mono" style={{ position: 'absolute', top: -5, right: -7, background: 'var(--red-t)', color: '#fff', fontSize: 9.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '1px 5px', minWidth: 15, textAlign: 'center' }}>{naoLidas}</span>
          )}
        </span>
        {!colapsado && <span style={{ flex: 1 }}>Notificações</span>}
      </button>

      {aberto && (
        <>
          <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, zIndex: 79 }} />
          <div style={{ ...painelStyle, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-pop)', overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'cm-pop .15s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '11px 14px', borderBottom: '1px solid var(--border)' }}>
              <span className="t-sec" style={{ fontSize: 13.5 }}>Notificações</span>
              <button onClick={() => setAberto(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', display: 'flex', padding: 2 }}>
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ overflow: 'auto' }}>
              {state.notificacoes.length === 0 ? (
                <div style={{ padding: '22px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                  Nada por aqui. Quando o agente fechar uma venda, o aviso para dar baixa no estoque aparece nesta lista.
                </div>
              ) : (
                state.notificacoes.map(n => (
                  <CardNotificacao key={n.id} n={n} onResolvida={id => dispatch({ type: 'NOTIF_RESOLVIDA', id })} />
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

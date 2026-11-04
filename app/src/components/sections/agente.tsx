'use client';

import ConveniosEValores from '@/components/agente/convenios-e-valores';
import RegioesDeEntrega from '@/components/agente/regioes-de-entrega';
import { dadosDeSaudeDaTela, dadosDeSaudeNaTela, ehSaude } from '@/lib/saude';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { createClient } from '@/lib/supabase/client';
import AgenteDoNumeroPainel from '@/components/agente/agente-do-numero';
import SecaoProdutos from '@/components/agente/produtos';
import RegrasDoCatalogo from '@/components/agente/regras-do-catalogo';
import { listarNumerosConfiguraveis, ROTULO_ROTEIRO, roteiroPadraoDoPapel, type NumeroConfiguravel } from '@/lib/data/agente-do-numero';
import { salvarAgenteConfig, setAgenteAtivo, type AgenteConfigPayload } from '@/lib/data/mutations';
import { guardarVersao, listarVersoes } from '@/lib/data/versoes-do-agente';
import { abasQueMudaram, conteudoDaVersao, produtosComEstoqueAtual, type ConteudoDaVersao, type VersaoDoAgente } from '@/lib/agente/versoes';
import type { CamposDoNumeroNaTela, NumeroNaTela, RascunhoDaTela } from '@/lib/simulador/rascunho';
import type { HorarioDia, Preco, Tom, TipoSucesso, AgenteTabKey } from '@/lib/types';
import { SEGMENTOS, presetPorSegmento, aplicarNomeNegocio } from '@/lib/presets';
import { MOSTRAR_MODELOS_POR_NICHO } from '@/lib/botoes-escondidos';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';

const TONS: { key: Tom; label: string; emoji: string }[] = [
  { key: 'simpatico', label: 'Simpático', emoji: '😊' },
  { key: 'direto', label: 'Direto', emoji: '🎯' },
  { key: 'formal', label: 'Formal', emoji: '🎩' },
  { key: 'descontraido', label: 'Descontraído', emoji: '😎' },
];

// Regras sugeridas: um clique já adiciona a regra pré-preenchida ao rascunho.
const SUGESTOES_REGRAS: { label: string; gatilho: string; acao: 'transferir' | 'responder'; mensagem: string }[] = [
  { label: 'Palavrão ou ofensa', gatilho: 'o cliente usar palavrões, xingamentos ou linguagem ofensiva', acao: 'responder', mensagem: 'Entendo que você possa estar chateado(a) e quero muito te ajudar. Vamos manter o respeito para eu resolver isso da melhor forma? 🙏' },
  { label: 'Pedido de cancelamento', gatilho: 'o cliente pedir para cancelar um pedido, agendamento ou contrato', acao: 'transferir', mensagem: '' },
  { label: 'Fala de concorrente', gatilho: 'o cliente citar ou comparar com um concorrente', acao: 'responder', mensagem: 'Prefiro focar em como podemos te atender bem por aqui! Posso te mostrar o que temos de melhor?' },
  { label: 'Insistência em desconto', gatilho: 'o cliente insistir em desconto ou negociar valores fora da tabela', acao: 'transferir', mensagem: '' },
  { label: 'Reclamação grave', gatilho: 'o cliente fizer uma reclamação séria ou ameaçar reclamar publicamente', acao: 'transferir', mensagem: '' },
];

const SUCESSO_TIPOS: { key: TipoSucesso; label: string; sub: string; emoji: string }[] = [
  { key: 'venda', label: 'Venda realizada', sub: 'O cliente fechou uma compra.', emoji: '🛒' },
  { key: 'agendamento', label: 'Agendamento feito', sub: 'O cliente marcou um horário.', emoji: '📅' },
  { key: 'contato', label: 'Contato registrado', sub: 'O cliente deixou os dados para retorno.', emoji: '📇' },
];

interface SimuladorMsg { role: 'user' | 'assistant'; content: string; time?: string }

const SUGESTOES_TESTE = ['Quanto custa?', 'Qual o horário de funcionamento?', 'Onde vocês ficam?'];

function horaAgora(): string {
  return horaEmSP(new Date());
}

function SimuladorPanel({ onClose, rascunho, numero, rotuloDoNumero, avisoDoNumero }: {
  onClose: () => void;
  rascunho: RascunhoDaTela;
  /** O número escolhido no seletor; sem ele, o padrão da empresa. */
  numero?: NumeroNaTela | null;
  rotuloDoNumero?: string | null;
  avisoDoNumero?: string | null;
}) {
  const isMobile = useIsMobile();
  const org = useOrg();
  const [msgs, setMsgs] = useState<SimuladorMsg[]>([]);
  // Relógio ao vivo do celular simulado (atualiza a cada 20s).
  const [relogio, setRelogio] = useState(horaAgora);
  useEffect(() => {
    const id = setInterval(() => setRelogio(horaAgora()), 20_000);
    return () => clearInterval(id);
  }, []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToEnd() {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  }

  async function enviar(textoPronto?: string) {
    const texto = (textoPronto ?? input).trim();
    if (!texto || loading) return;
    const historico = [...msgs, { role: 'user' as const, content: texto, time: horaAgora() }];
    setMsgs([...historico, { role: 'assistant', content: '', time: horaAgora() }]);
    setInput('');
    setLoading(true);
    scrollToEnd();

    try {
      const resp = await fetch('/api/simulador', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: historico, rascunho, numero }),
      });
      if (!resp.ok || !resp.body) throw new Error('Falha na resposta do simulador');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      const horaResp = horaAgora();
      let acumulado = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acumulado += decoder.decode(value, { stream: true });
        setMsgs([...historico, { role: 'assistant', content: acumulado, time: horaResp }]);
        scrollToEnd();
      }
    } catch {
      setMsgs([...historico, { role: 'assistant', content: 'Não foi possível gerar uma resposta agora. Tente novamente.', time: horaAgora() }]);
    } finally {
      setLoading(false);
    }
  }

  const nomeAgente = org.orgName || 'Seu agente';
  const inicialAgente = nomeAgente.trim().charAt(0).toUpperCase() || 'A';

  const chat = (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--wa-bg)' }}>
      {/* Cabeçalho estilo WhatsApp */}
      <div style={{ flexShrink: 0, background: '#008069', color: '#fff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 18px 0', fontSize: 11.5, fontWeight: 600 }}>
          <span>{relogio}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <svg width={16} height={11} viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="7" width="3" height="5" rx="1" /><rect x="5" y="4" width="3" height="8" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
            <svg width={22} height={12} viewBox="0 0 24 12" fill="none"><rect x="0.5" y="1" width="20" height="10" rx="2.5" stroke="currentColor" /><rect x="2" y="2.5" width="15" height="7" rx="1" fill="currentColor" /><rect x="21.5" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" /></svg>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 12px 9px' }}>
          <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m15 18-6-6 6-6" /></svg>
          <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{inicialAgente}</div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nomeAgente}</span>
            <span style={{ fontSize: 11.5, opacity: 0.85 }}>{loading ? 'digitando…' : 'online'}</span>
          </div>
          <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
          <svg width={5} height={18} viewBox="0 0 4 18" fill="currentColor" style={{ flexShrink: 0 }}><circle cx="2" cy="2" r="2" /><circle cx="2" cy="9" r="2" /><circle cx="2" cy="16" r="2" /></svg>
        </div>
      </div>

      {/* Mensagens */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {msgs.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, margin: 'auto 0', padding: '20px 8px' }}>
            <div style={{ background: 'var(--wa-in)', color: 'var(--wa-meta)', borderRadius: 10, padding: '8px 14px', fontSize: 12, textAlign: 'center', boxShadow: '0 1px 1px rgba(0,0,0,.08)', maxWidth: 240, lineHeight: 1.5 }}>Converse como se você fosse um cliente no WhatsApp</div>
            {avisoDoNumero && <div style={{ background: 'var(--wa-in)', color: 'var(--wa-meta)', borderRadius: 10, padding: '8px 14px', fontSize: 12, textAlign: 'center', boxShadow: '0 1px 1px rgba(0,0,0,.08)', maxWidth: 240, lineHeight: 1.5 }}>{avisoDoNumero}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7, width: '100%', maxWidth: 260 }}>
              {SUGESTOES_TESTE.map(s => (
                <button key={s} onClick={() => enviar(s)} style={{ background: 'var(--wa-in)', color: '#008069', border: 'none', borderRadius: 999, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 1px rgba(0,0,0,.08)' }}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => {
          const out = m.role === 'user';
          const digitando = !m.content && loading && i === msgs.length - 1;
          return (
            <div key={i} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '78%', background: out ? 'var(--wa-out)' : 'var(--wa-in)', color: 'var(--wa-text)', borderRadius: 8, borderTopRightRadius: out ? 2 : 8, borderTopLeftRadius: out ? 8 : 2, padding: digitando ? '10px 14px' : '6px 9px 5px', boxShadow: '0 1px 1px rgba(0,0,0,.13)', fontSize: 13.5, lineHeight: 1.45 }}>
                {digitando ? (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span className="wa-dot" /><span className="wa-dot" /><span className="wa-dot" /></div>
                ) : (
                  <>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{m.content}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, float: 'right', marginLeft: 10, fontSize: 10, color: 'var(--wa-meta)', transform: 'translateY(6px)' }}>
                      {m.time ?? relogio}
                      {out && <svg width={15} height={11} viewBox="0 0 18 12" fill="none" stroke="#53bdeb" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 6.5 4.5 10 11 2.5" /><path d="M7 9.5 8 10.5 14.5 3" /></svg>}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Barra de digitação */}
      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px 9px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 7, background: 'var(--wa-in)', borderRadius: 999, padding: '7px 8px 7px 14px', boxShadow: '0 1px 1px rgba(0,0,0,.08)' }}>
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && enviar()} placeholder="Mensagem" disabled={loading}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13.5, color: 'var(--wa-text)' }} />
          <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="var(--wa-meta)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </div>
        <button onClick={() => enviar()} disabled={loading || !input.trim()} style={{ width: 42, height: 42, borderRadius: '50%', background: '#008069', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: loading || !input.trim() ? 'default' : 'pointer', opacity: loading || !input.trim() ? 0.75 : 1, flexShrink: 0 }}>
          <svg width={19} height={19} viewBox="0 0 24 24" fill="#fff" stroke="none"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: isMobile ? 0 : 16, zIndex: 60, padding: isMobile ? 0 : 24, animation: 'cm-pop .15s ease' }}>
      {!isMobile && (
        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#fff' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'center' }}>
            <span style={{ fontSize: 14.5, fontWeight: 700 }}>Testar agente</span>
            <span style={{ fontSize: 11.5, opacity: 0.8 }}>{rotuloDoNumero ? `Número ${rotuloDoNumero}, com o que está na tela` : 'Responde com o que está na tela, mesmo sem salvar'}</span>
          </div>
          <button onClick={onClose} title="Fechar" style={{ background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', padding: 7, borderRadius: 'var(--r-pill)' }}>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      )}
      {isMobile ? (
        <div onClick={e => e.stopPropagation()} style={{ width: '100%', height: '100%' }}>{chat}</div>
      ) : (
        <div onClick={e => e.stopPropagation()} style={{ width: 336, height: 680, maxHeight: 'calc(100vh - 120px)', background: '#0b0b0f', borderRadius: 46, padding: 11, boxShadow: '0 30px 70px rgba(0,0,0,.5), inset 0 0 0 2px #2a2a30', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)', width: 96, height: 26, background: '#0b0b0f', borderRadius: 'var(--r-pill)', zIndex: 5 }} />
          <div style={{ width: '100%', height: '100%', borderRadius: 36, overflow: 'hidden' }}>{chat}</div>
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 36, height: 20, borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', background: on ? 'var(--primary)' : 'var(--border2)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 2, left: 0, width: 16, height: 16, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transform: on ? 'translateX(18px)' : 'translateX(2px)', transition: 'transform .15s' }} />
    </button>
  );
}

// Três abas: **Empresa** (o que o negócio é), **Produtos** (o que ele vende) e
// **Agente** (como ele fala). A régua que separa as três cabe numa frase: **o
// que está em Empresa e em Produtos vale para todos os números, sempre; o que
// está em Agente é o que o seletor de número governa.**
//
// Produtos saiu de dentro de Empresa em 15/09: com mil itens ela é a maior
// coisa da tela, e no meio dos outros campos empurrava horário, localização e
// dúvidas para longe demais de quem só queria conferir um preço.
const AGENTE_TABS: { key: AgenteTabKey; label: string; sub: string }[] = [
  { key: 'empresa', label: 'Empresa', sub: 'Os fatos do negócio — valem para todos os números' },
  { key: 'produtos', label: 'Produtos', sub: 'O que você vende e a que preço — vale para todos os números' },
  { key: 'agente', label: 'Agente', sub: 'Como o agente fala, número por número' },
];

function TabBar({ active, onSelect, badges }: { active: AgenteTabKey; onSelect: (k: AgenteTabKey) => void; badges?: Partial<Record<AgenteTabKey, React.ReactNode>> }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
      {AGENTE_TABS.map(t => {
        const sel = active === t.key;
        return (
          <button key={t.key} onClick={() => onSelect(t.key)} title={t.sub}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', color: sel ? 'var(--primary)' : 'var(--text3)', borderBottom: `2px solid ${sel ? 'var(--primary)' : 'transparent'}`, marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}
            {badges?.[t.key]}
          </button>
        );
      })}
    </div>
  );
}

function TabPanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: '0 0 12px 12px', padding: '18px' }}>
      {children}
    </div>
  );
}

// Salvar põe no ar na hora; o histórico é o jeito de desfazer. Carregar uma
// cópia só preenche a tela: dá para testar no simulador, e quem põe no ar é o
// Salvar (decisão de 29/09, item 9).
function HistoricoModal({ orgId, onCarregar, onClose }: {
  orgId: string;
  onCarregar: (conteudo: ConteudoDaVersao) => void;
  onClose: () => void;
}) {
  const [versoes, setVersoes] = useState<VersaoDoAgente[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarVersoes(orgId)
      .then(lista => { if (vivo) setVersoes(lista); })
      .catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  }, [orgId]);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16, animation: 'cm-pop .15s ease' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', width: 'min(480px, 100%)', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-pop)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Histórico</span>
            <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Cada vez que você salva, fica uma cópia aqui.</span>
          </div>
          <button onClick={onClose} title="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
            <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
        <div style={{ overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {falhou && <span style={{ padding: '18px 20px', fontSize: 13, color: 'var(--red-t)' }}>Não foi possível abrir o histórico.</span>}
          {!falhou && versoes === null && <span style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text3)' }}>Carregando…</span>}
          {versoes?.length === 0 && <span style={{ padding: '18px 20px', fontSize: 13, color: 'var(--text3)' }}>Nenhuma cópia ainda. A primeira aparece quando você salvar.</span>}
          {versoes?.map((v, i) => {
            const anterior = versoes[i + 1];
            const abas = anterior ? abasQueMudaram(v.conteudo, anterior.conteudo) : [];
            return (
              <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {dataBRemSP(v.criadaEm)} às {horaEmSP(v.criadaEm)}
                    {i === 0 && <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, color: 'var(--primary-t)' }}>No ar</span>}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {[v.autor, abas.length ? `mudou ${abas.join(', ')}` : ''].filter(Boolean).join(' · ')}
                  </span>
                </div>
                {i > 0 && (
                  <button onClick={() => onCarregar(v.conteudo)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }} className="hs">
                    Voltar para esta
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AgenteSection() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  const searchParams = useSearchParams();
  const [salvando, setSalvando] = useState(false);
  // Vindo do onboarding (/agente?testar=1), o simulador já abre — o primeiro
  // contato com o agente é conversar com ele, não procurar o botão.
  const [simuladorOpen, setSimuladorOpen] = useState(searchParams.get('testar') === '1');
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [nichoOpen, setNichoOpen] = useState(false);
  const [nichoConfirm, setNichoConfirm] = useState<string | null>(null);
  const [regrasAbertas, setRegrasAbertas] = useState<Set<number>>(() => new Set());

  // Qual número esta tela está configurando. Vazio = a empresa toda, que é o
  // único modo que existia até aqui e continua sendo o padrão. O seletor só
  // aparece quando há mais de um número, ou quando algum não é de atendimento:
  // quem tem um número só (todo o Wappia Atendimento) não vê nada de novo.
  const [numeros, setNumeros] = useState<NumeroConfiguravel[]>([]);
  const [numeroSelecionado, setNumeroSelecionado] = useState('');
  // O que está na tela do número escolhido, para o simulador testar sem salvar.
  const [camposDoNumero, setCamposDoNumero] = useState<CamposDoNumeroNaTela | null>(null);

  async function recarregarNumeros() {
    try {
      setNumeros(await listarNumerosConfiguraveis(createClient(), org.orgId));
    } catch {
      // Sem números não há seletor, e a tela segue exatamente como sempre foi.
    }
  }
  useEffect(() => {
    let vivo = true;
    listarNumerosConfiguraveis(createClient(), org.orgId)
      .then(lista => { if (vivo) setNumeros(lista); })
      .catch(() => { /* sem números não há seletor, e a tela segue como sempre foi */ });
    return () => { vivo = false; };
  }, [org.orgId]);

  const numeroEmEdicao = numeros.find(n => n.id === numeroSelecionado) ?? null;
  const mostrarSeletorDeNumero = numeros.length > 1 || numeros.some(n => n.papel !== 'atendimento');

  function toggleRegraAberta(i: number) {
    setRegrasAbertas(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }
  function addRegraSugerida(s: { gatilho: string; acao: 'transferir' | 'responder'; mensagem: string }) {
    dispatch({ type: 'SET', key: 'gatilhos', value: [...state.gatilhos, { gatilho: s.gatilho, ativo: true, acao: s.acao, mensagem: s.mensagem }] });
    setRegrasAbertas(prev => new Set(prev).add(state.gatilhos.length));
  }

  // Aplica um modelo de nicho ao rascunho: sobrescreve personalidade, questionario,
  // gatilhos e FAQs pelos valores do preset (nome do negocio ja interpolado).
  function aplicarPresetNicho(key: string) {
    const preset = presetPorSegmento(key);
    const nome = state.cl.fantasia;
    dispatch({ type: 'SET', key: 'welcomeMsg', value: aplicarNomeNegocio(preset.welcomeMsg, nome) });
    dispatch({ type: 'SET', key: 'agentPrompt', value: aplicarNomeNegocio(preset.prompt, nome) });
    dispatch({ type: 'SET', key: 'limitacoes', value: preset.limitacoes });
    dispatch({ type: 'SET', key: 'perguntas', value: preset.perguntas.map(q => ({ ...q, objetivo: 'contato' as const })) });
    dispatch({ type: 'SET', key: 'gatilhos', value: preset.gatilhos.map(g => ({ ...g, acao: 'transferir' as const, mensagem: '' })) });
    dispatch({ type: 'SET', key: 'faqs', value: preset.faqsExemplo });
    setNichoConfirm(null);
    setNichoOpen(false);
    showToast(`Modelo "${preset.label}" aplicado. Salve para valer.`);
  }

  function montarPayload(): AgenteConfigPayload {
    return {
      ativo: state.agenteAtivo,
      welcomeMsg: state.welcomeMsg,
      agentPrompt: state.agentPrompt,
      limitacoes: state.limitacoes,
      tom: state.tom,
      fallbackMode: state.fallbackMode,
      fallbackMsg: state.fallbackMsg,
      fallbackAtendente: state.fallbackAtendente,
      horarioVinculaAgenda: state.horarioVinculaAgenda,
      nomeNegocio: state.cl.fantasia,
      descricaoNegocio: state.cl.descricao,
      endereco: state.cl.endereco,
      precos: state.precos,
      faqs: state.faqs,
      perguntas: state.perguntas,
      gatilhos: state.gatilhos,
      sucessos: state.sucessos,
      infoAdicional: state.infoAdicional,
      horario: state.horarioEdit,
      // Valor inválido não chega a ser gravado: o Salvar barra antes. Aqui ele
      // só precisa de um número para a comparação de "tem mudança".
      dadosSaude: dadosDeSaudeDaTela(state.dadosSaude)
        ?? { convenios: state.dadosSaude.convenios, atendeParticular: state.dadosSaude.atendeParticular, valorConsultaCentavos: -1 },
      textosDoCatalogo: state.textosDoCatalogo,
    };
  }

  // Rascunho "sujo": algum campo editável mudou desde o último salvamento no banco.
  // `ativo` é salvo à parte (toggle no header), então é neutralizado na assinatura.
  const draftSig = JSON.stringify({ ...montarPayload(), ativo: false });
  const baselineRef = useRef<string | null>(null);
  if (baselineRef.current === null) baselineRef.current = draftSig;
  // eslint-disable-next-line react-hooks/refs -- the baseline is captured once, on the first render
  const rascunhoSujo = baselineRef.current !== draftSig;

  // Rascunho vive só em memória — avisa antes de fechar/recarregar a página.
  useEffect(() => {
    if (!rascunhoSujo) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [rascunhoSujo]);

  async function handleToggleAtivo() {
    const novo = !state.agenteAtivo;
    dispatch({ type: 'SET', key: 'agenteAtivo', value: novo });
    try {
      await setAgenteAtivo(org.orgId, novo);
    } catch {
      dispatch({ type: 'SET', key: 'agenteAtivo', value: !novo });
      showToast('Erro ao alterar o status do agente');
    }
  }

  // O modal de horários edita a tela, como o resto; quem grava é o Salvar.
  // Cancelar devolve o que estava antes de abrir.
  const horarioAoAbrirRef = useRef<{ horario: HorarioDia[]; vincula: boolean } | null>(null);
  function abrirHorarios() {
    horarioAoAbrirRef.current = { horario: state.horarioEdit, vincula: state.horarioVinculaAgenda };
    dispatch({ type: 'SET', key: 'horarioModalOpen', value: true });
  }
  function cancelarHorarios() {
    const antes = horarioAoAbrirRef.current;
    if (antes) {
      dispatch({ type: 'SET', key: 'horarioEdit', value: antes.horario });
      dispatch({ type: 'SET', key: 'horarioVinculaAgenda', value: antes.vincula });
    }
    dispatch({ type: 'SET', key: 'horarioModalOpen', value: false });
  }

  async function handleSalvarAgente() {
    if (salvando) return;
    if (!dadosDeSaudeDaTela(state.dadosSaude)) {
      showToast('Valor da consulta inválido.');
      return;
    }
    setSalvando(true);
    const payload = montarPayload();
    const aoAbrir = baselineRef.current;
    let precos: Preco[];
    try {
      // Horários, convênios e catálogo só são regravados quando mudaram. A tela abre os
      // horários em sete dias; regravar sem mudança trocaria "Segunda a sexta"
      // por sete linhas iguais sem ninguém ter mexido.
      const aberto = aoAbrir ? JSON.parse(aoAbrir) as AgenteConfigPayload : null;
      const mudou = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
      precos = await salvarAgenteConfig(org.orgId, {
        ...payload,
        horario: !aberto || mudou(payload.horario, aberto.horario) ? payload.horario : undefined,
        dadosSaude: !aberto || mudou(payload.dadosSaude, aberto.dadosSaude) ? payload.dadosSaude : undefined,
        // Só grava o catálogo quando mudou: empresa sem catálogo não ganha linha vazia.
        textosDoCatalogo: aberto && mudou(payload.textosDoCatalogo, aberto.textosDoCatalogo) ? payload.textosDoCatalogo : undefined,
      }, state.agentesData);
      dispatch({ type: 'SET_PRECOS_SALVOS', precos });
      baselineRef.current = draftSig;
      dispatch({ type: 'SALVAR_AGENTE' });
      showToast('Salvo. Já vale no WhatsApp.');
    } catch {
      showToast('Erro ao salvar. Tente novamente.');
      setSalvando(false);
      return;
    }
    // A cópia é o desfazer, não o salvar: se ela falhar, o que foi salvo continua
    // no ar e a pessoa não precisa saber.
    try {
      const anterior = aoAbrir ? conteudoDaVersao(JSON.parse(aoAbrir) as AgenteConfigPayload) : null;
      await guardarVersao(org.orgId, conteudoDaVersao({ ...payload, precos }), org.memberName, anterior);
    } catch (err) {
      console.error('Histórico do agente: a cópia não foi guardada:', err);
    } finally {
      setSalvando(false);
    }
  }

  function carregarVersao(conteudo: ConteudoDaVersao) {
    dispatch({ type: 'SET', key: 'welcomeMsg', value: conteudo.welcomeMsg });
    dispatch({ type: 'SET', key: 'agentPrompt', value: conteudo.agentPrompt });
    dispatch({ type: 'SET', key: 'limitacoes', value: conteudo.limitacoes });
    dispatch({ type: 'SET', key: 'tom', value: conteudo.tom });
    dispatch({ type: 'SET', key: 'fallbackMode', value: conteudo.fallbackMode });
    dispatch({ type: 'SET', key: 'fallbackMsg', value: conteudo.fallbackMsg });
    dispatch({ type: 'SET', key: 'fallbackAtendente', value: conteudo.fallbackAtendente });
    dispatch({ type: 'SET', key: 'horarioVinculaAgenda', value: conteudo.horarioVinculaAgenda });
    dispatch({ type: 'SET', key: 'cl', value: { ...state.cl, fantasia: conteudo.nomeNegocio, descricao: conteudo.descricaoNegocio, endereco: conteudo.endereco } });
    dispatch({ type: 'SET', key: 'precos', value: produtosComEstoqueAtual(conteudo.precos, state.precos) });
    dispatch({ type: 'SET', key: 'faqs', value: conteudo.faqs });
    dispatch({ type: 'SET', key: 'perguntas', value: conteudo.perguntas });
    dispatch({ type: 'SET', key: 'gatilhos', value: conteudo.gatilhos });
    dispatch({ type: 'SET', key: 'sucessos', value: conteudo.sucessos });
    dispatch({ type: 'SET', key: 'infoAdicional', value: conteudo.infoAdicional });
    if (conteudo.horario) dispatch({ type: 'SET', key: 'horarioEdit', value: conteudo.horario });
    if (conteudo.dadosSaude) dispatch({ type: 'SET', key: 'dadosSaude', value: dadosDeSaudeNaTela(conteudo.dadosSaude) });
    if (conteudo.textosDoCatalogo) dispatch({ type: 'SET', key: 'textosDoCatalogo', value: conteudo.textosDoCatalogo });
    setHistoricoOpen(false);
    showToast('Cópia carregada. Teste e salve para valer.');
  }

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: isMobile ? '18px 14px' : '24px 28px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span style={{ width: 30, height: 30, borderRadius: 'var(--r-ctrl)', background: 'var(--primary-soft)', color: 'var(--primary-t)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>
              </span>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>Conhecimento</h1>
            </div>
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>Tudo o que a IA sabe: a empresa, os produtos e como ela fala</span>
          </div>
          {/* O cabeçalho fica visível também com um número escolhido. Ele sumia
              até 14/09 porque Publicar publica o padrão, não o número — mas
              esconder Ativo, Testar e Publicar deixava a tela sem saída para
              quem entrou pelo seletor, e foi o que o Leonardo estranhou:
              "alterei aqui, quero publicar daqui". Quem responde isso agora é o
              botão do painel do número, que diz que salvar já põe no ar. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '6px 12px 6px 14px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: state.agenteAtivo ? 'var(--text)' : 'var(--text3)' }}>{state.agenteAtivo ? 'Ativo' : 'Inativo'}</span>
              <Toggle on={state.agenteAtivo} onClick={handleToggleAtivo} />
            </div>
            {rascunhoSujo && (
              <button onClick={handleSalvarAgente} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hs">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            )}
            {MOSTRAR_MODELOS_POR_NICHO && (
              <button onClick={() => setNichoOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
                <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                Modelos por nicho
              </button>
            )}
            <button onClick={() => setHistoricoOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></svg>
              Histórico
            </button>
            <button onClick={() => setSimuladorOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--primary-soft)', border: '1px solid transparent', color: 'var(--primary-t)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
              Testar
            </button>
          </div>
        </div>

        <TabBar active={state.agenteTab} onSelect={k => dispatch({ type: 'SET', key: 'agenteTab', value: k })} />

        {/* O seletor de número mora DENTRO da aba Agente, e não acima das duas.
            Acima das duas ele sugeria governar a Empresa também — que foi
            exatamente a dúvida do Leonardo ao usar a tela. Ele só governa
            comportamento, então fica onde o comportamento está. */}
        {state.agenteTab === 'agente' && mostrarSeletorDeNumero && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--card)', border: '1px solid var(--border)', borderTop: 'none', borderRadius: 0, padding: '11px 14px' }}>
            <label htmlFor="numero-em-edicao" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }}>Configurando</label>
            <select
              id="numero-em-edicao"
              value={numeroSelecionado}
              onChange={e => { setNumeroSelecionado(e.target.value); setCamposDoNumero(null); }}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)' }}
            >
              <option value="">O padrão de todos os números</option>
              {numeros.map(n => (
                <option key={n.id} value={n.id}>
                  {(n.telefone ?? 'Número sem telefone') + ' · ' + ROTULO_ROTEIRO[n.roteiro ?? roteiroPadraoDoPapel(n.papel)]}
                </option>
              ))}
            </select>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              {numeroEmEdicao
                ? 'O que você mudar aqui vale só para este número. O que deixar em branco segue o padrão.'
                : 'É assim que você muda todos os números de uma vez. Cada número pode mudar só o que for dele.'}
            </span>
          </div>
        )}

        {state.agenteTab === 'agente' && numeroEmEdicao && (
          <TabPanel>
            <AgenteDoNumeroPainel key={numeroEmEdicao.id} numero={numeroEmEdicao} onSalvo={recarregarNumeros} onMudar={setCamposDoNumero} />
          </TabPanel>
        )}

        {/* Agente: como ele se comporta, no padrão de todos os números */}
        {state.agenteTab === 'agente' && !numeroEmEdicao && (
        <TabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13, fontWeight: 700 }}>Tom de voz</span>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Como o agente soa nas mensagens — isso já ajusta a instrução principal automaticamente.</span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TONS.map(t => (
                  <button key={t.key} onClick={() => dispatch({ type: 'SET', key: 'tom', value: t.key })}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${state.tom === t.key ? 'var(--primary)' : 'var(--border)'}`, background: state.tom === t.key ? 'var(--primary-soft)' : 'var(--surface)', color: state.tom === t.key ? 'var(--primary-t)' : 'var(--text2)', borderRadius: 'var(--r-pill)', padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">
                    <span>{t.emoji}</span>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            {[
              { label: 'Mensagem de boas-vindas', sub: 'A primeira mensagem que o agente envia ao iniciar uma conversa.', key: 'welcomeMsg' as const, rows: 2, sugestao: (seg: string) => aplicarNomeNegocio(presetPorSegmento(seg).welcomeMsg, state.cl.fantasia) },
              { label: 'Instrução principal', sub: 'A personalidade e as regras que guiam todas as respostas do agente.', key: 'agentPrompt' as const, rows: 6, sugestao: null },
              { label: 'Limitações e restrições', sub: 'O que o agente nunca deve fazer, mesmo se o cliente pedir.', key: 'limitacoes' as const, rows: 3, sugestao: (seg: string) => presetPorSegmento(seg).limitacoes },
            ].map(f => (
              <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{f.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{f.sub}</span>
                  </div>
                  {f.sugestao && (
                    <button onClick={() => dispatch({ type: 'SET', key: f.key, value: f.sugestao!(org.segmento) })} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}>
                      Usar sugestão do meu segmento
                    </button>
                  )}
                </div>
                <textarea value={state[f.key] as string} onChange={e => dispatch({ type: 'SET', key: f.key, value: e.target.value })} rows={f.rows} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)', resize: 'vertical' }} />
              </div>
            ))}

            {/* Regra de catálogo? Não: é regra do agente. Ela mora junto da
                instrução e das limitações porque responde o que a IA faz em
                dúvida — o dicionário, que é vocabulário, ficou em Produtos. */}
            <RegrasDoCatalogo />

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 2 }} />

            {/* Objetivo do atendimento + perguntas por objetivo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Objetivo do atendimento</span>
                <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>O que o agente tenta concretizar. Ative um ou mais e, para cada um, defina as perguntas que ele coleta e a mensagem de fechamento.</span>
              </div>
              {SUCESSO_TIPOS.map(t => {
                const s = state.sucessos[t.key];
                const perguntasObj = state.perguntas.map((p, i) => ({ p, i })).filter(x => x.p.objetivo === t.key);
                return (
                  <div key={t.key} style={{ border: `1px solid ${s.ativo ? 'var(--primary)' : 'var(--border)'}`, background: s.ativo ? 'var(--primary-soft)' : 'var(--surface)', borderRadius: 'var(--r-ctrl)', padding: 13, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                      <span style={{ fontSize: 19 }}>{t.emoji}</span>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700 }}>{t.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{t.sub}</span>
                      </div>
                      <Toggle on={s.ativo} onClick={() => dispatch({ type: 'UPD_SUCESSO', tipo: t.key, k: 'ativo', v: !s.ativo })} />
                    </div>
                    {s.ativo && (
                      <>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Perguntas para este objetivo</label>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                            {perguntasObj.length === 0 && <span style={{ fontSize: 12, color: 'var(--text3)' }}>Nenhuma pergunta ainda.</span>}
                            {perguntasObj.map(({ p, i }) => (
                              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 9px' }}>
                                <input value={p.pergunta} onChange={e => dispatch({ type: 'UPD_PREGUNTA', i, k: 'pergunta', v: e.target.value })} placeholder="O que perguntar" style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: 'var(--text)', fontWeight: 600, minWidth: 0 }} />
                                <button onClick={() => dispatch({ type: 'UPD_PREGUNTA', i, k: 'obrigatoria', v: !p.obrigatoria })} style={{ flexShrink: 0, border: 'none', cursor: 'pointer', background: p.obrigatoria ? 'var(--red-b)' : 'var(--gray-b)', color: p.obrigatoria ? 'var(--red-t)' : 'var(--text3)', borderRadius: 'var(--r-pill)', padding: '5px 11px', fontSize: 11, fontWeight: 600 }}>{p.obrigatoria ? 'Obrigatória' : 'Opcional'}</button>
                                <button onClick={() => { dispatch({ type: 'DEL_PERGUNTA', i }); showToast('Pergunta removida', { label: 'Desfazer', run: () => dispatch({ type: 'RESTORE_PERGUNTA', i, value: p }) }); }} style={{ flexShrink: 0, background: 'none', border: 'none', color: 'var(--red-t)', cursor: 'pointer', display: 'flex', padding: 2 }}>
                                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                          <button onClick={() => dispatch({ type: 'ADD_PERGUNTA', objetivo: t.key })} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--primary-t)', borderRadius: 'var(--r-ctrl)', padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} className="hs">
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                            Adicionar pergunta
                          </button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mensagem de fechamento</label>
                          <textarea value={s.mensagem} onChange={e => dispatch({ type: 'UPD_SUCESSO', tipo: t.key, k: 'mensagem', v: e.target.value })} rows={2} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13, lineHeight: 1.5, color: 'var(--text)', resize: 'vertical' }} />
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ borderTop: '1px solid var(--border)', marginTop: 2 }} />

            {/* Quando passar para uma pessoa (antiga aba Regras) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Quando passar para uma pessoa</span>
                <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>Situações em que o agente age de um jeito específico: <strong>chamar um atendente</strong> ou <strong>responder com uma mensagem pronta</strong>. Cada regra tem sua própria ação.</span>
              </div>

              {SUGESTOES_REGRAS.some(s => !state.gatilhos.some(g => g.gatilho === s.gatilho)) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)', fontWeight: 600 }}>Sugestões:</span>
                  {SUGESTOES_REGRAS.filter(s => !state.gatilhos.some(g => g.gatilho === s.gatilho)).map(s => (
                    <button key={s.label} onClick={() => addRegraSugerida(s)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--primary-soft)', color: 'var(--primary-t)', border: '1px solid transparent', borderRadius: 'var(--r-pill)', padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                      {s.label}
                    </button>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {state.gatilhos.length === 0 && (
                  <span style={{ fontSize: 12.5, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 13px', lineHeight: 1.5 }}>Nenhuma regra ainda. Use uma sugestão acima ou crie a sua para o agente reagir a situações específicas.</span>
                )}
                {state.gatilhos.map((g, i) => {
                  const aberta = regrasAbertas.has(i);
                  const respostaMode = g.acao === 'responder';
                  return (
                    <div key={i} style={{ border: `1px solid ${g.ativo ? 'var(--green-t)' : 'var(--border)'}`, borderRadius: 'var(--r-ctrl)', background: g.ativo ? 'var(--green-b)' : 'var(--surface2)', overflow: 'hidden' }}>
                      {/* Cabeçalho recolhível */}
                      <div onClick={() => toggleRegraAberta(i)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', cursor: 'pointer' }}>
                        <svg style={{ color: 'var(--text3)', transform: aberta ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: g.ativo ? 'var(--text)' : 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{g.gatilho || 'Nova regra'}</span>
                        <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 9px', background: respostaMode ? 'var(--blue-b)' : 'var(--surface)', color: respostaMode ? 'var(--blue-t)' : 'var(--text2)', border: respostaMode ? 'none' : '1px solid var(--border)' }}>{respostaMode ? 'Responder' : 'Chamar atendente'}</span>
                        <div onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <Toggle on={g.ativo} onClick={() => dispatch({ type: 'UPD_GATILHO', i, k: 'ativo', v: !g.ativo })} />
                          <button onClick={() => { dispatch({ type: 'DEL_GATILHO', i }); showToast('Regra removida', { label: 'Desfazer', run: () => dispatch({ type: 'RESTORE_GATILHO', i, value: g }) }); }} title="Remover regra" style={{ background: 'none', border: 'none', color: 'var(--red-t)', cursor: 'pointer', display: 'flex', padding: 2 }}>
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          </button>
                        </div>
                      </div>
                      {/* Corpo expandido */}
                      {aberta && (
                        <div style={{ padding: '2px 13px 13px', display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingTop: 11 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Quando…</label>
                            <input value={g.gatilho} onChange={e => dispatch({ type: 'UPD_GATILHO', i, k: 'gatilho', v: e.target.value })} placeholder="ex.: o cliente usar palavrões" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 12.5, color: 'var(--text)' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>O agente deve</label>
                            <div style={{ display: 'inline-flex', gap: 2, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 2, width: 'fit-content' }}>
                              {([['transferir', 'Chamar atendente'], ['responder', 'Responder mensagem']] as const).map(([a, label]) => {
                                const sel = g.acao === a;
                                return (
                                  <button key={a} onClick={() => dispatch({ type: 'UPD_GATILHO', i, k: 'acao', v: a })} style={{ border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 'var(--r-pill)', background: sel ? 'var(--surface)' : 'transparent', color: sel ? 'var(--text)' : 'var(--text3)', boxShadow: sel ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{label}</button>
                                );
                              })}
                            </div>
                          </div>
                          {respostaMode && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Mensagem que o agente envia</label>
                              <textarea value={g.mensagem} onChange={e => dispatch({ type: 'UPD_GATILHO', i, k: 'mensagem', v: e.target.value })} rows={2} placeholder="O que o agente deve responder nessa situação…" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 12.5, lineHeight: 1.5, color: 'var(--text2)', resize: 'vertical' }} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <button onClick={() => { dispatch({ type: 'ADD_GATILHO' }); setRegrasAbertas(prev => new Set(prev).add(state.gatilhos.length)); }} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--primary-t)', borderRadius: 'var(--r-ctrl)', padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} className="hs">
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Adicionar regra
                </button>
              </div>
            </div>
          </div>
        </TabPanel>
        )}

        {/* Produtos: a lista que o agente consulta. Aba própria desde 15/09 —
            ela é a maior coisa da tela e estava enterrando o resto da Empresa. */}
        {state.agenteTab === 'produtos' && (
        <TabPanel>
          <SecaoProdutos />
        </TabPanel>
        )}

        {/* Empresa: o que o agente sabe sobre o negócio */}
        {state.agenteTab === 'empresa' && (
        <TabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Identidade do negócio */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Nome fantasia</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>É este nome que o agente usa ao falar com o cliente. A razão social fica em Configurações → Dados do negócio e só aparece na cobrança.</span>
                </div>
                <input value={state.cl.fantasia} onChange={e => dispatch({ type: 'SET', key: 'cl', value: { ...state.cl, fantasia: e.target.value } })} placeholder="Como o cliente conhece o seu negócio" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13.5, fontWeight: 600, color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Descrição do negócio</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>O que vocês fazem e, principalmente, <strong>o que te diferencia</strong> da concorrência — é isso que o agente usa para defender seu preço e convencer o cliente.</span>
                </div>
                <textarea value={state.cl.descricao} onChange={e => dispatch({ type: 'SET', key: 'cl', value: { ...state.cl, descricao: e.target.value } })} rows={4} placeholder="Ex.: Clínica odontológica no centro há 12 anos. Diferenciais: atendimento no mesmo dia para urgências, aparelho invisível com pagamento em até 18x, estacionamento próprio e dentista especialista em pacientes com medo de dentista." style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', fontSize: 13, lineHeight: 1.55, color: 'var(--text)', resize: 'vertical' }} />
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)' }} />

            {/* Horários de funcionamento */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Horários de funcionamento</span>
                </div>
                <button onClick={abrirHorarios} style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}>Editar</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '0 24px' }}>
                {state.horarioEdit.map((h, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>{h.dia}</span>
                    <span className="mono" style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', color: h.cor }}>{h.hora}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Clínica: convênios e valor da consulta (S8). */}
            {ehSaude(org.segmento) && <ConveniosEValores />}

            {/* Localização */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Localização</span>
              </div>
              <textarea value={state.cl.endereco} onChange={e => dispatch({ type: 'SET', key: 'cl', value: { ...state.cl, endereco: e.target.value } })} rows={2} style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13, lineHeight: 1.5, color: 'var(--text2)', resize: 'vertical' }} />
            </div>

            <RegioesDeEntrega />

            {/* Dúvidas frequentes */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Dúvidas frequentes</span>
                </div>
                <button onClick={() => dispatch({ type: 'ADD_FAQ' })} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--primary-t)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                  Adicionar dúvida
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {state.faqs.map((f, i) => {
                  const open = state.openFaq === i;
                  return (
                    <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', overflow: 'hidden' }}>
                      <div onClick={() => dispatch({ type: 'SET', key: 'openFaq', value: open ? null : i })} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px', cursor: 'pointer', background: open ? 'var(--surface2)' : 'transparent' }} className="hs">
                        <svg style={{ color: 'var(--text3)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', flexShrink: 0 }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{f.q}</span>
                      </div>
                      {open && (
                        <div style={{ padding: '4px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Pergunta</label>
                            <input value={f.q} onChange={e => dispatch({ type: 'UPD_FAQ', i, k: 'q', v: e.target.value })} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Resposta</label>
                            <textarea value={f.a} onChange={e => dispatch({ type: 'UPD_FAQ', i, k: 'a', v: e.target.value })} rows={2} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--text2)', resize: 'vertical' }} />
                          </div>
                          <button onClick={() => { dispatch({ type: 'DEL_FAQ', i }); showToast('Dúvida removida', { label: 'Desfazer', run: () => dispatch({ type: 'RESTORE_FAQ', i, value: f }) }); }} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--red-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
                            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                            Remover
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Informações adicionais */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="16" y2="17" /></svg>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Informações adicionais</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>Qualquer coisa que o agente deva saber e que não se encaixe nos campos acima.</span>
              </div>
              <textarea value={state.infoAdicional} onChange={e => dispatch({ type: 'SET', key: 'infoAdicional', value: e.target.value })} rows={4} placeholder="Ex.: políticas de cancelamento, formas de pagamento aceitas, diferenciais do negócio, promoções vigentes…" style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', fontSize: 13, lineHeight: 1.55, color: 'var(--text)', resize: 'vertical' }} />
            </div>
          </div>
        </TabPanel>
        )}
      </div>

      {/* Modal: Horário */}
      {state.horarioModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(420px, calc(100vw - 28px))', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Horário de funcionamento</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {state.horarioEdit.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--text2)', width: 150, flexShrink: 0 }}>{h.dia}</span>
                  <input value={h.hora} onChange={e => dispatch({ type: 'UPD_HORARIO_EDIT', i, v: e.target.value })} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 13px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Vincular à Agenda</span>
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Os horários disponíveis para o agente oferecer seguem a Agenda do seu negócio</span>
              </div>
              <Toggle on={state.horarioVinculaAgenda} onClick={() => dispatch({ type: 'SET', key: 'horarioVinculaAgenda', value: !state.horarioVinculaAgenda })} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={cancelarHorarios} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
              <button onClick={() => dispatch({ type: 'SET', key: 'horarioModalOpen', value: false })} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Pronto</button>
            </div>
          </div>
        </div>
      )}

      {/* Painel: Simulador do agente */}
      {simuladorOpen && (
        <SimuladorPanel
          onClose={() => setSimuladorOpen(false)}
          rascunho={conteudoDaVersao(montarPayload())}
          numero={numeroEmEdicao ? { id: numeroEmEdicao.id, campos: camposDoNumero } : null}
          rotuloDoNumero={numeroEmEdicao?.telefone ?? null}
          avisoDoNumero={numeroEmEdicao && (numeroEmEdicao.roteiro ?? roteiroPadraoDoPapel(numeroEmEdicao.papel)) !== 'atendimento'
            ? 'Neste teste a IA não consulta o sistema da empresa. No WhatsApp ela consulta.'
            : null}
        />
      )}

      {historicoOpen && <HistoricoModal orgId={org.orgId} onCarregar={carregarVersao} onClose={() => setHistoricoOpen(false)} />}

      {/* Modal: modelos por nicho */}
      {nichoOpen && (
        <div onClick={() => setNichoOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 16, animation: 'cm-pop .15s ease' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', width: 'min(680px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-pop)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Modelos por nicho</span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Comece com o comportamento pronto do seu segmento e ajuste depois.</span>
              </div>
              <button onClick={() => setNichoOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ padding: '16px 20px', overflow: 'auto', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              {SEGMENTOS.map(s => (
                <button key={s.key} onClick={() => setNichoConfirm(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px', cursor: 'pointer' }} className="hs">
                  <span style={{ fontSize: 24, flexShrink: 0 }}>{s.emoji}</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{s.label}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.4 }}>{s.descricao}</span>
                  </div>
                </button>
              ))}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
              Aplicar um modelo substitui a <strong>personalidade</strong>, o <strong>questionário</strong>, os <strong>gatilhos</strong> e as <strong>FAQs</strong> na tela. Nada muda no WhatsApp até você salvar.
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de aplicar modelo */}
      {nichoConfirm && (() => {
        const preset = presetPorSegmento(nichoConfirm);
        const nome = state.cl.fantasia;
        const secaoLabel = { fontSize: 11, fontWeight: 600 as const, color: 'var(--text3)', textTransform: 'uppercase' as const, letterSpacing: '0.04em' };
        const bloco = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.55, whiteSpace: 'pre-wrap' as const };
        return (
        <div onClick={() => setNichoConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, padding: 16, animation: 'cm-pop .15s ease' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', width: 'min(560px, 100%)', maxHeight: '90vh', boxShadow: 'var(--sh-pop)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <span style={{ fontSize: 26, flexShrink: 0 }}>{preset.emoji}</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{preset.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Prévia do que este modelo vai preencher</span>
                </div>
              </div>
              <button onClick={() => setNichoConfirm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex', flexShrink: 0 }} className="hs">
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ padding: '16px 20px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>Mensagem de boas-vindas</span>
                <div style={bloco}>{aplicarNomeNegocio(preset.welcomeMsg, nome)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>Instrução principal</span>
                <div style={bloco}>{aplicarNomeNegocio(preset.prompt, nome)}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>Limitações e restrições</span>
                <div style={bloco}>{preset.limitacoes}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>Questionário ({preset.perguntas.length})</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {preset.perguntas.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, ...bloco }}>
                      <span>{p.pergunta}</span>
                      <span style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 8px', background: p.obrigatoria ? 'var(--primary-soft)' : 'var(--surface)', color: p.obrigatoria ? 'var(--primary-t)' : 'var(--text3)', border: p.obrigatoria ? 'none' : '1px solid var(--border)' }}>{p.obrigatoria ? 'Obrigatória' : 'Opcional'}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>Gatilhos de intervenção ({preset.gatilhos.length})</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {preset.gatilhos.map((g, i) => <div key={i} style={bloco}>{g.gatilho}</div>)}
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={secaoLabel}>FAQs de exemplo ({preset.faqsExemplo.length})</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {preset.faqsExemplo.map((f, i) => (
                    <div key={i} style={{ ...bloco, display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{f.q}</span>
                      <span>{f.a}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '12px 20px', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45, flex: 1, minWidth: 180 }}>Substitui personalidade, questionário, gatilhos e FAQs na tela. Só vale depois de salvar.</span>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                <button onClick={() => setNichoConfirm(null)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
                <button onClick={() => aplicarPresetNicho(nichoConfirm)} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Aplicar modelo</button>
              </div>
            </div>
          </div>
        </div>
        );
      })()}
    </section>
  );
}

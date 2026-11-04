'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { iniciais, avatarBg, identificacaoDoContato } from '@/lib/ui-helpers';
import { horaEmSP } from '@/lib/fuso';
import { enviarMensagem, setConversaModo, encerrarConversa, reabrirConversa, iniciarConversa } from '@/lib/data/mutations';
import { createClient } from '@/lib/supabase/client';
import type { Msg } from '@/lib/types';
import type { Tables } from '@/lib/supabase/database.types';
import { ROTULO_PAPEL } from '@/lib/data/numeros-whatsapp';
import { preencherCorpo } from '@/lib/whatsapp/regras-de-template';
import PainelContato from '@/components/contato/painel-contato';

function fmtHoraRelativa(iso: string): string {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'Agora';
  if (diffMin < 60) return `${diffMin} min`;
  return horaEmSP(iso);
}

export default function ConversasSection() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const { conversas, convTab, convSel, msgTab, draft, soExcedidas, novaContato, novaModelo, contatos, templates, labels, fConvLabel, fConvNumero, numeros, fichaConvOpen } = state;
  const isMobile = useIsMobile();
  const [fichaOpen, setFichaOpen] = useState(false);
  const [enviando, setEnviando] = useState(false);
  // Nova conversa: template sai sempre; texto livre só dentro das 24 horas.
  const [modoNova, setModoNova] = useState<'template' | 'texto'>('template');
  const [textoNova, setTextoNova] = useState('');
  const [valoresNova, setValoresNova] = useState<string[]>([]);
  const labelById = new Map(labels.map(l => [l.id, l]));

  const abertas = conversas.filter(c => c.status === 'aberta');
  const encerradas = conversas.filter(c => c.status === 'encerrada');
  const excedidas = abertas.filter(c => c.excedida);

  const listaBase = (convTab === 'abertas'
    ? (soExcedidas ? excedidas : abertas)
    : (convTab === 'encerradas' ? encerradas : []))
    // Quem falou por último aparece em cima. A ordenação é feita aqui, na
    // renderização, e não na consulta: a lista muda em tempo real (mensagem
    // nova chega pelo Realtime), e ordenar no banco deixaria a ordem velha na
    // tela até o próximo recarregamento.
    .toSorted((a, b) => (b.ultimaMsgIso ?? '').localeCompare(a.ultimaMsgIso ?? ''));
  const labelsDoMun = (munId: string) => contatos.find(m => m.id === munId)?.labelIds ?? [];
  const porEtiqueta = fConvLabel === 'Todas' ? listaBase : listaBase.filter(c => labelsDoMun(c.mun).includes(fConvLabel));
  const lista = fConvNumero === 'Todos' ? porEtiqueta
    : porEtiqueta.filter(c => (fConvNumero === 'sem-numero' ? c.waNumberId === null : c.waNumberId === fConvNumero));
  // Com um número só, o filtro é ruído. Conversa antiga não tem número (é
  // anterior à tabela); em vez de sumir sob qualquer número, ganha a própria opção.
  const mostraFiltroNumero = numeros.length > 1;
  const temSemNumero = conversas.some(c => c.waNumberId === null);

  const convAtiva = conversas.find(c => c.id === convSel);
  const munAtivo = convAtiva ? contatos.find(m => m.id === convAtiva.mun) : null;

  // O painel de detalhes é o mesmo componente de Contatos e lê `contatoBuffer`.
  // Aqui o contato vem da conversa aberta, então o buffer precisa acompanhá-la.
  const munAtivoId = munAtivo?.id;
  useEffect(() => {
    if (munAtivoId) dispatch({ type: 'OPEN_CONTATO', id: munAtivoId });
  }, [munAtivoId, dispatch]);
  // Sair de Conversas não deve deixar a ficha de um contato aberta em Contatos.
  useEffect(() => () => { dispatch({ type: 'FECHAR_CONTATO' }); }, [dispatch]);

  const aprovados = templates.filter(t => t.status === 'APPROVED' && !t.oculto);
  const tplNova = aprovados.find(t => t.id === novaModelo) ?? aprovados[0];
  const valoresDoTpl = (tplNova?.variaveis ?? []).map((_, i) => valoresNova[i] ?? '');
  const novaPreview = modoNova === 'texto'
    ? textoNova.trim()
    : (tplNova ? preencherCorpo(tplNova.corpo, valoresDoTpl) : '');
  const novaPronta = modoNova === 'texto' ? !!textoNova.trim() : !!tplNova && valoresDoTpl.every(v => v.trim());

  const agentesDataRef = useRef(state.agentesData);
  useEffect(() => {
    agentesDataRef.current = state.agentesData;
  }, [state.agentesData]);

  useEffect(() => {
    const supabase = createClient();
    const nomeMembroPorId = (id: string | null) => id ? (agentesDataRef.current.find(a => a.id === id)?.nome ?? '—') : '—';

    const channel = supabase.channel(`conversas-${org.orgId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `organization_id=eq.${org.orgId}`,
      }, payload => {
        const row = payload.new as Tables<'messages'>;
        const msg: Msg = {
          id: row.id,
          from: row.autor,
          text: row.texto,
          time: row.autor === 'sys' ? undefined : fmtHoraRelativa(row.created_at),
          read: row.read,
          camp: row.camp || undefined,
          tipo: row.tipo,
        };
        dispatch({ type: 'RT_MSG_INSERIDA', conversationId: row.conversation_id, msg });
      })
      // Foto e áudio chegam com texto provisório e são reescritos segundos
      // depois, quando a descrição ou a transcrição fica pronta.
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages', filter: `organization_id=eq.${org.orgId}`,
      }, payload => {
        const row = payload.new as Tables<'messages'>;
        dispatch({ type: 'RT_MSG_ATUALIZADA', conversationId: row.conversation_id, id: row.id, text: row.texto, tipo: row.tipo });
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'conversations', filter: `organization_id=eq.${org.orgId}`,
      }, payload => {
        const row = payload.new as Tables<'conversations'>;
        dispatch({
          type: 'RT_CONVERSA_UPSERT',
          conversa: {
            id: row.id, mun: row.contact_id, assunto: row.assunto, hora: 'Agora',
            ultimaMsgIso: new Date().toISOString(),
            unread: 0, excedida: false, status: row.status, modo: row.modo,
            atendente: nomeMembroPorId(row.atendente_id), tags: [], labelIds: [], msgs: [],
            waNumberId: row.wa_number_id,
          },
        });
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conversations', filter: `organization_id=eq.${org.orgId}`,
      }, payload => {
        const row = payload.new as Tables<'conversations'>;
        dispatch({
          type: 'RT_CONVERSA_ATUALIZADA', id: row.id, modo: row.modo, status: row.status,
          atendente: nomeMembroPorId(row.atendente_id),
        });
      })
      .subscribe(status => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Realtime Conversas:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.orgId]);

  async function handleEnviar() {
    const txt = draft.trim();
    if (!txt || !convAtiva || enviando) return;
    setEnviando(true);
    try {
      const nota = msgTab === 'notas';
      const { id } = await enviarMensagem(org.orgId, convAtiva.id, txt, nota ? 'nota' : 'humano',
        !nota && convAtiva.modo === 'ia' ? org.memberId : null);
      dispatch({ type: 'SEND_MSG', atendenteNome: org.memberName, id });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao enviar — tente novamente');
    } finally {
      setEnviando(false);
    }
  }

  async function handleToggleModo(modo: 'ia' | 'humano') {
    if (!convAtiva || convAtiva.modo === modo) return;
    const label = modo === 'ia' ? 'Modo de resposta travado em Atendente IA' : `Modo de resposta travado em Atendente humano (${org.memberName})`;
    try {
      await setConversaModo(org.orgId, convAtiva.id, modo, modo === 'humano' ? org.memberId : null, label);
      dispatch({ type: 'TOGGLE_CONV_MODO', id: convAtiva.id, modo, atendenteNome: org.memberName });
    } catch {
      showToast('Erro ao trocar o modo — tente novamente');
    }
  }

  async function handleEncerrar() {
    if (!convAtiva) return;
    try {
      await encerrarConversa(org.orgId, convAtiva.id);
      dispatch({ type: 'ENCERRAR_CONV' });
      showToast('Conversa encerrada');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao encerrar — tente novamente');
    }
  }

  async function handleReabrir() {
    if (!convAtiva) return;
    const id = convAtiva.id;
    try {
      await reabrirConversa(org.orgId, id);
      dispatch({ type: 'REABRIR_CONV', id });
      showToast('Conversa reaberta');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao reabrir — tente novamente');
    }
  }

  async function handleIniciarConversa() {
    const mun = contatos.find(m => m.nome === novaContato);
    if (!mun) { showToast('Selecione um contato'); return; }
    const jaAberta = conversas.find(c => c.mun === mun.id && c.status === 'aberta');
    if (jaAberta) {
      dispatch({ type: 'SET', key: 'convTab', value: 'abertas' });
      dispatch({ type: 'SET_CONV_SEL', id: jaAberta.id });
      return;
    }
    if (enviando) return;
    setEnviando(true);
    try {
      const assunto = modoNova === 'texto' ? 'Envio ativo' : `Envio ativo — ${tplNova?.nome ?? ''}`;
      const id = await iniciarConversa(mun.id, modoNova === 'texto'
        ? { assunto, texto: novaPreview }
        : { templateId: tplNova?.id ?? '', valores: valoresDoTpl });
      dispatch({ type: 'ADD_CONVERSA', conversa: {
        id, mun: mun.id, assunto, hora: 'Agora', ultimaMsgIso: new Date().toISOString(), unread: 0, excedida: false,
        status: 'aberta', modo: 'ia', atendente: '—', tags: ['Envio ativo'], labelIds: [], waNumberId: null,
        msgs: [{ from: 'ia', text: novaPreview, time: 'Agora', read: true, camp: true }],
      } });
      showToast('Conversa iniciada');
      setTextoNova('');
      setValoresNova([]);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao iniciar conversa — tente novamente');
    } finally {
      setEnviando(false);
    }
  }

  function tabStyle(t: string) {
    const active = convTab === t;
    return { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 10px', color: active ? 'var(--primary)' : 'var(--text3)', borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 };
  }

  function msgTabStyle(t: string) {
    const active = msgTab === t;
    return { background: active ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 'var(--r-pill)', color: active ? 'var(--primary)' : 'var(--text3)' };
  }

  function renderMsg(m: Msg, i: number) {
    if (m.from === 'sys') {
      return (
        <div key={i} style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
          <span style={{ background: 'var(--chip)', color: 'var(--text2)', fontSize: 11.5, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '4px 13px', textAlign: 'center', overflowWrap: 'anywhere' }}>{m.text}</span>
        </div>
      );
    }
    const out = m.from === 'cliente';
    const nota = m.from === 'nota';
    const bg = nota ? 'var(--note-b)' : out ? 'var(--wa-out)' : 'var(--wa-in)';
    const autor = m.from === 'ia' ? 'Agente IA' : m.from === 'humano' ? convAtiva?.atendente : m.from === 'nota' ? 'Nota interna' : null;
    return (
      <div key={i} style={{ display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' }}>
        <div style={{ maxWidth: isMobile ? '84%' : '62%', background: bg, color: 'var(--wa-text)', borderRadius: 10, padding: '7px 10px 6px', boxShadow: '0 1px 1px rgba(0,0,0,.07)', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {autor && <span style={{ fontSize: 11.5, fontWeight: 700, color: nota ? '#b45309' : out ? 'var(--text3)' : 'var(--primary)' }}>{autor}</span>}
          {(m.tipo === 'imagem' || m.tipo === 'audio') && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>
              {m.tipo === 'imagem' ? (
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" /><circle cx="12" cy="13" r="3" /></svg>
              ) : (
                <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
              )}
              {m.tipo === 'imagem' ? 'Foto · descrição automática' : 'Áudio · transcrição automática'}
            </span>
          )}
          {/* Link longo não tem espaço para quebrar: sem `anywhere` ele estourava o
              balão, alargava a coluna e cortava as outras mensagens na esquerda. */}
          <span style={{ fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{m.text}</span>
          {m.time && <span style={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end', fontSize: 10.5, color: 'var(--wa-meta)' }}>{m.time}</span>}
        </div>
      </div>
    );
  }

  // No celular as colunas viram uma pilha navegável: lista → chat (com voltar) → ficha (painel sobreposto).
  const mostraLista = !isMobile || !convAtiva;

  return (
    <section style={{ flex: 1, display: 'flex', minHeight: 0, height: '100%' }}>
      {/* Col 1: lista */}
      {mostraLista && (
      <div style={{ width: isMobile ? '100%' : 312, flexShrink: 0, background: 'var(--surface)', borderRight: isMobile ? 'none' : '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.3px' }}>Conversas</h1>
          <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
            <button onClick={() => dispatch({ type: 'SET', key: 'convTab', value: 'abertas' })} style={tabStyle('abertas')}>Abertas</button>
            <button onClick={() => dispatch({ type: 'SET', key: 'convTab', value: 'encerradas' })} style={tabStyle('encerradas')}>Encerradas</button>
            <button onClick={() => dispatch({ type: 'SET', key: 'convTab', value: 'nova' })} style={tabStyle('nova')}>Nova conversa</button>
          </div>
          {convTab !== 'nova' && labels.length > 0 && (
            <select value={fConvLabel} onChange={e => dispatch({ type: 'SET', key: 'fConvLabel', value: e.target.value })}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 12.5, color: 'var(--text2)', cursor: 'pointer', width: '100%' }}>
              <option value="Todas">Todas as etiquetas</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          )}
          {convTab !== 'nova' && mostraFiltroNumero && (
            <select value={fConvNumero} onChange={e => dispatch({ type: 'SET', key: 'fConvNumero', value: e.target.value })}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 12.5, color: 'var(--text2)', cursor: 'pointer', width: '100%' }}>
              <option value="Todos">Todos os números</option>
              {numeros.map(n => <option key={n.id} value={n.id}>{n.telefone ?? 'Sem telefone'} · {ROTULO_PAPEL[n.papel]}</option>)}
              {temSemNumero && <option value="sem-numero">Sem número</option>}
            </select>
          )}
        </div>

        {convTab === 'abertas' && excedidas.length > 0 && (
          <div onClick={() => dispatch({ type: 'SET', key: 'soExcedidas', value: !soExcedidas })}
            style={{ margin: '10px 12px 0', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--amber-b)', color: 'var(--amber-t)', border: `1px solid ${soExcedidas ? 'var(--amber-t)' : 'transparent'}`, borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></svg>
            <span style={{ flex: 1 }}>{soExcedidas ? 'Mostrar todas as conversas' : `${excedidas.length} conversa(s) com tempo excedido`}</span>
          </div>
        )}

        {convTab === 'nova' && (
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {contatos.length === 0 ? (
              <span style={{ fontSize: 12.5, color: 'var(--text3)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', lineHeight: 1.5 }}>
                Você ainda não tem contatos. Adicione um na tela Contatos para iniciar uma conversa.
              </span>
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Contato</label>
                  <select value={novaContato} onChange={e => dispatch({ type: 'SET', key: 'novaContato', value: e.target.value })} style={{ ...{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13, color: 'var(--text)' }, cursor: 'pointer' }}>
                    <option value="">Selecione…</option>
                    {contatos.map(m => <option key={m.id}>{m.nome}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  {(['template', 'texto'] as const).map(m => (
                    <button key={m} onClick={() => setModoNova(m)} style={{ flex: 1, background: modoNova === m ? 'var(--primary-soft)' : 'var(--surface)', border: `1px solid ${modoNova === m ? 'var(--primary)' : 'var(--border)'}`, color: modoNova === m ? 'var(--primary-t)' : 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                      {m === 'template' ? 'Template' : 'Texto livre'}
                    </button>
                  ))}
                </div>
                {modoNova === 'template' ? (
                  aprovados.length === 0 ? (
                    <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>Nenhum template aprovado. Crie em Configurações, Templates.</span>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Template</label>
                        <select value={tplNova?.id ?? ''} onChange={e => { dispatch({ type: 'SET', key: 'novaModelo', value: e.target.value }); setValoresNova([]); }} style={{ ...{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13, color: 'var(--text)' }, cursor: 'pointer' }}>
                          {aprovados.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                        </select>
                      </div>
                      {valoresDoTpl.map((v, i) => (
                        <input key={i} value={v} onChange={e => { const novos = [...valoresDoTpl]; novos[i] = e.target.value; setValoresNova(novos); }}
                          placeholder={`{{${i + 1}}}${tplNova?.variaveis[i]?.exemplo ? ` ex.: ${tplNova.variaveis[i].exemplo}` : ''}`} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13, color: 'var(--text)' }} />
                      ))}
                    </>
                  )
                ) : (
                  <>
                    <textarea value={textoNova} onChange={e => setTextoNova(e.target.value)} rows={3} placeholder="Mensagem" style={{ ...{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13, color: 'var(--text)' }, resize: 'vertical' }} />
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>Só sai se o contato escreveu nas últimas 24 horas.</span>
                  </>
                )}
                {novaPreview && modoNova === 'template' && <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{novaPreview}</div>}
                <button onClick={handleIniciarConversa} disabled={enviando || !novaPronta} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '10px 14px', fontSize: 13.5, fontWeight: 700, cursor: enviando ? 'wait' : 'pointer', opacity: enviando || !novaPronta ? 0.6 : 1 }} className="hp">{enviando ? 'Enviando…' : 'Iniciar conversa'}</button>
              </>
            )}
          </div>
        )}

        {convTab !== 'nova' && (
          <div style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {lista.length === 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '36px 18px', textAlign: 'center' }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text2)' }}>
                  {convTab === 'abertas' ? 'Nenhuma conversa aberta' : 'Nenhuma conversa encerrada'}
                </span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                  {convTab === 'abertas'
                    ? 'Quando seus clientes mandarem mensagem no WhatsApp, as conversas aparecem aqui. Você também pode iniciar uma em "Nova conversa".'
                    : 'Conversas finalizadas ficam guardadas aqui.'}
                </span>
              </div>
            )}
            {lista.map(c => {
              const mun = contatos.find(m => m.id === c.mun);
              if (!mun) return null;
              const lastMsg = c.msgs.filter(m => m.from !== 'sys').slice(-1)[0];
              const active = convSel === c.id;
              return (
                <div key={c.id} onClick={() => dispatch({ type: 'SET_CONV_SEL', id: c.id })}
                  style={{ display: 'flex', gap: 10, padding: 10, borderRadius: 'var(--r-ctrl)', cursor: 'pointer', background: active ? 'var(--primary-soft)' : 'transparent' }} className="hs">
                  <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarBg(mun.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>{iniciais(mun.nome)}</div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{mun.nome}</span>
                      <span className="mono" style={{ fontSize: 11, color: 'var(--text3)', flexShrink: 0 }}>{c.hora}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>{lastMsg?.text.slice(0, 50)}…</span>
                      {c.excedida && <svg style={{ color: 'var(--amber-t)', flexShrink: 0 }} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>}
                      {c.unread > 0 && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />}
                    </div>
                    {labelsDoMun(c.mun).length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 1 }}>
                        {labelsDoMun(c.mun).map(id => labelById.get(id)).filter(Boolean).map(l => (
                          <span key={l!.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '0 7px 0 5px' }}>
                            <span style={{ width: 6, height: 6, borderRadius: '50%', background: l!.cor, flexShrink: 0 }} />
                            {l!.nome}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}

      {/* Col 2: placeholder quando nada selecionado */}
      {!convAtiva && !isMobile && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--wa-bg)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, maxWidth: 320, textAlign: 'center', padding: 20 }}>
            <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="var(--text3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text2)' }}>Selecione uma conversa</span>
            <span style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>Escolha uma conversa na lista ao lado para ver as mensagens e responder.</span>
          </div>
        </div>
      )}

      {/* Col 2+3: chat */}
      {convAtiva && munAtivo && (
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
            {/* header */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: isMobile ? 8 : 12, padding: isMobile ? '10px 12px' : '12px 18px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              {isMobile && (
                <button onClick={() => dispatch({ type: 'SET', key: 'convSel', value: null })}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text2)', display: 'flex', padding: 4, borderRadius: 6, flexShrink: 0 }} className="hs" title="Voltar para a lista">
                  <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
                </button>
              )}
              <div onClick={isMobile ? () => setFichaOpen(true) : undefined} style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1, cursor: isMobile ? 'pointer' : 'default' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarBg(munAtivo.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>{iniciais(munAtivo.nome)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{munAtivo.nome}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{identificacaoDoContato(munAtivo)} · {convAtiva.assunto}</span>
                </div>
              </div>
              <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 11px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: convAtiva.modo === 'ia' ? 'var(--blue-b)' : 'var(--green-b)', color: convAtiva.modo === 'ia' ? 'var(--blue-t)' : 'var(--green-t)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: convAtiva.modo === 'ia' ? 'var(--blue-t)' : 'var(--green-t)' }} />
                {convAtiva.modo === 'ia' ? 'Modo IA' : `Atendente`}
              </span>
              {!isMobile && (
                <button onClick={() => dispatch({ type: 'SET', key: 'fichaConvOpen', value: !fichaConvOpen })}
                  title={fichaConvOpen ? 'Ocultar detalhes do cliente' : 'Ver detalhes do cliente'}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 34, height: 34, borderRadius: 'var(--r-ctrl)', cursor: 'pointer', flexShrink: 0, background: fichaConvOpen ? 'var(--primary-soft)' : 'var(--surface)', border: `1px solid ${fichaConvOpen ? 'transparent' : 'var(--border)'}`, color: fichaConvOpen ? 'var(--primary-t)' : 'var(--text2)' }} className="hs">
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" /></svg>
                </button>
              )}
              {convAtiva.status === 'aberta' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 2 }}>
                  {(['ia', 'humano'] as const).map(m => (
                    <button key={m} onClick={() => handleToggleModo(m)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '5px 11px', borderRadius: 'var(--r-pill)', background: convAtiva.modo === m ? 'var(--surface)' : 'transparent', color: convAtiva.modo === m ? 'var(--text)' : 'var(--text3)' }}>
                      {m === 'ia' ? <><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></svg>IA</> : <><svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="7" r="4" /><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /></svg>Atendente</>}
                    </button>
                  ))}
                </div>
              )}
              {convAtiva.status === 'aberta' && (
                <button onClick={handleEncerrar} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hs">Encerrar</button>
              )}
              {convAtiva.status === 'encerrada' && (
                <button onClick={handleReabrir} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
                  Reabrir
                </button>
              )}
            </div>

            {/* messages */}
            <div style={{ flex: 1, overflow: 'auto', background: 'var(--wa-bg)', padding: isMobile ? '14px 12px' : '20px 26px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {convAtiva.msgs.map((m, i) => renderMsg(m, i))}
            </div>

            {/* composer */}
            <div style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)', padding: '8px 16px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {([['mensagem', 'Mensagem'], ['notas', 'Anotações internas'], ['ia', 'Respostas prontas']] as [string, string][]).map(([t, label]) => (
                  <button key={t} onClick={() => dispatch({ type: 'SET', key: 'msgTab', value: t as 'mensagem' | 'notas' | 'ia' })} style={msgTabStyle(t)}>{label}</button>
                ))}
              </div>
              {msgTab === 'ia' && (() => {
                const lastClientMsg = [...(convAtiva?.msgs ?? [])].reverse().find(m => m.from === 'cliente')?.text.toLowerCase() ?? '';
                // Sugestões a partir das FAQs cadastradas pela organização
                const relacionadas = state.faqs.filter(f => {
                  const palavras = f.q.toLowerCase().split(/\W+/).filter(w => w.length > 3);
                  return palavras.some(w => lastClientMsg.includes(w));
                }).slice(0, 3);
                const sugs = relacionadas.length > 0
                  ? relacionadas.map(f => f.a)
                  : state.faqs.slice(0, 3).map(f => f.a);
                const respostas = state.respostasProntas;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {respostas.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Respostas prontas</span>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {respostas.map(r => (
                            <button key={r.id} title={r.texto} onClick={() => dispatch({ type: 'SET', key: 'draft', value: r.texto })} style={{ background: 'var(--primary-soft)', color: 'var(--primary-t)', border: '1px solid transparent', borderRadius: 'var(--r-pill)', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>{r.titulo}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Sugestões com base no conhecimento do agente</span>
                      {sugs.length === 0 ? (
                        <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Cadastre FAQs na tela Conhecimento para ver sugestões aqui.</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {sugs.map(s => (
                            <button key={s} onClick={() => dispatch({ type: 'SET', key: 'draft', value: s })} style={{ background: 'var(--primary-soft)', color: 'var(--primary-t)', border: '1px solid transparent', borderRadius: 'var(--r-pill)', padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}>{s.length > 80 ? s.slice(0, 77) + '…' : s}</button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: msgTab === 'notas' ? 'var(--note-b)' : 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '6px 8px 6px 12px' }}>
                <input value={draft} onChange={e => dispatch({ type: 'SET', key: 'draft', value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEnviar(); } }}
                  placeholder={msgTab === 'notas' ? 'Anotação interna (não enviada ao cliente)…' : 'Mensagem…'}
                  style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 13.5, color: 'var(--text)', padding: '7px 0' }} />
                <button onClick={handleEnviar} disabled={enviando} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: enviando ? 'wait' : 'pointer', opacity: enviando ? 0.7 : 1, flexShrink: 0 }} className="hp">
                  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>
                </button>
              </div>
            </div>
          </div>

          {/* Col 3: ficha — no celular vira painel sobreposto aberto pelo cabeçalho */}
          {isMobile && fichaOpen && (
            <div onClick={() => setFichaOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', zIndex: 70 }} />
          )}
          {((isMobile && fichaOpen) || (!isMobile && fichaConvOpen)) && (
            <PainelContato
              titulo="Detalhes do cliente"
              contexto="conversas"
              onFechar={() => { if (isMobile) setFichaOpen(false); else dispatch({ type: 'SET', key: 'fichaConvOpen', value: false }); }}
              topo={(
                // Modo é estado da conversa, não do contato — por isso entra
                // como faixa da tela e não dentro do painel compartilhado.
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Modo</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{convAtiva.modo === 'ia' ? 'IA' : convAtiva.atendente}</span>
                </div>
              )}
            />
          )}
        </>
      )}
    </section>
  );
}

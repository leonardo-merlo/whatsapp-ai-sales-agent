'use client';

import { useRef, useState, useEffect } from 'react';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { permissoesDe } from '@/lib/permissoes';
import LembreteConfig from '@/components/agenda/lembrete-config';
import { useIsMobile } from '@/lib/use-is-mobile';
import { salvarAgendamento, cancelarAgendamento, criarDisponibilidade, atualizarDisponibilidade, deletarDisponibilidade, definirOverrideDisponibilidade, listarDisponibilidades, FORA_DE_JANELA, HORARIO_CHEIO } from '@/lib/data/mutations';
import { createClient } from '@/lib/supabase/client';
import type { Disponibilidade } from '@/lib/types';
import type { Tables } from '@/lib/supabase/database.types';
import { useSearchParams, useRouter } from 'next/navigation';
import { fmtDiaISO } from '@/lib/fuso';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Grade da agenda (estilo Google Agenda): linhas = horas, colunas = dias.
const HORA_INICIO = 6;   // primeira linha (06h)
const HORA_FIM = 22;     // última linha exclusiva (mostra até 21h)
const ROW_H = 46;        // altura de cada linha de hora (px)
const HORAS = Array.from({ length: HORA_FIM - HORA_INICIO }, (_, i) => HORA_INICIO + i);

function addDays(d: Date, n: number) { return new Date(d.getTime() + n * 86400000); }
function toISO(d: Date) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function horaParaFloat(h: string): number { const [hh, mm] = h.split(':').map(Number); return hh + (mm || 0) / 60; }
function horaLabel(h: number): string { return String(h).padStart(2, '0') + ':00'; }

// Converte a posição vertical do cursor numa coluna de dia para minutos desde
// HORA_INICIO (com snap). Separado de horaDoEventoY porque o arrasto precisa
// fazer conta com os minutos, e formatar só no fim.
function minutosDoEventoY(clientY: number, el: HTMLElement, snap: number): number {
  const y = clientY - el.getBoundingClientRect().top;
  const maxMin = (HORA_FIM - HORA_INICIO) * 60 - snap;
  return Math.max(0, Math.min(maxMin, Math.round((y / ROW_H) * 60 / snap) * snap));
}

function minutosParaHora(minutos: number): string {
  return String(HORA_INICIO + Math.floor(minutos / 60)).padStart(2, '0') + ':' + String(minutos % 60).padStart(2, '0');
}

// Converte a posição vertical do cursor numa coluna de dia para "HH:MM" (com snap).
function horaDoEventoY(clientY: number, el: HTMLElement, snap: number): string {
  return minutosParaHora(minutosDoEventoY(clientY, el, snap));
}

const SNAP_CRIAR = 15;   // granularidade do arrasto (min)
const DUR_MIN_ARRASTO = 15; // menor compromisso que o arrasto consegue criar

export default function AgendaSection() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  const { agendaWeekOffset, agendaItens, disponibilidades, agendaModalSel, agendaModalBuffer, agendaModalConfirm } = state;
  const [salvando, setSalvando] = useState(false);
  const dragIdxRef = useRef<number | null>(null);
  const [dragOver, setDragOver] = useState<{ iso: string; hora: string } | null>(null);
  // Arrasto para criar (estilo Google Agenda): ancora no minuto do mousedown e
  // acompanha o cursor. `ancora` fica fixa, `fim` acompanha — arrastar para cima
  // é válido e inverte o intervalo na hora de ler.
  const [criando, setCriando] = useState<{ iso: string; ancora: number; fim: number } | null>(null);
  const criandoRef = useRef<typeof criando>(null);
  useEffect(() => { criandoRef.current = criando; }, [criando]);
  const colunaRef = useRef<HTMLElement | null>(null);

  // Enquanto arrasta, o cursor pode sair da coluna (ou da grade). Por isso o
  // mousemove/mouseup escutam o documento e medem contra a coluna do mousedown,
  // e não contra o elemento sob o cursor.
  const arrastandoParaCriar = criando !== null;
  useEffect(() => {
    if (!arrastandoParaCriar) return;
    function mover(e: MouseEvent) {
      const el = colunaRef.current;
      if (!el) return;
      const m = minutosDoEventoY(e.clientY, el, SNAP_CRIAR);
      setCriando(c => (c && c.fim !== m) ? { ...c, fim: m } : c);
    }
    function soltar() {
      const c = criandoRef.current;
      setCriando(null);
      colunaRef.current = null;
      if (!c) return;
      const inicio = Math.min(c.ancora, c.fim);
      const fim = Math.max(c.ancora, c.fim);
      const duracao = fim - inicio;
      // Clique seco (sem arrastar o bastante) cria com a duração da janela,
      // que é a regra do negócio; arrastar é que define duração na mão.
      dispatch({
        type: 'ABRIR_AGENDA_MODAL', idx: 'new', iso: c.iso,
        hora: minutosParaHora(inicio),
        duracaoMin: duracao >= DUR_MIN_ARRASTO ? duracao : null,
      });
    }
    document.addEventListener('mousemove', mover);
    document.addEventListener('mouseup', soltar);
    return () => {
      document.removeEventListener('mousemove', mover);
      document.removeEventListener('mouseup', soltar);
    };
  }, [arrastandoParaCriar, dispatch]);

  const atendenteOpts = ['Todos', ...state.agentesData.map(a => a.nome)];
  const nomePorId = (id: string | null) => id ? (state.agentesData.find(a => a.id === id)?.nome ?? 'Todos') : 'Todos';
  const idPorNome = (nome: string) => nome === 'Todos' ? null : (state.agentesData.find(a => a.nome === nome)?.id ?? null);

  // Realtime: agendamentos criados/alterados em qualquer lugar (inclusive pela IA)
  // aparecem na agenda sem precisar recarregar.
  const agentesRef = useRef(state.agentesData);
  useEffect(() => { agentesRef.current = state.agentesData; }, [state.agentesData]);
  useEffect(() => {
    const supabase = createClient();
    const nomeRT = (id: string | null) => id ? (agentesRef.current.find(a => a.id === id)?.nome ?? 'Todos') : 'Todos';
    const paraItem = (row: Tables<'appointments'>) => ({
      id: row.id, data: row.data, hora: row.hora, cliente: row.paciente_nome, servico: row.servico, atendente: nomeRT(row.atendente_id), duracaoMin: row.duracao_min,
    });
    const channel = supabase.channel(`agenda-${org.orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments', filter: `organization_id=eq.${org.orgId}` }, payload => {
        dispatch({ type: 'RT_AGENDA_UPSERT', item: paraItem(payload.new as Tables<'appointments'>) });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'appointments'>;
        if (row.status === 'cancelado') dispatch({ type: 'RT_AGENDA_REMOVIDA', id: row.id });
        else dispatch({ type: 'RT_AGENDA_UPSERT', item: paraItem(row) });
      })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Realtime Agenda:', status); });
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.orgId]);

  // Preseleção: vindo de "Agendar" na ficha de um contato (/agenda?cliente=Nome).
  const searchParams = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const cliente = searchParams.get('cliente');
    if (cliente) {
      dispatch({ type: 'ABRIR_AGENDA_MODAL', idx: 'new', cliente });
      router.replace('/agenda');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  interface DispBuffer { id: string | null; parentId: string | null; ocorrenciaData: string | null; atendenteId: string | null; tipo: 'semanal' | 'data'; diaSemana: number; data: string; horaInicio: string; horaFim: string; escopo: 'serie' | 'dia'; capacidade: number | null; duracaoMin: number | null; }
  const [dispBuffer, setDispBuffer] = useState<DispBuffer | null>(null);

  const hoje = new Date();

  async function recarregarDisp() {
    try { dispatch({ type: 'SET', key: 'disponibilidades', value: await listarDisponibilidades(org.orgId) }); } catch { /* ignora */ }
  }

  function abrirNovaDisp() {
    const iso = toISO(hoje);
    setDispBuffer({ id: null, parentId: null, ocorrenciaData: null, atendenteId: null, tipo: 'semanal', diaSemana: new Date(iso + 'T00:00:00').getDay(), data: iso, horaInicio: '09:00', horaFim: '18:00', escopo: 'serie', capacidade: null, duracaoMin: 60 });
  }

  function abrirEditarDisp(ref: Disponibilidade, override: Disponibilidade | null, iso: string, horaInicio: string, horaFim: string) {
    if (ref.tipo === 'semanal') {
      setDispBuffer({ id: ref.id, parentId: ref.id, ocorrenciaData: iso, atendenteId: (override ?? ref).atendenteId, tipo: 'semanal', diaSemana: ref.diaSemana ?? 0, data: iso, horaInicio, horaFim, escopo: 'serie', capacidade: (override ?? ref).capacidade, duracaoMin: (override ?? ref).duracaoMin });
    } else {
      setDispBuffer({ id: ref.id, parentId: null, ocorrenciaData: null, atendenteId: ref.atendenteId, tipo: 'data', diaSemana: 0, data: ref.data ?? iso, horaInicio: ref.horaInicio, horaFim: ref.horaFim, escopo: 'dia', capacidade: ref.capacidade, duracaoMin: ref.duracaoMin });
    }
  }

  async function salvarDisp() {
    const b = dispBuffer;
    if (!b || salvando) return;
    setSalvando(true);
    try {
      if (b.id === null) {
        await criarDisponibilidade(org.orgId, { atendenteId: b.atendenteId, tipo: b.tipo, diaSemana: b.diaSemana, data: b.data, horaInicio: b.horaInicio, horaFim: b.horaFim, capacidade: b.capacidade, duracaoMin: b.duracaoMin });
      } else if (b.tipo === 'data' && !b.parentId) {
        await atualizarDisponibilidade(b.id, { horaInicio: b.horaInicio, horaFim: b.horaFim, atendenteId: b.atendenteId, capacidade: b.capacidade, duracaoMin: b.duracaoMin });
      } else if (b.escopo === 'serie') {
        await atualizarDisponibilidade(b.id, { horaInicio: b.horaInicio, horaFim: b.horaFim, atendenteId: b.atendenteId, capacidade: b.capacidade, duracaoMin: b.duracaoMin });
      } else {
        await definirOverrideDisponibilidade(org.orgId, b.parentId!, b.ocorrenciaData!, { horaInicio: b.horaInicio, horaFim: b.horaFim, cancelado: false, atendenteId: b.atendenteId, capacidade: b.capacidade, duracaoMin: b.duracaoMin });
      }
      await recarregarDisp();
      setDispBuffer(null);
      showToast('Disponibilidade salva');
    } catch {
      showToast('Erro ao salvar disponibilidade — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  async function removerDisp(escopo: 'serie' | 'dia') {
    const b = dispBuffer;
    if (!b || b.id === null || salvando) return;
    setSalvando(true);
    try {
      if ((b.tipo === 'data' && !b.parentId) || escopo === 'serie') {
        await deletarDisponibilidade(b.id);
      } else {
        await definirOverrideDisponibilidade(org.orgId, b.parentId!, b.ocorrenciaData!, { horaInicio: b.horaInicio, horaFim: b.horaFim, cancelado: true, atendenteId: b.atendenteId, capacidade: b.capacidade, duracaoMin: b.duracaoMin });
      }
      await recarregarDisp();
      setDispBuffer(null);
      showToast('Disponibilidade removida');
    } catch {
      showToast('Erro ao remover — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  // Blocos de disponibilidade efetivos de um dia (aplicando overrides das recorrências).
  function blocosDispDoDia(iso: string, diaSemana: number): { horaInicio: string; horaFim: string; ref: Disponibilidade; override: Disponibilidade | null }[] {
    const out: { horaInicio: string; horaFim: string; ref: Disponibilidade; override: Disponibilidade | null }[] = [];
    for (const o of disponibilidades) {
      if (o.tipo === 'data' && !o.parentId && o.data === iso && !o.cancelado) out.push({ horaInicio: o.horaInicio, horaFim: o.horaFim, ref: o, override: null });
    }
    for (const r of disponibilidades) {
      if (r.tipo !== 'semanal' || r.parentId || r.diaSemana !== diaSemana) continue;
      const ov = disponibilidades.find(x => x.parentId === r.id && x.data === iso);
      if (ov) { if (!ov.cancelado) out.push({ horaInicio: ov.horaInicio, horaFim: ov.horaFim, ref: r, override: ov }); }
      else out.push({ horaInicio: r.horaInicio, horaFim: r.horaFim, ref: r, override: null });
    }
    return out;
  }

  // O drop não remarca direto: abre confirmação com o antes/depois.
  const [reagendarPendente, setReagendarPendente] = useState<{ idx: number; data: string; hora: string } | null>(null);
  // S6: marcado por padrão. O aviso sai pelo template aviso_remarcacao.
  const [avisarCliente, setAvisarCliente] = useState(true);

  function fmtDataCurta(iso: string): string {
    return fmtDiaISO(iso, { weekday: 'short', day: '2-digit', month: '2-digit' });
  }

  function solicitarReagendarDrop(idx: number, data: string, hora: string) {
    const item = agendaItens[idx];
    if (!item || (item.data === data && item.hora === hora)) return;
    setAvisarCliente(true);
    setReagendarPendente({ idx, data, hora });
  }

  async function confirmarReagendarDrop() {
    const p = reagendarPendente;
    if (!p || salvando) return;
    const item = agendaItens[p.idx];
    if (!item) { setReagendarPendente(null); return; }
    const anterior = { data: item.data, hora: item.hora };
    setSalvando(true);
    dispatch({ type: 'MOVER_AGENDAMENTO', idx: p.idx, data: p.data, hora: p.hora });
    try {
      await salvarAgendamento(org.orgId, { ...item, data: p.data, hora: p.hora }, state.agentesData, state.contatos);
      setReagendarPendente(null);
      // O lembrete volta a valer para o horário novo; o aviso só sai marcado.
      const aviso = item.id
        ? await fetch('/api/agenda/remarcada', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appointmentId: item.id, avisar: avisarCliente }),
        }).then(r => r.json() as Promise<{ avisado?: boolean }>).catch(() => ({ avisado: false }))
        : { avisado: false };
      showToast(!avisarCliente ? 'Agendamento remarcado'
        : aviso.avisado ? 'Remarcado e cliente avisado' : 'Remarcado. O aviso não saiu, veja o sino.');
    } catch {
      dispatch({ type: 'MOVER_AGENDAMENTO', idx: p.idx, data: anterior.data, hora: anterior.hora });
      showToast('Erro ao remarcar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  // Aviso "marcar mesmo assim" quando o horário está fora da disponibilidade ou cheio.
  const [avisoForcar, setAvisoForcar] = useState<string | null>(null);

  async function salvarAgend(forcar: boolean) {
    if (!agendaModalBuffer || salvando) return;
    setSalvando(true);
    try {
      const id = await salvarAgendamento(org.orgId, agendaModalBuffer, state.agentesData, state.contatos, forcar);
      setAvisoForcar(null);
      dispatch({ type: 'CONFIRMAR_REAGENDAR', id });
      showToast('Agendamento salvo');
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg === FORA_DE_JANELA) setAvisoForcar('Esse horário está fora da disponibilidade cadastrada.');
      else if (msg === HORARIO_CHEIO) setAvisoForcar('Esse horário já está cheio (conflita com outro agendamento).');
      else showToast('Erro ao salvar agendamento — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  function handleConfirmarSalvar() { salvarAgend(false); }

  async function handleConfirmarCancelar() {
    if (!agendaModalBuffer || salvando) return;
    setSalvando(true);
    try {
      if (agendaModalBuffer.id) await cancelarAgendamento(agendaModalBuffer.id);
      dispatch({ type: 'CONFIRMAR_CANCELAR' });
      showToast('Agendamento cancelado');
    } catch {
      showToast('Erro ao cancelar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }
  const monday = new Date(hoje.getTime() + agendaWeekOffset * 7 * 86400000);
  const weekStart = addDays(monday, -(monday.getDay() === 0 ? 6 : monday.getDay() - 1));

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i);
    const iso = toISO(d);
    return {
      label: DIAS_SEMANA[d.getDay()],
      numero: d.getDate(),
      iso,
      diaSemana: d.getDay(),
      isHoje: iso === toISO(hoje),
      itens: agendaItens.filter(a => a.data === iso),
    };
  });

  const periodoLabel = `${weekStart.getDate()} de ${MESES[weekStart.getMonth()]} — ${addDays(weekStart, 6).getDate()} de ${MESES[addDays(weekStart, 6).getMonth()]}`;

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: isMobile ? '18px 14px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>Agenda</h1>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>Compromissos confirmados pelo agente e pela equipe</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => dispatch({ type: 'SET', key: 'agendaWeekOffset', value: 0 })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hs">Hoje</button>
          <button onClick={() => dispatch({ type: 'SET', key: 'agendaWeekOffset', value: agendaWeekOffset - 1 })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} className="hs">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button onClick={() => dispatch({ type: 'SET', key: 'agendaWeekOffset', value: agendaWeekOffset + 1 })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }} className="hs">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
          </button>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text2)', marginLeft: 4, whiteSpace: 'nowrap' }}>{periodoLabel}</span>
          {/* Lembrete grava em organizations, que só admin escreve. */}
          {permissoesDe(org.memberRole).editarDadosNegocio && <LembreteConfig />}
          <button onClick={abrirNovaDisp} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--green-b)', border: '1px solid transparent', color: 'var(--green-t)', borderRadius: 'var(--r-ctrl)', padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', marginLeft: 6 }} className="hs">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /><path d="m9 16 2 2 4-4" /></svg>
            Disponibilidade
          </button>
          <button onClick={() => dispatch({ type: 'ABRIR_AGENDA_MODAL', idx: 'new', iso: toISO(hoje) })} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '7px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            Novo agendamento
          </button>
        </div>
      </div>

      {agendaItens.length === 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--primary-soft)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '12px 16px' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>
            Sua agenda está vazia. Clique em um dia ou em <strong>Novo agendamento</strong> para criar o primeiro — depois, o agente de IA também vai agendar por aqui.
          </span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', background: 'var(--surface)' }}>
        {/* Cabeçalho dos dias (fixo no topo ao rolar) */}
        <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', minWidth: isMobile ? 680 : undefined, position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div />
          {days.map(col => (
            <div key={col.iso} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, padding: '8px 4px', borderLeft: '1px solid var(--border)', background: col.isHoje ? 'var(--primary-soft)' : 'transparent' }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: col.isHoje ? 'var(--primary)' : 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{col.label}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: col.isHoje ? 'var(--primary)' : 'var(--text)' }}>{col.numero}</span>
            </div>
          ))}
        </div>
        {/* Corpo: gutter de horas + colunas de dia */}
        <div style={{ display: 'grid', gridTemplateColumns: '56px repeat(7, 1fr)', minWidth: isMobile ? 680 : undefined }}>
          <div style={{ position: 'relative' }}>
            {HORAS.map(h => (
              <div key={h} style={{ height: ROW_H, position: 'relative' }}>
                {/* A primeira hora não tem linha de grade acima para "montar" — ficaria cortada atrás do cabeçalho fixo. */}
                <span className="mono" style={{ position: 'absolute', top: h === HORA_INICIO ? 2 : -7, right: 8, fontSize: 10.5, color: 'var(--text3)', background: 'var(--bg)', padding: '0 2px' }}>{horaLabel(h)}</span>
              </div>
            ))}
          </div>
          {days.map(col => (
            <div key={col.iso}
              onDragOver={e => {
                e.preventDefault(); e.dataTransfer.dropEffect = 'move';
                const hora = horaDoEventoY(e.clientY, e.currentTarget as HTMLElement, 30);
                setDragOver(prev => (prev && prev.iso === col.iso && prev.hora === hora) ? prev : { iso: col.iso, hora });
              }}
              onDrop={e => { e.preventDefault(); const idx = dragIdxRef.current; dragIdxRef.current = null; setDragOver(null); if (idx == null) return; solicitarReagendarDrop(idx, col.iso, horaDoEventoY(e.clientY, e.currentTarget as HTMLElement, 30)); }}
              onMouseDown={e => {
                if (e.button !== 0) return;
                const el = e.currentTarget as HTMLElement;
                colunaRef.current = el;
                const m = minutosDoEventoY(e.clientY, el, SNAP_CRIAR);
                setCriando({ iso: col.iso, ancora: m, fim: m });
                e.preventDefault(); // sem isso o arrasto seleciona texto da grade
              }}
              style={{ position: 'relative', height: HORAS.length * ROW_H, borderLeft: '1px solid var(--border)', cursor: 'pointer', userSelect: 'none' }}>
              {HORAS.map((h, i) => (
                <div key={h} style={{ position: 'absolute', top: i * ROW_H, left: 0, right: 0, height: ROW_H, borderTop: '1px solid var(--border)' }} />
              ))}
              {blocosDispDoDia(col.iso, col.diaSemana).map((bl, bi) => {
                const top = (horaParaFloat(bl.horaInicio) - HORA_INICIO) * ROW_H;
                const alt = (horaParaFloat(bl.horaFim) - horaParaFloat(bl.horaInicio)) * ROW_H;
                return (
                  // O bloco é só pintura: deixa o clique passar para a coluna,
                  // senão a faixa disponível vira justamente o lugar onde não dá
                  // para marcar. Editar a disponibilidade fica na etiqueta.
                  <div key={'d' + bi}
                    style={{ position: 'absolute', top: Math.max(0, top), left: 0, right: 0, height: Math.max(14, alt), background: 'var(--green-b)', borderLeft: '2px solid var(--green-t)', boxSizing: 'border-box', pointerEvents: 'none' }}>
                    <button
                      onMouseDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); abrirEditarDisp(bl.ref, bl.override, col.iso, bl.horaInicio, bl.horaFim); }}
                      title={`Editar disponibilidade ${bl.horaInicio}–${bl.horaFim}${bl.ref.atendenteId ? ' · ' + nomePorId(bl.ref.atendenteId) : ''}`}
                      style={{ position: 'absolute', top: 2, left: 4, background: 'var(--green-t)', color: '#fff', border: 'none', borderRadius: 5, fontSize: 9, fontWeight: 700, padding: '2px 6px', textTransform: 'uppercase', letterSpacing: '0.03em', pointerEvents: 'auto', cursor: 'pointer' }}>
                      Disponível
                    </button>
                  </div>
                );
              })}
              {col.itens.map(a => {
                const gidx = agendaItens.indexOf(a);
                const top = (horaParaFloat(a.hora) - HORA_INICIO) * ROW_H;
                // Sem duração gravada o bloco vale uma hora, que era a altura fixa de antes.
                const altura = ((a.duracaoMin ?? 60) / 60) * ROW_H - 4;
                return (
                  <div key={gidx} draggable
                    onDragStart={e => { dragIdxRef.current = gidx; e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { dragIdxRef.current = null; setDragOver(null); }}
                    // Sem isto, apertar num compromisso começaria a criar outro por baixo.
                    onMouseDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); dispatch({ type: 'ABRIR_AGENDA_MODAL', idx: gidx }); }}
                    title={`${a.hora} — ${a.cliente} (${a.servico})`}
                    style={{ position: 'absolute', top: Math.max(0, top), left: 3, right: 3, height: Math.max(18, altura), background: 'var(--evt-b)', color: 'var(--evt-t)', borderRadius: 6, padding: '3px 7px', overflow: 'hidden', cursor: 'grab', display: 'flex', flexDirection: 'column', gap: 0, boxShadow: 'var(--sh-card)', zIndex: 1 }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--evt-t)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.hora} · {a.cliente}</span>
                    <span style={{ fontSize: 10.5, color: 'var(--evt-t)', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.servico}</span>
                  </div>
                );
              })}
              {criando && criando.iso === col.iso && (() => {
                const inicio = Math.min(criando.ancora, criando.fim);
                const fim = Math.max(criando.ancora, criando.fim);
                const duracao = Math.max(DUR_MIN_ARRASTO, fim - inicio);
                return (
                  <div style={{ position: 'absolute', top: (inicio / 60) * ROW_H, left: 3, right: 3, height: (duracao / 60) * ROW_H - 2, background: 'var(--primary-soft)', border: '2px dashed var(--primary)', borderRadius: 6, pointerEvents: 'none', zIndex: 3, padding: '2px 6px', overflow: 'hidden' }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--primary-t)' }}>
                      {minutosParaHora(inicio)}–{minutosParaHora(inicio + duracao)}
                    </span>
                  </div>
                );
              })()}
              {dragOver && dragOver.iso === col.iso && (() => {
                const top = (horaParaFloat(dragOver.hora) - HORA_INICIO) * ROW_H;
                return (
                  <div style={{ position: 'absolute', top: Math.max(0, top), left: 3, right: 3, height: ROW_H - 4, border: '2px dashed var(--green-t)', background: 'var(--green-b)', borderRadius: 6, pointerEvents: 'none', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--green-t)' }}>{dragOver.hora}</span>
                  </div>
                );
              })()}
            </div>
          ))}
        </div>
      </div>

      {/* Modal: confirmar remarcação via drag-and-drop */}
      {reagendarPendente && (() => {
        const item = agendaItens[reagendarPendente.idx];
        if (!item) return null;
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(380px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Remarcar agendamento?</span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>{item.cliente} · {item.servico}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 14px', fontSize: 13 }}>
                <span style={{ color: 'var(--text3)' }}>{fmtDataCurta(item.data)} às {item.hora}</span>
                <svg style={{ color: 'var(--text3)', flexShrink: 0 }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></svg>
                <span style={{ fontWeight: 700 }}>{fmtDataCurta(reagendarPendente.data)} às {reagendarPendente.hora}</span>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={avisarCliente} onChange={e => setAvisarCliente(e.target.checked)} data-testid="avisar-cliente" style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
                Avisar o cliente
              </label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => setReagendarPendente(null)} disabled={salvando} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
                <button onClick={confirmarReagendarDrop} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">{salvando ? 'Remarcando…' : 'Remarcar'}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal agenda */}
      {agendaModalSel !== null && agendaModalBuffer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(400px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
            {!agendaModalConfirm ? (
              <>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{agendaModalSel === 'new' ? 'Novo agendamento' : 'Editar agendamento'}</span>
                {([
                  { k: 'cliente' as const, label: 'Cliente', placeholder: 'Selecione o cliente…', opts: state.contatos.map(c => c.nome) },
                  { k: 'servico' as const, label: 'Serviço', placeholder: 'Selecione o serviço…', opts: state.precos.map(p => p.proc) },
                ]).map(({ k, label, placeholder, opts }) => {
                  const atual = agendaModalBuffer[k];
                  // Preserva um valor que não esteja na lista (ex.: agendamento criado pela IA).
                  const todas = atual && !opts.includes(atual) ? [atual, ...opts] : opts;
                  return (
                    <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
                      <select value={atual} onChange={e => dispatch({ type: 'SET_AGENDA_BUF', k, v: e.target.value })} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}>
                        <option value="">{placeholder}</option>
                        {todas.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  );
                })}
                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr 0.9fr', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data</label>
                    <input type="date" value={agendaModalBuffer.data} onChange={e => dispatch({ type: 'SET_AGENDA_BUF', k: 'data', v: e.target.value })} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', minWidth: 0, width: '100%' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Hora</label>
                    <input type="time" value={agendaModalBuffer.hora} onChange={e => dispatch({ type: 'SET_AGENDA_BUF', k: 'hora', v: e.target.value })} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', minWidth: 0, width: '100%' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Duração</label>
                    {/* Vazio = herda a duração da janela de disponibilidade. */}
                    <input type="number" min={15} step={15} placeholder="padrão"
                      value={agendaModalBuffer.duracaoMin ?? ''}
                      onChange={e => { const n = parseInt(e.target.value, 10); dispatch({ type: 'SET_AGENDA_DURACAO', v: Number.isFinite(n) && n > 0 ? n : null }); }}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', minWidth: 0, width: '100%' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Atendente</label>
                  <select value={agendaModalBuffer.atendente} onChange={e => dispatch({ type: 'SET_AGENDA_BUF', k: 'atendente', v: e.target.value })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}>
                    {state.agentesData.map(a => <option key={a.id}>{a.nome}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {agendaModalSel !== 'new' && (
                    <button onClick={() => dispatch({ type: 'SET', key: 'agendaModalConfirm', value: 'cancelar' })} style={{ background: 'none', border: 'none', color: 'var(--red-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Cancelar agendamento</button>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                    <button onClick={() => dispatch({ type: 'SET', key: 'agendaModalSel', value: null })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Fechar</button>
                    <button onClick={() => dispatch({ type: 'SET', key: 'agendaModalConfirm', value: 'reagendar' })} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Salvar</button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>{agendaModalConfirm === 'reagendar' ? 'Confirmar agendamento?' : 'Cancelar agendamento?'}</span>
                <span style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>{agendaModalBuffer.cliente} — {agendaModalBuffer.servico}, {agendaModalBuffer.data} às {agendaModalBuffer.hora}.</span>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => dispatch({ type: 'SET', key: 'agendaModalConfirm', value: null })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Voltar</button>
                  {agendaModalConfirm === 'reagendar'
                    ? <button onClick={handleConfirmarSalvar} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Salvando…' : 'Sim, salvar'}</button>
                    : <button onClick={handleConfirmarCancelar} disabled={salvando} style={{ background: 'var(--red-t)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Cancelando…' : 'Sim, cancelar'}</button>
                  }
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Aviso: horário fora da disponibilidade ou cheio — deixa o dono forçar */}
      {avisoForcar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 70, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 22, width: 'min(380px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: 'var(--sh-pop)' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Marcar mesmo assim?</span>
            <span style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>{avisoForcar} Você pode encaixar este agendamento mesmo assim, se quiser.</span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAvisoForcar(null)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Voltar</button>
              <button onClick={() => salvarAgend(true)} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Salvando…' : 'Marcar mesmo assim'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal disponibilidade */}
      {dispBuffer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 400, display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>{dispBuffer.id === null ? 'Nova disponibilidade' : 'Disponibilidade'}</span>

            {dispBuffer.id === null && (
              <div style={{ display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 3 }}>
                {([['semanal', 'Toda semana'], ['data', 'Data específica']] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setDispBuffer(b => b ? { ...b, tipo: k } : b)}
                    style={{ flex: 1, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 10px', borderRadius: 6, background: dispBuffer.tipo === k ? 'var(--surface)' : 'transparent', color: dispBuffer.tipo === k ? 'var(--text)' : 'var(--text3)', boxShadow: dispBuffer.tipo === k ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>{label}</button>
                ))}
              </div>
            )}

            {dispBuffer.tipo === 'semanal' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Dia da semana</label>
                {dispBuffer.id === null ? (
                  <select value={dispBuffer.diaSemana} onChange={e => setDispBuffer(b => b ? { ...b, diaSemana: Number(e.target.value) } : b)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}>
                    {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][i]}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text2)' }}>Toda {['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'][dispBuffer.diaSemana]}{dispBuffer.escopo === 'dia' && dispBuffer.ocorrenciaData ? ` · edição do dia ${dispBuffer.ocorrenciaData.split('-').reverse().join('/')}` : ''}</span>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data</label>
                <input type="date" value={dispBuffer.data} onChange={e => setDispBuffer(b => b ? { ...b, data: e.target.value } : b)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', minWidth: 0, width: '100%' }} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {([['horaInicio', 'Início'], ['horaFim', 'Fim']] as const).map(([k, label]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
                  <input type="time" value={dispBuffer[k]} onChange={e => setDispBuffer(b => b ? { ...b, [k]: e.target.value } : b)} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', minWidth: 0, width: '100%' }} />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Atendente</label>
              <select value={nomePorId(dispBuffer.atendenteId)} onChange={e => setDispBuffer(b => b ? { ...b, atendenteId: idPorNome(e.target.value) } : b)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}>
                {atendenteOpts.map(o => <option key={o}>{o}</option>)}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Vagas por horário</label>
                <input type="number" min={1} placeholder="Sem limite" value={dispBuffer.capacidade ?? ''}
                  onChange={e => { const n = parseInt(e.target.value, 10); setDispBuffer(b => b ? { ...b, capacidade: Number.isFinite(n) && n > 0 ? n : null } : b); }}
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Duração (min)</label>
                <input type="number" min={5} step={5} placeholder="60" value={dispBuffer.duracaoMin ?? ''}
                  onChange={e => { const n = parseInt(e.target.value, 10); setDispBuffer(b => b ? { ...b, duracaoMin: Number.isFinite(n) && n > 0 ? n : null } : b); }}
                  style={{ width: '100%', boxSizing: 'border-box', minWidth: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
              </div>
            </div>
            <span style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: -8 }}>Vagas vazio = grupo sem limite; use 1 para individual. A duração define quanto cada sessão ocupa — dois agendamentos individuais não podem se sobrepor.</span>

            {dispBuffer.id !== null && dispBuffer.tipo === 'semanal' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Aplicar em</label>
                <div style={{ display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 3 }}>
                  {([['dia', 'Somente este dia'], ['serie', 'Toda semana']] as const).map(([k, label]) => (
                    <button key={k} onClick={() => setDispBuffer(b => b ? { ...b, escopo: k } : b)}
                      style={{ flex: 1, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: '6px 8px', borderRadius: 6, background: dispBuffer.escopo === k ? 'var(--surface)' : 'transparent', color: dispBuffer.escopo === k ? 'var(--text)' : 'var(--text3)' }}>{label}</button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {dispBuffer.id !== null && (
                <button onClick={() => removerDisp(dispBuffer.tipo === 'semanal' ? dispBuffer.escopo : 'serie')} disabled={salvando} style={{ background: 'none', border: 'none', color: 'var(--red-t)', fontSize: 12.5, fontWeight: 600, cursor: salvando ? 'wait' : 'pointer' }}>
                  {dispBuffer.tipo === 'semanal' && dispBuffer.escopo === 'dia' ? 'Remover só neste dia' : 'Remover'}
                </button>
              )}
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button onClick={() => setDispBuffer(null)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Fechar</button>
                <button onClick={salvarDisp} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">{salvando ? 'Salvando…' : 'Salvar'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

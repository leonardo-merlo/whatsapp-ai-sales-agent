'use client';

import { useState, useEffect, useRef } from 'react';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { iniciais, avatarBg, statusBadge, formatTelefone, identificacaoDoContato } from '@/lib/ui-helpers';
import { addContato } from '@/lib/data/mutations';
import { fmtDataBR } from '@/lib/data/mappers';
import { createClient } from '@/lib/supabase/client';
import type { Contato } from '@/lib/types';
import type { Tables } from '@/lib/supabase/database.types';
import PainelContato from '@/components/contato/painel-contato';

const STATUS_NOVO_OPTS: Contato['status'][] = ['Ativo', 'Inativo'];
const ORIGEM_NOVO_OPTS = ['WhatsApp', 'Instagram', 'Google', 'Indicação', 'Presencial'];

const STATUS_OPTS = ['Todos', 'Ativo', 'Inativo'];
const ORIGEM_OPTS = ['Todos', 'WhatsApp', 'Instagram', 'Google', 'Indicação', 'Presencial'];

export default function ContatosSection() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  const { contatos, contatoSel, contatoBuffer, fStatus, fOrigem, busca, customFieldDefs, fInativos, labels, fLabel } = state;

  const responsaveis = state.agentesData.map(a => a.nome);
  const labelById = new Map(labels.map(l => [l.id, l]));

  // Realtime: resumo, questionário e próximo compromisso (criados pela IA ou pela
  // agenda) aparecem na ficha do contato sem precisar recarregar a página.
  const agentesRef = useRef(state.agentesData);
  useEffect(() => { agentesRef.current = state.agentesData; }, [state.agentesData]);
  useEffect(() => {
    const supabase = createClient();
    // Recalcula o próximo compromisso do contato após qualquer mudança na agenda.
    const atualizarProximo = async (contactId: string) => {
      const hoje = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from('appointments')
        .select('data, hora, servico, atendente_id')
        .eq('organization_id', org.orgId).eq('contact_id', contactId)
        .neq('status', 'cancelado').gte('data', hoje)
        .order('data', { ascending: true }).order('hora', { ascending: true })
        .limit(1).maybeSingle();
      dispatch({ type: 'RT_CONTATO_PROXIMO', contactId, proximo: data ? {
        data: fmtDataBR(data.data), hora: data.hora, servico: data.servico,
        atendente: data.atendente_id ? (agentesRef.current.find(a => a.id === data.atendente_id)?.nome ?? '—') : '—',
      } : null });
    };
    const channel = supabase.channel(`contatos-${org.orgId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'contact_history', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'contact_history'>;
        dispatch({ type: 'RT_CONTATO_HISTORICO', contactId: row.contact_id, entry: { id: row.id, data: fmtDataBR(row.data), canal: row.canal, resumo: row.resumo } });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'questionnaire_responses', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'questionnaire_responses'>;
        dispatch({ type: 'RT_CONTATO_QUESTIONARIO', contactId: row.contact_id, entry: {
          id: row.id, data: fmtDataBR(row.created_at),
          resultado: (row.resultado as import('@/lib/types').TipoSucesso | null) ?? null,
          respostas: (row.respostas as unknown as import('@/lib/types').RespostaItem[] | null) ?? [],
        } });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'appointments', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'appointments'>;
        if (row.contact_id) atualizarProximo(row.contact_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'appointments', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'appointments'>;
        if (row.contact_id) atualizarProximo(row.contact_id);
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `organization_id=eq.${org.orgId}` }, payload => {
        const row = payload.new as Tables<'contacts'>;
        const p = (row.perfil as Partial<import('@/lib/types').PerfilContato> | null) ?? {};
        dispatch({ type: 'SET_PERFIL', contactId: row.id, perfil: {
          preferencias: Array.isArray(p.preferencias) ? p.preferencias : [],
          dadosChave: Array.isArray(p.dadosChave) ? p.dadosChave : [],
          ultimoInteresse: p.ultimoInteresse ?? '',
          observacoes: p.observacoes ?? '',
          atualizadoEm: p.atualizadoEm ?? null,
        } });
      })
      .subscribe(status => { if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('Realtime Contatos:', status); });
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.orgId]);
  const [ordUltimo, setOrdUltimo] = useState<'none' | 'asc' | 'desc'>('none');
  const [addOpen, setAddOpen] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [addForm, setAddForm] = useState({
    nome: '', telefone: '', email: '', cpf: '', bairro: '',
    status: 'Ativo' as Contato['status'],
    responsavel: '', origem: 'WhatsApp', nascimento: '',
  });
  const [addCustom, setAddCustom] = useState<Record<string, string>>({});
  const [addErr, setAddErr] = useState('');

  async function handleAddSubmit() {
    if (!addForm.nome.trim() || !addForm.telefone.trim()) { setAddErr('Nome e telefone são obrigatórios.'); return; }
    setSalvando(true);
    try {
      const novo = await addContato(org.orgId, {
        nome: addForm.nome.trim(), telefone: addForm.telefone.trim(), email: addForm.email.trim(),
        cpf: addForm.cpf.trim(), bairro: addForm.bairro,
        status: addForm.status, responsavel: addForm.responsavel || org.memberName, origem: addForm.origem,
        nascimento: addForm.nascimento,
        customFields: addCustom,
        labelIds: [],
      }, state.agentesData);
      dispatch({ type: 'ADD_CONTATO', contato: novo });
      showToast(`Contato "${novo.nome}" adicionado`);
      setAddOpen(false);
      setAddForm({ nome: '', telefone: '', email: '', cpf: '', bairro: '', status: 'Ativo', responsavel: '', origem: 'WhatsApp', nascimento: '' });
      setAddCustom({});
      setAddErr('');
    } catch {
      setAddErr('Não foi possível salvar o contato. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  }

  const filtered = contatos.filter(m => {
    const q = busca.toLowerCase();
    const matchQ = !busca || m.nome.toLowerCase().includes(q) || identificacaoDoContato(m).toLowerCase().includes(q);
    const matchS = fStatus === 'Todos' || m.status === fStatus;
    const matchO = fOrigem === 'Todos' || m.origem === fOrigem;
    const matchInativo = !fInativos || m.diasSemContato >= 30;
    const matchLabel = fLabel === 'Todas' || m.labelIds.includes(fLabel);
    return matchQ && matchS && matchO && matchInativo && matchLabel;
  });

  const ordered = ordUltimo === 'none'
    ? filtered
    : [...filtered].sort((a, b) => ordUltimo === 'desc' ? b.diasSemContato - a.diasSemContato : a.diasSemContato - b.diasSemContato);

  return (
    <section style={{ height: '100%', display: 'flex', minHeight: 0, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, padding: isMobile ? '18px 14px' : '24px 28px', gap: 16, overflow: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>Contatos</h1>
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>{contatos.length === 1 ? '1 contato na sua base' : `${contatos.length} contatos na sua base`}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => showToast('Exportação disponível em breve')} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 13px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Exportar contatos
            </button>
            <button onClick={() => setAddOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              Adicionar contato
            </button>
          </div>
        </div>

        {/* filters */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
            <svg style={{ position: 'absolute', left: 11, top: 10, color: 'var(--text3)' }} width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
            <input value={busca} onChange={e => dispatch({ type: 'SET', key: 'busca', value: e.target.value })} placeholder="Buscar por nome ou telefone…" style={{ width: '100%', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px 8px 33px', fontSize: 13.5, color: 'var(--text)' }} />
          </div>
          {[
            { key: 'fStatus', opts: STATUS_OPTS },
            { key: 'fOrigem', opts: ORIGEM_OPTS },
          ].map(f => (
            <select key={f.key} value={state[f.key as keyof typeof state] as string} onChange={e => dispatch({ type: 'SET', key: f.key as keyof typeof state, value: e.target.value })}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13.5, color: 'var(--text2)', cursor: 'pointer' }}>
              {f.opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
          <button onClick={() => dispatch({ type: 'SET', key: 'fInativos', value: !fInativos })}
            style={{ background: fInativos ? 'var(--amber-b)' : 'var(--surface)', border: `1px solid ${fInativos ? 'var(--amber-t)' : 'var(--border)'}`, color: fInativos ? 'var(--amber-t)' : 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            Sem contato +30d
          </button>
          {labels.length > 0 && (
            <select value={fLabel} onChange={e => dispatch({ type: 'SET', key: 'fLabel', value: e.target.value })}
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 10px', fontSize: 13.5, color: 'var(--text2)', cursor: 'pointer' }}>
              <option value="Todas">Todas as etiquetas</option>
              {labels.map(l => <option key={l.id} value={l.id}>{l.nome}</option>)}
            </select>
          )}
          <span style={{ fontSize: 12.5, color: 'var(--text3)', marginLeft: 'auto' }}>{ordered.length} resultados</span>
        </div>

        {/* table */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: isMobile ? 640 : undefined, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface2)' }}>
                {['Nome', 'Telefone', 'Último contato', 'Status', 'Responsável'].map(h => (
                  <th key={h} onClick={h === 'Último contato' ? () => setOrdUltimo(o => o === 'desc' ? 'asc' : o === 'asc' ? 'none' : 'desc') : undefined}
                    style={{ textAlign: 'left', fontSize: 11.5, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '10px 16px', cursor: h === 'Último contato' ? 'pointer' : 'default', userSelect: 'none' }}>
                    {h}{h === 'Último contato' && ordUltimo !== 'none' ? (ordUltimo === 'desc' ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ordered.map(m => {
                const { bg, color } = statusBadge(m.status);
                return (
                  <tr key={m.id} onClick={() => dispatch({ type: 'OPEN_CONTATO', id: m.id })} style={{ cursor: 'pointer', background: contatoSel === m.id ? 'var(--primary-soft)' : 'transparent' }} className="hs">
                    <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarBg(m.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>{iniciais(m.nome)}</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                          <span style={{ fontWeight: 600, fontSize: 13.5 }}>{m.nome}</span>
                          {m.labelIds.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {m.labelIds.map(id => labelById.get(id)).filter(Boolean).map(l => (
                                <span key={l!.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: 'var(--text2)', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '1px 8px 1px 6px' }}>
                                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: l!.cor, flexShrink: 0 }} />
                                  {l!.nome}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text2)' }}>{identificacaoDoContato(m)}</td>
                    <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text2)' }}>{m.ultimoContato}</td>
                    <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)' }}>
                      <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: bg, color }}>{m.status}</span>
                    </td>
                    <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)', fontSize: 13.5, color: 'var(--text2)' }}>{m.responsavel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {ordered.length === 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '42px 20px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text2)' }}>
                {contatos.length === 0 ? 'Nenhum contato ainda' : 'Nenhum contato com esses filtros'}
              </span>
              <span style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', maxWidth: 380 }}>
                {contatos.length === 0
                  ? 'Adicione o primeiro contato manualmente — ou eles aparecem sozinhos quando clientes mandarem mensagem no WhatsApp.'
                  : 'Ajuste a busca ou os filtros acima para encontrar quem você procura.'}
              </span>
              {contatos.length === 0 && (
                <button onClick={() => setAddOpen(true)} style={{ marginTop: 6, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">
                  Adicionar primeiro contato
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Side panel — no celular vira painel sobreposto */}
      {contatoSel !== null && contatoBuffer && isMobile && (
        <div onClick={() => dispatch({ type: 'FECHAR_CONTATO' })} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', zIndex: 70 }} />
      )}
      {contatoSel !== null && contatoBuffer && (
        <PainelContato
          titulo="Detalhes do contato"
          contexto="contatos"
          onFechar={() => dispatch({ type: 'FECHAR_CONTATO' })}
        />
      )}

      {/* Add contact modal */}
      {addOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', width: 'min(520px, calc(100vw - 28px))', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-pop)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Adicionar contato</span>
              <button onClick={() => setAddOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
                <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ padding: '18px 20px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {addErr && <span style={{ fontSize: 12.5, color: 'var(--red-t)', background: 'var(--red-b)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px' }}>{addErr}</span>}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {([
                  { k: 'nome', label: 'Nome completo *', full: true },
                  { k: 'telefone', label: 'Telefone *' },
                  { k: 'cpf', label: 'CPF' },
                  { k: 'nascimento', label: 'Nascimento' },
                  { k: 'bairro', label: 'Bairro' },
                  { k: 'email', label: 'E-mail', full: true },
                ] as { k: keyof typeof addForm; label: string; full?: boolean }[]).map(f => (
                  <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(f.full ? { gridColumn: '1 / -1' } : {}) }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</label>
                    <input value={String(addForm[f.k])} inputMode={f.k === 'telefone' ? 'tel' : undefined}
                      onChange={e => setAddForm(prev => ({ ...prev, [f.k]: f.k === 'telefone' ? formatTelefone(e.target.value) : e.target.value }))}
                      style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                  </div>
                ))}
                {([
                  { k: 'status', label: 'Status', opts: STATUS_NOVO_OPTS },
                  { k: 'responsavel', label: 'Responsável', opts: responsaveis.length > 0 ? responsaveis : ['—'] },
                  { k: 'origem', label: 'Origem', opts: ORIGEM_NOVO_OPTS },
                ] as { k: keyof typeof addForm; label: string; opts: string[] }[]).map(f => (
                  <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</label>
                    <select value={String(addForm[f.k])} onChange={e => setAddForm(prev => ({ ...prev, [f.k]: e.target.value }))} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)', cursor: 'pointer' }}>
                      {f.opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                ))}
                {customFieldDefs.map(def => (
                  <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{def.label}</label>
                    <input value={addCustom[def.key] ?? ''} onChange={e => setAddCustom(prev => ({ ...prev, [def.key]: e.target.value }))} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--border)' }}>
              <button onClick={() => setAddOpen(false)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
              <button onClick={handleAddSubmit} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">{salvando ? 'Salvando…' : 'Adicionar'}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

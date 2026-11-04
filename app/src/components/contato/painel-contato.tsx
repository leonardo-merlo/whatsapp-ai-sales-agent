'use client'; // painel editável: buffer, seletor de etiquetas e perfil são interativos

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { permissoesDe } from '@/lib/permissoes';
import { ehSaude } from '@/lib/saude';
import DadosDoTitular from './dados-do-titular';
import { useIsMobile } from '@/lib/use-is-mobile';
import { iniciais, avatarBg, statusBadge, formatTelefone } from '@/lib/ui-helpers';
import { saveContato, criarLabel, deletarLabel, apagarHistorico, esquecerContato, salvarPerfilContato } from '@/lib/data/mutations';
import type { Contato } from '@/lib/types';
import CadastroDoErpDoContato from './cadastro-do-erp';
import OrcamentosDoContato, { EmAbertoDoContato, useOrcamentosDoContato } from './orcamentos-do-contato';
import SecaoRecolhivel from './secao-recolhivel';

const LABEL_CORES = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#8b5cf6', '#14b8a6'];
const ORIGEM_LEAD_OPTS = ['WhatsApp', 'Instagram', 'Google', 'Indicação', 'Presencial'];

const RESULTADO_INFO: Record<string, { label: string; bg: string; color: string }> = {
  venda: { label: 'Venda realizada', bg: 'var(--green-b)', color: 'var(--green-t)' },
  agendamento: { label: 'Agendamento feito', bg: 'var(--blue-b)', color: 'var(--blue-t)' },
  contato: { label: 'Contato registrado', bg: 'var(--primary-soft)', color: 'var(--primary-t)' },
};

// Fora do componente: declarada dentro do pai, o React recria essa função a cada
// tecla digitada e remonta o <input>, derrubando o foco a cada caractere.
function Field({ k, label, full, select, opts }: { k: keyof Contato; label: string; full?: boolean; select?: boolean; opts?: string[] }) {
  const { state, dispatch } = useApp();
  const { contatoBuffer } = state;
  if (!contatoBuffer) return null;
  const val = contatoBuffer[k] as string;
  const style = { width: '100%', boxSizing: 'border-box' as const, minWidth: 0, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...(full ? { gridColumn: '1 / -1' } : {}) }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {select
        ? <select value={val} onChange={e => dispatch({ type: 'SET_CONTATO_BUF', k, v: e.target.value })} style={{ ...style, cursor: 'pointer' }}>
            {opts!.map(o => <option key={o}>{o}</option>)}
          </select>
        : k === 'telefone'
        ? <input value={val} inputMode="tel" onChange={e => dispatch({ type: 'SET_CONTATO_BUF', k, v: formatTelefone(e.target.value) })} style={style} />
        : <input value={val} onChange={e => dispatch({ type: 'SET_CONTATO_BUF', k, v: e.target.value })} style={style} />
      }
    </div>
  );
}

export default function PainelContato({ titulo, contexto, onFechar, topo }: {
  titulo: string;
  // Em 'conversas' o botão de abrir conversa some — já estamos nela.
  contexto: 'contatos' | 'conversas';
  onFechar: () => void;
  // Faixa própria da tela (o Modo da conversa não é dado do contato).
  topo?: React.ReactNode;
}) {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const router = useRouter();
  const isMobile = useIsMobile();
  const { contatos, contatoSel, contatoBuffer, customFieldDefs, labels } = state;

  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const [novoLabelNome, setNovoLabelNome] = useState('');
  const [novoLabelCor, setNovoLabelCor] = useState(LABEL_CORES[0]);
  const [histQuestOpen, setHistQuestOpen] = useState(false);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const responsaveis = state.agentesData.map(a => a.nome);
  const labelById = new Map(labels.map(l => [l.id, l]));

  // O contato como está gravado, ao lado do buffer que o formulário edita.
  const contatoSalvo = contatos.find(c => c.id === contatoSel);
  const dirty = !!contatoBuffer && contatoSel !== null &&
    JSON.stringify(contatoBuffer) !== JSON.stringify(contatoSalvo);

  // Ficha do Wappia Vendas (08/10): "Em aberto" no lugar do próximo compromisso,
  // perfil só com o que é de vendas e sem a memória da IA, que a máquina de
  // estados não alimenta. O Atendimento continua como era.
  const vendas = org.produtoAtivo === 'vendas';
  const veOrcamentos = vendas && permissoesDe(org.memberRole).editarDadosNegocio;
  const orcamentos = useOrcamentosDoContato(veOrcamentos && contatoSalvo?.id ? contatoSalvo.id : null);

  async function handleSalvarContato() {
    if (!contatoBuffer || salvando) return;
    setSalvando(true);
    try {
      await saveContato(org.orgId, contatoBuffer, state.agentesData);
      dispatch({ type: 'SALVAR_CONTATO' });
      showToast('Contato salvo');
    } catch {
      showToast('Erro ao salvar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  async function handleCriarLabel() {
    const nome = novoLabelNome.trim();
    if (!nome) return;
    try {
      const label = await criarLabel(org.orgId, nome, novoLabelCor);
      dispatch({ type: 'ADD_LABEL', label });
      dispatch({ type: 'TOGGLE_BUF_LABEL', labelId: label.id });
      setNovoLabelNome('');
    } catch {
      showToast('Erro ao criar etiqueta');
    }
  }

  async function handleDeletarLabel(id: string) {
    try {
      await deletarLabel(id);
      dispatch({ type: 'DEL_LABEL', id });
    } catch {
      showToast('Erro ao excluir etiqueta');
    }
  }

  if (!contatoBuffer) return null;

  const camposPersonalizados = customFieldDefs.length > 0 && (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
      {customFieldDefs.map(def => (
        <div key={def.key} style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{def.label}</label>
          <input
            value={contatoBuffer.customFields[def.key] ?? ''}
            onChange={e => dispatch({ type: 'SET_CONTATO_CUSTOM_FIELD', key: def.key, v: e.target.value })}
            style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)', minWidth: 0, width: '100%', boxSizing: 'border-box' }}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div style={{
      ...(isMobile
        ? { position: 'fixed' as const, top: 0, right: 0, bottom: 0, width: 'min(344px, 92vw)', zIndex: 71, boxShadow: 'var(--sh-pop)' }
        : { width: 344, flexShrink: 0, borderLeft: '1px solid var(--border)' }),
      background: 'var(--surface)', display: 'flex', flexDirection: 'column', overflow: 'auto', animation: 'cm-pop .18s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>{titulo}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {dirty && (
            <button onClick={handleSalvarContato} disabled={salvando} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>
              <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}
          <button onClick={onFechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
        </div>
      </div>
      <div style={{ padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarBg(contatoBuffer.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13.5, fontWeight: 700 }}>{iniciais(contatoBuffer.nome)}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 0 }}>
            <input value={contatoBuffer.nome} onChange={e => dispatch({ type: 'SET_CONTATO_BUF', k: 'nome', v: e.target.value })} style={{ fontSize: 13.5, fontWeight: 700, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '5px 9px', color: 'var(--text)', minWidth: 0, width: '100%', boxSizing: 'border-box' }} />
            <select value={contatoBuffer.status} onChange={e => dispatch({ type: 'SET_CONTATO_BUF', k: 'status', v: e.target.value })}
              style={{ display: 'inline-block', padding: '1px 9px', borderRadius: 'var(--r-pill)', fontSize: 11.5, fontWeight: 600, background: statusBadge(contatoBuffer.status).bg, color: statusBadge(contatoBuffer.status).color, width: 'fit-content', border: 'none', cursor: 'pointer' }}>
              <option>Ativo</option><option>Inativo</option>
            </select>
          </div>
        </div>

        {topo}

        {!vendas && (<>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
          <Field k="cpf" label="CPF" />
          <Field k="nascimento" label="Nascimento" />
          <Field k="email" label="E-mail" full />
          <Field k="telefone" label="Telefone" />
          <Field k="bairro" label="Bairro" />
          <Field k="responsavel" label="Responsável" select opts={responsaveis.length > 0 ? responsaveis : ['—']} />
          <Field k="origem" label="Origem do lead" select opts={ORIGEM_LEAD_OPTS} />
        </div>
        {camposPersonalizados}
        </>)}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Etiquetas</span>
            <button onClick={() => setLabelPickerOpen(o => !o)} style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}>+ Etiqueta</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {contatoBuffer.labelIds.length === 0 && !labelPickerOpen && (
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Nenhuma etiqueta aplicada</span>
            )}
            {contatoBuffer.labelIds.map(id => labelById.get(id)).filter(Boolean).map(l => (
              <span key={l!.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#fff', background: l!.cor, borderRadius: 'var(--r-pill)', padding: '3px 6px 3px 10px' }}>
                {l!.nome}
                <button onClick={() => dispatch({ type: 'TOGGLE_BUF_LABEL', labelId: l!.id })} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', padding: 0, opacity: 0.85 }}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </span>
            ))}
          </div>
          {labelPickerOpen && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', background: 'var(--surface)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: 'var(--sh-pop)' }}>
              {labels.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 180, overflow: 'auto' }}>
                  {labels.map(l => {
                    const aplicada = contatoBuffer.labelIds.includes(l.id);
                    return (
                      <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 6px', borderRadius: 7 }} className="hs">
                        <button onClick={() => dispatch({ type: 'TOGGLE_BUF_LABEL', labelId: l.id })} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0, minWidth: 0 }}>
                          <span style={{ width: 16, height: 16, borderRadius: 5, border: `2px solid ${aplicada ? l.cor : 'var(--border2)'}`, background: aplicada ? l.cor : 'transparent', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {aplicada && <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
                          </span>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: l.cor, flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: aplicada ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.nome}</span>
                        </button>
                        <button onClick={() => handleDeletarLabel(l.id)} title="Excluir etiqueta" style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 2, flexShrink: 0 }}>
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, borderTop: labels.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: labels.length > 0 ? 8 : 0 }}>
                <input value={novoLabelNome} onChange={e => setNovoLabelNome(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCriarLabel()} placeholder="Nova etiqueta…" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '7px 10px', fontSize: 13, color: 'var(--text)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {LABEL_CORES.map(c => (
                    <button key={c} onClick={() => setNovoLabelCor(c)} style={{ width: 18, height: 18, borderRadius: '50%', background: c, cursor: 'pointer', border: novoLabelCor === c ? '2px solid var(--text)' : '2px solid transparent', flexShrink: 0 }} />
                  ))}
                  <button onClick={handleCriarLabel} disabled={!novoLabelNome.trim()} style={{ marginLeft: 'auto', background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 7, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: novoLabelNome.trim() ? 'pointer' : 'not-allowed', opacity: novoLabelNome.trim() ? 1 : 0.6 }} className="hp">Criar</button>
                </div>
              </div>
            </div>
          )}
        </div>

        {vendas ? (veOrcamentos && <EmAbertoDoContato orcamentos={orcamentos} />) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Próximo compromisso</span>
          {contatoBuffer.proximoCompromisso ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, background: 'var(--primary-soft)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-t)' }}>{contatoBuffer.proximoCompromisso.servico}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text2)' }}>{contatoBuffer.proximoCompromisso.data} às {contatoBuffer.proximoCompromisso.hora} · {contatoBuffer.proximoCompromisso.atendente}</span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Nenhum compromisso agendado</span>
              <button onClick={() => { const nome = contatoBuffer.nome; onFechar(); router.push('/agenda?cliente=' + encodeURIComponent(nome)); }} style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Agendar</button>
            </div>
          )}
        </div>
        )}

        {vendas && (
          <SecaoRecolhivel id="perfil-vendas" titulo="Perfil do cliente">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 14px' }}>
              <Field k="email" label="E-mail" full />
              <Field k="telefone" label="Telefone" />
              <Field k="responsavel" label="Responsável" select opts={responsaveis.length > 0 ? responsaveis : ['—']} />
              {contatoSalvo?.documento && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>CPF/CNPJ da conversa</span>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{contatoSalvo.documento}</span>
                </div>
              )}
            </div>
            {camposPersonalizados}
          </SecaoRecolhivel>
        )}

        {contatoBuffer.questionarios.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Questionário</span>
            {contatoBuffer.questionarios.slice(0, histQuestOpen ? undefined : 1).map((q, qi) => (
              <div key={q.id} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{qi === 0 ? 'Mais recente · ' : ''}{q.data}</span>
                  {q.resultado && RESULTADO_INFO[q.resultado] && (
                    <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 9px', background: RESULTADO_INFO[q.resultado].bg, color: RESULTADO_INFO[q.resultado].color }}>{RESULTADO_INFO[q.resultado].label}</span>
                  )}
                </div>
                {q.respostas.map((r, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>{r.pergunta}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>{r.resposta || '—'}</span>
                  </div>
                ))}
              </div>
            ))}
            {contatoBuffer.questionarios.length > 1 && (
              <button onClick={() => setHistQuestOpen(o => !o)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}>
                {histQuestOpen ? 'Ver menos' : `Ver histórico (${contatoBuffer.questionarios.length - 1})`}
              </button>
            )}
          </div>
        )}

        {/* Só aparece em contato já identificado no sistema de gestão — ou seja,
            nunca numa organização do Wappia Atendimento. Lê do contato salvo, e
            não do buffer: nada aqui é editável, então o rascunho não se aplica. */}
        <CadastroDoErpDoContato
          clienteId={contatoSalvo?.erpClienteId ?? ''}
          documento={contatoSalvo?.documento ?? ''}
          cadastro={contatoSalvo?.erpCadastro ?? null}
          cadastros={contatoSalvo?.erpCadastros ?? []}
        />

        {veOrcamentos && <OrcamentosDoContato orcamentos={orcamentos} />}

        {!vendas && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Perfil do cliente</span>
            <button onClick={() => setEditandoPerfil(e => !e)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, padding: 2 }}>
              {editandoPerfil ? 'Concluir' : 'Editar'}
            </button>
          </div>
          <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {editandoPerfil ? (
              <>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Último interesse</label>
                <input
                  value={contatoBuffer.perfil.ultimoInteresse}
                  onChange={e => dispatch({ type: 'SET_PERFIL', contactId: contatoBuffer.id, perfil: { ...contatoBuffer.perfil, ultimoInteresse: e.target.value } })}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)' }}
                />
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Preferências (uma por linha)</label>
                <textarea
                  value={contatoBuffer.perfil.preferencias.join('\n')}
                  onChange={e => dispatch({ type: 'SET_PERFIL', contactId: contatoBuffer.id, perfil: { ...contatoBuffer.perfil, preferencias: e.target.value.split('\n').map(s => s.trim()).filter(Boolean) } })}
                  rows={3}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)', resize: 'vertical' }}
                />
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)' }}>Observações</label>
                <textarea
                  value={contatoBuffer.perfil.observacoes}
                  onChange={e => dispatch({ type: 'SET_PERFIL', contactId: contatoBuffer.id, perfil: { ...contatoBuffer.perfil, observacoes: e.target.value } })}
                  rows={2}
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text)', resize: 'vertical' }}
                />
                <button
                  onClick={async () => {
                    try {
                      await salvarPerfilContato(contatoBuffer!.id, contatoBuffer!.perfil);
                      setEditandoPerfil(false);
                      showToast('Perfil salvo');
                    } catch { showToast('Não foi possível salvar o perfil'); }
                  }}
                  style={{ alignSelf: 'flex-start', background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '7px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  className="hp"
                >
                  Salvar perfil
                </button>
              </>
            ) : (
              <>
                {contatoBuffer.perfil.ultimoInteresse && (
                  <span style={{ fontSize: 13, color: 'var(--text)' }}><b style={{ color: 'var(--text3)', fontWeight: 600 }}>Interesse:</b> {contatoBuffer.perfil.ultimoInteresse}</span>
                )}
                {contatoBuffer.perfil.preferencias.length > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--text)' }}><b style={{ color: 'var(--text3)', fontWeight: 600 }}>Preferências:</b> {contatoBuffer.perfil.preferencias.join(' · ')}</span>
                )}
                {contatoBuffer.perfil.dadosChave.map((d, i) => (
                  <span key={i} style={{ fontSize: 13, color: 'var(--text)' }}><b style={{ color: 'var(--text3)', fontWeight: 600 }}>{d.rotulo}:</b> {d.valor}</span>
                ))}
                {contatoBuffer.perfil.observacoes && (
                  <span style={{ fontSize: 13, color: 'var(--text2)' }}>{contatoBuffer.perfil.observacoes}</span>
                )}
                {!contatoBuffer.perfil.ultimoInteresse && !contatoBuffer.perfil.preferencias.length && !contatoBuffer.perfil.dadosChave.length && !contatoBuffer.perfil.observacoes && (
                  <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Ainda sem perfil — a IA vai preenchendo conforme a conversa acontece.</span>
                )}
              </>
            )}
          </div>
        </div>
        )}

        <SecaoRecolhivel
          id="historico"
          titulo="Histórico de interações"
          contagem={contatoBuffer.historico.length}
          acao={contatoBuffer.historico.length > 0 && (
              <button
                onClick={async () => {
                  if (!confirm('Apagar toda a memória que a IA tem deste contato? As mensagens da conversa não são apagadas.')) return;
                  try {
                    await esquecerContato(contatoBuffer!.id);
                    dispatch({ type: 'ESQUECER_CONTATO', contactId: contatoBuffer!.id });
                    showToast('Memória do contato apagada');
                  } catch { showToast('Não foi possível esquecer o contato'); }
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red-t)', fontSize: 12, fontWeight: 600, padding: 2 }}
                className="hr"
              >
                Esquecer contato
              </button>
          )}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {contatoBuffer.historico.map(h => (
              <div key={h.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--primary-t)' }}>{h.canal}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{h.data}</span>
                    <button
                      onClick={async () => {
                        try {
                          await apagarHistorico(h.id);
                          dispatch({ type: 'DEL_HISTORICO', contactId: contatoBuffer!.id, historicoId: h.id });
                        } catch { showToast('Não foi possível apagar'); }
                      }}
                      title="Apagar este registro da memória"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: '2px 5px', borderRadius: 5, display: 'flex' }}
                      className="hr"
                    >
                      <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                    </button>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>{h.resumo}</span>
              </div>
            ))}
          </div>
        </SecaoRecolhivel>

        {/* LGPD (S9): exportar e apagar, só para admin e só contato já salvo. */}
        {contatoSalvo?.id && permissoesDe(org.memberRole).editarDadosNegocio && (
          <DadosDoTitular contactId={contatoSalvo.id} rotulo={ehSaude(org.segmento) ? 'Dados do paciente' : 'Dados do cliente'} />
        )}

        {contexto === 'contatos' && (
          <button onClick={() => { onFechar(); router.push('/conversas'); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '10px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
            <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></svg>
            Iniciar conversa no WhatsApp
          </button>
        )}
      </div>
    </div>
  );
}

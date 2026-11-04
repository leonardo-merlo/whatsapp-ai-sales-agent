'use client';

import { useMemo, useState } from 'react';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { statusBadge, fmtNum } from '@/lib/ui-helpers';
import { dispararCampanha, addCategoriaCampanha, delCategoriaCampanha } from '@/lib/data/mutations';
import { LIMITE_POR_DISPARO, publicoDoDisparo } from '@/lib/campanhas/publico';
import { nomeDaCategoria, preencherCorpo } from '@/lib/whatsapp/regras-de-template';
import { PRECOS_META_CONSULTADOS_EM, PRECO_POR_MENSAGEM_BRL } from '@/lib/whatsapp/precos-meta';
import { hojeEmSP } from '@/lib/fuso';

const STEP_LABELS = ['Nome', 'Template', 'Público', 'Revisar'];

type Variavel = { tipo: 'texto'; valor: string } | { tipo: 'nome' };

export default function CampanhasSection() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  const [publicando, setPublicando] = useState(false);
  const [numeroId, setNumeroId] = useState('');
  const [variaveis, setVariaveis] = useState<Variavel[]>([]);
  const [resultado, setResultado] = useState<{ enviados: number; falhas: number } | null>(null);
  const {
    campanhas, campView, wizStep, wizNome, wizModelo, wizCategoria,
    pubBairro, pubStatus, campCategorias, campFiltroCategoria, campFiltroStatus,
    campOrdenar, gerenciarCategoriasOpen, novaCategoriaTexto, templates, contatos, numeros,
  } = state;

  // Filtros de público derivados dos contatos reais da organização
  const BAIRROS = ['Todos', ...Array.from(new Set(contatos.map(c => c.bairro).filter(Boolean))).sort()];
  const STATUS_WIZ = ['Todos', 'Ativos', 'Inativos'];

  // O template é da conta do WhatsApp do número: escolher o número decide
  // quais templates aparecem. Com um número só, não há o que escolher.
  const numerosComConta = numeros.filter(n => n.ativo && n.wabaId);
  const numeroSel = numerosComConta.find(n => n.id === numeroId) ?? numerosComConta[0];
  const aprovados = templates.filter(t => t.status === 'APPROVED' && !t.oculto && t.wabaId === numeroSel?.wabaId);
  const tplSel = aprovados.find(t => t.id === wizModelo) ?? aprovados[0];

  const filtroBairro = pubBairro === 'Todos' ? null : pubBairro;
  const filtroStatus = pubStatus === 'Todos' ? null : (pubStatus === 'Ativos' ? 'ativo' as const : 'inativo' as const);
  const est = useMemo(() => publicoDoDisparo(
    contatos.map(c => ({ id: c.id, nome: c.nome, telefone: c.telefone, bairro: c.bairro, status: c.status === 'Ativo' ? 'ativo' : 'inativo' })),
    { bairro: filtroBairro, status: filtroStatus },
  ).length, [contatos, filtroBairro, filtroStatus]);

  // Uma entrada por variável do template escolhido; trocar de template recomeça.
  const variaveisDoTpl: Variavel[] = (tplSel?.variaveis ?? []).map((_, i) => variaveis[i] ?? { tipo: 'texto', valor: '' });
  const variaveisOk = variaveisDoTpl.every(v => v.tipo === 'nome' || v.valor.trim());
  const preview = tplSel ? preencherCorpo(tplSel.corpo, variaveisDoTpl.map(v => (v.tipo === 'nome' ? '[nome do contato]' : v.valor))) : '';
  const precoUnitario = tplSel ? PRECO_POR_MENSAGEM_BRL[tplSel.categoria as keyof typeof PRECO_POR_MENSAGEM_BRL] : undefined;
  const custoEstimado = precoUnitario != null
    ? (est * precoUnitario).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    : 'veja a tabela da Meta';

  function trocarTemplate(id: string) {
    dispatch({ type: 'SET', key: 'wizModelo', value: id });
    setVariaveis([]);
  }

  function atualizarVariavel(i: number, v: Variavel) {
    const novas = [...variaveisDoTpl];
    novas[i] = v;
    setVariaveis(novas);
  }

  async function handleDisparar() {
    if (!wizNome.trim() || !tplSel || !numeroSel || publicando) return;
    setPublicando(true);
    try {
      const r = await dispararCampanha({
        nome: wizNome.trim(),
        categoriaNome: wizCategoria || null,
        waNumberId: numeroSel.id,
        templateId: tplSel.id,
        variaveis: variaveisDoTpl,
        filtros: { bairro: filtroBairro, status: filtroStatus },
      });
      setResultado({ enviados: r.enviados, falhas: r.falhas });
      dispatch({ type: 'CAMPANHA_CRIADA', camp: {
        id: r.campanhaId, nome: wizNome.trim(), modelo: tplSel.nome, categoria: wizCategoria || '—',
        data: hojeEmSP().split('-').reverse().join('/'), disparos: r.enviados.toLocaleString('pt-BR'),
        taxa: '—', status: 'Ativa', falhas: r.falhas,
      } });
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Não foi possível disparar.');
    } finally {
      setPublicando(false);
    }
  }

  async function handleAddCategoria() {
    const v = novaCategoriaTexto.trim();
    if (!v || campCategorias.includes(v)) return;
    try {
      await addCategoriaCampanha(org.orgId, v);
      dispatch({ type: 'ADD_CATEGORIA' });
    } catch {
      showToast('Erro ao adicionar categoria');
    }
  }

  async function handleDelCategoria(i: number) {
    try {
      await delCategoriaCampanha(org.orgId, campCategorias[i]);
      dispatch({ type: 'DEL_CATEGORIA', i });
    } catch {
      showToast('Erro ao remover categoria');
    }
  }

  const filtradas = campanhas
    .filter(c => {
      const matchCat = campFiltroCategoria === 'Todas' || c.categoria === campFiltroCategoria;
      const matchSt = campFiltroStatus === 'Todos' || c.status === campFiltroStatus;
      return matchCat && matchSt;
    })
    .sort((a, b) => {
      if (campOrdenar === 'taxa') {
        const ta = parseFloat(a.taxa) || 0;
        const tb = parseFloat(b.taxa) || 0;
        return tb - ta;
      }
      return 0; // manter ordem original para 'recentes'
    });

  const TODAS_CATEGORIAS = ['Todas', ...campCategorias];

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
        {children}
      </div>
    );
  }

  const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', fontSize: 13.5, color: 'var(--text)', width: '100%' };
  const selectStyle = { ...inputStyle, cursor: 'pointer' };

  const bloqueado = publicando
    || (wizStep === 1 && !wizNome.trim())
    || (wizStep === 2 && (!tplSel || !variaveisOk))
    || (wizStep >= 3 && (est === 0 || est > LIMITE_POR_DISPARO));

  function renderWizardStep() {
    if (wizStep === 5) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '40px 0' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--green-b)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke="var(--green-t)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center' }}>
            <span style={{ fontSize: 20, fontWeight: 700 }}>Campanha enviada</span>
            <span style={{ fontSize: 13.5, color: 'var(--text3)', maxWidth: 360, lineHeight: 1.6 }}>
              {fmtNum(resultado?.enviados ?? 0)} enviadas
              {resultado?.falhas ? `, ${fmtNum(resultado.falhas)} não saíram (o motivo está em cada conversa)` : ''}.
              {' '}As respostas chegam em Conversas.
            </span>
          </div>
          <button onClick={() => dispatch({ type: 'SET', key: 'campView', value: 'lista' })} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '10px 24px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }} className="hp">Ver campanhas</button>
        </div>
      );
    }

    return (
      <>
        {/* step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {STEP_LABELS.map((label, i) => {
            const step = i + 1;
            const done = wizStep > step;
            const active = wizStep === step;
            return (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: step < 4 ? 1 : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 700, background: done ? 'var(--primary)' : active ? 'var(--primary-soft)' : 'var(--surface2)', color: done ? '#fff' : active ? 'var(--primary)' : 'var(--text3)', border: active ? '2px solid var(--primary)' : 'none' }}>
                    {done ? <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg> : step}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: active ? 'var(--text)' : 'var(--text3)', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
                {step < 4 && <div style={{ flex: 1, height: 1, background: done ? 'var(--primary)' : 'var(--border)', minWidth: 20 }} />}
              </div>
            );
          })}
        </div>

        {/* step content */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          {wizStep === 1 && (
            <Field label="Nome da campanha">
              <input value={wizNome} onChange={e => dispatch({ type: 'SET', key: 'wizNome', value: e.target.value })} placeholder="Ex.: Retorno de outubro" style={inputStyle} />
            </Field>
          )}

          {wizStep === 2 && (
            <>
              <Field label="Número">
                {numerosComConta.length > 1 ? (
                  <select value={numeroSel?.id ?? ''} onChange={e => { setNumeroId(e.target.value); trocarTemplate(''); }} style={selectStyle}>
                    {numerosComConta.map(n => <option key={n.id} value={n.id}>{n.telefone ?? n.id}</option>)}
                  </select>
                ) : (
                  <input value={numeroSel?.telefone ?? 'Nenhum número conectado'} disabled style={{ ...inputStyle, color: 'var(--text3)', cursor: 'not-allowed' }} />
                )}
              </Field>
              {aprovados.length === 0 ? (
                <div style={{ background: 'var(--amber-b)', color: 'var(--amber-t)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px', fontSize: 12.5, lineHeight: 1.5 }}>
                  Nenhum template aprovado neste número. Crie em Configurações, Templates.
                </div>
              ) : (
                <Field label="Template aprovado">
                  <select value={tplSel?.id ?? ''} onChange={e => trocarTemplate(e.target.value)} style={selectStyle}>
                    {aprovados.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
                  </select>
                </Field>
              )}
              {tplSel && variaveisDoTpl.map((v, i) => (
                <Field key={i} label={`Variável {{${i + 1}}}`}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select value={v.tipo} onChange={e => atualizarVariavel(i, e.target.value === 'nome' ? { tipo: 'nome' } : { tipo: 'texto', valor: '' })}
                      style={{ ...selectStyle, width: 170, flexShrink: 0 }}>
                      <option value="texto">Texto</option>
                      <option value="nome">Nome do contato</option>
                    </select>
                    {v.tipo === 'texto' && (
                      <input value={v.valor} onChange={e => atualizarVariavel(i, { tipo: 'texto', valor: e.target.value })}
                        placeholder={tplSel.variaveis[i]?.exemplo ? `Ex.: ${tplSel.variaveis[i].exemplo}` : ''} style={inputStyle} />
                    )}
                  </div>
                </Field>
              ))}
              {tplSel && (
                <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Pré-visualização</span>
                    <span style={{ fontSize: 11.5, background: 'var(--blue-b)', color: 'var(--blue-t)', border: '1px solid var(--blue-bb)', borderRadius: 'var(--r-pill)', padding: '2px 10px', fontWeight: 600 }}>{nomeDaCategoria(tplSel.categoria)}</span>
                  </div>
                  <div style={{ background: 'var(--wa-out)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, color: 'var(--wa-text)', lineHeight: 1.5, maxWidth: '80%', alignSelf: 'flex-end', boxShadow: '0 1px 2px rgba(0,0,0,.06)', whiteSpace: 'pre-wrap' }}>
                    {preview}
                  </div>
                </div>
              )}
              <Field label="Categoria">
                <select value={wizCategoria} onChange={e => dispatch({ type: 'SET', key: 'wizCategoria', value: e.target.value })} style={selectStyle}>
                  {campCategorias.map(c => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </>
          )}

          {wizStep === 3 && (
            <>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Selecione o público</span>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
                <Field label="Bairro">
                  <select value={pubBairro} onChange={e => dispatch({ type: 'SET', key: 'pubBairro', value: e.target.value })} style={selectStyle}>
                    {BAIRROS.map(b => <option key={b}>{b}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={pubStatus} onChange={e => dispatch({ type: 'SET', key: 'pubStatus', value: e.target.value })} style={selectStyle}>
                    {STATUS_WIZ.map(s => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ background: 'var(--primary-soft)', border: '1px solid var(--primary)', borderRadius: 'var(--r-card)', padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-t)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Alcance estimado</span>
                  <span style={{ fontSize: 28, fontWeight: 800, color: 'var(--primary)', letterSpacing: '-0.02em' }}>{fmtNum(est)}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>contatos com WhatsApp nesses filtros</span>
                </div>
                <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              </div>
              {est > LIMITE_POR_DISPARO && (
                <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>O limite por disparo é {LIMITE_POR_DISPARO} contatos. Use um filtro.</span>
              )}
              <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                Envie só para quem pediu contato. Denúncias derrubam a qualidade do número e podem bloqueá-lo.
              </span>
            </>
          )}

          {wizStep === 4 && (
            <>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Revisar e publicar</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  ['Campanha', wizNome || '—'],
                  ['Número', numeroSel?.telefone ?? '—'],
                  ['Template', tplSel?.nome ?? '—'],
                  ['Categoria', wizCategoria],
                  ['Público', `${pubBairro !== 'Todos' ? pubBairro : 'Todos os bairros'} · ${pubStatus !== 'Todos' ? pubStatus : 'Todos os status'}`],
                  ['Contatos', fmtNum(est)],
                  ['Custo na Meta', `${custoEstimado} (preço de ${PRECOS_META_CONSULTADOS_EM})`],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 12, padding: '10px 14px', background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)' }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text3)', width: 140, flexShrink: 0 }}>{k}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{v}</span>
                  </div>
                ))}
              </div>
              <div style={{ background: 'var(--amber-b)', color: 'var(--amber-t)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px', fontSize: 12.5, lineHeight: 1.5 }}>
                A mensagem sai agora para {fmtNum(est)} contatos. O custo é cobrado pela Meta, na sua conta com ela. Não dá para desfazer.
              </div>
            </>
          )}
        </div>

        {/* navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button onClick={() => {
            if (wizStep === 1) dispatch({ type: 'SET', key: 'campView', value: 'lista' });
            else dispatch({ type: 'SET', key: 'wizStep', value: wizStep - 1 });
          }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">
            {wizStep === 1 ? 'Cancelar' : 'Voltar'}
          </button>
          <button disabled={bloqueado} onClick={() => {
            if (wizStep === 4) handleDisparar();
            else dispatch({ type: 'SET', key: 'wizStep', value: wizStep + 1 });
          }} style={{ background: wizStep === 4 ? 'var(--green-t)' : 'var(--primary)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: bloqueado ? 'not-allowed' : 'pointer', opacity: bloqueado ? 0.5 : 1 }}>
            {publicando ? 'Enviando…' : wizStep === 4 ? 'Disparar agora' : 'Continuar'}
          </button>
        </div>
      </>
    );
  }

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: isMobile ? '18px 14px' : '24px 28px', display: 'flex', flexDirection: 'column', gap: 16, maxWidth: campView === 'wizard' ? 780 : undefined, margin: campView === 'wizard' ? '0 auto' : undefined, width: '100%' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>Campanhas</h1>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>Um template aprovado para uma lista de contatos</span>
        </div>
        {campView === 'lista' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => dispatch({ type: 'SET', key: 'gerenciarCategoriasOpen', value: true })} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 13px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">
              Gerenciar categorias
            </button>
            <button onClick={() => { dispatch({ type: 'SET', key: 'campView', value: 'wizard' }); dispatch({ type: 'SET', key: 'wizStep', value: 1 }); dispatch({ type: 'SET', key: 'wizNome', value: '' }); setResultado(null); }} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 14px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
              Nova campanha
            </button>
          </div>
        )}
      </div>

      {campView === 'lista' && (
        <>
          {/* filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', flex: 1 }}>
              {TODAS_CATEGORIAS.map(cat => (
                <button key={cat} onClick={() => dispatch({ type: 'SET', key: 'campFiltroCategoria', value: cat })}
                  style={{ background: campFiltroCategoria === cat ? 'var(--primary-soft)' : 'var(--surface)', border: `1px solid ${campFiltroCategoria === cat ? 'var(--primary)' : 'var(--border)'}`, color: campFiltroCategoria === cat ? 'var(--primary-t)' : 'var(--text2)', borderRadius: 'var(--r-pill)', padding: '5px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  {cat}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={campFiltroStatus} onChange={e => dispatch({ type: 'SET', key: 'campFiltroStatus', value: e.target.value })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
                {['Todos', 'Ativa', 'Encerrada'].map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={campOrdenar} onChange={e => dispatch({ type: 'SET', key: 'campOrdenar', value: e.target.value })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 10px', fontSize: 13, color: 'var(--text2)', cursor: 'pointer' }}>
                <option value="recentes">Mais recentes</option>
                <option value="taxa">Maior taxa de resposta</option>
              </select>
            </div>
          </div>

          {/* campaign list */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflowX: 'auto' }}>
            {filtradas.length === 0
              ? <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 48 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text2)' }}>{campanhas.length === 0 ? 'Nenhuma campanha ainda' : 'Nenhuma campanha com esses filtros'}</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', textAlign: 'center', maxWidth: 400 }}>
                    {campanhas.length === 0
                      ? 'Campanha envia um template aprovado para um grupo de contatos. Crie o template em Configurações, Templates.'
                      : 'Ajuste os filtros acima para encontrar a campanha.'}
                  </span>
                </div>
              : filtradas.map((c, i) => {
                const { bg, color } = statusBadge(c.status);
                return (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 100px 80px 90px', minWidth: isMobile ? 600 : undefined, alignItems: 'center', gap: 16, padding: '13px 18px', borderTop: i > 0 ? '1px solid var(--border)' : 'none' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{c.nome}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{c.modelo} · {c.categoria}{c.falhas > 0 ? ` · ${fmtNum(c.falhas)} não saíram` : ''}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Disparos</span>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{c.disparos}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Taxa resp.</span>
                      <span style={{ fontSize: 13.5, fontWeight: 600, color: c.taxa !== '—' ? 'var(--green-t)' : 'var(--text3)' }}>{c.taxa}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Data</span>
                      <span className="mono" style={{ fontSize: 12.5, color: 'var(--text2)' }}>{c.data}</span>
                    </div>
                    <span style={{ display: 'inline-block', padding: '3px 11px', borderRadius: 'var(--r-pill)', fontSize: 12, fontWeight: 600, background: bg, color, textAlign: 'center' }}>{c.status}</span>
                  </div>
                );
              })}
          </div>
        </>
      )}

      {campView === 'wizard' && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {renderWizardStep()}
        </div>
      )}

      {/* Gerenciar categorias modal */}
      {gerenciarCategoriasOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(380px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>Gerenciar categorias</span>
              <button onClick={() => dispatch({ type: 'SET', key: 'gerenciarCategoriasOpen', value: false })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {campCategorias.map((cat, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{cat}</span>
                  <button onClick={() => handleDelCategoria(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: '2px 5px', borderRadius: 5, display: 'flex' }} className="hr">
                    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={novaCategoriaTexto} onChange={e => dispatch({ type: 'SET', key: 'novaCategoriaTexto', value: e.target.value })}
                onKeyDown={e => e.key === 'Enter' && handleAddCategoria()}
                placeholder="Nova categoria…" style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
              <button onClick={handleAddCategoria} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Adicionar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { useInsightsDispensados, dispensarInsight } from '@/lib/insights-dispensados';

function reaisDeCentavos(centavos: number): string {
  return `R$ ${(centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Insight {
  id: string;
  texto: string;
  acao: string;
  onAcao: () => void;
}

export default function PainelSection() {
  const { state, dispatch } = useApp();
  const router = useRouter();
  const isMobile = useIsMobile();
  const periodo = state.painelPeriodo;
  const stats = state.painelStats;
  const pKey = periodo === '7d' ? 'd7' as const : periodo === '30d' ? 'd30' as const : 'd90' as const;

  const dispensados = useInsightsDispensados();

  const abertas = state.conversas.filter(c => c.status === 'aberta');
  const comUnread = abertas.filter(c => c.unread > 0).length;

  const origensMap: Record<string, number> = {};
  state.contatos.forEach(c => { origensMap[c.origem] = (origensMap[c.origem] || 0) + 1; });
  const origens = Object.entries(origensMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maxO = origens[0]?.[1] || 1;

  const maxUnidades = Math.max(...stats.produtosVendidos.map(p => p.unidades), 1);
  const maxDia = Math.max(...stats.dias.map(d => d.valor), 1);
  const maxHora = Math.max(...stats.horas.map(h => h.valor), 1);
  const temInteracoes = stats.dias.some(d => d.valor > 0) || stats.horas.some(h => h.valor > 0);

  const semContato30 = state.contatos.filter(c => c.diasSemContato >= 30).length;

  const cards: Array<{ label: string; value: number | string; sub: string; subColor: string; clickable?: boolean; clickableInativos?: boolean }> = [
    { label: `Clientes interagindo (${periodo === '7d' ? 'semana' : periodo === '30d' ? 'mês' : 'trimestre'})`, value: stats.interagindo[pKey], sub: 'conversas com mensagens de clientes', subColor: 'var(--text3)' },
    { label: 'Tempo médio de resposta da IA', value: '—', sub: 'disponível com o WhatsApp conectado', subColor: 'var(--text3)' },
    { label: 'Resolvido só pela IA', value: '—', sub: 'disponível com o WhatsApp conectado', subColor: 'var(--text3)' },
    { label: 'Conversas com msg não lidas', value: comUnread, sub: 'abertas aguardando retorno', subColor: comUnread > 0 ? 'var(--amber-t)' : 'var(--text3)', clickable: true },
    { label: 'Clientes sem contato há +30 dias', value: semContato30, sub: 'clique para reengajar', subColor: semContato30 > 0 ? 'var(--amber-t)' : 'var(--text3)', clickableInativos: true },
    { label: 'Novos contatos', value: stats.novosContatos[pKey], sub: `adicionados nos últimos ${periodo === '7d' ? '7 dias' : periodo === '30d' ? '30 dias' : '90 dias'}`, subColor: 'var(--text3)' },
    { label: 'Vendas confirmadas', value: reaisDeCentavos(stats.valorVendas[pKey]), sub: `${stats.qtdVendas[pKey]} ${stats.qtdVendas[pKey] === 1 ? 'venda com baixa aprovada' : 'vendas com baixa aprovada'}`, subColor: 'var(--text3)' },
  ];

  // ── Insights ──
  // Cada um é uma conta em cima de dado que já existe, com um limiar de
  // elegibilidade e um botão que leva a uma tela que já existe. Nada aqui é
  // texto gerado por IA: o número precisa ser verdade.
  const insightsPossiveis: Insight[] = [
    ...(semContato30 >= 3 ? [{
      id: 'inativos',
      texto: `${semContato30} ${semContato30 === 1 ? 'cliente está' : 'clientes estão'} há mais de 30 dias sem falar com você.`,
      acao: 'Criar campanha de retorno',
      onAcao: () => {
        dispatch({ type: 'SET', key: 'campView', value: 'wizard' });
        dispatch({ type: 'SET', key: 'wizStep', value: 1 });
        dispatch({ type: 'SET', key: 'wizNome', value: 'Campanha de retorno' });
        router.push('/campanhas');
      },
    }] : []),
    ...(stats.transferencias30d >= 5 ? [{
      id: 'gargalo',
      texto: `A IA passou ${stats.transferencias30d} conversas para uma pessoa nos últimos 30 dias — pode estar faltando resposta para alguma dúvida comum.`,
      acao: 'Revisar dúvidas frequentes',
      onAcao: () => router.push('/conhecimento'),
    }] : []),
  ];
  const insights = insightsPossiveis.filter(i => !dispensados.includes(i.id));

  const emptyChart = (msg: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 100, fontSize: 12.5, color: 'var(--text3)', textAlign: 'center', padding: '0 12px' }}>{msg}</div>
  );

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: isMobile ? '20px 16px' : '24px 24px 44px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h1 className="t-sec" style={{ margin: 0, fontSize: isMobile ? 18 : 20 }}>Painel</h1>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text3)' }}>Visão geral do atendimento do seu negócio via WhatsApp</span>
          </div>
          <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: 3 }}>
            {(['7d', '30d', '90d'] as const).map(p => (
              <button key={p} onClick={() => dispatch({ type: 'SET', key: 'painelPeriodo', value: p })}
                style={{ background: periodo === p ? 'var(--bg)' : 'none', boxShadow: periodo === p ? 'var(--sh-raised)' : 'none', border: 'none', color: periodo === p ? 'var(--text)' : 'var(--text3)', borderRadius: 7, padding: '6px 13px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', transition: 'all .12s' }}>
                {p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : '90 dias'}
              </button>
            ))}
          </div>
        </div>

        {/* insights */}
        {insights.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {insights.map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', gap: 12, flexDirection: isMobile ? 'column' : 'row', background: 'var(--surface)', borderRadius: 14, padding: '14px 18px', boxShadow: 'inset 0 0 0 1.5px var(--primary-soft)' }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="var(--green-t)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M9 18h6" /><path d="M10 22h4" />
                  <path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2Z" />
                </svg>
                <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>{i.texto}</span>
                <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                  <button onClick={i.onAcao}
                    style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hp">
                    {i.acao}
                  </button>
                  <button onClick={() => dispensarInsight(i.id)} title="Dispensar"
                    style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text3)', borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">
                    Dispensar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap: 12 }}>
          {cards.map(c => {
            const alerta = (c.clickable && comUnread > 0) || (c.clickableInativos && semContato30 > 0);
            return (
            <div key={c.label}
              onClick={c.clickable ? () => router.push('/conversas') : c.clickableInativos ? () => { dispatch({ type: 'SET', key: 'fInativos', value: true }); router.push('/contatos'); } : undefined}
              style={{ background: 'var(--bg)', border: `1px solid ${alerta ? 'var(--amber-bb)' : 'var(--border)'}`, borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 7, cursor: (c.clickable || c.clickableInativos) ? 'pointer' : 'default', transition: 'background .15s, box-shadow .15s' }}
              className={(c.clickable || c.clickableInativos) ? 'hs' : ''}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', lineHeight: 1.3 }}>{c.label}</span>
              <span className="mono" style={{ fontSize: 23, fontWeight: 600, letterSpacing: '-0.46px', lineHeight: 1.1 }}>{c.value}</span>
              <span style={{ fontSize: 11.5, fontWeight: 500, color: c.subColor, lineHeight: 1.35 }}>{c.sub}</span>
            </div>
            );
          })}
        </div>

        {/* charts row 1 */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Clientes interagindo por dia</span>
            {!temInteracoes ? emptyChart('Sem interações ainda — os gráficos ganham vida quando seus clientes começarem a conversar.') : (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 140, paddingTop: 6 }}>
                {stats.dias.map((d, i) => (
                  <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, height: '100%', justifyContent: 'flex-end' }}>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)' }}>{d.valor}</span>
                    <div style={{ width: '100%', maxWidth: 30, borderRadius: '6px 6px 0 0', background: d.hoje ? 'var(--primary)' : 'var(--surface2)', height: `${Math.max(Math.round((d.valor / maxDia) * 100), 2)}%` }} />
                    <span style={{ fontSize: 11, color: 'var(--text3)', fontWeight: 600 }}>{d.dia}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Interações por horário</span>
            {!temInteracoes ? emptyChart('Sem dados de horário ainda.') : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.horas.map(h => (
                  <div key={h.hora} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text3)', width: 30, flexShrink: 0 }}>{h.hora}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--primary)', width: `${Math.round((h.valor / maxHora) * 100)}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', width: 20, textAlign: 'right', flexShrink: 0 }}>{h.valor}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* charts row 2 */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Principais serviços agendados</span>
            {stats.tipos.length === 0 ? emptyChart('Nenhum agendamento ainda — crie o primeiro na Agenda.') : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.tipos.map(t => (
                  <div key={t.tipo} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.tipo}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--primary)', width: `${t.valor}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', width: 34, textAlign: 'right', flexShrink: 0 }}>{t.valor}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Produtos mais vendidos</span>
            {stats.produtosVendidos.length === 0 ? emptyChart('Nenhuma venda confirmada nos últimos 90 dias — as vendas entram aqui depois que você aprova a baixa no sino.') : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {stats.produtosVendidos.map(p => (
                  <div key={p.nome} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', width: 140, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.nome}>{p.nome}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--primary)', width: `${Math.max(Math.round((p.unidades / maxUnidades) * 100), 2)}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', width: 92, textAlign: 'right', flexShrink: 0 }}>
                      {p.unidades} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>· {reaisDeCentavos(p.valorCentavos)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* charts row 3 */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700 }}>Origem dos contatos</span>
            {origens.length === 0 && emptyChart('Nenhum contato ainda — adicione o primeiro em Contatos.')}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {origens.map(([o, n]) => {
                const pct = Math.round((n / maxO) * 100);
                return (
                  <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', width: 90, flexShrink: 0 }}>{o}</span>
                    <div style={{ flex: 1, height: 8, borderRadius: 'var(--r-pill)', background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--primary)', width: `${pct}%` }} />
                    </div>
                    <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--text2)', width: 44, textAlign: 'right', flexShrink: 0 }}>{n} <span style={{ color: 'var(--text3)', fontWeight: 400 }}>{pct}%</span></span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

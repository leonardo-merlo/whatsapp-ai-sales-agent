'use client'; // formulário que edita o estado da tela Conhecimento

import { useApp } from '@/lib/app-context';

/**
 * Convênios, particular e valor da consulta (S8). Só aparece em empresa de
 * saúde. Desde 29/09 grava com o Salvar principal da tela, entra no Histórico
 * e o simulador enxerga o que está aqui antes de salvar.
 */
export default function ConveniosEValores() {
  const { state, dispatch } = useApp();
  const dados = state.dadosSaude;
  const mudar = (parte: Partial<typeof dados>) => dispatch({ type: 'SET', key: 'dadosSaude', value: { ...dados, ...parte } });

  const campo: React.CSSProperties = { width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13, color: 'var(--text)' };

  return (
    <div data-testid="convenios-e-valores" style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18" /></svg>
        <span style={{ fontSize: 13.5, fontWeight: 700 }}>Convênios e valores</span>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>
        Convênios aceitos
        <input value={dados.convenios} onChange={e => mudar({ convenios: e.target.value })} placeholder="Ex.: Unimed, Bradesco Saúde" style={campo} />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={dados.atendeParticular} onChange={e => mudar({ atendeParticular: e.target.checked })} style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
        Atende particular
      </label>
      {dados.atendeParticular && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>
          Valor da consulta (R$)
          <input inputMode="decimal" value={dados.valorConsulta} onChange={e => mudar({ valorConsulta: e.target.value })} placeholder="Ex.: 250,00" style={{ ...campo, maxWidth: 160 }} />
        </label>
      )}
    </div>
  );
}

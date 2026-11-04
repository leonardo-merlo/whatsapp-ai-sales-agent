'use client'; // botão com modal, leitura e gravação da configuração da empresa

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';

/**
 * Lembrete antes da consulta (S5): ligar e dizer quantas horas antes.
 * Grava em `organizations`, que só admin escreve (RLS).
 */
export default function LembreteConfig() {
  const org = useOrg();
  const { showToast } = useApp();
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(false);
  const [horas, setHoras] = useState(24);
  const [salvando, setSalvando] = useState(false);

  async function abrir() {
    setAberto(true);
    const { data } = await createClient()
      .from('organizations').select('lembrete_ativo, lembrete_horas_antes').eq('id', org.orgId).maybeSingle();
    if (data) { setAtivo(data.lembrete_ativo); setHoras(data.lembrete_horas_antes); }
  }

  async function salvar() {
    const h = Math.round(horas);
    if (!Number.isFinite(h) || h < 1 || h > 72) { showToast('Use de 1 a 72 horas.'); return; }
    setSalvando(true);
    const { error } = await createClient()
      .from('organizations').update({ lembrete_ativo: ativo, lembrete_horas_antes: h }).eq('id', org.orgId);
    setSalvando(false);
    if (error) { showToast('Não foi possível salvar.'); return; }
    showToast(ativo ? `Lembrete ligado, ${h} h antes` : 'Lembrete desligado');
    setAberto(false);
  }

  return (
    <>
      <button onClick={() => void abrir()} data-testid="lembrete-config"
        style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hs">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
        Lembrete
      </button>
      {aberto && (
        <div onClick={() => setAberto(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 22, width: 'min(360px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>Lembrete da consulta</span>
              <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>O paciente recebe o lembrete e responde sim ou não.</span>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>
              Enviar lembrete
              <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--primary)' }} />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 13, fontWeight: 600, color: ativo ? 'var(--text)' : 'var(--text3)' }}>
              Horas antes
              <input type="number" min={1} max={72} value={horas} disabled={!ativo} onChange={e => setHoras(Number(e.target.value))}
                style={{ width: 80, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
            </label>
            <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>Precisa do template lembrete_agendamento aprovado em Templates.</span>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setAberto(false)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
              <button onClick={() => void salvar()} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }} className="hp">{salvando ? 'Salvando…' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

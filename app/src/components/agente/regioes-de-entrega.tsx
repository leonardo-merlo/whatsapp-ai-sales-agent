'use client'; // carrega do banco no navegador e a busca por cidade é interativa

// Regiões de entrega na aba Empresa. Vêm do sistema de gestão (sync mensal) e
// não se editam aqui. Empresa sem regiões sincronizadas não vê nada.

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { dataBRemSP } from '@/lib/fuso';
import { listarRegioesDeEntrega, type RegiaoDeEntrega } from '@/lib/data/regioes-de-entrega';

const semAcento = (valor: string): string =>
  valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function RegioesDeEntrega() {
  const { orgId } = useOrg();
  const [regioes, setRegioes] = useState<RegiaoDeEntrega[] | null>(null);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    listarRegioesDeEntrega(createClient(), orgId).then(lista => { if (ativo) setRegioes(lista); });
    return () => { ativo = false; };
  }, [orgId]);

  const filtradas = useMemo(() => {
    const termo = semAcento(busca.trim());
    if (!regioes || !termo) return regioes ?? [];
    return regioes.filter(r => r.cidades.some(c => semAcento(c.cidade).includes(termo)));
  }, [regioes, busca]);

  if (!regioes || regioes.length === 0) return null;

  const totalDeCidades = new Set(regioes.flatMap(r => r.cidades.map(c => `${c.cidade}/${c.uf}`))).size;
  const sincronizadoEm = regioes.map(r => r.sincronizadoEm).filter(Boolean).sort().at(-1) ?? null;

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <svg style={{ color: 'var(--primary-t)' }} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></svg>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Regiões de entrega</span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text3)' }}>
          {regioes.length} regiões · {totalDeCidades} cidades{sincronizadoEm ? ` · sistema de gestão, ${dataBRemSP(sincronizadoEm)}` : ''}
        </span>
      </div>
      <input
        value={busca}
        onChange={e => setBusca(e.target.value)}
        placeholder="Buscar cidade"
        style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)' }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 320, overflowY: 'auto' }}>
        {filtradas.length === 0 && (
          <span style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 0' }}>Nenhuma região entrega nessa cidade.</span>
        )}
        {filtradas.map(r => {
          const expandida = aberta === r.regiaoId || busca.trim() !== '';
          return (
            <div key={r.regiaoId} style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => setAberta(aberta === r.regiaoId ? null : r.regiaoId)}
                className="hs"
                style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 4px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--text)' }}
              >
                <span style={{ fontSize: 13 }}>
                  {r.nome} <span className="mono" style={{ fontSize: 11.5, color: 'var(--text3)' }}>{r.regiaoId}</span>
                </span>
                <span style={{ fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>{r.cidades.length} cidades</span>
              </button>
              {expandida && (
                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text2)', padding: '0 4px 10px' }}>
                  {r.cidades.map(c => `${c.cidade} (${c.uf})`).join(', ')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

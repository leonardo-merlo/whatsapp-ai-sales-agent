'use client'; // lê os avisos da organização ativa no navegador, como as outras abas

// Cartão "Avisos da integração": o que o ERP mandou num formato que o código
// não lê (`erp/avisos.ts`). Um aviso por dado diferente, com quantas vezes
// chegou. Some da lista quem não chega há 30 dias.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';
import { ROTULO_DO_AVISO, type TipoDeAviso } from '@/lib/erp/avisos-rotulos';
import type { Tables } from '@/lib/supabase/database.types';

type Aviso = Pick<Tables<'erp_avisos'>, 'id' | 'tipo' | 'origem' | 'descricao' | 'referencia' | 'ocorrencias' | 'ultima_em'>;

const JANELA_DIAS = 30;

const ORIGEM: Record<string, string> = { cliente: 'Cliente', produto: 'Produto', regiao: 'Região' };

function rotulo(tipo: string): { titulo: string; efeito: string } {
  return ROTULO_DO_AVISO[tipo as TipoDeAviso] ?? { titulo: tipo, efeito: '' };
}

export default function AvisosDaIntegracao() {
  const { orgId } = useOrg();
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const desde = new Date(Date.now() - JANELA_DIAS * 86_400_000).toISOString();
    createClient().from('erp_avisos')
      .select('id, tipo, origem, descricao, referencia, ocorrencias, ultima_em')
      .eq('organization_id', orgId).gte('ultima_em', desde)
      .order('ultima_em', { ascending: false }).limit(500)
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) setErro(error.message);
        else setAvisos(data ?? []);
      });
    return () => { vivo = false; };
  }, [orgId]);

  const grupos = new Map<string, Aviso[]>();
  for (const a of avisos ?? []) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);

  return (
    <div data-testid="avisos-da-integracao" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>Avisos da integração{avisos?.length ? ` (${avisos.length})` : ''}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>Dados do ERP num formato que o sistema não lê. Últimos {JANELA_DIAS} dias.</div>
      </div>

      {erro && <div style={{ fontSize: 13, color: 'var(--red-t)' }}>Não consegui ler os avisos: {erro}</div>}
      {!erro && !avisos && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Carregando...</div>}
      {avisos && !avisos.length && <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhum aviso.</div>}

      {[...grupos.entries()].map(([tipo, itens]) => {
        const { titulo, efeito } = rotulo(tipo);
        return (
          <div key={tipo} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{titulo} ({itens.length})</div>
            {efeito && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>{efeito}</div>}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {itens.map(a => (
                <div key={a.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200, color: 'var(--text)' }}>{a.descricao}</span>
                  {a.referencia && a.origem === 'cliente' && (
                    <span style={{ color: 'var(--text3)' }}>{ORIGEM[a.origem]} <span className="mono">{a.referencia}</span></span>
                  )}
                  <span style={{ color: 'var(--text3)' }}>{a.ocorrencias === 1 ? '1 vez' : `${a.ocorrencias} vezes`}</span>
                  <span className="mono" style={{ color: 'var(--text3)' }}>{dataBRemSP(a.ultima_em)} {horaEmSP(a.ultima_em)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

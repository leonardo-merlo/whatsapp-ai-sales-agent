'use client'; // busca os orçamentos do contato ao abrir a ficha

// "Em aberto", "Orçamentos pedidos" e "Produtos mais pedidos" na ficha do
// contato do Wappia Vendas. A tabela é lida só por administradores, então para o
// atendente os blocos não existem. A ficha busca uma vez (`useOrcamentosDoContato`)
// e passa para os blocos, que ficam em lugares diferentes dela.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { listarOrcamentosDoContato, produtosMaisPedidos, resumirOrcamento, type OrcamentoDoContato } from '@/lib/data/orcamentos-do-contato';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';
import SecaoRecolhivel from './secao-recolhivel';

const CARTAO = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', display: 'flex', flexDirection: 'column' as const, gap: 6 };

export function useOrcamentosDoContato(contactId: string | null): OrcamentoDoContato[] {
  const [orcamentos, setOrcamentos] = useState<OrcamentoDoContato[]>([]);

  useEffect(() => {
    if (!contactId) return;
    let ativo = true;
    listarOrcamentosDoContato(createClient(), contactId)
      .then(linhas => { if (ativo) setOrcamentos(linhas.map(l => resumirOrcamento(l))); })
      .catch(() => { if (ativo) setOrcamentos([]); });
    return () => { ativo = false; };
  }, [contactId]);

  return contactId ? orcamentos : [];
}

/**
 * Tudo o que está pendente com o cliente. Hoje: orçamento sem terminar e lista
 * esperando o vendedor. Quando o fluxo tiver orçamento, pagamento e entrega,
 * entram aqui também (pedido do Leonardo em 08/10, no backlog).
 */
export function EmAbertoDoContato({ orcamentos }: { orcamentos: OrcamentoDoContato[] }) {
  const abertos = orcamentos.filter(o => o.pendencia);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Em aberto</span>
      {abertos.length === 0 ? (
        <div style={{ ...CARTAO, gap: 0 }}><span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Nada em aberto</span></div>
      ) : abertos.map(o => (
        <div key={o.id} style={{ display: 'flex', flexDirection: 'column', gap: 3, background: 'var(--primary-soft)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-t)' }}>{o.pendencia}</span>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>
            {dataBRemSP(o.criadoEm)} {horaEmSP(o.criadoEm)}{o.cidade ? ` · ${o.cidade}` : ''}{o.itens.length ? ` · ${o.itens.length} ${o.itens.length === 1 ? 'item' : 'itens'}` : ''}{o.validade ? ` · ${o.validade}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function OrcamentosDoContato({ orcamentos }: { orcamentos: OrcamentoDoContato[] }) {
  if (!orcamentos.length) return null;
  const maisPedidos = produtosMaisPedidos(orcamentos);

  return (
    <>
      <SecaoRecolhivel id="orcamentos" titulo="Orçamentos pedidos" contagem={orcamentos.length}>
        {orcamentos.map(o => (
          <div key={o.id} style={CARTAO}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>
                {o.numero !== null ? `Nº ${o.numero} · ${o.validade} · ` : ''}{dataBRemSP(o.criadoEm)} {horaEmSP(o.criadoEm)}{o.cidade ? ` · ${o.cidade}` : ''}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 9px',
                background: o.concluido ? 'var(--green-b)' : 'var(--amber-b)', color: o.concluido ? 'var(--green-t)' : 'var(--amber-t)',
              }}>
                {o.situacao}
              </span>
            </div>
            {o.itens.map(i => (
              <span key={i.codigo} style={{ fontSize: 13, color: 'var(--text2)' }}>
                {i.quantidade ? `${i.quantidade} × ` : ''}{i.descricao} <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{i.codigo}</span>
              </span>
            ))}
            {o.pagamento && (
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Pagamento: {o.pagamento}</span>
            )}
          </div>
        ))}
      </SecaoRecolhivel>

      {maisPedidos.length > 0 && (
        <SecaoRecolhivel id="mais-pedidos" titulo="Produtos mais pedidos" contagem={maisPedidos.length}>
          <div style={CARTAO}>
            {maisPedidos.map(p => (
              <div key={p.codigo} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {p.descricao} <span className="mono" style={{ fontSize: 11, color: 'var(--text3)' }}>{p.codigo}</span>
                </span>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                  {p.vezes} {p.vezes === 1 ? 'lista' : 'listas'}
                </span>
              </div>
            ))}
          </div>
        </SecaoRecolhivel>
      )}
    </>
  );
}

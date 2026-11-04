'use client'; // busca o uso no navegador com o client do usuário (RLS) e mantém estado de período

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { fetchUsoIA, ROTULO_ORIGEM, type PeriodoUso, type ResumoUsoIA, type UsoPorOrigem } from '@/lib/data/uso-ia';

const PERIODOS: readonly PeriodoUso[] = ['7d', '30d', '90d'];

function rotuloPeriodo(p: PeriodoUso): string {
  return p === '7d' ? '7 dias' : p === '30d' ? '30 dias' : '90 dias';
}

function rotuloOrigem(origem: UsoPorOrigem['origem']): string {
  return origem === 'outros' ? 'Outros' : ROTULO_ORIGEM[origem];
}

const fmtNumero = new Intl.NumberFormat('pt-BR');
const fmtDolar = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Abaixo de um centavo o valor formatado vira "US$ 0,00", que parece bug.
// Nesses casos mostra 4 casas para o número não sumir.
function formatarCusto(valor: number): string {
  if (valor > 0 && valor < 0.01) {
    return `US$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`;
  }
  return fmtDolar.format(valor);
}

/**
 * Uso e custo da IA da organização.
 *
 * `podeVer` existe porque o RLS de ai_usage é `is_member_of` — qualquer membro
 * consegue ler os dados. Quem esconde faturamento de atendente é a montagem da
 * tela, não o banco: passe `podeVer={role === 'owner' || role === 'admin'}`.
 */
export default function UsoIASection({ podeVer }: { podeVer: boolean }) {
  const { orgId } = useOrg();
  const isMobile = useIsMobile();
  const [periodo, setPeriodo] = useState<PeriodoUso>('30d');
  // `sinal` só serve para o botão Atualizar reexecutar o efeito sem duplicar a
  // lógica de busca (e sem perder o cancelamento na troca de período).
  const [sinal, setSinal] = useState(0);
  const carregar = useCallback(() => setSinal(n => n + 1), []);

  // O resultado carrega a chave da busca que o produziu. "Carregando" é
  // derivado disso — nada de setState no corpo do efeito para marcar loading.
  const chave = `${periodo}|${sinal}`;
  const [resultado, setResultado] = useState<{ chave: string; dados: ResumoUsoIA } | null>(null);
  const carregando = resultado?.chave !== chave;
  // Enquanto a busca do período novo não volta, não mostra o número do período
  // antigo — seria um dado certo respondendo a uma pergunta diferente.
  const resumo = carregando ? null : (resultado?.dados ?? null);

  useEffect(() => {
    if (!podeVer) return;
    let ativo = true;
    fetchUsoIA(createClient(), orgId, periodo).then(dados => {
      if (ativo) setResultado({ chave, dados });
    });
    return () => { ativo = false; };
  }, [podeVer, orgId, periodo, chave]);

  if (!podeVer) return null;

  const maxCusto = Math.max(...(resumo?.porOrigem.map(o => o.custoUsd) ?? [0]), 0);

  const cards: Array<{ label: string; value: string; sub: string }> = [
    {
      label: 'Custo no período',
      value: resumo ? formatarCusto(resumo.custoUsd) : '—',
      sub: `últimos ${rotuloPeriodo(periodo)}`,
    },
    {
      label: 'Tokens processados',
      value: resumo ? fmtNumero.format(resumo.tokensTotal) : '—',
      sub: resumo
        ? `${fmtNumero.format(resumo.tokensEntrada)} de entrada · ${fmtNumero.format(resumo.tokensSaida)} de saída`
        : 'entrada e saída',
    },
    {
      label: 'Chamadas à IA',
      value: resumo ? fmtNumero.format(resumo.chamadas) : '—',
      sub: 'cada resposta ou resumo conta uma',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* cabeçalho + seletor de período */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em' }}>Uso e custo da IA</span>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>
            Quanto o seu atendente de IA consumiu no período, em dólares.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 2, background: 'var(--surface2)', borderRadius: 999, padding: 3 }}>
          {PERIODOS.map(p => (
            <button
              key={p}
              onClick={() => setPeriodo(p)}
              style={{
                background: periodo === p ? 'var(--bg)' : 'none',
                boxShadow: periodo === p ? '0 1px 3px rgba(0,0,0,.08)' : 'none',
                border: 'none',
                color: periodo === p ? 'var(--text)' : 'var(--text3)',
                borderRadius: 999,
                padding: '7px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all .12s',
              }}
            >
              {rotuloPeriodo(p)}
            </button>
          ))}
        </div>
      </div>

      {/* números do período */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 14 }}>
        {cards.map(c => (
          <div
            key={c.label}
            style={{ background: 'var(--surface)', borderRadius: 16, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 7 }}
          >
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', lineHeight: 1.3 }}>{c.label}</span>
            <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em' }}>{c.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.3 }}>{c.sub}</span>
          </div>
        ))}
      </div>

      {/* quebra por origem */}
      <div style={{ background: 'var(--surface)', borderRadius: 16, padding: 24, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Onde o custo aconteceu</span>
        {carregando ? (
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Carregando…</span>
        ) : !resumo || resumo.porOrigem.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 90, fontSize: 12.5, color: 'var(--text3)', textAlign: 'center', padding: '0 12px' }}>
            Nenhuma chamada à IA nos últimos {rotuloPeriodo(periodo)}.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {resumo.porOrigem.map(o => (
              <div key={o.origem} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 12.5, color: 'var(--text2)', width: isMobile ? 120 : 170, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rotuloOrigem(o.origem)}
                  </span>
                  <div style={{ flex: 1, height: 8, borderRadius: 999, background: 'var(--border2)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', borderRadius: 999, background: 'var(--green-t)', width: `${maxCusto > 0 ? Math.max(Math.round((o.custoUsd / maxCusto) * 100), 2) : 2}%` }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text2)', width: 80, textAlign: 'right', flexShrink: 0 }}>
                    {formatarCusto(o.custoUsd)}
                  </span>
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text3)', paddingLeft: isMobile ? 120 : 170 }}>
                  {fmtNumero.format(o.chamadas)} {o.chamadas === 1 ? 'chamada' : 'chamadas'} · {fmtNumero.format(o.tokens)} tokens
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4 }}>
          O custo é registrado no momento da chamada, com o preço vigente naquele dia. Valores anteriores não mudam se o preço mudar.
        </span>
        <button
          onClick={carregar}
          className="hs"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}
        >
          Atualizar
        </button>
      </div>
    </div>
  );
}

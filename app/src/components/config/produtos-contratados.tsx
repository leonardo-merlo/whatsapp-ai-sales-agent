'use client'; // lê a organização do contexto do client

import { useOrg } from '@/lib/org-context';
import { NOME_DO_PRODUTO, PRODUTOS, WHATSAPP_DA_WAPPIA } from '@/lib/produtos';

const DESCRICAO = {
  atendimento: 'A IA atende, tira dúvida e marca horário.',
  vendas: 'A IA prepara o orçamento para o vendedor.',
} as const;

/** Os dois produtos da Wappia: o contratado em cor, o outro em cinza. */
export default function ProdutosContratados() {
  const { produtos } = useOrg();

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <span style={{ fontSize: 13.5, fontWeight: 700 }}>Produtos</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {PRODUTOS.map(p => {
          const contratado = produtos.includes(p);
          return (
            <div key={p} data-testid={`produto-${p}`} style={{
              display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 'var(--r-ctrl)', padding: '12px 14px',
              border: `1px solid ${contratado ? `var(--produto-${p})` : 'var(--border)'}`,
              background: contratado ? `var(--produto-${p}-soft)` : 'var(--surface2)',
            }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800, color: contratado ? `var(--produto-${p})` : 'var(--text3)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: contratado ? `var(--produto-${p})` : 'var(--border2)' }} />
                Wappia {NOME_DO_PRODUTO[p]}
              </span>
              <span style={{ fontSize: 12.5, color: contratado ? 'var(--text2)' : 'var(--text3)' }}>{DESCRICAO[p]}</span>
              {contratado
                ? <span style={{ fontSize: 12, fontWeight: 700, color: `var(--produto-${p})` }}>Contratado</span>
                : (
                  <a href={WHATSAPP_DA_WAPPIA} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', textDecoration: 'underline' }}>
                    Fale com a Wappia para ativar
                  </a>
                )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

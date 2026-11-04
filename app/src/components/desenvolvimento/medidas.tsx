'use client'; // lê o catálogo da organização ativa no navegador, como as outras abas

// Aba Medidas: os produtos cujas medidas o sistema não conseguiu ler da
// descrição (`catalogo/moldes.ts`). A lista crescer é o sinal de que a empresa
// mudou o jeito de cadastrar. Esses produtos continuam funcionando só pela
// descrição; o que eles perdem é a conferência de medida.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { lerEmPaginas } from '@/lib/catalogo/importar';

interface ProdutoComMolde {
  codigo: string;
  descricao: string;
  molde: string;
  medidas: Record<string, string> | null;
  grupo: string;
}

type Linha = { codigo: string; descricao: string; molde: string; medidas: unknown; catalogo_grupos: { nome: string } | null };

function Lista({ titulo, ajuda, itens, detalhe }: {
  titulo: string;
  ajuda: string;
  itens: ProdutoComMolde[];
  detalhe: (p: ProdutoComMolde) => string;
}) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{titulo} ({itens.length})</div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>{ajuda}</div>
      </div>
      {itens.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhum.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {itens.map(p => (
            <div key={p.codigo} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', padding: '8px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
              <span style={{ fontFamily: 'monospace', color: 'var(--text2)' }}>{p.codigo}</span>
              <span style={{ flex: 1, minWidth: 200, color: 'var(--text)' }}>{p.descricao}</span>
              <span style={{ color: 'var(--text3)' }}>{detalhe(p)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MedidasDoCatalogo() {
  const { orgId } = useOrg();
  const [produtos, setProdutos] = useState<ProdutoComMolde[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const supabase = createClient();
    lerEmPaginas<Linha>((de, ate) => supabase.from('catalogo_produtos')
      .select('codigo, descricao, molde, medidas, catalogo_grupos(nome)')
      .eq('organization_id', orgId).eq('ativo', true).not('molde', 'is', null)
      .order('codigo').range(de, ate) as unknown as PromiseLike<{ data: Linha[] | null; error: { message: string } | null }>)
      .then(linhas => {
        if (!vivo) return;
        setProdutos(linhas.map(l => ({
          codigo: l.codigo, descricao: l.descricao, molde: l.molde,
          medidas: (l.medidas as Record<string, string> | null) ?? null,
          grupo: l.catalogo_grupos?.nome ?? '',
        })));
      })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : String(e)); });
    return () => { vivo = false; };
  }, [orgId]);

  if (erro) return <div style={{ fontSize: 13, color: 'var(--red-t)' }}>Não consegui ler o catálogo: {erro}</div>;
  if (!produtos) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Carregando...</div>;
  if (!produtos.length) {
    return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Esta empresa não tem leitura de medidas.</div>;
  }

  const semMedidas = produtos.filter(p => !p.medidas);
  const lidos = produtos.length - semMedidas.length;
  const chapaDiverge = produtos.filter(p => p.medidas?.chapa_do_grupo);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13.5, color: 'var(--text2)' }}>
        <strong style={{ color: 'var(--text)' }}>{lidos} de {produtos.length}</strong> produtos com medida lida.
      </div>
      <Lista
        titulo="Sem medidas"
        ajuda="A descrição veio num formato que o sistema não lê. Funcionam só pela descrição, sem conferência de medida."
        itens={semMedidas}
        detalhe={p => p.grupo}
      />
      <Lista
        titulo="Chapa diferente do grupo"
        ajuda="A descrição diz uma chapa e o nome do grupo diz outra. Vale a da descrição."
        itens={chapaDiverge}
        detalhe={p => `descrição ${p.medidas?.chapa}, grupo ${p.medidas?.chapa_do_grupo}`}
      />
    </div>
  );
}

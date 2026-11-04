'use client'; // edita o estado da tela e consulta se a empresa tem catálogo

// **"Quando perguntar em vez de escolher" é regra do agente, não do catálogo.**
//
// O campo nasceu junto do dicionário, dentro de "Como ler este catálogo", e os
// dois pareciam da mesma família. Não são: o dicionário diz *como o cliente
// chama cada coisa* — é vocabulário, e vive com a lista de produtos. Este aqui
// diz *o que a IA faz quando fica em dúvida*, que é comportamento, e vive perto
// da instrução principal e do "o que a IA não pode fazer". Foi a leitura do
// Leonardo ao usar a tela, e é a certa.
//
// **O dado não mudou de lugar**: continua em `catalogo_config.regras`. Desde
// 29/09 grava com o Salvar principal da tela, junto do dicionário, então entra
// no Histórico e o simulador lê o que está aqui antes de salvar.
//
// Ele é **da empresa**, não do número: as regras de leitura do catálogo valem
// igual em todos os vendedores (um item errado num orçamento é pior que um item
// faltando). Por isso aparece só quando se edita o padrão de todos os números.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useApp } from '@/lib/app-context';
import { resumoDoCatalogo } from '@/lib/catalogo/consultar';

export default function RegrasDoCatalogo() {
  const org = useOrg();
  const { state, dispatch } = useApp();
  const [supabase] = useState(createClient);
  const [temCatalogo, setTemCatalogo] = useState(false);

  useEffect(() => {
    let vivo = true;
    resumoDoCatalogo(supabase, org.orgId)
      .then(r => { if (vivo) setTemCatalogo(r.produtos > 0); })
      .catch(() => { /* sem catálogo o campo só aparece se já tiver texto */ });
    return () => { vivo = false; };
  }, [supabase, org.orgId]);

  const regras = state.textosDoCatalogo.regras;

  // Sem catálogo e sem nada escrito, este campo seria só ruído numa clínica que
  // digitou seis serviços. Quem já escreveu alguma coisa continua vendo.
  if (!temCatalogo && !regras.trim()) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>Quando perguntar em vez de escolher</span>
        <span style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
          O que o agente faz quando o pedido do cliente casa com mais de um produto do catálogo. Um item
          errado dentro de um orçamento é pior que um item faltando, porque o vendedor lança sem conferir.
        </span>
      </div>
      <textarea
        id="regras-catalogo" value={regras} rows={5}
        onChange={e => dispatch({ type: 'SET', key: 'textosDoCatalogo', value: { ...state.textosDoCatalogo, regras: e.target.value } })}
        placeholder={'Ex.: a medida que o cliente pediu não se troca por outra parecida.\n"cantoneira 3/4" sem a espessura tem dois candidatos: pergunte.'}
        style={{ width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px', fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' }}
      />
      <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45 }}>Vale para todos os números.</span>
    </div>
  );
}

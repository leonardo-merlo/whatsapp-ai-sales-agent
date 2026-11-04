// Lê o orçamento em sombra da conversa, aplica a máquina e grava.
//
// Best-effort, como o resto do rastreio: qualquer falha vira `console.error` e
// devolve `null`, e a resposta ao cliente segue sem saber que isto existiu.
//
// **Nunca `upsert`.** O índice de "um ativo por conversa" é PARCIAL (só etapas
// não finais), e o PostgREST não consegue usar índice parcial em `ON CONFLICT`
// (42P10 — ver a memória "dublê precisa espelhar o banco"). Por isso: lê, e
// então insere ou atualiza por `id` e `versao`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../supabase/database.types';
import type { Rastreio } from './rastreio';
import {
  divergencias, ETAPAS_FINAIS, eventosDaExecucao, proximaEtapaSombra,
  type EtapaSombra,
} from './sombra';

type Client = SupabaseClient<Database>;

interface DadosDaSombra {
  documento?: { valor: string; origem: 'cliente' };
  cliente?: { id: string; nome: string; origem: 'erp' };
}

export interface ResultadoDaSombra {
  antes: EtapaSombra | null;
  depois: EtapaSombra | null;
  divergencias: string[];
}

/** O cliente que o ERP devolveu numa consulta ou num cadastro, se houver. */
function clienteDaChamada(resposta: unknown): { id: string; nome: string } | null {
  const r = (resposta ?? {}) as {
    cliente_id?: unknown; nome?: unknown; encontrado?: unknown;
    cliente?: { id?: unknown; cliente_id?: unknown; nome?: unknown } | null;
  };
  if (r.cliente && typeof r.cliente === 'object') {
    const id = String(r.cliente.id ?? r.cliente.cliente_id ?? '');
    return id ? { id, nome: String(r.cliente.nome ?? '') } : null;
  }
  if (r.encontrado === false || !r.cliente_id) return null;
  return { id: String(r.cliente_id), nome: String(r.nome ?? '') };
}

export async function aplicarSombra(
  supabase: Client,
  r: Rastreio,
  contexto: {
    orgId: string;
    conversationId: string;
    contactId: string | null;
    waNumberId: string | null;
    silencio: boolean;
    resposta: string;
    nomeGuardado: string | null;
  },
): Promise<ResultadoDaSombra | null> {
  try {
    const { data: linhas, error } = await supabase
      .from('orcamentos_em_andamento')
      .select('id, etapa, versao, dados')
      .eq('conversation_id', contexto.conversationId)
      .eq('modo', 'sombra')
      .order('created_at', { ascending: false })
      .limit(5);
    if (error) {
      console.error('Sombra: falha ao ler o orçamento em andamento:', error.message);
      return null;
    }
    const ativo = (linhas ?? []).find(l => !ETAPAS_FINAIS.includes(l.etapa as EtapaSombra)) ?? null;
    const antes = (ativo?.etapa as EtapaSombra | undefined) ?? null;
    const dadosAntes = (ativo?.dados ?? {}) as DadosDaSombra;
    const falaDoCliente = r.entrada?.falaDoCliente ?? '';

    const eventos = eventosDaExecucao({
      ativo: !!ativo,
      silencio: contexto.silencio,
      falaDoCliente,
      documentoGuardado: dadosAntes.documento?.valor ?? null,
      chamadasErp: r.chamadasErp,
    });
    const passo = proximaEtapaSombra(antes, eventos);

    // Os dados acompanham os eventos: o documento vem do cliente; o cliente,
    // só do ERP. X1 (outro documento) limpa o cliente, como no spec.
    const dados: DadosDaSombra = ativo ? { ...dadosAntes } : {};
    const doc = eventos.find(e => e.tipo === 'documento');
    if (doc && doc.tipo === 'documento') {
      dados.documento = { valor: doc.documento, origem: 'cliente' };
      delete dados.cliente;
    }
    for (const c of r.chamadasErp) {
      if (!c.ok || (c.operacao !== 'consultar_cliente' && c.operacao !== 'criar_cliente')) continue;
      const cliente = clienteDaChamada(c.resposta);
      if (cliente) dados.cliente = { ...cliente, origem: 'erp' };
    }

    let turnoAnterior = false;
    if (r.entrada?.mensagemId) {
      const { data: outros } = await supabase
        .from('agente_turnos').select('id').eq('mensagem_id', r.entrada.mensagemId).limit(5);
      turnoAnterior = (outros ?? []).some(o => o.id !== r.turnoId);
    }

    const lista = divergencias({
      transicoes: passo.transicoes,
      visitadas: [...(antes ? [antes] : []), ...passo.visitadas],
      ferramentas: r.ferramentas.map(f => f.nome),
      resposta: contexto.resposta,
      clienteDoErp: dados.cliente?.origem === 'erp',
      nomeGuardado: contexto.nomeGuardado,
      turnoAnteriorDaMesmaMensagem: turnoAnterior,
      falaDoCliente,
      havia_ativo: !!ativo,
    });

    const mensagemId = r.entrada?.mensagemId ?? null;
    if (!ativo && passo.depois) {
      const { error: e } = await supabase.from('orcamentos_em_andamento').insert({
        organization_id: contexto.orgId,
        conversation_id: contexto.conversationId,
        contact_id: contexto.contactId,
        wa_number_id: contexto.waNumberId,
        modo: 'sombra',
        etapa: passo.depois,
        etapa_desde_mensagem: mensagemId,
        dados: dados as Json,
      });
      if (e) console.error('Sombra: falha ao criar o orçamento em sombra:', e.message);
    } else if (ativo && passo.transicoes.length) {
      const { error: e } = await supabase.from('orcamentos_em_andamento').update({
        etapa: passo.depois ?? antes ?? 'aguardando_documento',
        versao: ativo.versao + 1,
        ...(passo.depois !== antes ? { etapa_desde_mensagem: mensagemId } : {}),
        dados: dados as Json,
        updated_at: new Date().toISOString(),
      }).eq('id', ativo.id).eq('versao', ativo.versao);
      if (e) console.error('Sombra: falha ao atualizar o orçamento em sombra:', e.message);
    }

    return { antes, depois: passo.depois, divergencias: lista };
  } catch (err) {
    console.error('Sombra: falhou e foi ignorada:', err instanceof Error ? err.message : err);
    return null;
  }
}

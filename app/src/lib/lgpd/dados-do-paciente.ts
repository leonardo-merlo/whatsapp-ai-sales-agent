// Direitos do titular (LGPD art. 18) para dado de saúde (art. 11): exportar e
// apagar tudo de um paciente (S9).
//
// As duas funções recebem a organização já conferida pela rota e filtram TUDO
// por ela: o id do contato vem do navegador e nunca é acreditado sozinho.
//
// Apagar: o contato leva junto, pelo ON DELETE CASCADE do banco, conversas,
// mensagens, resumos, respostas de questionário e etiquetas. O que o cascade
// não leva e ainda guarda dado do paciente sai aqui, antes: consultas (têm o
// nome), avisos do sino ligados a ele e a ficha das execuções do agente (tem o
// prompt, com as mensagens). Venda fica, sem o vínculo: é registro financeiro.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

/** O que a pessoa digita para confirmar. */
export const PALAVRA_DE_CONFIRMACAO = 'APAGAR';

export interface ExportacaoDoPaciente {
  exportadoEm: string;
  contato: Record<string, unknown>;
  conversas: { id: string; criadaEm: string; mensagens: { autor: string; texto: string; em: string }[] }[];
  historico: Record<string, unknown>[];
  consultas: Record<string, unknown>[];
  questionarios: Record<string, unknown>[];
}

export async function exportarPaciente(
  supabase: Client, orgId: string, contactId: string,
): Promise<ExportacaoDoPaciente | null> {
  const { data: contato } = await supabase
    .from('contacts').select('*').eq('id', contactId).eq('organization_id', orgId).maybeSingle();
  if (!contato) return null;

  const [conversas, historico, consultas, questionarios] = await Promise.all([
    supabase.from('conversations').select('id, created_at').eq('contact_id', contactId).eq('organization_id', orgId).order('created_at'),
    supabase.from('contact_history').select('*').eq('contact_id', contactId),
    supabase.from('appointments').select('servico, data, hora, status, confirmado_em, created_at')
      .eq('contact_id', contactId).eq('organization_id', orgId).order('data'),
    supabase.from('questionnaire_responses').select('respostas, resultado, created_at')
      .eq('contact_id', contactId).eq('organization_id', orgId),
  ]);

  const ids = (conversas.data ?? []).map(c => c.id);
  const { data: mensagens } = ids.length
    ? await supabase.from('messages').select('conversation_id, autor, texto, created_at')
      .in('conversation_id', ids).eq('organization_id', orgId).order('created_at')
    : { data: [] as { conversation_id: string; autor: string; texto: string; created_at: string }[] };

  return {
    exportadoEm: new Date().toISOString(),
    contato,
    conversas: (conversas.data ?? []).map(c => ({
      id: c.id,
      criadaEm: c.created_at,
      mensagens: (mensagens ?? [])
        .filter(m => m.conversation_id === c.id && m.autor !== 'sys' && m.autor !== 'nota')
        .map(m => ({ autor: m.autor, texto: m.texto, em: m.created_at })),
    })),
    historico: historico.data ?? [],
    consultas: consultas.data ?? [],
    questionarios: questionarios.data ?? [],
  };
}

export type ResultadoDeApagar = { apagado: true } | { apagado: false; motivo: 'nao-encontrado' | 'erro'; detalhe?: string };

/** `supabase` aqui é o service role: a ficha do agente não tem política de
 *  apagar para ninguém. A rota só chega aqui depois de conferir que quem pede
 *  é admin DESTA organização. */
export async function apagarPaciente(
  supabase: Client, orgId: string, contactId: string,
): Promise<ResultadoDeApagar> {
  const { data: contato } = await supabase
    .from('contacts').select('id').eq('id', contactId).eq('organization_id', orgId).maybeSingle();
  if (!contato) return { apagado: false, motivo: 'nao-encontrado' };

  const { data: conversas } = await supabase
    .from('conversations').select('id').eq('contact_id', contactId).eq('organization_id', orgId);
  const ids = (conversas ?? []).map(c => c.id);

  try {
    if (ids.length) {
      await supabase.from('agente_turnos').delete().in('conversation_id', ids).eq('organization_id', orgId);
    }
    await supabase.from('appointments').delete().eq('contact_id', contactId).eq('organization_id', orgId);
    await supabase.from('notificacoes').delete().eq('contact_id', contactId).eq('organization_id', orgId);
    const { error } = await supabase.from('contacts').delete().eq('id', contactId).eq('organization_id', orgId);
    if (error) return { apagado: false, motivo: 'erro', detalhe: error.message };
    return { apagado: true };
  } catch (err) {
    return { apagado: false, motivo: 'erro', detalhe: err instanceof Error ? err.message : String(err) };
  }
}

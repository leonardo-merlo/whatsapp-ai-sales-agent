// Ao encerrar uma conversa, gera um resumo curto (2-3 linhas) do atendimento e
// grava na ficha do contato (contact_history). Nas próximas conversas, esse
// resumo é injetado no prompt da IA para dar memória entre atendimentos.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { logAiUsage, MODELO_IA } from './log-uso';

type Client = SupabaseClient<Database>;

export async function resumirConversa(supabase: Client, orgId: string, conversationId: string): Promise<void> {
  const { data: conv } = await supabase
    .from('conversations').select('contact_id, wa_number_id, resumida_em').eq('id', conversationId).single();
  if (!conv?.contact_id) return;

  // Só o que veio depois do resumo anterior: quem conversa de manhã e volta à
  // noite ganha dois resumos, e o da noite não repete o da manhã.
  let consulta = supabase
    .from('messages')
    .select('autor, texto')
    .eq('conversation_id', conversationId)
    .in('autor', ['cliente', 'ia', 'humano']);
  if (conv.resumida_em) consulta = consulta.gt('created_at', conv.resumida_em);
  const { data: mensagens } = await consulta
    .order('created_at', { ascending: true })
    .limit(60);
  if (!mensagens?.length) return;

  const transcricao = mensagens
    .map(m => `${m.autor === 'cliente' ? 'Cliente' : 'Atendimento'}: ${m.texto}`)
    .join('\n');

  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODELO_IA,
    max_tokens: 256,
    system: 'Você resume atendimentos de WhatsApp para a ficha do cliente. Escreva 2 a 3 linhas, em português, registrando o que o cliente queria, o que foi combinado e qualquer preferência ou dado útil para um próximo contato. Sem saudações, sem markdown, só o resumo.',
    messages: [{ role: 'user', content: `Resuma este atendimento:\n\n${transcricao}` }],
  });

  await logAiUsage(supabase, { orgId, origem: 'resumo', model: MODELO_IA, usage: response.usage, conversationId });

  const bloco = response.content.find(b => b.type === 'text');
  const resumo = bloco && bloco.type === 'text' ? bloco.text.trim() : '';
  if (!resumo) return;

  const { error: histError } = await supabase.from('contact_history').insert({
    organization_id: orgId,
    contact_id: conv.contact_id,
    canal: 'IA',
    resumo,
    data: new Date().toISOString(),
    // De qual número veio este resumo: a IA de outro vendedor não pode lê-lo.
    wa_number_id: conv.wa_number_id,
  });
  if (histError) {
    console.error('Falha ao gravar contact_history:', histError.message);
    return;
  }

  await supabase.from('conversations').update({ resumida_em: new Date().toISOString() }).eq('id', conversationId);
}

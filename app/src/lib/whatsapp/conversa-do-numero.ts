// Qual conversa recebe uma mensagem que chegou por um número.
//
// Estava dentro do webhook e saiu para cá quando a coexistência entrou: o eco
// (o que o vendedor digita no celular dele) precisa cair **na mesma conversa**
// que a mensagem do cliente. Duas cópias dessa regra é o tipo de coisa que
// funciona no dia em que é escrita e diverge na semana seguinte.
//
// A regra, decidida em 2026-09-10: uma conversa aberta por número. O cliente
// que fala com o João e com o Pedro tem duas conversas, e a IA de cada um só vê
// a dele. Conversa aberta sem número (anterior a essa separação) serve de
// reserva e é carimbada aqui — é o que mantém o Wappia Atendimento, com um
// número só, funcionando igual a antes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export async function resolverConversaDoNumero(
  supabase: Client,
  { orgId, contatoId, waNumberId }: { orgId: string; contatoId: string; waNumberId: string | null },
): Promise<string | null> {
  const { data: abertas } = await supabase
    .from('conversations')
    .select('id, wa_number_id')
    .eq('organization_id', orgId)
    .eq('contact_id', contatoId)
    .eq('status', 'aberta')
    .order('updated_at', { ascending: false })
    .limit(20);

  const conversa = waNumberId
    ? (abertas ?? []).find(c => c.wa_number_id === waNumberId) ?? (abertas ?? []).find(c => !c.wa_number_id)
    : (abertas ?? [])[0];

  if (!conversa) {
    const { data: nova, error } = await supabase
      .from('conversations')
      .insert({
        organization_id: orgId, contact_id: contatoId, assunto: 'WhatsApp', status: 'aberta', modo: 'ia',
        // Por qual número esta conversa entrou. É o que o atendente humano vai
        // usar depois para responder pelo mesmo número.
        wa_number_id: waNumberId,
      })
      .select('id')
      .single();
    if (error) {
      console.error('Erro ao criar conversa do webhook:', error.message);
      return null;
    }
    return nova.id;
  }

  if (waNumberId && !conversa.wa_number_id) {
    // Conversa aberta antes de existir a tabela de números: carimba o número
    // agora. Só quando está vazio — sobrescrever apagaria a informação de por
    // onde ela realmente entrou.
    await supabase.from('conversations').update({ wa_number_id: waNumberId }).eq('id', conversa.id);
  }
  return conversa.id;
}

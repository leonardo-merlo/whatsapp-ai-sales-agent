// Envia uma mensagem do atendente humano para o cliente no WhatsApp.
// Precisa ser uma rota de servidor porque o WHATSAPP_ACCESS_TOKEN é secreto e
// não pode ir para o navegador. Envia primeiro e grava depois: assim a conversa
// no painel nunca mostra uma mensagem que o cliente não recebeu.
// Autenticado pela sessão do usuário (client Supabase normal, com RLS).

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send-message';
import { normalizarTelefoneWhatsApp } from '@/lib/whatsapp/telefone';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });

  let body: { conversationId?: string; texto?: string; assumir?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const texto = body.texto?.trim();
  if (!body.conversationId || !texto) {
    return Response.json({ error: 'Conversa e texto são obrigatórios' }, { status: 400 });
  }

  const { data: conversa } = await supabase
    .from('conversations')
    .select('id, contact_id, contacts(telefone, wa_user_id), wa_numbers(phone_number_id)')
    .eq('id', body.conversationId)
    .eq('organization_id', member.organizationId)
    .maybeSingle();
  if (!conversa) return Response.json({ error: 'Conversa não encontrada' }, { status: 404 });

  const contato = conversa.contacts as { telefone: string | null; wa_user_id: string | null } | null;
  // Responder pelo mesmo número por onde a conversa entrou. Sem isso, o cliente
  // que escreveu para o vendedor João receberia a resposta pelo número do Pedro.
  // Nulo em conversa antiga: aí vale o comportamento antigo (o número da org).
  const numeroDeSaida = (conversa.wa_numbers as { phone_number_id: string } | null)?.phone_number_id ?? null;
  const telefone = contato?.telefone ? normalizarTelefoneWhatsApp(contato.telefone) : null;
  // Sem telefone válido, o BSUID: o cliente que escreveu com nome de usuário,
  // sem que a Meta mandasse o número.
  const bsuid = contato?.wa_user_id ?? null;
  if (!telefone && !bsuid) {
    return Response.json({ error: 'O telefone deste contato não é um número de WhatsApp válido. Corrija o cadastro do contato para poder responder.' }, { status: 400 });
  }

  try {
    await sendWhatsAppMessage(member.organizationId, { telefone, bsuid }, texto, numeroDeSaida);
  } catch (err) {
    console.error('Erro ao enviar mensagem do atendente:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Não foi possível entregar a mensagem no WhatsApp. Ela não foi enviada — tente novamente.' }, { status: 502 });
  }

  const { data: msg, error: msgError } = await supabase
    .from('messages')
    .insert({
      organization_id: member.organizationId,
      conversation_id: conversa.id,
      autor: 'humano',
      texto,
      read: true,
    })
    .select('id')
    .single();
  if (msgError) {
    console.error('Mensagem entregue no WhatsApp mas não gravada:', msgError.message);
    return Response.json({ error: 'A mensagem foi entregue, mas não apareceu no histórico. Recarregue a conversa.' }, { status: 500 });
  }

  if (body.assumir) {
    await supabase
      .from('conversations')
      .update({ modo: 'humano', atendente_id: member.memberId })
      .eq('id', conversa.id);
  }

  return Response.json({ id: msg.id });
}

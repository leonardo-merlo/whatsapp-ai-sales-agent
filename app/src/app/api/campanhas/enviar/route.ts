// "Nova conversa" em Conversas: a empresa puxa conversa com UM contato.
//
// Dois jeitos, porque a Meta tem duas regras:
// - **Template aprovado** sai sempre, e é o único que alcança quem não
//   escreveu nas últimas 24 horas.
// - **Texto livre** só sai dentro da janela de 24 horas desde a última
//   mensagem do cliente. Fora dela a Meta recusa; a rota confere antes e diz
//   o motivo, em vez de mandar e falhar.
//
// O WHATSAPP_ACCESS_TOKEN é secreto, por isso precisa ser rota de servidor.
// Autenticado pela sessão do usuário (client Supabase normal, com RLS).

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { sendWhatsAppMessage } from '@/lib/whatsapp/send-message';
import { normalizarTelefoneWhatsApp } from '@/lib/whatsapp/telefone';
import { createServiceClient } from '@/lib/supabase/service';
import { enviarTemplateNaConversa } from '@/lib/whatsapp/template-na-conversa';
import { preencherCorpo } from '@/lib/whatsapp/regras-de-template';

const JANELA_MS = 24 * 60 * 60 * 1000;

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });

  let body: { contactId?: string; assunto?: string; texto?: string; templateId?: string; valores?: string[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const texto = body.texto?.trim();
  if (!body.contactId || (!texto && !body.templateId)) {
    return Response.json({ error: 'Escolha o contato e a mensagem.' }, { status: 400 });
  }
  const contactId = body.contactId;

  const { data: contato } = await supabase
    .from('contacts')
    .select('id, telefone, wa_user_id')
    .eq('id', contactId)
    .eq('organization_id', member.organizationId)
    .maybeSingle();
  if (!contato) return Response.json({ error: 'Contato não encontrado' }, { status: 404 });

  const telefone = contato.telefone ? normalizarTelefoneWhatsApp(contato.telefone) : null;
  if (!telefone && !contato.wa_user_id) {
    return Response.json({ error: 'O telefone deste contato não é um número de WhatsApp válido. Corrija o cadastro do contato para poder enviar a campanha.' }, { status: 400 });
  }

  if (body.templateId) {
    return enviarTemplate(member.organizationId, contactId, telefone, body.templateId, body.valores ?? []);
  }
  if (!texto) return Response.json({ error: 'Escreva a mensagem.' }, { status: 400 });

  // A janela conta da última mensagem DO CLIENTE, em qualquer conversa dele.
  const { data: conversasDoContato } = await supabase
    .from('conversations').select('id')
    .eq('organization_id', member.organizationId).eq('contact_id', contactId);
  const ids = (conversasDoContato ?? []).map(c => c.id);
  const { data: recente } = ids.length
    ? await supabase.from('messages').select('id')
      .in('conversation_id', ids).eq('autor', 'cliente')
      .gte('created_at', new Date(Date.now() - JANELA_MS).toISOString())
      .limit(1)
    : { data: [] };
  if (!recente?.length) {
    return Response.json({ error: 'Este contato não escreveu nas últimas 24 horas. Use um template.' }, { status: 400 });
  }

  try {
    await sendWhatsAppMessage(member.organizationId, { telefone, bsuid: contato.wa_user_id }, texto);
  } catch (err) {
    console.error('Erro ao enviar mensagem de campanha:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'Não foi possível entregar a mensagem no WhatsApp. Ela não foi enviada — nenhuma conversa foi criada. Tente novamente.' }, { status: 502 });
  }

  const { data: conversa, error: convError } = await supabase
    .from('conversations')
    .insert({
      organization_id: member.organizationId,
      contact_id: contactId,
      assunto: body.assunto ?? 'WhatsApp',
      status: 'aberta',
      modo: 'ia',
    })
    .select('id')
    .single();
  if (convError) {
    console.error('Mensagem entregue no WhatsApp mas conversa não criada:', convError.message);
    return Response.json({ error: 'A mensagem foi entregue, mas a conversa não foi criada. Recarregue e verifique antes de enviar de novo.' }, { status: 500 });
  }

  await supabase
    .from('conversation_tags')
    .insert({ organization_id: member.organizationId, conversation_id: conversa.id, tag: 'Envio ativo' });

  const { error: msgError } = await supabase
    .from('messages')
    .insert({
      organization_id: member.organizationId,
      conversation_id: conversa.id,
      autor: 'ia',
      texto,
      read: true,
      camp: true,
    });
  if (msgError) {
    console.error('Conversa criada mas mensagem não gravada:', msgError.message);
    return Response.json({ error: 'A mensagem foi entregue, mas não apareceu no histórico. Recarregue a conversa.' }, { status: 500 });
  }

  return Response.json({ conversationId: conversa.id });
}

/** Template aprovado para um contato, pelo número da conta dona do template. */
async function enviarTemplate(
  orgId: string, contactId: string, telefone: string | null, templateId: string, valores: string[],
): Promise<Response> {
  if (!telefone) return Response.json({ error: 'Este contato não tem telefone de WhatsApp.' }, { status: 400 });

  const service = createServiceClient();
  const { data: template } = await service
    .from('wa_templates').select('nome, corpo, waba_id')
    .eq('id', templateId).eq('organization_id', orgId).maybeSingle();
  if (!template) return Response.json({ error: 'Template não encontrado.' }, { status: 404 });

  // Template é da conta do WhatsApp: sai por um número dessa conta, de
  // preferência o de atendimento, que é quem fala em nome da empresa.
  const { data: numeros } = await service
    .from('wa_numbers').select('id, phone_number_id, papel')
    .eq('organization_id', orgId).eq('waba_id', template.waba_id).eq('ativo', true);
  const numero = (numeros ?? []).find(n => n.papel === 'atendimento') ?? numeros?.[0];
  if (!numero) return Response.json({ error: 'Nenhum número conectado na conta deste template.' }, { status: 400 });

  const { data: contato } = await service.from('contacts').select('nome').eq('id', contactId).maybeSingle();
  const resultado = await enviarTemplateNaConversa(service, {
    orgId,
    waNumberId: numero.id,
    phoneNumberId: numero.phone_number_id,
    telefone,
    nome: contato?.nome ?? '',
    contatoId: contactId,
    template: { nome: template.nome, valores },
    textoNaConversa: preencherCorpo(template.corpo, valores),
  });
  if (!resultado.enviado) {
    // A tentativa e o motivo ficaram na conversa, que existe: a tela abre nela.
    return Response.json({ error: resultado.erro ?? 'Não foi possível enviar.', conversationId: resultado.conversationId }, { status: 502 });
  }
  return Response.json({ conversationId: resultado.conversationId });
}

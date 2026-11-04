// O aviso de cada mudança de status do pedido: ao cliente pelo número do vendedor, ou ao vendedor pelo copiloto.
//
// Dentro da janela de 24 h (o cliente escreveu nas últimas 24 h) vai texto livre, que a Meta entrega sem template e
// sem custo. Fora dela, só template aprovado: sem ele, `enviarTemplateNaConversa` deixa na conversa o que a gente ia
// dizer e o motivo de não ter saído. Nada aqui lança: o status do pedido já foi guardado, o aviso é o passo seguinte.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { numeroCopiloto } from '../agente/avisar-vendedor';
import { sendWhatsAppMessage } from '../whatsapp/send-message';
import { enviarTemplateNaConversa } from '../whatsapp/template-na-conversa';
import { TIPOS_DE_EVENTO, variaveisDoAviso, type EventoDoPedido } from './eventos-do-pedido';

type Client = SupabaseClient<Database>;

export const JANELA_DO_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export interface PedidoParaAviso {
  organization_id: string;
  conversation_id: string | null;
  contact_id: string | null;
  wa_number_id: string | null;
}

export type ResultadoDoAvisoDeStatus =
  | { enviado: true; como: 'texto' | 'template'; para: 'cliente' | 'vendedor' }
  | { enviado: false; motivo: string };

async function dentroDaJanela(supabase: Client, conversationId: string, agora: number): Promise<boolean> {
  const { data } = await supabase.from('messages').select('created_at')
    .eq('conversation_id', conversationId).eq('autor', 'cliente')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  return !!data && agora - new Date(data.created_at).getTime() < JANELA_DO_WHATSAPP_MS;
}

export async function avisarStatusDoPedido(
  supabase: Client, pedido: PedidoParaAviso, evento: EventoDoPedido, agora = Date.now(),
): Promise<ResultadoDoAvisoDeStatus> {
  const tipo = TIPOS_DE_EVENTO[evento.tipo];
  if (!tipo) return { enviado: false, motivo: `tipo ${evento.tipo} sem aviso` };
  const orgId = pedido.organization_id;

  const [{ data: contato }, { data: numero }] = await Promise.all([
    pedido.contact_id ? supabase.from('contacts').select('nome, telefone, wa_user_id').eq('id', pedido.contact_id).maybeSingle() : Promise.resolve({ data: null }),
    pedido.wa_number_id ? supabase.from('wa_numbers').select('id, phone_number_id, member_id').eq('id', pedido.wa_number_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const { data: membro } = numero?.member_id
    ? await supabase.from('organization_members').select('nome, telefone_whatsapp').eq('id', numero.member_id).maybeSingle()
    : { data: null };
  const valores = variaveisDoAviso(evento, { cliente: contato?.nome ?? '', vendedor: membro?.nome ?? '' });
  const texto = tipo.texto(valores);
  const template = { nome: tipo.template, valores: Object.fromEntries(tipo.variaveis.map(v => [v, valores[v]])) };

  if (tipo.vai === 'vendedor') {
    const telefone = membro?.telefone_whatsapp?.trim();
    if (!telefone) return { enviado: false, motivo: 'vendedor do número sem WhatsApp cadastrado' };
    const copiloto = await numeroCopiloto(supabase, orgId);
    if (!copiloto) return { enviado: false, motivo: 'organização sem número copiloto' };
    const r = await enviarTemplateNaConversa(supabase, {
      orgId, waNumberId: copiloto.id, phoneNumberId: copiloto.phone_number_id, telefone, nome: membro?.nome ?? 'vendedor', template, textoNaConversa: texto,
    });
    return r.enviado ? { enviado: true, como: 'template', para: 'vendedor' } : { enviado: false, motivo: r.erro ?? 'falha no envio' };
  }

  if (!pedido.conversation_id || !contato || !numero) return { enviado: false, motivo: 'pedido sem conversa, contato ou número' };
  if (await dentroDaJanela(supabase, pedido.conversation_id, agora)) {
    const { error } = await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: pedido.conversation_id, autor: 'ia', texto, read: true,
    });
    if (error) console.error('Erro ao gravar o aviso do pedido:', error.message);
    try {
      await sendWhatsAppMessage(orgId, { telefone: contato.telefone, bsuid: contato.wa_user_id }, texto, numero.phone_number_id);
      return { enviado: true, como: 'texto', para: 'cliente' };
    } catch (err) {
      const erro = err instanceof Error ? err.message : String(err);
      await supabase.from('messages').insert({ organization_id: orgId, conversation_id: pedido.conversation_id, autor: 'sys', texto: `Aviso não entregue (${tipo.template}): ${erro}`, read: true });
      return { enviado: false, motivo: erro };
    }
  }
  if (!contato.telefone) return { enviado: false, motivo: 'contato sem telefone: template precisa do número' };
  const r = await enviarTemplateNaConversa(supabase, {
    orgId, waNumberId: numero.id, phoneNumberId: numero.phone_number_id, telefone: contato.telefone, nome: contato.nome,
    contatoId: pedido.contact_id ?? undefined, template, textoNaConversa: texto,
  });
  return r.enviado ? { enviado: true, como: 'template', para: 'cliente' } : { enviado: false, motivo: r.erro ?? 'falha no envio' };
}

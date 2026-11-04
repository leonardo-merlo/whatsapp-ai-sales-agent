// Serviço de envio via WhatsApp Cloud API (Graph API). Usado pela IA no webhook
// e pelo atendente humano, via /api/conversas/enviar.

import { createServiceClient } from '../supabase/service';
import { tokenDeEnvio } from './token-do-cliente';
import { ehFalhaDePagamento, marcarEnvioOk, marcarFalhaDePagamento } from './billing-status';

export const GRAPH_API_VERSION = 'v22.0';

/** Para quem a mensagem vai. O telefone manda quando existe; o BSUID (o id do
 *  cliente por portfólio, que a Meta criou com os nomes de usuário) é o que
 *  sobra quando o cliente escreveu sem que o telefone viesse junto. */
export interface DestinoWhatsApp {
  telefone: string | null;
  bsuid: string | null;
}

/**
 * @param phoneNumberIdDeSaida Número da Cloud API por onde a mensagem sai.
 *   Quem sabe por qual número a conversa entrou precisa dizer aqui: com vários
 *   números na mesma empresa (Wappia Vendas), deduzir pela organização faria o
 *   cliente do vendedor João receber a resposta pelo número do Pedro.
 *   Omitido, vale o comportamento antigo — o único número da organização.
 */
export async function sendWhatsAppMessage(
  orgId: string,
  para: string | DestinoWhatsApp,
  texto: string,
  phoneNumberIdDeSaida?: string | null,
): Promise<void> {
  await enviarPelaGraph(orgId, para, { type: 'text', text: { body: texto } }, phoneNumberIdDeSaida);
}

/** Template aprovado na Meta, com os valores das variáveis na ordem ({{1}}, {{2}}…). */
export interface TemplateParaEnviar {
  nome: string;
  variaveis: string[];
  /** Código de idioma do template na Meta. Todos os nossos são pt_BR. */
  idioma?: string;
}

/**
 * Envia um template aprovado. É o único tipo de mensagem que pode puxar uma
 * conversa ou falar com alguém fora da janela de 24 h desde a última mensagem
 * dele — lembrete de agenda, aviso do copiloto ao vendedor. Dentro da janela,
 * a resposta normal continua sendo texto livre (`sendWhatsAppMessage`).
 *
 * @returns o `wamid` que a Meta deu à mensagem.
 */
export async function sendWhatsAppTemplate(
  orgId: string,
  para: string | DestinoWhatsApp,
  template: TemplateParaEnviar,
  phoneNumberIdDeSaida?: string | null,
): Promise<string | null> {
  if (template.variaveis.some(v => !v.trim())) {
    // A Meta recusa parâmetro vazio, mas só depois de a chamada sair; aqui o
    // erro diz qual template e evita gastar a tentativa.
    throw new Error(`Template ${template.nome} com variável vazia.`);
  }
  return enviarPelaGraph(orgId, para, {
    type: 'template',
    template: {
      name: template.nome,
      language: { code: template.idioma ?? 'pt_BR' },
      ...(template.variaveis.length
        ? { components: [{ type: 'body', parameters: template.variaveis.map(text => ({ type: 'text', text })) }] }
        : {}),
    },
  }, phoneNumberIdDeSaida);
}

async function enviarPelaGraph(
  orgId: string,
  para: string | DestinoWhatsApp,
  conteudo: Record<string, unknown>,
  phoneNumberIdDeSaida?: string | null,
): Promise<string | null> {
  const destino: DestinoWhatsApp = typeof para === 'string' ? { telefone: para, bsuid: null } : para;
  if (!destino.telefone && !destino.bsuid) throw new Error('Contato sem telefone e sem BSUID: não há para onde enviar.');

  let phoneNumberId = phoneNumberIdDeSaida ?? null;
  if (!phoneNumberId) {
    const supabase = createServiceClient();
    const { data: org, error } = await supabase
      .from('organizations')
      .select('wa_phone_number_id')
      .eq('id', orgId)
      .single();
    if (error) throw error;
    phoneNumberId = org.wa_phone_number_id;
  }
  if (!phoneNumberId) {
    throw new Error('WhatsApp não configurado para esta organização (sem wa_phone_number_id).');
  }

  // Quem autoriza o envio é o dono do número: o business token do cliente
  // quando ele conectou pelo Embedded Signup, o token da Wappia quando não.
  // Só dá para decidir depois de saber por qual número a mensagem sai.
  const accessToken = await tokenDeEnvio(phoneNumberId);

  const resp = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      // `to` e `recipient` são campos diferentes da mesma API; com os dois, a
      // Meta usa o telefone. Manda só um, para o corpo dizer o que aconteceu.
      ...(destino.telefone ? { to: destino.telefone } : { recipient: destino.bsuid }),
      ...conteudo,
    }),
  });

  const body = await resp.json().catch(() => null) as
    { messages?: { id?: string }[]; error?: { message?: string; code?: number } } | null;
  if (!resp.ok) {
    const msg = body?.error?.message ?? `Falha ao enviar mensagem via WhatsApp (HTTP ${resp.status})`;
    // O código é o que diz o motivo de verdade (131042/131044 = pagamento,
    // 132001 = template não existe, 132000 = número de variáveis).
    if (ehFalhaDePagamento(body?.error?.code)) {
      await marcarFalhaDePagamento(phoneNumberId, body!.error!.code!, msg)
        .catch(e => console.error('Billing: não foi possível registrar a falha', e));
    }
    throw new Error(body?.error?.code ? `${msg} (código ${body.error.code})` : msg);
  }
  // Awaited: na imensa maioria das mensagens isto é um update que não casa
  // linha nenhuma (o número já está 'ok'), então o custo extra é mínimo — e
  // esperar evita o cliente ver "status ok" antes de a limpeza ter terminado.
  await marcarEnvioOk(phoneNumberId).catch(e => console.error('Billing: não foi possível limpar o status', e));
  return body?.messages?.[0]?.id ?? null;
}

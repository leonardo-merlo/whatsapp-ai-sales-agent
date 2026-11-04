// Webhook receiver da WhatsApp Cloud API (Meta).
// Endpoint público e não-autenticado por sessão — a autenticação É a
// verificação da assinatura HMAC (X-Hub-Signature-256) em todo POST.
// Usa o client service_role (bypassa RLS): não há usuário logado aqui,
// a "autorização" é resolver a org pelo phone_number_id do próprio payload
// (nunca aceitar organization_id vindo de fora).

import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { responderConversaComIA } from '@/lib/agente/responder-conversa';
import { usarFila } from '@/lib/agente/fila';
import { buscarConfigDoAgente } from '@/lib/agente/config-do-numero';
import { lerMidiaDoCliente, textoProvisorioDaMidia, type TipoMidia } from '@/lib/agente/midia-do-cliente';
import { resolverContatoDoWebhook } from '@/lib/whatsapp/contato-do-webhook';
import { resolverConversaDoNumero } from '@/lib/whatsapp/conversa-do-numero';
import { registrarEcosDoVendedor, type EcoRecebido } from '@/lib/whatsapp/eco-do-vendedor';
import { tratarEventoDeTemplate, type EventoDeTemplate } from '@/lib/whatsapp/catalogo-de-templates';

export const runtime = 'nodejs';
// Teto explícito em vez do padrão da plataforma, que muda com o plano da
// Vercel. Importa desde que a mensagem repetida da Meta passou a ser ignorada
// (wamid): se este request for cortado DEPOIS de gravar a mensagem e ANTES de
// responder, o reenvio não salva mais ninguém. Uma resposta do motor leva
// segundos; 60 dá folga larga e cabe em qualquer plano.
export const maxDuration = 60;

// ── Verificação do webhook (handshake da Meta) ──

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

// ── Recebimento de mensagens ──

interface CloudApiValue {
  metadata?: { phone_number_id?: string };
  // `user_id` / `from_user_id` são o BSUID; `wa_id` / `from`, o telefone, que
  // pode faltar (ver contato-do-webhook.ts).
  contacts?: { wa_id?: string; user_id?: string; profile?: { name?: string; username?: string } }[];
  messages?: {
    id?: string; from?: string; from_user_id?: string; type?: string;
    text?: { body?: string };
    image?: { id?: string; caption?: string };
    audio?: { id?: string };
    document?: { id?: string; caption?: string; mime_type?: string; filename?: string };
  }[];
  /** Coexistência: o que o vendedor mandou pelo aplicativo do celular dele.
   *  Chega no campo `smb_message_echoes`, com o cliente em `to`. */
  message_echoes?: EcoRecebido[];
}

// Tipo da Meta → o que fica em `messages.tipo`. Tipo que não está aqui é
// gravado como veio: melhor um nome em inglês na coluna do que perder a
// informação (ou a mensagem, se a coluna recusasse o valor).
const TIPOS: Record<string, string> = {
  text: 'texto', image: 'imagem', audio: 'audio', video: 'video', document: 'documento',
  sticker: 'figurinha', location: 'localizacao', contacts: 'contato', reaction: 'reacao',
  button: 'botao', interactive: 'botao',
};

// Postgres: violação de índice único. Aqui só pode ser o `wamid` repetido —
// nenhuma outra restrição única existe em `messages`.
const CODIGO_DUPLICATA = '23505';

/** Tipo da Meta → (tipo na coluna, texto de reserva para o que não é texto). */
function tipoETextoDeReserva(tipoDaMeta: string | undefined) {
  const tipo = TIPOS[tipoDaMeta ?? ''] ?? tipoDaMeta ?? 'desconhecido';
  return { tipo, texto: `[tipo não suportado: ${tipoDaMeta ?? 'desconhecido'}]` };
}

function isValidSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex');
  const provided = signatureHeader.slice('sha256='.length);
  const expectedBuf = Buffer.from(expected, 'hex');
  const providedBuf = Buffer.from(provided, 'hex');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

export async function POST(request: Request) {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    console.error('WHATSAPP_APP_SECRET não configurado — recusando webhook.');
    return new Response('Not configured', { status: 500 });
  }

  const rawBody = await request.text();
  if (!isValidSignature(rawBody, request.headers.get('x-hub-signature-256'), appSecret)) {
    return new Response('Invalid signature', { status: 401 });
  }

  let payload: { entry?: { id?: string; changes?: { field?: string; value?: CloudApiValue & EventoDeTemplate }[] }[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('Malformed payload', { status: 400 });
  }

  const supabase = createServiceClient();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Status e categoria de template. Tratado antes de tudo e isolado: um
      // erro aqui não pode cair no caminho das mensagens, e o evento não tem
      // phone_number_id (o entry.id é a WABA).
      if (change.field === 'message_template_status_update' || change.field === 'template_category_update') {
        await tratarEventoDeTemplate(supabase, entry.id ?? null, change.field, change.value ?? {})
          .catch(e => console.error(`Webhook WhatsApp: falha ao tratar ${change.field}`, e));
        continue;
      }

      const value = change.value ?? {};
      const ecos = value.message_echoes ?? [];
      if (!value.messages?.length && !ecos.length) {
        // Coexistência traz dois campos que ainda não sabemos digerir. Ficam
        // registrados no log em vez de sumirem em silêncio: importar o
        // histórico e a agenda de contatos do celular é item à parte.
        if (change.field === 'history' || change.field === 'smb_app_state_sync') {
          console.info(`Webhook WhatsApp: campo ${change.field} recebido e ignorado (importação ainda não implementada).`);
        }
        continue; // ex.: eventos de status (entregue/lido), ignorados por ora
      }

      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      // A tabela nova manda; a coluna antiga é reserva. Enquanto as duas
      // existirem, uma org que ainda não passou pelo backfill continua
      // atendendo normalmente.
      const { data: numero } = await supabase
        .from('wa_numbers')
        .select('id, organization_id')
        .eq('phone_number_id', phoneNumberId)
        .eq('ativo', true)
        .maybeSingle();

      let orgId = numero?.organization_id ?? null;
      const waNumberId = numero?.id ?? null;
      if (!orgId) {
        const { data: org } = await supabase
          .from('organizations')
          .select('id')
          .eq('wa_phone_number_id', phoneNumberId)
          .maybeSingle();
        orgId = org?.id ?? null;
      }
      if (!orgId) {
        console.warn(`Webhook WhatsApp: nenhuma org para phone_number_id=${phoneNumberId}`);
        continue;
      }

      // Coexistência: o que o vendedor digitou no celular dele. Entra na
      // conversa como fala da casa e **não** chama o motor — quem faz a IA
      // falar é mensagem de cliente.
      if (ecos.length) {
        await registrarEcosDoVendedor(supabase, {
          orgId, waNumberId, ecos, textoDoTipo: tipoETextoDeReserva,
        });
      }

      const waContact = value.contacts?.[0];
      for (const msg of value.messages ?? []) {
        // O telefone pode não vir (cliente com nome de usuário que não falou
        // com este número nos últimos 30 dias); o BSUID vem sempre.
        const telefone = msg.from ?? waContact?.wa_id ?? null;
        const bsuid = msg.from_user_id ?? waContact?.user_id ?? null;
        if (!telefone && !bsuid) {
          console.warn(`Webhook WhatsApp: mensagem ${msg.id ?? '?'} sem telefone e sem BSUID, ignorada`);
          continue;
        }

        const contato = await resolverContatoDoWebhook(supabase, orgId, {
          telefone, bsuid,
          nomeDoPerfil: waContact?.profile?.name ?? null,
          usuario: waContact?.profile?.username ?? null,
        });
        if (!contato) continue;
        const contatoId = contato.id;
        const contatoNome = contato.nome || waContact?.profile?.name || telefone || 'Cliente do WhatsApp';

        // A conversa é a mesma para a mensagem do cliente e para o eco do
        // vendedor: a regra mora em conversa-do-numero.ts.
        const conversaId = await resolverConversaDoNumero(supabase, { orgId, contatoId, waNumberId });
        if (!conversaId) continue;

        // Foto e áudio entram com um texto provisório e são lidos logo abaixo,
        // antes da resposta. Precisam do `wamid` para achar a mensagem depois.
        const { tipo, texto: textoDeReserva } = tipoETextoDeReserva(msg.type);
        // PDF (Vendedor 1, 27/10: cliente manda o orçamento de outro lugar ou o cartão CNPJ). Outro documento segue sem leitura.
        const pdf = msg.type === 'document' && msg.document?.mime_type === 'application/pdf' ? msg.document : undefined;
        const mediaId = msg.type === 'image' ? msg.image?.id : msg.type === 'audio' ? msg.audio?.id : pdf?.id;
        const midia = mediaId && msg.id && (tipo === 'imagem' || tipo === 'audio' || (tipo === 'documento' && pdf))
          ? { tipo: tipo as TipoMidia, mediaId, wamid: msg.id, legenda: msg.image?.caption ?? pdf?.caption ?? null } as const
          : null;
        const texto = msg.type === 'text' ? (msg.text?.body ?? '')
          : midia ? textoProvisorioDaMidia(midia.tipo, midia.legenda)
          : textoDeReserva;
        const { error: msgError } = await supabase.from('messages').insert({
          organization_id: orgId, conversation_id: conversaId, autor: 'cliente', texto, read: false, tipo,
          // Identificador da mensagem na Meta. É ele que segura o reenvio: a
          // Meta repete o webhook quando demoramos a confirmar, e o índice
          // único parcial em (organization_id, wamid) faz o segundo insert
          // falhar em vez de gerar mensagem e resposta duplicadas.
          wamid: msg.id ?? null,
        });
        if (msgError) {
          // Duplicata não é erro: é a Meta reenviando o que já processamos.
          // Sair aqui é o ponto exato — antes de chamar o modelo e antes de
          // enviar qualquer coisa de volta ao cliente.
          if (msgError.code === CODIGO_DUPLICATA) continue;
          console.error('Erro ao gravar mensagem do webhook:', msgError.message);
          continue;
        }

        // Daqui em diante é a resposta da IA, que roda de um de dois jeitos:
        // dentro deste request (como sempre foi) ou depois dele, pelo after(),
        // quando a fila está ligada para esta organização.
        // A mídia é lida no mesmo passo da resposta, e antes dela: com a fila
        // ligada isso sai do request da Meta junto com a geração.
        const responder = async (origem: 'webhook' | 'fila') => {
          if (midia) await lerMidiaDoCliente(supabase, { orgId, conversationId: conversaId, ...midia });
          await responderConversaComIA(supabase, {
            orgId, conversationId: conversaId, contatoNome, phoneNumberId, origem,
            destino: { telefone: telefone ?? contato.telefone, bsuid: bsuid ?? contato.bsuid },
          });
        };

        // O roteiro do número decide junto com a chave da organização: vendas e
        // copiloto usam fila SEMPRE, porque somam chamadas ao sistema do
        // cliente e não cabem no tempo que a Meta espera antes de reenviar.
        const cfgDoNumero = await buscarConfigDoAgente(supabase, orgId, waNumberId);
        if (usarFila(orgId, cfgDoNumero?.roteiro)) {
          // A mensagem do cliente JÁ está gravada neste ponto: derrubar o worker
          // agora perde a resposta, não a mensagem.
          after(async () => {
            try {
              await responder('fila');
            } catch (err) {
              console.error('Erro ao responder a conversa em segundo plano:', err instanceof Error ? err.message : err);
            }
          });
        } else {
          await responder('webhook');
        }
      }
    }
  }

  return new Response('OK', { status: 200 });
}

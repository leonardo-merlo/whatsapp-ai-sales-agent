// Cenário base dos testes do webhook: duas organizações, cada uma com o seu
// número da Meta. Duas, e não uma, porque o roteamento só é de fato testado
// quando existe uma org errada para a mensagem cair.

import { createHmac, randomUUID } from 'node:crypto';
import type { Banco, OpcoesBanco } from './supabase-falso.mts';

/** Espelha os índices únicos que a migration cria. Fica num lugar só para o
 *  dublê não divergir do banco sem ninguém perceber. */
export const INDICES_UNICOS: OpcoesBanco = {
  unicos: {
    // 20260908000001_messages_wamid.sql — parcial, só vale com wamid não nulo.
    messages: [['organization_id', 'wamid']],
    // 20260908000002_wa_numbers.sql — único no projeto inteiro, não por org.
    wa_numbers: [['phone_number_id']],
    // 20260925000001_catalogo_de_templates.sql — constraint inteira, não parcial.
    wa_templates: [['organization_id', 'waba_id', 'nome', 'idioma']],
  },
};

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';
export const NUMERO_A = 'PHONE-NUMBER-ID-A';
export const NUMERO_B = 'PHONE-NUMBER-ID-B';
export const WA_NUMBER_A = 'dddddddd-0000-4000-8000-00000000000a';
export const WA_NUMBER_B = 'dddddddd-0000-4000-8000-00000000000b';
export const SEGREDO_DO_APP = 'segredo-de-teste-do-app-da-meta';

function configDoAgente(orgId: string, nome: string) {
  return {
    id: `cfg-${orgId}`,
    organization_id: orgId,
    ativo: true,
    prompt: `Você é o atendente virtual da ${nome}.`,
    tom: 'simpatico',
    limitacoes: null,
    info_adicional: null,
    sucessos: null,
    fallback_mode: 'transferir',
    fallback_atendente_id: null,
    // Nulo = configuração da empresa toda, que é o que toda org tem hoje.
    wa_number_id: null,
    roteiro: 'atendimento',
  };
}

export function cenarioBase(): Banco {
  return {
    organizations: [
      { id: ORG_A, nome: 'Clínica A', nome_fantasia: 'Clínica A', descricao: null, endereco: null, telefone: null, wa_phone_number_id: NUMERO_A },
      { id: ORG_B, nome: 'Loja B', nome_fantasia: 'Loja B', descricao: null, endereco: null, telefone: null, wa_phone_number_id: NUMERO_B },
    ],
    // Depois da migration, o número vive aqui. A coluna `wa_phone_number_id`
    // acima continua preenchida de propósito: é a reserva que o webhook usa
    // enquanto houver org que não passou pelo backfill.
    wa_numbers: [
      { id: WA_NUMBER_A, organization_id: ORG_A, phone_number_id: NUMERO_A, telefone: '+55 11 90000-0001', papel: 'atendimento', member_id: null, ativo: true },
      { id: WA_NUMBER_B, organization_id: ORG_B, phone_number_id: NUMERO_B, telefone: '+55 11 90000-0002', papel: 'atendimento', member_id: null, ativo: true },
    ],
    ai_agent_config: [configDoAgente(ORG_A, 'Clínica A'), configDoAgente(ORG_B, 'Loja B')],
    plans: [{ id: 'plano-unico', key: 'unico', max_msgs_mes: 1000 }],
    subscriptions: [],
    contacts: [],
    conversations: [],
    messages: [],
    ai_usage: [],
    business_prices: [],
    business_hours: [],
    business_faqs: [],
    business_qualification_questions: [],
    business_triggers: [],
    availability: [],
    appointments: [],
    contact_history: [],
    questionnaire_responses: [],
    organization_members: [],
  };
}

/** Payload de mensagem de texto no formato que a Cloud API entrega.
 *  O `wamid` é diferente a cada chamada por padrão, como na vida real; passar
 *  um valor fixo é o que simula o reenvio da Meta. */
export function payloadDeMensagem(opcoes: {
  phoneNumberId: string;
  telefone: string;
  texto: string;
  nomeDoPerfil?: string;
  wamid?: string;
}): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999999999', phone_number_id: opcoes.phoneNumberId },
              contacts: [{ profile: { name: opcoes.nomeDoPerfil ?? 'Cliente de Teste' }, wa_id: opcoes.telefone }],
              messages: [
                {
                  from: opcoes.telefone,
                  id: opcoes.wamid ?? `wamid.${randomUUID()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: opcoes.texto },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

export function assinar(corpo: string, segredo = SEGREDO_DO_APP): string {
  return `sha256=${createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex')}`;
}

export function requisicaoDoWebhook(corpo: string, assinatura: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (assinatura !== null) headers['x-hub-signature-256'] = assinatura;
  return new Request('https://www.wappia.com.br/api/webhooks/whatsapp', {
    method: 'POST',
    headers,
    body: corpo,
  });
}

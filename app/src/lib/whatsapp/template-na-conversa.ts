// Enviar um template e deixar registro disso na conversa.
//
// **A pendência que este arquivo fecha** vem do bloco A (10/09): o envio de
// template funcionava, mas a mensagem sumia — não aparecia em lugar nenhum do
// painel. Um lembrete de agenda mandado ontem, um aviso ao vendedor de manhã:
// nada disso existia para quem abria a tela. Pior no Wappia Vendas, onde o
// aviso ao vendedor é a única coisa que o copiloto faz.
//
// A ordem aqui é escolhida: **grava primeiro, envia depois**. Se o envio
// falhar, fica registrado o que a gente tentou dizer, com o motivo — em vez de
// um buraco que ninguém consegue investigar. E é por isso que o texto que vai
// para a conversa é montado por quem chama: a Meta guarda o texto do template,
// nós só temos as variáveis, e "template orcamento_enviado com 4 parâmetros"
// não é o que um humano precisa ler no painel.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { resolverContatoDoWebhook } from './contato-do-webhook';
import { resolverConversaDoNumero } from './conversa-do-numero';
import { sendWhatsAppTemplate } from './send-message';
import { prepararTemplate } from './catalogo-de-templates';

type Client = SupabaseClient<Database>;

export interface EnvioDeTemplate {
  orgId: string;
  /** Número por onde o template sai (o copiloto, no aviso ao vendedor). */
  waNumberId: string | null;
  phoneNumberId: string;
  /** Para quem: telefone no formato da Cloud API. */
  telefone: string;
  /** Nome de quem recebe, para o contato quando ele ainda não existe. */
  nome: string;
  /** Nome do template no catálogo e os valores das variáveis, por nome
   *  (na ordem que o catálogo diz) ou por posição. */
  template: { nome: string; valores: Record<string, string> | string[] };
  /** O que aparece na conversa. É o texto que um humano lê, não o nome do
   *  template com os parâmetros soltos. */
  textoNaConversa: string;
  /** Contato já conhecido (campanha, nova conversa). Sem isto o contato é
   *  achado pelo telefone exato, e um telefone gravado com máscara no painel
   *  viraria um contato duplicado. */
  contatoId?: string;
  /** Mensagem de campanha: fica fora da conta do limite de respostas da IA. */
  camp?: boolean;
}

export interface ResultadoDoEnvio {
  enviado: boolean;
  conversationId: string | null;
  erro?: string;
}

export async function enviarTemplateNaConversa(
  supabase: Client,
  envio: EnvioDeTemplate,
): Promise<ResultadoDoEnvio> {
  const contato = envio.contatoId
    ? { id: envio.contatoId }
    : await resolverContatoDoWebhook(supabase, envio.orgId, {
      telefone: envio.telefone, bsuid: null, nomeDoPerfil: envio.nome, usuario: null,
    });
  if (!contato) return { enviado: false, conversationId: null, erro: 'não foi possível resolver o contato' };

  const conversationId = await resolverConversaDoNumero(supabase, {
    orgId: envio.orgId, contatoId: contato.id, waNumberId: envio.waNumberId,
  });
  if (!conversationId) return { enviado: false, conversationId: null, erro: 'não foi possível abrir a conversa' };

  const { data: gravada, error: erroGravar } = await supabase.from('messages').insert({
    organization_id: envio.orgId,
    conversation_id: conversationId,
    autor: 'ia',
    texto: envio.textoNaConversa,
    read: true,
    camp: envio.camp ?? false,
  }).select('id').maybeSingle();
  if (erroGravar) console.error('Erro ao gravar a mensagem de template:', erroGravar.message);

  try {
    // O catálogo decide antes da Meta: template que não está aprovado nem sai.
    const pronto = await prepararTemplate(supabase, {
      orgId: envio.orgId, phoneNumberId: envio.phoneNumberId, nome: envio.template.nome, valores: envio.template.valores,
    });
    if (!pronto.ok) throw new Error(pronto.motivo);
    const wamid = await sendWhatsAppTemplate(envio.orgId, { telefone: envio.telefone, bsuid: null }, pronto.template, envio.phoneNumberId);
    // O `wamid` fecha o ciclo: é por ele que um evento de entrega futuro
    // encontra esta mensagem.
    if (wamid && gravada?.id) await supabase.from('messages').update({ wamid }).eq('id', gravada.id);
    return { enviado: true, conversationId };
  } catch (err) {
    const erro = err instanceof Error ? err.message : String(err);
    console.error(`Falha ao enviar o template ${envio.template.nome}:`, erro);
    // A mensagem fica na conversa com uma nota do sistema ao lado. Quem abrir a
    // tela vê o que a gente tentou dizer E que não saiu.
    await supabase.from('messages').insert({
      organization_id: envio.orgId,
      conversation_id: conversationId,
      autor: 'sys',
      texto: `Aviso não entregue (${envio.template.nome}): ${erro}`,
      read: true,
    });
    return { enviado: false, conversationId, erro };
  }
}

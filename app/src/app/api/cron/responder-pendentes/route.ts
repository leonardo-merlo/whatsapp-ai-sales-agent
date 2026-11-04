// Cron: varredura de mensagem sem resposta. A rede de segurança da fila.
//
// A própria tabela `messages` é a fila: uma conversa em modo `ia` cuja última
// mensagem é do cliente, com mais de 3 minutos e menos de 30, ficou sem
// resposta. Isto reprocessa essas conversas com o mesmo
// `responderConversaComIA()` do webhook. Cobre três buracos de uma vez: o
// `after()` que morre, o request cortado pelo `maxDuration`, e o erro
// momentâneo da Anthropic (que no webhook só loga).
//
// Roda **a cada minuto**, agendada pelo pg_cron do Supabase (migration
// 20260910000002, depois acelerada no banco: `cron.job` 3 está em `* * * * *`).
// Protegida por CRON_SECRET, como a de resumir-paradas.

import { createServiceClient } from '@/lib/supabase/service';
import { responderConversaComIA } from '@/lib/agente/responder-conversa';

export const runtime = 'nodejs';
// Teto de 60 s. Com o cron a cada minuto duas varreduras PODEM se sobrepor, e
// o que impede a mesma conversa de ser respondida duas vezes não é este teto:
// é o `ORCAMENTO_DE_TEMPO_MS` abaixo (para de pegar conversa nova aos 40 s) e a
// checagem de "a última mensagem ainda é do cliente?", que a varredura de
// dentro refaz para cada conversa, já com o que a de fora gravou.
export const maxDuration = 60;

// Abaixo disso a mensagem pode estar sendo respondida agora pelo webhook, e
// responder junto mandaria duas mensagens ao cliente.
//
// **Eram 3 minutos até 21/09, e caíram para 1min30 a pedido do Leonardo.** O
// motivo: a Anthropic vinha devolvendo erro 500 com frequência, e cada falha
// dessas custava ao cliente final 4 minutos de silêncio no WhatsApp — medido
// no teste real daquela noite (mensagem às 21:16:09, resposta às 21:20:09).
//
// **O que a folga protege, e por que 1min30 ainda protege.** O webhook tem
// `maxDuration = 60`, então uma resposta em andamento não pode durar mais que
// isso: passou de 60 s, a Vercel já cortou o request e não existe mais ninguém
// para falar por cima. Os 30 s que sobram são a margem para o relógio do banco
// e o do servidor não estarem perfeitamente iguais.
//
// **O que isto NÃO resolve:** a granularidade do cron é de 1 minuto, então o
// tempo real até o resgate fica entre 1min30 e 2min30, não 1min30 cravado.
const ESPERA_MINIMA_MS = 90 * 1000;
// Acima disso responder atrapalha mais do que ajuda: o cliente já desistiu ou
// alguém da empresa já viu a conversa parada.
const JANELA_MAXIMA_MS = 30 * 60 * 1000;
// Para de pegar conversa nova perto do teto, para não ser cortado no meio de
// uma resposta — o que deixaria a conversa para a próxima rodada de qualquer
// jeito, mas depois de ter pago o modelo.
const ORCAMENTO_DE_TEMPO_MS = 40 * 1000;
// Erro que acontece DEPOIS de o modelo responder (resposta truncada, JSON
// inválido) é pago e tende a se repetir igual. Sem este teto, a varredura
// pagaria o modelo a cada 2 minutos durante a janela inteira. Erro antes de o
// modelo responder (Anthropic fora do ar) não entra no `ai_usage` e continua
// sendo tentado — é justamente o caso que a varredura existe para cobrir.
const MAX_CHAMADAS_PAGAS_SEM_RESPOSTA = 4;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Não autorizado', { status: 401 });
  }

  const inicio = Date.now();
  const supabase = createServiceClient();
  const maisNova = new Date(inicio - ESPERA_MINIMA_MS).toISOString();
  const maisAntiga = new Date(inicio - JANELA_MAXIMA_MS).toISOString();

  // Só mensagem com `wamid`, ou seja, que chegou de fato pelo WhatsApp. Semente
  // de demonstração e restauração de backup gravam mensagem de cliente sem ele,
  // e responder essas mandaria WhatsApp para número inventado.
  const { data: candidatas, error } = await supabase
    .from('messages')
    .select('conversation_id')
    .eq('autor', 'cliente')
    .not('wamid', 'is', null)
    .gte('created_at', maisAntiga)
    .lte('created_at', maisNova)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('Varredura: falha ao buscar mensagens', error.message);
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  const ids = [...new Set((candidatas ?? []).map(m => m.conversation_id))];
  if (!ids.length) return Response.json({ ok: true, verificadas: 0, reprocessadas: [] });

  const { data: conversas } = await supabase
    .from('conversations')
    .select('id, organization_id, contact_id, wa_number_id')
    .in('id', ids)
    .eq('status', 'aberta')
    .eq('modo', 'ia');

  const reprocessadas: string[] = [];
  const puladas: { id: string; motivo: string }[] = [];

  for (const conv of conversas ?? []) {
    if (Date.now() - inicio > ORCAMENTO_DE_TEMPO_MS) {
      puladas.push({ id: conv.id, motivo: 'sem tempo nesta rodada' });
      continue;
    }

    // A última mensagem decide. Se é da IA, de um atendente ou do sistema, a
    // conversa foi atendida. Se é do cliente mas mais nova que a espera mínima,
    // o webhook ainda pode estar respondendo.
    const { data: ultima } = await supabase
      .from('messages')
      .select('autor, created_at, wamid')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!ultima || ultima.autor !== 'cliente' || !ultima.wamid) continue;
    // Comparado como data, não como texto: o Postgres devolve `+00:00` e
    // microssegundos, o JavaScript escreve `Z` e milissegundos.
    const idadeMs = inicio - new Date(ultima.created_at).getTime();
    if (idadeMs < ESPERA_MINIMA_MS) continue;

    const { count: chamadasPagas } = await supabase
      .from('ai_usage')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conv.id)
      .eq('origem', 'motor')
      .gte('created_at', ultima.created_at);
    if ((chamadasPagas ?? 0) >= MAX_CHAMADAS_PAGAS_SEM_RESPOSTA) {
      puladas.push({ id: conv.id, motivo: `${chamadasPagas} chamadas pagas sem resposta` });
      continue;
    }

    const { data: contato } = await supabase
      .from('contacts').select('nome, telefone, wa_user_id').eq('id', conv.contact_id).maybeSingle();
    if (!contato?.telefone && !contato?.wa_user_id) {
      puladas.push({ id: conv.id, motivo: 'contato sem telefone e sem BSUID' });
      continue;
    }

    // O mesmo número por onde a conversa entrou, com a coluna antiga da org
    // como reserva — a mesma ordem que o webhook usa.
    let phoneNumberId: string | null = null;
    if (conv.wa_number_id) {
      const { data: numero } = await supabase
        .from('wa_numbers').select('phone_number_id').eq('id', conv.wa_number_id).eq('ativo', true).maybeSingle();
      phoneNumberId = numero?.phone_number_id ?? null;
    } else {
      const { data: org } = await supabase
        .from('organizations').select('wa_phone_number_id').eq('id', conv.organization_id).maybeSingle();
      phoneNumberId = org?.wa_phone_number_id ?? null;
    }
    if (!phoneNumberId) {
      puladas.push({ id: conv.id, motivo: 'sem número de WhatsApp ativo' });
      continue;
    }

    console.log(`Varredura: respondendo a conversa ${conv.id}, mensagem do cliente de ${Math.round(idadeMs / 60000)} min atrás`);
    try {
      await responderConversaComIA(supabase, {
        orgId: conv.organization_id,
        conversationId: conv.id,
        contatoNome: contato.nome || contato.telefone || 'Cliente do WhatsApp',
        destino: { telefone: contato.telefone, bsuid: contato.wa_user_id },
        phoneNumberId,
        origem: 'varredura',
      });
      reprocessadas.push(conv.id);
    } catch (err) {
      console.error('Varredura: falha ao responder', conv.id, err instanceof Error ? err.message : err);
    }
  }

  return Response.json({ ok: true, verificadas: conversas?.length ?? 0, reprocessadas, puladas });
}

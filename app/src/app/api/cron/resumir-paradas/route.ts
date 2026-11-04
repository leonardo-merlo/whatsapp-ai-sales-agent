// Cron: resume conversas paradas (sem atividade recente) que ainda não têm
// resumo desde a última mensagem. Roda de hora em hora, agendada pelo pg_cron do
// Supabase (migration 20260727000005) — o Vercel Cron no Hobby só permite 1x/dia.
// Protegida por CRON_SECRET no header Authorization. Usa service_role porque
// não há sessão de usuário. Best-effort por conversa: uma falha não trava as outras.

import { createServiceClient } from '@/lib/supabase/service';
import { resumirConversa } from '@/lib/agente/resumir-conversa';

export const runtime = 'nodejs';

const IDLE_MS = 6 * 60 * 60 * 1000; // 6 horas

// Um resumo a cada período de conversa: mensagens novas desde o último resumo e
// 6 h paradas. Até 08/10 havia também um teto de um resumo a cada 24 h; o
// Leonardo pediu tirar (quem conversa de manhã e volta à noite tem duas
// conversas, e a da noite ficava sem resumo). O que segura o custo é a guarda
// pela última mensagem, abaixo: conversa parada sem mensagem nova nunca é
// resumida de novo. O resumo cobre só as mensagens desde o anterior.

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Não autorizado', { status: 401 });
  }

  const supabase = createServiceClient();
  const corte = new Date(Date.now() - IDLE_MS).toISOString();

  const { data: conversas } = await supabase
    .from('conversations')
    .select('id, organization_id, resumida_em, updated_at')
    .lt('updated_at', corte)
    // Mais recentes primeiro: conversa parada casa com o filtro pra sempre, então
    // sem ordenar o limite encheria de conversas antigas (já resumidas, descartadas
    // no laço abaixo) e as recém-paradas nunca entrariam na janela.
    .order('updated_at', { ascending: false })
    .limit(200);

  let resumidas = 0;
  for (const conv of conversas ?? []) {
    // "Mudou desde o último resumo?" se decide pela ÚLTIMA MENSAGEM, e não por
    // `updated_at`. Gravar `resumida_em` dispara o gatilho que põe `updated_at`
    // alguns milissegundos depois, então `resumida_em >= updated_at` nunca era
    // verdade: toda conversa parada era resumida de novo a cada 24 h, para
    // sempre, e cada resumo virava uma linha nova na memória do contato
    // (medido em 29/09: 1.598 linhas na Bem Sorrir, com conversas de junho).
    if (conv.resumida_em) {
      const { data: ultima } = await supabase
        .from('messages').select('created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (!ultima || conv.resumida_em >= ultima.created_at) continue;
    }
    try {
      await resumirConversa(supabase, conv.organization_id, conv.id);
      resumidas++;
    } catch (err) {
      console.error('Cron: falha ao resumir', conv.id, err instanceof Error ? err.message : err);
    }
  }

  return Response.json({ ok: true, verificadas: conversas?.length ?? 0, resumidas });
}

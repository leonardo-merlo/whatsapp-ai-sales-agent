// Cron: lembrete antes da consulta (S5).
//
// Agendada pelo pg_cron do Supabase a cada 15 minutos (migration
// 20260929000005), nunca pelo vercel.json: na conta Hobby cron não diário
// bloqueia o deploy. Protegida por CRON_SECRET, como as outras.

import { createServiceClient } from '@/lib/supabase/service';
import { enviarLembretesPendentes } from '@/lib/agenda/lembrete';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Não autorizado', { status: 401 });
  }
  const resumo = await enviarLembretesPendentes(createServiceClient());
  return Response.json(resumo);
}

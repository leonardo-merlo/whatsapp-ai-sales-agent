// Limites e uso corrente do plano de uma org — reaproveitado pelo webhook
// (corte de mensagens da IA) e pela leitura inicial de dados (UI de Configurações).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export interface LimitesEUsoOrg {
  maxMsgsMes: number;
  msgsUsadasMes: number;
  statusAssinatura: string | null;
  /** O que fazer ao passar do limite: `transferir` (a IA para e a conversa vai
   *  para uma pessoa — o padrão e o comportamento de sempre) ou `avisar` (a IA
   *  continua e o dono é avisado). Ver a migration `20260914000003`. */
  aoEstourarLimite: 'transferir' | 'avisar';
}

export async function buscarLimitesEUsoDaOrg(supabase: Client, orgId: string): Promise<LimitesEUsoOrg> {
  const inicioDoMes = new Date();
  inicioDoMes.setUTCDate(1);
  inicioDoMes.setUTCHours(0, 0, 0, 0);
  const hoje = new Date().toISOString().slice(0, 10);

  const [subscription, msgsIA, org] = await Promise.all([
    supabase.from('subscriptions').select('status, plans(max_msgs_mes)').eq('organization_id', orgId).eq('status', 'ativa').or(`periodo_fim.is.null,periodo_fim.gte.${hoje}`).maybeSingle(),
    supabase.from('messages').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('autor', 'ia').gte('created_at', inicioDoMes.toISOString()),
    supabase.from('organizations').select('ao_estourar_limite').eq('id', orgId).maybeSingle(),
  ]);

  let maxMsgsMes = (subscription.data?.plans as { max_msgs_mes: number } | null)?.max_msgs_mes ?? null;
  if (maxMsgsMes === null) {
    // Sem assinatura (período de teste) vale o plano da vitrine, desde 29/09 o
    // único de R$ 250.
    const padrao = await supabase.from('plans').select('max_msgs_mes').eq('key', 'unico').maybeSingle();
    maxMsgsMes = padrao.data?.max_msgs_mes ?? 0;
  }

  return {
    maxMsgsMes,
    msgsUsadasMes: msgsIA.count ?? 0,
    statusAssinatura: subscription.data?.status ?? null,
    // Sem linha, sem coluna ou com valor estranho: 'transferir', que é o
    // comportamento que existia antes desta coluna existir.
    aoEstourarLimite: org.data?.ao_estourar_limite === 'avisar' ? 'avisar' : 'transferir',
  };
}

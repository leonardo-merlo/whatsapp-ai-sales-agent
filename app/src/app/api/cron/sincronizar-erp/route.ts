// Cron: os syncs do sistema de gestão (contrato v4 da Distribuidora Exemplo).
//
//   GET /api/cron/sincronizar-erp?tipo=produtos   (pg_cron, todo dia 06:10 UTC)
//   GET /api/cron/sincronizar-erp?tipo=regioes    (pg_cron, dia 1 do mês 06:20 UTC)
//
// Agendada pelo pg_cron do Supabase (migration 20260927000002), nunca pelo
// vercel.json: o plano Hobby só aceita cron diário lá e rejeita o deploy em
// silêncio quando não é. Protegida por CRON_SECRET, como as outras.
//
// **Atrás de `SYNCS_DO_ERP_LIGADOS`** (ligada desde 30/09). Só roda para a
// organização que tem ERP ativo E o caminho daquele sync configurado.

import { createServiceClient } from '@/lib/supabase/service';
import { conexaoComOErp } from '@/lib/erp/integracao';
import { caminhoDoSync, type TipoDeSync } from '@/lib/erp/caminhos';
import { observadorQueGrava } from '@/lib/erp/registro-de-chamadas';
import { SYNCS_DO_ERP_LIGADOS } from '@/lib/erp/syncs/interruptor-dos-syncs';
import { sincronizarProdutos, type ResultadoDoSync } from '@/lib/erp/syncs/sincronizar-produtos';
import { sincronizarRegioes } from '@/lib/erp/syncs/sincronizar-regioes';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Não autorizado', { status: 401 });
  }

  const tipo = new URL(request.url).searchParams.get('tipo');
  if (tipo !== 'produtos' && tipo !== 'regioes') {
    return Response.json({ ok: false, erro: 'tipo precisa ser produtos ou regioes' }, { status: 400 });
  }
  if (!SYNCS_DO_ERP_LIGADOS) return Response.json({ ok: true, ligado: false, tipo });

  const supabase = createServiceClient();
  const { data: integracoes } = await supabase
    .from('organization_integrations').select('organization_id').eq('tipo', 'erp').eq('ativo', true);

  const resultados: ({ orgId: string } & (ResultadoDoSync | { status: 'pulado'; motivo: string }))[] = [];
  for (const { organization_id: orgId } of integracoes ?? []) {
    const r = await conexaoComOErp(supabase, orgId);
    if (!r.ok) {
      resultados.push({ orgId, status: 'pulado', motivo: r.falta });
      continue;
    }
    const caminho = caminhoDoSync(r.integracao.config, tipo as TipoDeSync);
    if (!caminho) {
      resultados.push({ orgId, status: 'pulado', motivo: 'sem caminho configurado para este sync' });
      continue;
    }
    // A chamada vai para `erp_chamadas`, como as da conversa: é na aba
    // Chamadas que se vê se o sync da madrugada rodou.
    const conexao = { ...r.conexao, observador: observadorQueGrava(supabase, { orgId }) };
    const resultado = tipo === 'produtos'
      ? await sincronizarProdutos(supabase, orgId, conexao, caminho)
      : await sincronizarRegioes(supabase, orgId, conexao, caminho);
    if (resultado.status !== 'aplicado') {
      console.error(`Sync de ${tipo} da organização ${orgId}: ${resultado.status} — ${resultado.motivo ?? ''}`);
    }
    // O desfecho (não só a chamada HTTP): é daqui que o painel mostra o
    // último sync e a lista parcial. Falhar aqui não desfaz o sync.
    const { error: erroDoRegistro } = await supabase.from('erp_sync_execucoes').insert({
      organization_id: orgId,
      tipo,
      status: resultado.status,
      motivo: resultado.motivo ?? null,
      gravados: resultado.gravados,
      desativados: resultado.desativados,
      problemas: resultado.problemas.slice(0, 100),
      falhas_do_erp: resultado.falhasDoErp,
    });
    if (erroDoRegistro) console.error(`Registro do sync de ${tipo} (${orgId}): ${erroDoRegistro.message}`);
    resultados.push({ orgId, ...resultado });
  }

  return Response.json({ ok: true, ligado: true, tipo, resultados });
}

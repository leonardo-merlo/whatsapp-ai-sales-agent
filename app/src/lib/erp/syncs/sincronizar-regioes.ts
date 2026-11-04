// Sync mensal de regiões (contrato v4, proposta nossa ainda a confirmar):
// cada região com as cidades e os grupos de produto entregues ali.
//
// Nesta entrega a região **só é gravada**; o motor ainda não a lê (ajuste A3 do
// spec da máquina de estados, que depende de respostas da Distribuidora Exemplo). A regra é
// a do catálogo: região que sumiu da lista é desativada, nunca apagada; lista
// vazia não é aplicada; e lista com `falhas` ou que desativaria de uma vez
// mais de 30% das regiões grava o que veio sem desativar nada.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../supabase/database.types';
import { chamarErp, type ConexaoComOErp } from '../cliente-http';
import { lerRegioesDoSync } from './formato';
import {
  QUEDA_MAXIMA_ABSOLUTA, QUEDA_MAXIMA_PERCENTUAL, type ResultadoDoSync, type StatusDoSync,
} from './sincronizar-produtos';

type Client = SupabaseClient<Database>;

const semNada = (
  status: StatusDoSync, motivo: string, problemas: string[] = [], falhasDoErp: string[] = [],
): ResultadoDoSync => ({ status, motivo, gravados: 0, desativados: 0, problemas, falhasDoErp });

export async function sincronizarRegioes(
  supabase: Client,
  orgId: string,
  conexao: ConexaoComOErp,
  caminho: string,
): Promise<ResultadoDoSync> {
  const r = await chamarErp<unknown>(conexao, { metodo: 'GET', operacao: 'sync_regioes', caminho });
  if (!r.ok) return semNada('falhou', `${r.motivo}: ${r.codigo} — ${r.mensagem}`);

  const leitura = lerRegioesDoSync(r.dados);
  if (!leitura.ok) return semNada('formato_invalido', leitura.motivo);
  if (!leitura.itens.length) {
    return semNada('recusado_por_seguranca', 'A lista de regiões veio vazia.', leitura.problemas, leitura.falhasDoErp);
  }

  const agora = new Date().toISOString();
  // Índice único COMPLETO em (organization_id, regiao_id): aqui o upsert é
  // seguro (o problema do PostgREST é só com índice parcial).
  const { error } = await supabase.from('erp_regioes').upsert(
    leitura.itens.map(regiao => ({
      organization_id: orgId,
      regiao_id: regiao.regiao_id,
      nome: regiao.nome,
      cidades: regiao.cidades as unknown as Json,
      grupos: regiao.grupos,
      produto_ids: regiao.produto_ids,
      ativo: true,
      sincronizado_em: agora,
    })),
    { onConflict: 'organization_id,regiao_id' },
  );
  if (error) return semNada('falhou', `Falha ao gravar as regiões: ${error.message}`, leitura.problemas, leitura.falhasDoErp);

  const vistas = new Set([...leitura.itens.map(x => x.regiao_id), ...leitura.idsIncompletos]);
  const { data: ativas } = await supabase
    .from('erp_regioes').select('id, regiao_id').eq('organization_id', orgId).eq('ativo', true);
  const ausentes = (ativas ?? []).filter(x => !vistas.has(x.regiao_id)).map(x => x.id);
  const quedaGrande = ausentes.length > QUEDA_MAXIMA_ABSOLUTA
    && ausentes.length > (ativas ?? []).length * QUEDA_MAXIMA_PERCENTUAL;
  const paraDesativar = leitura.falhasDoErp.length || quedaGrande ? [] : ausentes;
  if (quedaGrande) leitura.problemas.push(`${ausentes.length} regiões sumiram de uma vez: nenhuma foi desativada.`);
  if (paraDesativar.length) {
    const { error: e } = await supabase.from('erp_regioes').update({ ativo: false }).in('id', paraDesativar);
    if (e) return semNada('falhou', `Falha ao desativar regiões: ${e.message}`, leitura.problemas, leitura.falhasDoErp);
  }

  return {
    status: 'aplicado',
    gravados: leitura.itens.length,
    desativados: paraDesativar.length,
    problemas: leitura.problemas,
    falhasDoErp: leitura.falhasDoErp,
  };
}

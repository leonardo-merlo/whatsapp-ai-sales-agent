// As regiões de entrega que o sync mensal traz do sistema de gestão
// (`erp_regioes`). Só leitura: quem escreve é o sync. RLS de membro.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export interface RegiaoDeEntrega {
  regiaoId: string;
  nome: string;
  cidades: { cidade: string; uf: string }[];
  sincronizadoEm: string | null;
}

export async function listarRegioesDeEntrega(supabase: Client, orgId: string): Promise<RegiaoDeEntrega[]> {
  const { data, error } = await supabase
    .from('erp_regioes')
    .select('regiao_id, nome, cidades, sincronizado_em')
    .eq('organization_id', orgId)
    .eq('ativo', true)
    .order('regiao_id');
  if (error) {
    console.error('Falha ao listar as regiões de entrega:', error.message);
    return [];
  }
  return (data ?? []).map(r => ({
    regiaoId: r.regiao_id,
    nome: r.nome,
    cidades: Array.isArray(r.cidades) ? r.cidades as { cidade: string; uf: string }[] : [],
    sincronizadoEm: r.sincronizado_em,
  }));
}

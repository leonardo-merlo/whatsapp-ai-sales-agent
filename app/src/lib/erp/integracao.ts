// Onde a organização diz qual é o sistema dela e com que chave se entra.
//
// A chave nunca passa por coluna: ela mora no Vault e sai de lá por uma função
// `SECURITY DEFINER` que só o `service_role` executa — o mesmo desenho que o C2
// usou para o business token da Meta. O motivo é o mesmo: com EXECUTE para
// `authenticated`, qualquer usuário logado leria a chave do ERP do cliente pela
// API pública.
//
// Sem linha em `organization_integrations`, a organização simplesmente não tem
// ERP — e o roteiro de vendas não consulta nada. É o comportamento de toda
// organização que existe hoje.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { caminhosDaIntegracao } from './caminhos';
import type { ConexaoComOErp } from './cliente-http';

type Client = SupabaseClient<Database>;

export interface IntegracaoDaOrganizacao {
  id: string;
  enderecoBase: string;
  ativo: boolean;
  config: Record<string, unknown>;
}

/** Por que não existe conexão. O texto é para o log e para o aviso ao
 *  vendedor — nunca para o cliente final. */
export type FaltaParaConectar = 'sem-integracao' | 'desativada' | 'sem-credencial';

export async function conexaoComOErp(
  supabase: Client,
  orgId: string,
): Promise<{ ok: true; conexao: ConexaoComOErp; integracao: IntegracaoDaOrganizacao } | { ok: false; falta: FaltaParaConectar }> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('id, endereco_base, ativo, config')
    .eq('organization_id', orgId)
    .eq('tipo', 'erp')
    .maybeSingle();

  if (!data) return { ok: false, falta: 'sem-integracao' };
  if (!data.ativo) return { ok: false, falta: 'desativada' };

  const { data: token, error } = await supabase.rpc('credencial_da_integracao', { p_integration_id: data.id });
  if (error || !token) {
    if (error) console.error('Falha ao ler a credencial do ERP:', error.message);
    return { ok: false, falta: 'sem-credencial' };
  }

  return {
    ok: true,
    // Os caminhos saem da config junto com o endereço e a chave: é aqui que a
    // organização inteira é resolvida, e nenhuma operação precisa saber que
    // existe configuração.
    conexao: {
      enderecoBase: data.endereco_base,
      token,
      caminhos: caminhosDaIntegracao(data.config),
    },
    integracao: {
      id: data.id,
      enderecoBase: data.endereco_base,
      ativo: data.ativo,
      config: (data.config ?? {}) as Record<string, unknown>,
    },
  };
}

export const EXPLICACAO_DA_FALTA: Record<FaltaParaConectar, string> = {
  'sem-integracao': 'Esta empresa não tem o sistema de gestão configurado no painel.',
  'desativada': 'A integração com o sistema de gestão está desativada no painel.',
  'sem-credencial': 'A integração existe, mas está sem a chave de acesso.',
};

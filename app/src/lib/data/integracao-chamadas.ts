// As chamadas ao sistema de gestão do cliente, para a aba Chamadas da seção
// Desenvolvimento.
//
// Quem lê esta tela, na prática, é o **desenvolvedor do cliente** durante a
// homologação: ele precisa conferir se o cadastro que a IA criou gravou com os
// dados certos, e descobrir sozinho por que uma chamada falhou. Antes disso
// existir, a única fonte era o log do servidor — ou seja, dependia do Leonardo.
//
// RLS: `erp_chamadas` é `is_admin_of`. A tabela guarda o corpo cru das
// requisições, e lá dentro vão CPF e CNPJ de cliente — um vendedor não precisa
// ver o documento dos clientes dos outros para trabalhar. Este módulo só
// consulta; quem decide se a tela aparece é a camada de cima.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export type FiltroDeDesfecho = 'todas' | 'falhas';

/** Uma chamada como a tela a mostra. */
export interface ChamadaAoErp {
  id: string;
  operacao: string;
  metodo: string;
  caminho: string;
  requisicao: unknown;
  statusHttp: number | null;
  resposta: unknown;
  ok: boolean;
  motivo: string | null;
  codigo: string | null;
  mensagem: string | null;
  tentativas: number;
  duracaoMs: number | null;
  chaveDeIdempotencia: string | null;
  conversationId: string | null;
  quando: string;
}

/** Quantas linhas a tela carrega de uma vez. Alto o suficiente para uma sessão
 *  inteira de homologação caber numa página, baixo o suficiente para a consulta
 *  não pesar — os corpos crus são grandes. */
export const LIMITE_DE_CHAMADAS = 100;

export interface ResumoDaIntegracao {
  total: number;
  falhas: number;
  /** Nulo quando nenhuma chamada aconteceu ainda. */
  ultimaEm: string | null;
}

export async function listarChamadas(
  supabase: Client,
  orgId: string,
  filtro: FiltroDeDesfecho = 'todas',
): Promise<ChamadaAoErp[]> {
  let consulta = supabase
    .from('erp_chamadas')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_DE_CHAMADAS);

  if (filtro === 'falhas') consulta = consulta.eq('ok', false);

  const { data, error } = await consulta;
  if (error) {
    console.error('Falha ao listar as chamadas ao ERP:', error.message);
    return [];
  }

  return (data ?? []).map(l => ({
    id: l.id,
    operacao: l.operacao,
    metodo: l.metodo,
    caminho: l.caminho,
    requisicao: l.requisicao,
    statusHttp: l.status_http,
    resposta: l.resposta,
    ok: l.ok,
    motivo: l.motivo,
    codigo: l.codigo,
    mensagem: l.mensagem,
    tentativas: l.tentativas,
    duracaoMs: l.duracao_ms,
    chaveDeIdempotencia: l.chave_idempotencia,
    conversationId: l.conversation_id,
    quando: l.created_at,
  }));
}

/** O cabeçalho da tela: quantas chamadas, quantas falharam, e quando foi a
 *  última. Duas contagens separadas em vez de somar no cliente porque a tela
 *  carrega no máximo 100 linhas e os números precisam ser do período todo. */
export async function resumoDaIntegracao(
  supabase: Client,
  orgId: string,
): Promise<ResumoDaIntegracao> {
  const [total, falhas, ultima] = await Promise.all([
    supabase.from('erp_chamadas').select('id', { count: 'exact', head: true }).eq('organization_id', orgId),
    supabase.from('erp_chamadas').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('ok', false),
    supabase.from('erp_chamadas').select('created_at').eq('organization_id', orgId)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  return {
    total: total.count ?? 0,
    falhas: falhas.count ?? 0,
    ultimaEm: ultima.data?.created_at ?? null,
  };
}

/** A última execução de um sync (`erp_sync_execucoes`): o que o sync FEZ com a
 *  resposta, que a chamada HTTP sozinha não diz. */
export interface UltimoSync {
  tipo: 'produtos' | 'regioes';
  status: string;
  motivo: string | null;
  gravados: number;
  desativados: number;
  falhasDoErp: string[];
  quando: string;
}

export async function ultimosSyncs(supabase: Client, orgId: string): Promise<UltimoSync[]> {
  const linhas = await Promise.all((['produtos', 'regioes'] as const).map(tipo =>
    supabase.from('erp_sync_execucoes')
      .select('tipo, status, motivo, gravados, desativados, falhas_do_erp, created_at')
      .eq('organization_id', orgId).eq('tipo', tipo)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ));
  return linhas.flatMap(({ data }) => data ? [{
    tipo: data.tipo as UltimoSync['tipo'],
    status: data.status,
    motivo: data.motivo,
    gravados: data.gravados,
    desativados: data.desativados,
    falhasDoErp: data.falhas_do_erp,
    quando: data.created_at,
  }] : []);
}

/** O endereço configurado, para a tela dizer contra qual ambiente as chamadas
 *  saíram. A CHAVE nunca vem: ela mora no Vault e nenhuma tela a lê. */
export async function enderecoDaIntegracao(
  supabase: Client,
  orgId: string,
): Promise<{ enderecoBase: string; ativo: boolean } | null> {
  const { data } = await supabase
    .from('organization_integrations')
    .select('endereco_base, ativo')
    .eq('organization_id', orgId)
    .eq('tipo', 'erp')
    .maybeSingle();

  return data ? { enderecoBase: data.endereco_base, ativo: data.ativo } : null;
}

/**
 * A última chamada BEM SUCEDIDA de cada operação, para a aba Fluxo mostrar o
 * corpo que sai e o que volta.
 *
 * O corpo que vai ao ERP é montado em código imperativo (`erp/operacoes/*.ts`)
 * e não dá para ler de um schema. A chamada real não pode divergir do código,
 * porque é literalmente o que aconteceu. Uma consulta por operação: são quatro,
 * e pedir "a mais recente de cada" numa só exigiria uma view.
 */
export async function ultimaChamadaOkPorOperacao(
  supabase: Client,
  orgId: string,
  operacoes: readonly string[],
): Promise<Record<string, { metodo: string; caminho: string; requisicao: unknown; resposta: unknown; quando: string }>> {
  const linhas = await Promise.all(operacoes.map(operacao =>
    supabase
      .from('erp_chamadas')
      .select('operacao, metodo, caminho, requisicao, resposta, created_at')
      .eq('organization_id', orgId)
      .eq('operacao', operacao)
      .eq('ok', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ));

  const ultimas: Record<string, { metodo: string; caminho: string; requisicao: unknown; resposta: unknown; quando: string }> = {};
  for (const { data, error } of linhas) {
    if (error) {
      console.error('Falha ao ler a última chamada ao ERP:', error.message);
      continue;
    }
    if (!data) continue;
    ultimas[data.operacao] = {
      metodo: data.metodo,
      caminho: data.caminho,
      requisicao: data.requisicao,
      resposta: data.resposta,
      quando: data.created_at,
    };
  }
  return ultimas;
}

/** A config da integração (os caminhos moram nela) e os roteiros que as
 *  configurações do agente usam — o que a aba Fluxo precisa para decidir o
 *  que mostrar. */
export async function contextoDoFluxo(
  supabase: Client,
  orgId: string,
): Promise<{ config: unknown; temIntegracao: boolean; roteiros: string[] }> {
  const [integracao, agentes] = await Promise.all([
    supabase.from('organization_integrations').select('config')
      .eq('organization_id', orgId).eq('tipo', 'erp').maybeSingle(),
    supabase.from('ai_agent_config').select('roteiro').eq('organization_id', orgId),
  ]);
  return {
    config: integracao.data?.config ?? null,
    temIntegracao: !!integracao.data,
    roteiros: (agentes.data ?? []).map(a => a.roteiro),
  };
}

// Qual organização o usuário está usando agora.
//
// Até aqui o código inteiro perguntava "qual é a org DESTE usuário?" com um
// `.maybeSingle()` em `organization_members`. Isso não é só uma limitação: com
// dois vínculos o PostgREST devolve **erro**, o resultado vira nulo e a pessoa é
// mandada para o /setup como se não tivesse organização nenhuma. Ou seja, hoje
// quem entra numa segunda empresa perde o acesso à primeira.
//
// A escolha mora num cookie, e não na URL nem no estado do navegador, porque
// quem monta as telas é Server Component: o servidor precisa saber a org antes
// de renderizar qualquer coisa.
//
// **O cookie nunca é acreditado sozinho.** Ele só escolhe entre os vínculos que
// o banco confirma para aquele usuário; um id qualquer colado ali cai no vínculo
// padrão. Quem de fato protege continua sendo a RLS.

import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { PapelMembro } from '../permissoes';
import { COOKIE_PRODUTO_ATIVO, escolherProduto, produtosValidos, type Produto } from '../produtos';

type Client = SupabaseClient<Database>;

export const COOKIE_ORG_ATIVA = 'wappia_org';

export interface VinculoDoUsuario {
  memberId: string;
  organizationId: string;
  nome: string;
  role: PapelMembro;
  orgNome: string;
  orgSegmento: string;
  /** Seções que esta organização não usa. Lista vazia = mostra tudo, que é o
   *  padrão de toda organização. Ver a migration 20260920000002. */
  secoesOcultas: string[];
  /** Produtos contratados (S14). Nunca vazio: sem nada no banco vale atendimento. */
  produtos: Produto[];
}

export interface MembroAtivo extends VinculoDoUsuario {
  /** Todos os vínculos do usuário, para a troca de organização na tela. */
  vinculos: VinculoDoUsuario[];
  /** O produto na tela: o do cookie, se contratado, senão o primeiro. */
  produtoAtivo: Produto;
}

/**
 * Os vínculos do usuário logado, em ordem estável (o mais antigo primeiro, que
 * é o que a pessoa reconhece como "a minha empresa").
 */
export async function vinculosDoUsuario(supabase: Client, userId: string): Promise<VinculoDoUsuario[]> {
  const { data } = await supabase
    .from('organization_members')
    .select('id, nome, role, organization_id, organizations(nome, nome_fantasia, segmento, secoes_ocultas, produtos)')
    .eq('user_id', userId)
    .eq('ativo', true)
    .order('created_at');

  return (data ?? []).map(m => ({
    memberId: m.id,
    organizationId: m.organization_id,
    nome: m.nome,
    role: m.role,
    orgNome: m.organizations?.nome_fantasia || (m.organizations?.nome ?? ''),
    orgSegmento: m.organizations?.segmento ?? 'outro',
    secoesOcultas: m.organizations?.secoes_ocultas ?? [],
    produtos: produtosValidos(m.organizations?.produtos),
  }));
}

/**
 * A decisão em si, sem framework no meio: vale a escolhida quando ela é um
 * vínculo de verdade, senão o primeiro. É aqui que o cookie deixa de ser
 * acreditado — um id de outra empresa não seleciona nada.
 */
export function escolherVinculo(
  vinculos: VinculoDoUsuario[],
  escolhida: string | null | undefined,
): VinculoDoUsuario | null {
  if (!vinculos.length) return null;
  return vinculos.find(v => v.organizationId === escolhida) ?? vinculos[0];
}

/**
 * O id gravado no cookie, ou `undefined`.
 *
 * O try/catch não é defensivo à toa: `cookies()` **lança** fora de um request
 * (num teste que chama a rota direto, num script). Nesse caso não há escolha a
 * respeitar, e o certo é cair no vínculo padrão em vez de derrubar a chamada.
 */
async function lerCookie(nome: string): Promise<string | undefined> {
  try {
    return (await cookies()).get(nome)?.value;
  } catch {
    return undefined;
  }
}

/**
 * O vínculo ativo: o do cookie quando ele é de verdade, senão o primeiro.
 * Devolve `null` quando o usuário não é membro de nenhuma organização.
 */
export async function membroAtivo(supabase: Client, userId: string): Promise<MembroAtivo | null> {
  const vinculos = await vinculosDoUsuario(supabase, userId);
  const vinculo = escolherVinculo(vinculos, await lerCookie(COOKIE_ORG_ATIVA));
  if (!vinculo) return null;
  const produtoAtivo = escolherProduto(vinculo.produtos, await lerCookie(COOKIE_PRODUTO_ATIVO));
  return { ...vinculo, vinculos, produtoAtivo };
}

/**
 * Atalho para as rotas de API, que só precisam saber em nome de qual
 * organização a pessoa está agindo.
 */
export async function orgDaRequisicao(
  supabase: Client,
  userId: string,
): Promise<{ organizationId: string; memberId: string; role: PapelMembro; produtoAtivo: Produto } | null> {
  const ativo = await membroAtivo(supabase, userId);
  if (!ativo) return null;
  return { organizationId: ativo.organizationId, memberId: ativo.memberId, role: ativo.role, produtoAtivo: ativo.produtoAtivo };
}

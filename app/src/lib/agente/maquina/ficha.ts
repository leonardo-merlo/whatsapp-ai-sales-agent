// A ficha do orçamento em andamento no banco (`orcamentos_em_andamento`, modo
// `valendo`). Lê, cria e grava cada transição com a trava de versão.
//
// **Nunca `upsert`:** o índice de "um ativo por conversa" é parcial, e o
// PostgREST não o enxerga em `ON CONFLICT` (42P10). Lê, e então insere ou
// atualiza por `id` e `versao`.
//
// **A versão é a trava de concorrência** (regra 3 do spec): `update ... where
// versao = N`. Zero linhas alteradas quer dizer que outra execução já andou, e
// a atual desiste do que ia fazer.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../supabase/database.types';
import { diaEmSP } from '../../fuso';
import { faltaParaAEtapa, type CadastroAnterior, type DadosDoOrcamento, type EstadoDoOrcamento, type EtapaDaMaquina, type PerguntaPendente } from './tipos';

type Client = SupabaseClient<Database>;

/** O orçamento parado há mais que isto numa etapa de espera vira `expirado` (X3 simples). */
export const PRAZO_SEM_RESPOSTA_MS = 24 * 60 * 60 * 1000;

/** Todas as etapas que o índice parcial considera finais (inclusive as de outras fases). */
const FINAIS_NO_BANCO = ['pedido_criado', 'expirado', 'substituido', 'encerrado', 'cadastro_concluido'];

export class ErroDeVersao extends Error {
  constructor() { super('outra execução já mudou este orçamento'); }
}

export class ErroDeEtapa extends Error {}

export interface Ficha {
  id: string;
  versao: number;
  estado: EstadoDoOrcamento;
  atualizadoEm: string;
  /** O número que o cliente vê (T1). Nasce na lista confirmada; antes disso, null. */
  numero: number | null;
  /** Até quando o orçamento vale (5 dias da lista confirmada). */
  expiraEm: string | null;
}

/** T1: o orçamento vale 5 dias a partir da lista confirmada (pedido do Leonardo, 20/10). */
export const VALIDADE_DO_ORCAMENTO_MS = 5 * 24 * 60 * 60 * 1000;

export interface Onde {
  orgId: string;
  conversationId: string;
  contactId: string | null;
  waNumberId: string | null;
}

/** O orçamento ativo da conversa, ou null. */
export async function lerFicha(supabase: Client, conversationId: string): Promise<Ficha | null> {
  // `*` e não a lista de colunas: `numero` vem de uma migration (20261021000020)
  // que pode chegar ao banco depois do código. Com a lista, a máquina parava.
  const { data, error } = await supabase.from('orcamentos_em_andamento')
    .select('*')
    .eq('conversation_id', conversationId).eq('modo', 'valendo');
  if (error) throw new Error(`Máquina: ler o orçamento: ${error.message}`);
  const linha = (data ?? []).find(l => !FINAIS_NO_BANCO.includes(l.etapa as string));
  if (!linha) return null;
  return fichaDaLinha(linha);
}

type LinhaDaFicha = Database['public']['Tables']['orcamentos_em_andamento']['Row'] & { numero?: number | null };

/** A linha do banco como ficha (vale para a ativa e para as que estão em espera). */
export function fichaDaLinha(linha: LinhaDaFicha): Ficha {
  return {
    id: linha.id as string,
    versao: linha.versao as number,
    atualizadoEm: linha.updated_at as string,
    numero: linha.numero ?? null,
    expiraEm: linha.expira_em ?? null,
    estado: {
      etapa: linha.etapa as EtapaDaMaquina,
      pergunta: (linha.pergunta_pendente as PerguntaPendente | null) ?? null,
      dados: (linha.dados ?? {}) as DadosDoOrcamento,
      desdeMensagem: (linha.etapa_desde_mensagem as string | null) ?? null,
      motivoPausa: (linha.motivo_pausa as string | null) ?? null,
    },
  };
}

/**
 * Venceu? Com número (lista confirmada), vale a validade de 5 dias, em qualquer
 * etapa. Sem número: parado 24 h numa etapa de espera, e a lista que já está
 * com o vendedor não vence.
 */
export function venceu(ficha: Ficha, agora = Date.now()): boolean {
  if (ficha.numero !== null && ficha.expiraEm) return agora > new Date(ficha.expiraEm).getTime();
  if (ficha.estado.etapa === 'aguardando_vendedor') return false;
  return agora - new Date(ficha.atualizadoEm).getTime() > PRAZO_SEM_RESPOSTA_MS;
}

function colunas(estado: EstadoDoOrcamento) {
  const falta = faltaParaAEtapa(estado);
  if (falta) throw new ErroDeEtapa(`R1: ${estado.etapa} ${falta}`);
  return {
    etapa: estado.etapa,
    pergunta_pendente: estado.pergunta,
    dados: estado.dados as unknown as Json,
    etapa_desde_mensagem: estado.desdeMensagem,
    motivo_pausa: estado.motivoPausa ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** Cria o orçamento. Outra execução que criou primeiro (índice único) vira `ErroDeVersao`. */
export async function criarFicha(supabase: Client, onde: Onde, estado: EstadoDoOrcamento): Promise<Ficha> {
  const { data, error } = await supabase.from('orcamentos_em_andamento').insert({
    organization_id: onde.orgId,
    conversation_id: onde.conversationId,
    contact_id: onde.contactId,
    wa_number_id: onde.waNumberId,
    modo: 'valendo',
    versao: 1,
    ...colunas(estado),
  }).select('id, versao, updated_at').single();
  if (error) {
    if (error.code === '23505') throw new ErroDeVersao();
    throw new Error(`Máquina: criar o orçamento: ${error.message}`);
  }
  return { id: data.id as string, versao: data.versao as number, atualizadoEm: data.updated_at as string, estado, numero: null, expiraEm: null };
}

/**
 * Dá o número e a validade ao orçamento (T1), uma vez só: a função do banco
 * devolve os que ele já tem. Se falhar (a migration ainda não foi aplicada),
 * o orçamento segue sem número em vez de travar a conversa.
 */
export async function numerarFicha(supabase: Client, ficha: Ficha, agora = Date.now()): Promise<Ficha> {
  const { data, error } = await supabase.rpc('numerar_orcamento', {
    p_id: ficha.id, p_expira_em: new Date(agora + VALIDADE_DO_ORCAMENTO_MS).toISOString(),
  });
  const linha = Array.isArray(data) ? data[0] : null;
  if (error || !linha) {
    console.error(`Máquina: numerar o orçamento ${ficha.id}: ${error?.message ?? 'sem resposta'}`);
    return ficha;
  }
  return { ...ficha, numero: linha.numero, expiraEm: linha.expira_em };
}

/** Grava uma transição. Só passa se a versão ainda for a que foi lida. */
export async function gravarFicha(supabase: Client, ficha: Ficha, estado: EstadoDoOrcamento): Promise<Ficha> {
  const { data, error } = await supabase.from('orcamentos_em_andamento')
    .update({ ...colunas(estado), versao: ficha.versao + 1 })
    .eq('id', ficha.id).eq('versao', ficha.versao)
    .select('id, updated_at');
  if (error) throw new Error(`Máquina: gravar o orçamento: ${error.message}`);
  if (!data?.length) throw new ErroDeVersao();
  return { ...ficha, versao: ficha.versao + 1, estado, atualizadoEm: data[0].updated_at as string };
}

/**
 * O cliente confirmado num orçamento desta conversa aberto HOJE (dia de
 * Brasília), o mais recente. É o que o T20 oferece no orçamento seguinte.
 */
export async function cadastroDeHoje(supabase: Client, conversationId: string, agora = Date.now()): Promise<CadastroAnterior | null> {
  const { data, error } = await supabase.from('orcamentos_em_andamento')
    .select('dados, created_at')
    .eq('conversation_id', conversationId).eq('modo', 'valendo')
    .order('created_at', { ascending: false }).limit(10);
  if (error) throw new Error(`Máquina: orçamentos anteriores: ${error.message}`);
  const hoje = diaEmSP(agora);
  for (const linha of data ?? []) {
    if (diaEmSP(linha.created_at as string) !== hoje) break;
    const d = (linha.dados ?? {}) as DadosDoOrcamento;
    if (d.cliente?.confirmado && d.cliente.origem === 'erp' && d.documento?.valor) return { documento: d.documento.valor, cliente: d.cliente, ...(d.entrega ? { entrega: { cidade: d.entrega.cidade, uf: d.entrega.uf } } : {}) };
  }
  return null;
}

/** Fecha o orçamento atual (lista já confirmada e o cliente pediu outro, ou venceu o prazo). */
export async function fecharFicha(supabase: Client, ficha: Ficha, etapa: 'encerrado' | 'expirado'): Promise<void> {
  await gravarFicha(supabase, ficha, { ...ficha.estado, etapa });
}

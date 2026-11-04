// O fiscal: o código confere os itens antes da lista ir ao cliente, e o
// orçamento só sai com a lista que o cliente viu (parte C de
// prompt-nova-sessao-fiscal.md; comportamento esperado em
// docs/comportamento-esperado-orcamento.md).
//
// **A chave é a lista abaixo.** Organização fora dela não ganha
// a ferramenta `confirmar_itens` nem a trava: a lista de ferramentas e o fluxo
// ficam idênticos aos de antes. Ligar na Distribuidora Exemplo só com o ok do Leonardo,
// depois do Passo 5 (a medição com a chave desligada e ligada).
//
// **Onde a lista fica guardada.** Na tabela da máquina de estados
// (`orcamentos_em_andamento`, spec de 21/09), numa linha `modo = 'valendo'` na
// etapa `levantando_itens`, com `pergunta_pendente = 'confirmar_itens'`. É a
// etapa de itens da máquina, a primeira a valer de verdade; as outras etapas
// continuam em sombra. `etapa_desde_mensagem` é a mensagem do cliente que
// estava sendo respondida quando a lista saiu: a confirmação só vale numa
// mensagem DEPOIS dela (a "G-fala" do spec).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import type { ContextoDaFerramenta } from './ferramentas/tipos';
import { usaPipelineV2 } from '../v2/pipeline';

type Client = SupabaseClient<Database>;

export const ORGS_COM_FISCAL = new Set<string>([
  // Ligado em 02/10 com o ok do Leonardo, depois do Passo 5 enxuto (5 mensagens
  // difíceis no mesmo dia: desligado 8% e 25 graves, ligado 76% e 1 grave).
  'e8e00000-0000-4000-8000-0000000000e1', // Distribuidora Exemplo
]);

export function usaFiscal(orgId: string): boolean {
  return ORGS_COM_FISCAL.has(orgId);
}

/** Um item da lista que o cliente viu, como fica em `dados.itens`. */
export interface ItemDaLista {
  /** O que o cliente escreveu, como a IA copiou. */
  descricao_livre: string;
  /** Os campos que a IA separou, sem traduzir. Só registro: quem decide é o texto. */
  item: string;
  medida: string;
  quantidade: number;
  /** Nulo quando a IA não achou o produto. */
  produto_id: string | null;
  descricao: string | null;
  unidade: string | null;
  /** `sem_a_medida`: a família existe, a medida não, e a lista oferece as mais
   *  próximas. `nao_trabalhamos`: está na lista fixa do que a loja não vende. */
  conferencia: 'conferido' | 'nao_conferido' | 'nao_encontrado' | 'sem_a_medida' | 'nao_trabalhamos' | 'em_duvida';
  /** As opções oferecidas ao cliente: as mais próximas (medida que não existe)
   *  ou as que servem (item em dúvida). */
  proximos?: string[];
  /** A mesma conferência feita só com o campo `medida`, para comparar no Passo 5. */
  conferencia_pelo_campo_medida: 'bate' | 'nao_bate' | 'sem_medida' | 'sem_campo';
}

const ETAPAS_FINAIS = ['pedido_criado', 'expirado', 'substituido', 'encerrado', 'cadastro_concluido'];

interface LinhaValendo {
  id: string;
  etapa: string;
  versao: number;
  etapa_desde_mensagem: string | null;
  pergunta_pendente: string | null;
  dados: Json;
}

async function linhaValendo(supabase: Client, conversationId: string): Promise<LinhaValendo | null> {
  const { data, error } = await supabase.from('orcamentos_em_andamento')
    .select('id, etapa, versao, etapa_desde_mensagem, pergunta_pendente, dados')
    .eq('conversation_id', conversationId).eq('modo', 'valendo');
  if (error) throw new Error(error.message);
  return ((data ?? []) as LinhaValendo[]).find(l => !ETAPAS_FINAIS.includes(l.etapa)) ?? null;
}

/**
 * Grava a lista que acabou de ir ao cliente.
 *
 * Nunca `upsert`: o índice de "um ativo por conversa" é parcial, e o PostgREST
 * não o enxerga em `ON CONFLICT` (42P10). Lê, e então atualiza por id e versão
 * ou insere. Um orçamento já criado na mesma conversa é encerrado antes: o
 * pedido novo é outro orçamento.
 */
export async function gravarListaEnviada(ctx: ContextoDaFerramenta, itens: ItemDaLista[]): Promise<void> {
  const atual = await linhaValendo(ctx.supabase, ctx.conversationId);
  const campos = {
    etapa: 'levantando_itens',
    etapa_desde_mensagem: ctx.mensagemId ?? null,
    pergunta_pendente: 'confirmar_itens',
    dados: { itens } as unknown as Json,
    updated_at: new Date().toISOString(),
  };
  if (atual?.etapa === 'levantando_itens') {
    const { error } = await ctx.supabase.from('orcamentos_em_andamento')
      .update({ ...campos, versao: atual.versao + 1 }).eq('id', atual.id).eq('versao', atual.versao);
    if (error) throw new Error(error.message);
    return;
  }
  if (atual) {
    const { error } = await ctx.supabase.from('orcamentos_em_andamento')
      .update({ etapa: 'encerrado', versao: atual.versao + 1, updated_at: new Date().toISOString() }).eq('id', atual.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await ctx.supabase.from('orcamentos_em_andamento').insert({
    organization_id: ctx.orgId,
    conversation_id: ctx.conversationId,
    contact_id: ctx.contactId,
    wa_number_id: ctx.waNumberId,
    modo: 'valendo',
    ...campos,
  });
  if (error) throw new Error(error.message);
}

const SEM_LISTA =
  'Antes de consultar preço ou criar o orçamento, confirme a lista com o cliente: chame confirmar_itens '
  + 'com todos os itens. O sistema manda a lista a ele.';
const ESPERE_O_CLIENTE =
  'A lista acabou de ser enviada ao cliente e ele ainda não respondeu. NÃO consulte preço nem crie o '
  + 'orçamento agora: espere a resposta dele.';
const LISTA_MUDOU =
  'Os itens não são os mesmos da lista que o cliente confirmou. Se ele pediu mudança, chame confirmar_itens '
  + 'de novo com a lista nova. Se não, use exatamente os códigos e as quantidades da lista enviada.';

const chaveDoItem = (codigo: string, quantidade: number): string => `${codigo}|${quantidade}`;

/**
 * A trava de `consultar_preco` e `criar_orcamento` com o fiscal ligado: só
 * passa com uma lista enviada, o cliente tendo falado depois dela, e os mesmos
 * itens (código e quantidade). Devolve o recado ao modelo, ou null para seguir.
 */
export async function travaDaListaConfirmada(
  ctx: ContextoDaFerramenta,
  itens: { produto_codigo: string; quantidade: number }[],
): Promise<string | null> {
  // Com a v2 ligada, a lista confirmada vem dela e a trava vale do mesmo jeito.
  if (!usaFiscal(ctx.orgId) && !usaPipelineV2(ctx.roteiro)) return null;
  let linha: LinhaValendo | null;
  try {
    linha = await linhaValendo(ctx.supabase, ctx.conversationId);
  } catch (err) {
    console.error('Fiscal: não consegui ler a lista confirmada:', err instanceof Error ? err.message : err);
    return SEM_LISTA;
  }
  if (!linha || linha.etapa !== 'levantando_itens' || linha.pergunta_pendente !== 'confirmar_itens') return SEM_LISTA;
  if (!ctx.mensagemId || linha.etapa_desde_mensagem === ctx.mensagemId) return ESPERE_O_CLIENTE;

  const daLista = ((linha.dados as { itens?: ItemDaLista[] } | null)?.itens ?? [])
    .filter(i => i.produto_id)
    .map(i => chaveDoItem(i.produto_id!, i.quantidade)).sort();
  const pedidos = itens.map(i => chaveDoItem(i.produto_codigo, i.quantidade)).sort();
  if (daLista.length !== pedidos.length || daLista.some((c, i) => c !== pedidos[i])) return LISTA_MUDOU;
  return null;
}

/** Depois de o orçamento ser criado: a lista sai da espera de confirmação. */
export async function marcarOrcamentoCriado(ctx: ContextoDaFerramenta): Promise<void> {
  if (!usaFiscal(ctx.orgId) && !usaPipelineV2(ctx.roteiro)) return;
  try {
    const linha = await linhaValendo(ctx.supabase, ctx.conversationId);
    if (!linha) return;
    await ctx.supabase.from('orcamentos_em_andamento')
      .update({ etapa: 'orcamento_criado', pergunta_pendente: null, versao: linha.versao + 1, updated_at: new Date().toISOString() })
      .eq('id', linha.id);
  } catch (err) {
    console.error('Fiscal: não consegui marcar o orçamento criado:', err instanceof Error ? err.message : err);
  }
}

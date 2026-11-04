// A ponte entre a v2 e o fluxo de vendas da v1 (com PIPELINE_VERSION=v2).
//
// A v1 continua dona da conversa: CPF/CNPJ, cadastro, região, preço e
// orçamento. A v2 entra só no meio, para levantar os itens:
//
//   1. A IA da v1 recebe o pedido de produtos e chama `levantar_itens` (no
//      lugar de buscar e confirmar ela mesma). A v2 abre um pedido e responde
//      ao cliente com os resolvidos e as perguntas.
//   2. Enquanto esse pedido está aberto, as mensagens do cliente vão direto
//      para a v2 (respostas às perguntas, itens novos, "sim" na lista).
//   3. Quando o cliente confirma a lista, a v2 grava os itens no mesmo lugar
//      em que a v1 guarda a lista do fiscal (`orcamentos_em_andamento`), e a
//      v1 segue: consulta o preço e cria o orçamento só com esses itens (a
//      trava `travaDaListaConfirmada` confere código e quantidade).

import type { SupabaseClient } from '@supabase/supabase-js';
import { gravarListaEnviada, type ItemDaLista } from '@/lib/agente/fiscal';
import { logAiUsage, MODELO_IA } from '@/lib/agente/log-uso';
import type { ContextoDaFerramenta, FerramentaDoAgente } from '@/lib/agente/ferramentas/tipos';
import { armazemSupabase, cacheSupabase, type ItemDoSnapshot } from './armazem';
import { clienteAnthropic, type ClienteIA } from './cache-ia';
import { montarResposta, processarMensagem, type Dependencias } from './conversa';
import { lerValor } from './numeros';
import { catalogoDaOrganizacao, operacoesLigadas } from './pipeline';

/** Cada chamada nova à IA entra em ai_usage, para o gasto da v2 aparecer no relatório de uso do painel. */
function comRegistroDeUso(cliente: ClienteIA, supabase: SupabaseClient, orgId: string, conversationId: string): ClienteIA {
  return {
    async chamar(pedido) {
      const resposta = await cliente.chamar(pedido);
      await logAiUsage(supabase as unknown as Parameters<typeof logAiUsage>[0], { orgId, origem: 'v2', model: MODELO_IA, usage: resposta.uso, conversationId });
      return resposta;
    },
  };
}

async function dependencias(supabase: SupabaseClient, orgId: string, conversationId: string): Promise<Dependencias> {
  const { catalogo, saude, versao } = await catalogoDaOrganizacao(supabase, orgId);
  return {
    armazem: armazemSupabase(supabase, orgId), cache: cacheSupabase(supabase), cliente: comRegistroDeUso(await clienteAnthropic(), supabase, orgId, conversationId),
    catalogo, saude, versaoDoCatalogo: versao, operacoes: operacoesLigadas(),
  };
}

/** O pedido da v2 ainda aberto nesta conversa (levantando itens ou esperando o "sim"). */
export async function pedidoV2Aberto(supabase: SupabaseClient, orgId: string, conversationId: string): Promise<{ id: string; estado: string } | null> {
  const { data, error } = await supabase.from('v2_pedidos').select('id, estado')
    .eq('organization_id', orgId).eq('referencia', conversationId).neq('estado', 'confirmado')
    .order('criado_em', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`v2: pedido aberto: ${error.message}`);
  return (data as { id: string; estado: string } | null) ?? null;
}

/**
 * O pedido aberto que é mesmo de ANTES da máquina: a conversa estava na v2
 * quando a chave ligou. Conversa com ficha `valendo` já é da máquina, e todo
 * pedido dela foi aberto pela máquina (a ficha nasce no pedido de orçamento,
 * antes dos itens), então não volta ao caminho antigo.
 *
 * Teste de 20/10 (T12): a ficha de 16/10 venceu, e o pedido de 16/10, que ela
 * tinha usado e nunca fechou, levou a conversa para o caminho antigo. Os itens
 * novos foram somados aos de 16/10 e o CPF/CNPJ foi pulado.
 */
export async function pedidoV2DeAntesDaMaquina(supabase: SupabaseClient, orgId: string, conversationId: string): Promise<{ id: string; estado: string } | null> {
  const aberto = await pedidoV2Aberto(supabase, orgId, conversationId);
  if (!aberto) return null;
  const { data, error } = await supabase.from('orcamentos_em_andamento').select('id')
    .eq('conversation_id', conversationId).eq('modo', 'valendo').limit(1);
  if (error) throw new Error(`v2: fichas da máquina: ${error.message}`);
  return data?.length ? null : aberto;
}

/** As falas do cliente desde a última resposta da casa: é a "mensagem" desta vez. */
async function falasDoCliente(supabase: SupabaseClient, conversationId: string): Promise<string> {
  const { data, error } = await supabase.from('messages').select('autor, texto, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: false }).limit(30);
  if (error) throw new Error(`v2: mensagens: ${error.message}`);
  const falas: string[] = [];
  for (const m of data ?? []) {
    if (m.autor !== 'cliente') break;
    if (m.texto) falas.unshift(m.texto as string);
  }
  return falas.join('\n');
}

/** A lista confirmada na v2 vira a lista que a v1 confere antes do preço e do orçamento. */
async function entregarListaParaV1(supabase: SupabaseClient, orgId: string, conversationId: string, itens: ItemDoSnapshot[]): Promise<void> {
  const { data: conversa } = await supabase.from('conversations').select('contact_id, wa_number_id').eq('id', conversationId).maybeSingle();
  const lista: ItemDaLista[] = itens.map(i => ({
    descricao_livre: i.descricao, item: i.descricao, medida: '', quantidade: lerValor(i.quantidade ?? '1')?.valor ?? 1,
    produto_id: i.codigo, descricao: i.descricao, unidade: null, conferencia: 'conferido', conferencia_pelo_campo_medida: 'sem_campo',
  }));
  // Sem mensagemId: a confirmação já aconteceu, então a próxima chamada de preço da v1 passa pela trava.
  const ctx = { supabase, orgId, conversationId, contactId: (conversa?.contact_id as string | null) ?? null, waNumberId: (conversa?.wa_number_id as string | null) ?? null, mensagemId: null } as unknown as ContextoDaFerramenta;
  await gravarListaEnviada(ctx, lista);
}

/**
 * A v1 segue para preço e orçamento depois da lista confirmada? Só com
 * V2_ORCAMENTO=ligado. Por padrão a conversa para na lista: a Distribuidora Exemplo ainda
 * não tem cotação nem orçamento no ERP, e o teste agora é só de identificação.
 */
export function orcamentoDepoisDaLista(valor: string | undefined = process.env.V2_ORCAMENTO): boolean {
  return valor?.trim() === 'ligado';
}

/** O que o cliente recebe quando a conversa para na lista confirmada. */
export const TEXTO_DA_LISTA_CONFIRMADA = 'Lista confirmada! O vendedor vai te mandar o orçamento com os preços.';

export const quantidadeBR = (q: string | null): string => (q ?? '?').replace('.', ',');

/** O que a v1 lê no system quando a lista acabou de ser confirmada na v2. */
export function instrucaoDaListaConfirmada(itens: ItemDoSnapshot[]): string {
  return `\n\n## Lista confirmada pelo cliente\nO cliente acabou de confirmar a lista de produtos (o sistema conferiu cada item). Siga o fluxo: consulte o preço e crie o orçamento com EXATAMENTE estes itens, sem buscar nem trocar produto:\n${itens.map(i => `- ${i.codigo} × ${quantidadeBR(i.quantidade)} (${i.descricao})`).join('\n')}\nNão repita a lista ao cliente.`;
}

/** A instrução da v1 quando a v2 cuida dos itens (no lugar da instrução do fiscal). */
export const INSTRUCAO_DA_V2 = `

## Produtos do pedido
Quando o cliente mandar os produtos que quer (a lista do pedido, um item ou vários), chame a ferramenta levantar_itens. É o sistema que identifica cada produto no catálogo e conversa com o cliente até a lista ficar confirmada: você NÃO escolhe código, NÃO escreve a lista e NÃO pergunta medida. Antes dos produtos, siga o fluxo de sempre (CPF/CNPJ, cadastro, região de entrega). Use buscar_produtos só para responder dúvida sobre o que a loja tem.`;

/** Ferramenta da v1 que entrega o pedido de produtos à v2. */
export const levantarItensNaV2: FerramentaDoAgente = {
  definicao: {
    name: 'levantar_itens',
    description:
      'Entrega o pedido de produtos do cliente ao sistema, que identifica cada produto no catálogo, pergunta ao '
      + 'cliente o que faltar e manda a lista para ele confirmar. Chame quando o cliente mandar os produtos que quer. '
      + 'Não precisa de argumentos: o sistema lê as mensagens do cliente. Depois, escreva só uma frase curta: '
      + 'o sistema manda a lista e as perguntas.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  async executar(_entrada, ctx) {
    try {
      const supabase = ctx.supabase as unknown as SupabaseClient;
      const deps = await dependencias(supabase, ctx.orgId, ctx.conversationId);
      const pedido = (await pedidoV2Aberto(supabase, ctx.orgId, ctx.conversationId)) ?? await deps.armazem.criarPedido(ctx.conversationId);
      const texto = ctx.falasDoPedido?.trim() || await falasDoCliente(supabase, ctx.conversationId);
      const r = await processarMensagem(deps, pedido.id, { texto });
      ctx.mensagensDoSistema?.push(r.texto);
      return 'O sistema JÁ MANDOU ao cliente os itens identificados e as perguntas, logo depois da sua resposta. '
        + 'Escreva só uma frase curta (ex.: "Separei os itens, confere comigo:"). Não repita itens, não consulte preço agora: '
        + 'as próximas mensagens do cliente sobre os itens vão direto para o sistema.';
    } catch (err) {
      console.error('levantar_itens (v2):', err instanceof Error ? err.message : err);
      return 'Não consegui levantar os itens agora. Diga ao cliente que vai conferir o pedido e já retorna.';
    }
  },
};

/**
 * A máquina de estados chama a v2 direto na etapa `levantando_itens`, sem a
 * ferramenta `levantar_itens` no meio: é o código que sabe que é a hora dos
 * itens. Sem `pedidoId`, abre um pedido novo (o orçamento é outro).
 */
export async function processarNaV2(
  supabase: SupabaseClient, orgId: string, conversationId: string, pedidoId: string | null, texto: string,
): Promise<{ pedidoId: string; texto: string; confirmados: ItemDoSnapshot[] | null }> {
  const deps = await dependencias(supabase, orgId, conversationId);
  const id = pedidoId ?? (await deps.armazem.criarPedido(conversationId)).id;
  const r = await processarMensagem(deps, id, { texto });
  return { pedidoId: id, texto: r.texto, confirmados: r.snapshot?.confirmado ? r.snapshot.itens : null };
}

/** A lista do pedido como está agora, sem mensagem nova (o cliente trocou de CNPJ e voltou aos itens). */
export async function listaDaV2(supabase: SupabaseClient, orgId: string, conversationId: string, pedidoId: string): Promise<string> {
  return (await montarResposta(await dependencias(supabase, orgId, conversationId), pedidoId)).texto;
}

/**
 * Responde, pela v2, a mensagem de uma conversa com pedido aberto. Devolve o
 * texto para o cliente ou, se ele acabou de confirmar a lista, os itens
 * confirmados (e a lista já gravada para a v1 seguir com preço e orçamento).
 */
export async function responderPedidoV2Aberto(
  supabase: SupabaseClient, orgId: string, conversationId: string, pedidoId: string,
): Promise<{ texto: string; confirmados: ItemDoSnapshot[] | null }> {
  const deps = await dependencias(supabase, orgId, conversationId);
  const texto = await falasDoCliente(supabase, conversationId);
  const r = await processarMensagem(deps, pedidoId, { texto });
  if (r.snapshot?.confirmado) {
    await entregarListaParaV1(supabase, orgId, conversationId, r.snapshot.itens);
    return { texto: r.texto, confirmados: r.snapshot.itens };
  }
  return { texto: r.texto, confirmados: null };
}

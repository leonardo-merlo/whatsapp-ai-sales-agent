// Registra a venda que a IA detectou numa conversa, como PENDENTE de aprovação.
//
// Por que pendente e não baixa direta no estoque: a IA erra nome e quantidade de
// produto. Ela é boa em perceber "o cliente fechou a compra" e em dizer o que foi
// citado, e ruim em ser a fonte de verdade de um número que mexe no seu estoque.
// Então ela só propõe — quem confirma é o dono, pelo sino de notificações.
//
// Duas decisões de segurança de dado, ambas de propósito:
//   1. O nome do produto é casado com o catálogo AQUI, no código, não pela IA.
//      Nome que não bate vira item sem product_id: aparece na notificação para o
//      dono conferir e não dá baixa em nada.
//   2. O valor NUNCA vem da IA — é calculado do preço cadastrado. Pedir dinheiro
//      para um LLM é convite a alucinação, e aqui isso viraria faturamento errado.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export interface ItemVendidoIA { produto: string; quantidade: number }

/** Normaliza para comparar nome de produto: sem acento, sem caixa, sem espaço
 *  duplicado. "Aparelho Invisível " e "aparelho invisivel" viram a mesma chave. */
function normalizar(s: string): string {
  return s
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Preço cadastrado é texto livre ("R$ 1.200", "a partir de R$ 90", "sob
 *  consulta"). Extrai centavos do que der; o que não tiver número vira 0 e a
 *  venda entra com valor zerado para o dono corrigir. */
export function precoParaCentavos(valor: string): number {
  const limpo = valor.replace(/[^\d.,]/g, '');
  if (!limpo) return 0;

  let normalizado: string;
  if (limpo.includes(',')) {
    // Vírgula é o separador decimal em pt-BR; ponto é milhar.
    normalizado = limpo.replace(/\./g, '').replace(',', '.');
  } else {
    const partes = limpo.split('.');
    // "12.50" é decimal; "1.200" é milhar.
    normalizado = partes.length > 1 && partes[partes.length - 1].length === 2
      ? `${partes.slice(0, -1).join('')}.${partes[partes.length - 1]}`
      : partes.join('');
  }

  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

interface ProdutoCatalogo {
  id: string;
  procedimento: string;
  valor: string;
}

/** Acha o produto do catálogo correspondente ao nome que a IA citou.
 *  Exige correspondência exata ou que um nome contenha o outro por inteiro, e
 *  desiste quando mais de um produto casa — na dúvida é melhor o dono conferir
 *  do que dar baixa no produto errado. */
function casarProduto(nomeIA: string, catalogo: ProdutoCatalogo[]): ProdutoCatalogo | null {
  const alvo = normalizar(nomeIA);
  if (!alvo) return null;

  const exatos = catalogo.filter(p => normalizar(p.procedimento) === alvo);
  if (exatos.length === 1) return exatos[0];
  if (exatos.length > 1) return null;

  const parciais = catalogo.filter(p => {
    const nome = normalizar(p.procedimento);
    return nome.includes(alvo) || alvo.includes(nome);
  });
  return parciais.length === 1 ? parciais[0] : null;
}

/** Cria a venda pendente + itens + notificação. Best-effort: qualquer falha aqui
 *  não pode derrubar a resposta que o cliente está esperando no WhatsApp. */
export async function registrarVendaPendente(
  supabase: Client,
  params: {
    orgId: string;
    conversationId: string;
    contactId: string | null;
    contatoNome: string;
    itens: ItemVendidoIA[];
  },
): Promise<void> {
  const itensLimpos = params.itens
    .map(it => ({ produto: (it.produto ?? '').trim(), quantidade: Math.max(1, Math.round(Number(it.quantidade) || 1)) }))
    .filter(it => it.produto !== '');
  if (itensLimpos.length === 0) return;

  try {
    const { data: catalogo } = await supabase
      .from('business_prices')
      .select('id, procedimento, valor')
      .eq('organization_id', params.orgId);

    const linhas = itensLimpos.map(it => {
      const p = casarProduto(it.produto, catalogo ?? []);
      return {
        produtoId: p?.id ?? null,
        // Guarda o nome do catálogo quando casou, e o que a IA disse quando não:
        // é o que o dono precisa ler para decidir.
        nome: p?.procedimento ?? it.produto,
        quantidade: it.quantidade,
        valorUnitCentavos: p ? precoParaCentavos(p.valor) : 0,
      };
    });

    const total = linhas.reduce((soma, l) => soma + l.valorUnitCentavos * l.quantidade, 0);

    // O índice único sales_uma_por_conversa_ia recusa a segunda venda da mesma
    // conversa. Isso é esperado: a IA repete "venda concluída" nas mensagens
    // seguintes, e sem isso viravam N vendas e N baixas do mesmo pedido.
    const { data: venda, error: erroVenda } = await supabase
      .from('sales')
      .insert({
        organization_id: params.orgId,
        contact_id: params.contactId,
        conversation_id: params.conversationId,
        valor_total_centavos: total,
        status: 'pendente',
        origem: 'ia',
      })
      .select('id')
      .single();
    if (erroVenda || !venda) return;

    const { error: erroItens } = await supabase.from('sale_items').insert(
      linhas.map(l => ({
        organization_id: params.orgId,
        sale_id: venda.id,
        product_id: l.produtoId,
        nome_snapshot: l.nome,
        quantidade: l.quantidade,
        valor_unit_centavos: l.valorUnitCentavos,
      })),
    );
    if (erroItens) return;

    const resumoItens = linhas.map(l => `${l.quantidade}x ${l.nome}`).join(', ');
    const semCatalogo = linhas.filter(l => l.produtoId === null).map(l => l.nome);
    const valorTexto = (total / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const corpo = [
      params.contatoNome ? `${params.contatoNome} fechou: ${resumoItens}.` : `Venda fechada: ${resumoItens}.`,
      `Valor pelos preços cadastrados: ${valorTexto}.`,
      semCatalogo.length
        ? `Atenção: não encontrei no catálogo ${semCatalogo.join(', ')} — esse item não terá baixa de estoque.`
        : 'Confirme para dar baixa no estoque.',
    ].join(' ');

    await supabase.from('notificacoes').insert({
      organization_id: params.orgId,
      tipo: 'venda_baixa_estoque',
      titulo: 'Venda para confirmar',
      corpo,
      sale_id: venda.id,
      contact_id: params.contactId,
    });
  } catch {
    /* registro de venda é secundário; nunca derruba a resposta ao cliente */
  }
}

// Os orçamentos que um contato pediu (máquina de estados do Wappia Vendas) e os
// produtos que ele mais pediu, para a ficha do contato. Pedido do Leonardo em
// 08/10. "Mais pedidos", não "mais comprados": até o orçamento e o pedido
// existirem, a única base é a lista que o cliente confirmou.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { diaMesEmSP } from '@/lib/fuso';

type Client = SupabaseClient<Database>;

const reais = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');

export interface LinhaDoOrcamento {
  id: string;
  created_at: string;
  updated_at: string;
  etapa: string;
  pergunta_pendente: string | null;
  dados: unknown;
  /** Ausentes antes da migration 20261021000020 e nos orçamentos de antes do T1. */
  numero?: number | null;
  expira_em?: string | null;
}

export interface ItemPedido { codigo: string; descricao: string; quantidade: string | null }

export interface OrcamentoDoContato {
  id: string;
  criadoEm: string;
  situacao: string;
  concluido: boolean;
  /** O que o bloco "Em aberto" mostra; nulo quando não há nada pendente. */
  pendencia: string | null;
  cidade: string | null;
  itens: ItemPedido[];
  /** A forma que o cliente escolheu: "cartão de crédito Visa em 3x · CV3". */
  pagamento: string | null;
  /** O número que o cliente vê (T1); nulo no orçamento de antes dele. */
  numero: number | null;
  /** "vale até 26/10" ou "venceu em 26/10"; nulo sem número. */
  validade: string | null;
}

export interface ProdutoMaisPedido { codigo: string; descricao: string; vezes: number }

export async function listarOrcamentosDoContato(supabase: Client, contactId: string): Promise<LinhaDoOrcamento[]> {
  // `*`: `numero` vem de uma migration que pode chegar depois do código (T1).
  const { data, error } = await supabase
    .from('orcamentos_em_andamento')
    .select('*')
    .eq('contact_id', contactId)
    .eq('modo', 'valendo')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function itensDe(dados: unknown): ItemPedido[] {
  const itens = (dados as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens)) return [];
  return itens
    .filter((i): i is ItemPedido => !!i && typeof i === 'object' && typeof (i as ItemPedido).codigo === 'string')
    .map(i => ({ codigo: i.codigo, descricao: i.descricao ?? i.codigo, quantidade: i.quantidade ?? null }));
}

function situacaoDe(linha: LinhaDoOrcamento, temItens: boolean): string {
  if (linha.etapa === 'definindo_pagamento') return 'Parou na forma de pagamento';
  if (temItens) return 'Lista confirmada';
  switch (linha.etapa) {
    case 'aguardando_documento': return 'Parou no CPF/CNPJ';
    case 'consultando_cadastro':
    case 'coletando_cadastro':
    case 'criando_cadastro': return 'Parou no cadastro';
    case 'confirmando_regiao': return linha.pergunta_pendente === 'cidade' ? 'Parou na cidade' : 'Parou na confirmação do cadastro';
    case 'levantando_itens': return 'Montando a lista';
    case 'expirado': return 'Venceu sem terminar';
    default: return 'Encerrado sem lista';
  }
}

/** Mesmo prazo da máquina (`venceu` em agente/maquina/ficha.ts): 24 h sem mudança, menos a lista que já está com o vendedor. */
const PRAZO_MS = 24 * 60 * 60 * 1000;
const ETAPAS_EM_ANDAMENTO = ['aguardando_documento', 'consultando_cadastro', 'coletando_cadastro', 'criando_cadastro', 'confirmando_regiao', 'levantando_itens', 'definindo_pagamento'];

/** Com número, o orçamento vale até `expira_em` (T1): pedir outro não o cancela. */
function numeradoValendo(linha: LinhaDoOrcamento, agora: number): boolean | null {
  if (linha.numero == null || !linha.expira_em) return null;
  return agora <= new Date(linha.expira_em).getTime();
}

function pendenciaDe(linha: LinhaDoOrcamento, situacao: string, agora: number): string | null {
  const valendo = numeradoValendo(linha, agora);
  if (valendo === false) return null;
  if (valendo && (linha.etapa === 'aguardando_vendedor' || linha.etapa === 'encerrado')) return `Orçamento nº ${linha.numero}, esperando o vendedor`;
  if (linha.etapa === 'aguardando_vendedor') return 'Lista confirmada, esperando o orçamento do vendedor';
  if (!ETAPAS_EM_ANDAMENTO.includes(linha.etapa)) return null;
  if (!valendo && agora - new Date(linha.updated_at).getTime() > PRAZO_MS) return null;
  return `Orçamento sem terminar: ${situacao.toLowerCase()}`;
}

function validadeDe(linha: LinhaDoOrcamento, agora: number): string | null {
  const valendo = numeradoValendo(linha, agora);
  if (valendo === null) return null;
  return `${valendo ? 'vale até' : 'venceu em'} ${diaMesEmSP(linha.expira_em!)}`;
}

export function resumirOrcamento(linha: LinhaDoOrcamento, agora = Date.now()): OrcamentoDoContato {
  const itens = itensDe(linha.dados);
  const valendo = numeradoValendo(linha, agora);
  const semTerminar = ETAPAS_EM_ANDAMENTO.includes(linha.etapa) && agora - new Date(linha.updated_at).getTime() > PRAZO_MS;
  const vencido = valendo === null ? semTerminar : false;
  const entrega = (linha.dados as { entrega?: { cidade?: string; uf?: string | null } } | null)?.entrega;
  const pagamento = (linha.dados as { pagamento?: { codigo?: string; rotulo?: string } } | null)?.pagamento;
  const total = (linha.dados as { cotacao?: { valor_total?: number } } | null)?.cotacao?.valor_total;
  return {
    id: linha.id,
    criadoEm: linha.created_at,
    situacao: valendo === false ? 'Vencido' : vencido ? 'Venceu sem terminar' : situacaoDe(linha, itens.length > 0),
    concluido: itens.length > 0 && linha.etapa !== 'definindo_pagamento',
    pendencia: pendenciaDe(linha, situacaoDe(linha, itens.length > 0), agora),
    cidade: entrega?.cidade ? [entrega.cidade, entrega.uf].filter(Boolean).join('/') : null,
    itens,
    pagamento: pagamento?.rotulo
      ? [pagamento.rotulo, pagamento.codigo, typeof total === 'number' ? `total consultado ${reais(total)}` : null].filter(Boolean).join(' · ')
      : null,
    numero: linha.numero ?? null,
    validade: validadeDe(linha, agora),
  };
}

/** Em quantas listas confirmadas cada produto apareceu, do mais pedido ao menos. */
export function produtosMaisPedidos(orcamentos: OrcamentoDoContato[], maximo = 10): ProdutoMaisPedido[] {
  const contagem = new Map<string, ProdutoMaisPedido>();
  for (const o of orcamentos) {
    for (const codigo of new Set(o.itens.map(i => i.codigo))) {
      const item = o.itens.find(i => i.codigo === codigo)!;
      const atual = contagem.get(codigo) ?? { codigo, descricao: item.descricao, vezes: 0 };
      contagem.set(codigo, { ...atual, vezes: atual.vezes + 1 });
    }
  }
  return [...contagem.values()].sort((a, b) => b.vezes - a.vezes || a.descricao.localeCompare(b.descricao)).slice(0, maximo);
}

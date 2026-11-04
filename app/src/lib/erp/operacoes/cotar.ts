// Operação 3 do contrato: quanto custa, sem criar registro nenhum.
//
// Existe porque o cliente pergunta preço antes de fechar. Sem ela, a IA só
// poderia falar de valor depois de criar o orçamento — e aí todo "quanto sai?"
// viraria um orçamento no sistema deles.
//
// **O formato é o de `precos`, que a Distribuidora Exemplo liberou em 08/10/2026.** O
// caminho continua configurável (`caminhos.ts`); o corpo é este. O ERP precifica
// o código que recebe, sem trocar por equivalente, e devolve saldo e
// `estoque_disponivel` por item.
//
// **A condição de pagamento é obrigatória**, porque ela escolhe a tabela de
// preço (à vista é a 131, BOL 30/60/90 é a 134). Sem ela o ERP responde 400;
// recusamos antes, sem gastar a ida.
//
// **Um produto sem preço recusa a cotação inteira.** O ERP devolve 200 com
// `encontrado: false` no item; nós transformamos em recusa. Devolver o resto
// faria a IA passar ao cliente um total que não é o do pedido dele.

import type { Cotacao, ItemCotado, ItemPedido, PrecoDoErp, RespostaDePrecos } from '../contrato';
import { chamarErp, type ConexaoComOErp, type ResultadoDoErp } from '../cliente-http';

export interface PedidoDeCotacao {
  clienteId?: string | null;
  vendedorId?: string | null;
  /** Código da condição no ERP (`condicoes`), ex.: `001` = à vista. */
  condicaoPagamento?: string | null;
  itens: ItemPedido[];
}

/**
 * A condição de pagamento padrão da organização, em
 * `organization_integrations.config.condicao_pagamento_padrao`.
 *
 * **Vazia é o estado desligado**: sem ela a ferramenta não cota. Ainda não está
 * decidido quais condições a IA oferece nem qual vale quando o cliente não diz
 * (pergunta 5 de `docs/backlog.md`); quando estiver, liga-se por config, sem
 * deploy.
 */
export function condicaoPadraoDaIntegracao(config: unknown): string | null {
  const valor = (config as { condicao_pagamento_padrao?: unknown } | null)?.condicao_pagamento_padrao;
  if (typeof valor !== 'string') return null;
  return valor.trim() || null;
}

function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

function itemCotado(p: PrecoDoErp): ItemCotado {
  return {
    produto_codigo: p.produto_id,
    descricao: p.descricao ?? p.produto_id,
    unidade: p.unidade ?? null,
    quantidade: Number(p.quantidade),
    preco_unitario: Number(p.preco_unitario),
    desconto_percentual: 0,
    valor_total: Number(p.total),
    saldo: typeof p.saldo === 'number' ? p.saldo : null,
    estoque_disponivel: typeof p.estoque_disponivel === 'boolean' ? p.estoque_disponivel : null,
    empresa: p.empresa ?? null,
    tabela_preco: p.tabela_preco ?? null,
    icms_st_estimado: typeof p.icms_st_estimado === 'number' ? p.icms_st_estimado : null,
  };
}

export async function cotarProdutos(
  conexao: ConexaoComOErp,
  pedido: PedidoDeCotacao,
): Promise<ResultadoDoErp<Cotacao>> {
  if (!pedido.itens?.length) {
    return { ok: false, motivo: 'recusado', codigo: 'itens_vazios', mensagem: 'Informe ao menos um item.', campo: 'itens' };
  }
  const condicao = pedido.condicaoPagamento?.trim();
  if (!condicao) {
    return {
      ok: false, motivo: 'recusado', codigo: 'condicao_pagamento_ausente',
      mensagem: 'Informe a condição de pagamento: ela escolhe a tabela de preço.', campo: 'condicao_pagamento',
    };
  }

  const r = await chamarErp<RespostaDePrecos>(conexao, {
    metodo: 'POST',
    operacao: 'cotar',
    corpo: {
      cliente_id: pedido.clienteId ?? null,
      ...(pedido.vendedorId ? { vendedor_id: pedido.vendedorId } : {}),
      condicao_pagamento: condicao,
      produtos: pedido.itens.map(i => ({ produto_id: i.produto_codigo, quantidade: i.quantidade })),
    },
  });

  if (!r.ok) return r;
  const produtos = r.dados?.produtos;
  if (!Array.isArray(produtos)) {
    return {
      ok: false, motivo: 'recusado', codigo: 'resposta_sem_itens',
      mensagem: 'O sistema respondeu sem a lista de produtos.',
    };
  }

  const semPreco = produtos.findIndex(p => !p.encontrado);
  if (semPreco >= 0) {
    const p = produtos[semPreco];
    return {
      ok: false, motivo: 'recusado', codigo: 'produto_nao_encontrado',
      mensagem: p.motivo ?? `O produto ${p.produto_id} não tem preço.`,
      campo: `itens[${semPreco}].produto_codigo`,
    };
  }

  const itens = produtos.map(itemCotado);
  return {
    ok: true,
    dados: {
      itens,
      valor_total: arredondar(itens.reduce((soma, i) => soma + i.valor_total, 0)),
      desconto_total: 0,
      validade: null,
      condicao_pagamento: r.dados.condicao_pagamento ?? condicao,
      consultado_em: r.dados.consultado_em ?? null,
    },
  };
}

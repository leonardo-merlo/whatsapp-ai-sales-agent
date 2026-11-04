// Operação 4 do contrato: criar o orçamento.
//
// É a operação mais importante do fluxo, por um motivo que não é técnico: **a
// resposta dela é o que o cliente vai ler.** Os itens, os valores e o desconto
// que voltam daqui são copiados campo por campo pela mensagem que sai no
// WhatsApp (ver `../mensagem-do-orcamento.ts`). Por isso a validação abaixo é
// dura: resposta sem `itens` ou sem `valor_total` é tratada como recusa, e não
// como sucesso pela metade — um orçamento sem números faria a IA ter que
// escrever valor de memória, que é o que o desenho inteiro proíbe.
//
// É também a operação em que um pedido repetido custa caro: dois orçamentos no
// sistema da Distribuidora Exemplo para o mesmo cliente. Por isso ela nunca é chamada
// direto, e sim por dentro de `umaVezSo` (ver `../idempotencia.ts`).

import type { ItemPedido, Orcamento } from '../contrato';
import { chamarErp, type ConexaoComOErp, type ResultadoDoErp } from '../cliente-http';

export interface PedidoDeOrcamento {
  clienteId: string;
  vendedorId?: string | null;
  itens: ItemPedido[];
  observacao?: string | null;
}

export async function criarOrcamento(
  conexao: ConexaoComOErp,
  pedido: PedidoDeOrcamento,
  chaveDeIdempotencia: string,
): Promise<ResultadoDoErp<Orcamento>> {
  if (!pedido.clienteId) {
    return { ok: false, motivo: 'recusado', codigo: 'cliente_ausente', mensagem: 'Sem cliente não há orçamento.', campo: 'cliente_id' };
  }
  if (!pedido.itens?.length) {
    return { ok: false, motivo: 'recusado', codigo: 'itens_vazios', mensagem: 'Informe ao menos um item.', campo: 'itens' };
  }

  const r = await chamarErp<{ orcamento: Orcamento }>(conexao, {
    metodo: 'POST',
    operacao: 'criar_orcamento',
    chaveDeIdempotencia,
    corpo: {
      cliente_id: pedido.clienteId,
      vendedor_id: pedido.vendedorId ?? null,
      canal: 'whatsapp',
      observacao: pedido.observacao ?? 'Pedido feito pelo WhatsApp, atendido pelo assistente do vendedor.',
      itens: pedido.itens.map(i => ({ produto_codigo: i.produto_codigo, quantidade: i.quantidade })),
    },
  });

  if (!r.ok) return r;

  const orcamento = r.dados?.orcamento;
  if (!orcamento?.id || !Array.isArray(orcamento.itens) || typeof orcamento.valor_total !== 'number') {
    return {
      ok: false, motivo: 'recusado', codigo: 'orcamento_sem_valores',
      mensagem: 'O sistema criou o orçamento mas não devolveu itens e valores — sem eles não dá para mandar ao cliente.',
    };
  }
  return { ok: true, dados: orcamento };
}

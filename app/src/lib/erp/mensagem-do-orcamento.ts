// A mensagem com itens e valores, montada pelo CÓDIGO.
//
// **Esta é a proteção principal do Wappia Vendas, e vale a pena dizer por quê.**
// No desenho antigo a IA nunca falava preço: ela encerrava com "vou pedir o
// orçamento" e o vendedor retornava. No fluxo automático de 13/09 o preço chega
// ao cliente pela IA — e um modelo que escreve números de memória, mais cedo ou
// mais tarde, escreve o número errado. Então ele não escreve: cada valor aqui é
// copiado da resposta do sistema da Distribuidora Exemplo, campo por campo, por este
// arquivo. A IA escreve só a moldura ("segue seu orçamento", "qualquer dúvida
// me chama").
//
// É o mesmo princípio de `src/lib/agente/registrar-venda.ts`, que casa o nome
// do produto no código e calcula o valor pelo preço cadastrado — nunca pedindo
// dinheiro ao modelo.

import type { Cotacao, ItemComPreco, Orcamento } from './contrato';

export function reais(valor: number | null | undefined): string {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '—';
  return `R$ ${valor.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d)(?=,))/g, '.')}`;
}

function quantidade(item: ItemComPreco): string {
  const n = Number(item.quantidade);
  const texto = Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
  return item.unidade ? `${texto} ${item.unidade}` : texto;
}

function linhasDosItens(itens: ItemComPreco[]): string[] {
  return itens.map(item => {
    const partes = [`• ${quantidade(item)} — ${item.descricao}`, `  ${reais(item.valor_total)}`];
    if (item.desconto_percentual > 0) {
      partes[1] += ` (com ${String(item.desconto_percentual).replace('.', ',')}% de desconto)`;
    }
    return partes.join('\n');
  });
}

/** A mensagem do orçamento criado. Sem markdown: é WhatsApp. */
export function mensagemDoOrcamento(orcamento: Orcamento): string {
  const partes: string[] = [];
  partes.push(orcamento.numero ? `Orçamento ${orcamento.numero}` : 'Orçamento');
  partes.push(linhasDosItens(orcamento.itens).join('\n'));

  const rodape: string[] = [];
  if (orcamento.desconto_total > 0) rodape.push(`Desconto: ${reais(orcamento.desconto_total)}`);
  rodape.push(`Total: ${reais(orcamento.valor_total)}`);
  if (orcamento.validade) rodape.push(`Válido até ${diaBR(orcamento.validade)}`);
  partes.push(rodape.join('\n'));

  return partes.join('\n\n');
}

/** A mensagem da consulta de preço. Diz que ainda não é orçamento, porque é
 *  essa a diferença que o cliente precisa entender. */
export function mensagemDaCotacao(cotacao: Cotacao): string {
  const partes: string[] = ['Consulta de preço'];
  partes.push(linhasDosItens(cotacao.itens).join('\n'));

  const rodape: string[] = [];
  if (cotacao.desconto_total > 0) rodape.push(`Desconto: ${reais(cotacao.desconto_total)}`);
  rodape.push(`Total: ${reais(cotacao.valor_total)}`);
  partes.push(rodape.join('\n'));

  return partes.join('\n\n');
}

/** O resumo curto para o vendedor, no copiloto. */
export function resumoParaOVendedor(orcamento: Orcamento, nomeDoCliente: string): string {
  const itens = orcamento.itens.length;
  return `${nomeDoCliente} · ${itens} ite${itens === 1 ? 'm' : 'ns'} · ${reais(orcamento.valor_total)}`;
}

function diaBR(iso: string): string {
  const casa = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!casa) return iso;
  return `${casa[3]}/${casa[2]}/${casa[1]}`;
}

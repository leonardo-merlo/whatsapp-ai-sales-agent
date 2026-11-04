// Organizações em que o motor usa o cache de prompt da Anthropic.
//
// Decisão do Leonardo em 01/10, para baixar o custo da bancada e do WhatsApp
// da Distribuidora Exemplo: sem cache, cada chamada paga de novo a parte fixa do system
// (instrução, índice do catálogo, dicionário e regras), que é a maior parte da
// entrada. Medido em 01/10 sem cache: US$ 0,05 a 0,20 por mensagem.
//
// **O que a chave faz.** O system vai em dois blocos em vez de um texto só:
//
//   1. o que `buildSystemPrompt` devolve, com `cache_control` no fim — é a
//      parte que não muda entre um cliente e outro;
//   2. o resto (o que já sabemos do cliente, o cliente do ERP, o vendedor, as
//      boas-vindas, o lembrete e a seção de formato), sem marca.
//
// O texto é o mesmo, byte a byte; muda só onde ele é cortado. As ferramentas
// vêm antes do system no pedido, então entram no mesmo cache. Trocar o
// `tool_choice` entre as voltas do laço não derruba esse cache (documentação
// da Anthropic, "Invalidation hierarchy").
//
// **Limite do Haiku 4.5:** só cacheia a partir de 4.096 tokens. Abaixo disso a
// marca é ignorada sem erro, e o pedido custa o mesmo de antes. Quem confere se
// pegou é o `ai_usage` (`cache_creation_input_tokens` na primeira chamada,
// `cache_read_input_tokens` nas seguintes).
//
// Nenhuma outra organização muda: sem a chave o system continua sendo o texto
// único de sempre. **Para desligar, apague o id da lista.** Nada mais precisa
// mudar.

import type Anthropic from '@anthropic-ai/sdk';

export const ORGS_COM_CACHE_DE_PROMPT = new Set<string>([
  'e8e00000-0000-4000-8000-0000000000e1', // Distribuidora Exemplo
]);

export function usaCacheDePrompt(orgId: string): boolean {
  return ORGS_COM_CACHE_DE_PROMPT.has(orgId);
}

/**
 * O `system` do pedido. Sem a chave, o texto inteiro, como sempre. Com a chave,
 * a parte fixa num bloco marcado para o cache e o resto num bloco depois.
 *
 * Se o texto não começar pela parte fixa (algum caminho que a reescreveu), não
 * há corte seguro: vai o texto inteiro, sem cache.
 */
export function systemDoPedido(
  orgId: string,
  parteFixa: string,
  system: string,
): string | Anthropic.TextBlockParam[] {
  if (!usaCacheDePrompt(orgId) || !parteFixa || !system.startsWith(parteFixa)) return system;
  const resto = system.slice(parteFixa.length);
  const fixo: Anthropic.TextBlockParam = { type: 'text', text: parteFixa, cache_control: { type: 'ephemeral' } };
  return resto ? [fixo, { type: 'text', text: resto }] : [fixo];
}

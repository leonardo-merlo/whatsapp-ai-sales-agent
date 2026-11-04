// Tabela de preços da API da Anthropic, em dólares por MILHÃO de tokens.
//
// Consultado em 2026-07-31 na documentação oficial:
// https://platform.claude.com/docs/en/about-claude/pricing (seção "Model pricing").
// Se a Anthropic mudar o preço, atualize aqui E a data acima — o histórico já
// gravado em ai_usage.custo_usd não se recalcula (é de propósito: o gasto do
// mês passado tem que continuar sendo o do mês passado).
//
// Só o cache write de 5 minutos está na tabela porque é o único que o projeto
// usaria hoje: não há cache_control em lugar nenhum, então os dois campos de
// cache chegam sempre zerados. Se um dia ligar cache de 1 hora, o preço de
// escrita é outro (2x a entrada, não 1,25x).

export interface PrecoModelo {
  /** Tokens de entrada não cacheados. */
  input: number;
  /** Tokens gerados pelo modelo. */
  output: number;
  /** Gravação no cache de prompt, TTL de 5 minutos (1,25x a entrada). */
  cacheWrite: number;
  /** Leitura do cache de prompt (0,1x a entrada). */
  cacheRead: number;
}

/** Dólares por milhão de tokens, por modelo. */
export const PRECOS_POR_MILHAO: Record<string, PrecoModelo> = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
  // Consultado em 2026-10-21. Leitura de foto (T11). Vale para prompt de até
  // 100 mil tokens; acima disso a Anthropic cobra 0,50 / 2,50, e a foto não
  // chega perto.
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

export interface TokensUso {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Custo em dólares de uma chamada. Modelo desconhecido devolve 0 e avisa no
 * log — um preço errado inventado é pior que um zero visível, e derrubar a
 * resposta ao cliente por causa de contabilidade seria pior ainda.
 */
export function calcularCustoUsd(model: string, usage: TokensUso): number {
  const preco = PRECOS_POR_MILHAO[model];
  if (!preco) {
    console.warn(`Preço não cadastrado para o modelo "${model}"; custo gravado como 0.`);
    return 0;
  }
  const total =
    usage.input_tokens * preco.input +
    usage.output_tokens * preco.output +
    (usage.cache_creation_input_tokens ?? 0) * preco.cacheWrite +
    (usage.cache_read_input_tokens ?? 0) * preco.cacheRead;
  // 8 casas é a escala da coluna numeric(14,8); arredondar aqui evita que o
  // Postgres recuse o insert por excesso de dígitos.
  return Math.round((total / 1_000_000) * 1e8) / 1e8;
}

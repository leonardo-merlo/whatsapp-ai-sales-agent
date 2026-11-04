// A cidade de entrega está na lista que o ERP manda todo mês (`erp_regioes`)?
//
// Decisão do Leonardo em 07/10: por enquanto a região NÃO depende do produto.
// Uma regra só: a cidade está em alguma região ativa, atende; não está, não
// atende e a conversa não segue. A conferência por produto fica para depois,
// com a Distribuidora Exemplo.

/** "Jundiaí" e "JUNDIAI" são a mesma cidade: sem acento, maiúscula, espaços simples. */
export function normalizarCidade(cidade: string): string {
  return cidade.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface RegiaoDeEntrega {
  regiao_id: string;
  cidades: { cidade: string; uf: string }[];
}

/**
 * As regiões que entregam nesta cidade (a mesma cidade pode estar em mais de
 * uma). Vazio quando não atende. Com UF, ela também precisa bater: há cidades
 * com o mesmo nome em estados diferentes (Alegre, ES e RJ).
 */
export function regioesDaCidade(regioes: RegiaoDeEntrega[], cidade: string, uf: string | null): string[] {
  const alvo = normalizarCidade(cidade);
  const ufAlvo = uf ? normalizarCidade(uf) : null;
  return regioes
    .filter(r => r.cidades.some(c => normalizarCidade(c.cidade) === alvo && (!ufAlvo || normalizarCidade(c.uf) === ufAlvo)))
    .map(r => r.regiao_id);
}

function distancia(a: string, b: string): number {
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Cidades da lista com nome parecido (até 2 letras de diferença), as mais
 * parecidas primeiro, no máximo 2. É para o erro de digitação: "Jundiaé" →
 * Jundiaí e Juniaí. Nome curto demais não ganha sugestão.
 */
export function cidadesParecidas(regioes: RegiaoDeEntrega[], cidade: string, maximo = 2): string[] {
  const alvo = normalizarCidade(cidade);
  if (alvo.length < 4) return [];
  const vistas = new Map<string, number>();
  for (const r of regioes) {
    for (const c of r.cidades) {
      const nome = normalizarCidade(c.cidade);
      if (vistas.has(nome)) continue;
      const d = distancia(alvo, nome);
      if (d > 0 && d <= 2) vistas.set(nome, d);
    }
  }
  return [...vistas.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).slice(0, maximo).map(([nome]) => nome);
}

const NOMES_DOS_ESTADOS: Record<string, string> = {
  MG: 'Minas Gerais', RJ: 'Rio de Janeiro', ES: 'Espírito Santo', SP: 'São Paulo', BA: 'Bahia', GO: 'Goiás',
};

/** Os estados atendidos, por extenso, para a frase de cidade não atendida. */
export function estadosAtendidos(regioes: RegiaoDeEntrega[]): string[] {
  const contagem = new Map<string, number>();
  for (const r of regioes) for (const c of r.cidades) contagem.set(c.uf, (contagem.get(c.uf) ?? 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1]).map(([uf]) => NOMES_DOS_ESTADOS[uf] ?? uf);
}

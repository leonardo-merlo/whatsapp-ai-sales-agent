// Regras de forma e rótulos de template, sem nada de servidor: a tela usa
// para validar antes de mandar, a rota usa para validar de novo, e as duas
// dizem a mesma coisa.

export interface VariavelDoTemplate {
  nome: string;
  exemplo: string;
}

export type CategoriaDoTemplate = 'UTILITY' | 'MARKETING';

export interface NovoTemplate {
  nome: string;
  categoria: CategoriaDoTemplate;
  corpo: string;
  variaveis: VariavelDoTemplate[];
  idioma?: string;
}

// ── Regras de forma, conferidas antes de gastar a chamada ──

/** "Promoção de Outubro!" → "promocao_de_outubro". A Meta só aceita
 *  minúsculas, números e underscore. */
export function slugDoNome(nomeAmigavel: string): string {
  return nomeAmigavel
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/** O texto como o cliente vai ler, para a conversa e a pré-visualização. A
 *  Meta monta o dela a partir do nome; este é o nosso espelho. */
export function preencherCorpo(corpo: string, valores: string[]): string {
  return corpo.replace(/\{\{\s*(\d+)\s*\}\}/g, (original, n: string) => valores[Number(n) - 1] || original);
}

/** Quantas variáveis o corpo usa. `null` quando a numeração não é 1, 2, 3...
 *  sem buraco — a Meta recusa {{1}} {{3}}. */
export function contarVariaveis(corpo: string): number | null {
  const numeros = [...new Set([...corpo.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
  return numeros.every((n, i) => n === i + 1) ? numeros.length : null;
}

/** O que está errado no template, em texto para o dono da conta, ou `null`. */
export function problemaNoTemplate(t: NovoTemplate): string | null {
  if (!t.nome) return 'Dê um nome ao template.';
  if (!t.corpo.trim()) return 'Escreva o texto da mensagem.';
  if (t.corpo.length > 1024) return 'O texto passa de 1024 caracteres.';
  const quantas = contarVariaveis(t.corpo);
  if (quantas === null) return 'Numere as variáveis em sequência: {{1}}, {{2}}, {{3}}.';
  if (quantas !== t.variaveis.length) return 'Cada variável precisa de um exemplo.';
  if (t.variaveis.some(v => !v.exemplo.trim())) return 'Cada variável precisa de um exemplo.';
  // A Meta recusa corpo que começa ou termina em variável.
  if (/^\s*\{\{/.test(t.corpo) || /\}\}\s*[.!?]?\s*$/.test(t.corpo)) {
    return 'O texto não pode começar nem terminar com uma variável.';
  }
  return null;
}

const NOME_DA_CATEGORIA: Record<string, string> = {
  UTILITY: 'Utilidade', MARKETING: 'Marketing', AUTHENTICATION: 'Autenticação',
};

export function nomeDaCategoria(categoria: string): string {
  return NOME_DA_CATEGORIA[categoria] ?? categoria;
}

export function rotuloDoStatus(status: string): string {
  switch (status) {
    case 'APPROVED': return 'Aprovado';
    // Nosso, não da Meta: guardado aqui e nunca mandado para aprovação.
    case 'RASCUNHO': return 'Rascunho';
    case 'PENDING': case 'IN_APPEAL': return 'Em análise';
    case 'REJECTED': return 'Rejeitado';
    case 'PAUSED': return 'Pausado';
    case 'DISABLED': return 'Desativado';
    default: return status;
  }
}


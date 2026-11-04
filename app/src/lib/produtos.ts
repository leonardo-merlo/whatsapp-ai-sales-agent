// Os dois produtos da Wappia: um sistema, duas caras (S14, 29/09).
//
// A empresa tem uma lista de produtos contratados (`organizations.produtos`),
// marcada pela Wappia. Qual deles está na tela mora num cookie, no mesmo padrão
// do `wappia_org`: o cookie **escolhe, não autoriza**. Um valor que a empresa
// não contratou cai no primeiro contratado.
//
// O produto decide o menu, a cor e os modelos de template. Quem decide o
// comportamento do motor continua sendo o roteiro de cada número.
//
// Módulo puro, sem `next/headers`: roda no client, no servidor e nos testes.

export type Produto = 'atendimento' | 'vendas';

export const PRODUTOS: Produto[] = ['atendimento', 'vendas'];

export const COOKIE_PRODUTO_ATIVO = 'wappia_produto';

export const NOME_DO_PRODUTO: Record<Produto, string> = {
  atendimento: 'Atendimento',
  vendas: 'Vendas',
};

/** WhatsApp da Wappia para quem quer ativar o outro produto. Confirmar com o
 *  Leonardo qual número atende esse contato (hoje é o 92579-1156). */
export const WHATSAPP_DA_WAPPIA = 'https://wa.me/5511925791156';

export function ehProduto(valor: unknown): valor is Produto {
  return valor === 'atendimento' || valor === 'vendas';
}

/** Lista do banco (text[]) filtrada para o que existe, na ordem de PRODUTOS. */
export function produtosValidos(lista: readonly string[] | null | undefined): Produto[] {
  const validos = PRODUTOS.filter(p => (lista ?? []).includes(p));
  return validos.length ? validos : ['atendimento'];
}

/**
 * O produto na tela: o do cookie quando a empresa o contratou, senão o
 * primeiro contratado.
 */
export function escolherProduto(contratados: readonly Produto[], escolhido: string | null | undefined): Produto {
  if (ehProduto(escolhido) && contratados.includes(escolhido)) return escolhido;
  return contratados[0] ?? 'atendimento';
}

/**
 * Seções do menu que só existem num produto, pelo pedaço da rota.
 * Agenda é de quem marca horário; Desenvolvimento é a integração com o sistema
 * de gestão, que só o Vendas tem.
 */
const SECOES_DO_PRODUTO: Record<string, Produto> = {
  agenda: 'atendimento',
  desenvolvimento: 'vendas',
};

/** Seções que o produto ativo esconde, somadas às que a empresa já esconde. */
export function secoesOcultasDoProduto(produto: Produto, ocultasDaOrg: readonly string[] = []): string[] {
  const doProduto = Object.entries(SECOES_DO_PRODUTO)
    .filter(([, dono]) => dono !== produto)
    .map(([secao]) => secao);
  return [...new Set([...ocultasDaOrg, ...doProduto])];
}

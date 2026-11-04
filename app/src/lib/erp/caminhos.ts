// Onde, dentro do sistema do cliente, mora cada uma das quatro operações.
//
// **Por que isto virou configuração.** Duas das quatro vieram do documento da
// Distribuidora Exemplo de 17/09 (`/clientes/consulta` e `/clientes/novo`); as outras
// duas (`/cotacoes` e `/orcamentos`) fomos nós que inventamos, e no contrato v3
// elas estão marcadas "A DEFINIR". No dia em que a Distribuidora Exemplo disser os nomes de
// verdade, trocar um caminho não pode exigir deploy — e o segundo cliente de
// Vendas terá outros quatro, sem nenhum deploy também.
//
// **⚠️ Caminho configurável sem FORMATO configurável é flexibilidade pela
// metade, e a tela precisa dizer isso.** O corpo de cada operação — quais campos
// vão, com que nome, aninhados como — continua escrito em `operacoes/*.ts`. Se o
// sistema do outro lado esperar um corpo diferente, mudar o endereço não
// resolve: é código. O aviso está na tela de Configuração, e está aqui para
// quem chegar pelo código.
//
// **Config vazia = exatamente o comportamento de hoje.** Nenhuma organização
// muda de comportamento por causa deste arquivo; quem não configurou nada
// continua batendo nos quatro caminhos abaixo.

/** As quatro operações do contrato, pela chave com que são conhecidas no resto
 *  do código (a mesma de `ROTULO_DA_OPERACAO`, em `registro-de-chamadas.ts`). */
export type OperacaoDoErp = 'consultar_cliente' | 'criar_cliente' | 'cotar' | 'criar_orcamento';

export type CaminhosDoErp = Record<OperacaoDoErp, string>;

/** O que valia antes de isto ser configurável, e o que vale para quem não
 *  configurar. Mudar um valor daqui muda o padrão de TODO mundo — o que se
 *  quer mudar por cliente é a config, não isto. */
export const CAMINHOS_PADRAO: CaminhosDoErp = {
  consultar_cliente: '/clientes/consulta',
  criar_cliente: '/clientes/novo',
  cotar: '/cotacoes',
  criar_orcamento: '/orcamentos',
};

export const OPERACOES: OperacaoDoErp[] = [
  'consultar_cliente', 'criar_cliente', 'cotar', 'criar_orcamento',
];

/**
 * Um caminho serve?
 *
 * Tem que começar com `/` e não pode carregar host: sem isso, `https://base` +
 * `http://outro.com/x` mandaria a chave de API do cliente para um servidor que
 * não é o dele. A validação vive aqui, e não só na rota, porque quem grava não
 * é necessariamente quem lê — uma linha escrita à mão no banco passaria por
 * cima da rota.
 */
export function caminhoValido(caminho: string): boolean {
  const limpo = caminho.trim();
  if (!limpo.startsWith('/')) return false;
  if (limpo.startsWith('//')) return false;
  if (/\s/.test(limpo)) return false;
  if (limpo.includes('://')) return false;
  return true;
}

/**
 * Os caminhos desta organização: o que ela configurou, e o padrão no que ela
 * não configurou.
 *
 * Valor em branco ou inválido cai no padrão de propósito — um caminho quebrado
 * gravado no banco derrubaria as quatro operações da empresa inteira, e cair no
 * padrão é o que o sistema fazia antes de a configuração existir.
 */
export function caminhosDaIntegracao(config: unknown): CaminhosDoErp {
  const guardados = (config as { caminhos?: Record<string, unknown> } | null)?.caminhos;
  const caminhos = { ...CAMINHOS_PADRAO };
  if (!guardados || typeof guardados !== 'object') return caminhos;

  for (const operacao of OPERACOES) {
    const valor = guardados[operacao];
    if (typeof valor !== 'string') continue;
    const limpo = valor.trim();
    if (limpo && caminhoValido(limpo)) caminhos[operacao] = limpo;
  }
  return caminhos;
}

/** Os dois syncs do contrato v4. Ficam fora de `OperacaoDoErp` de propósito:
 *  não têm caminho padrão (o endereço ainda não foi definido pela Distribuidora Exemplo) e
 *  não aparecem na tela das quatro operações. */
export type OperacaoDeSync = 'sync_produtos' | 'sync_regioes';
export type TipoDeSync = 'produtos' | 'regioes';

/**
 * O caminho de um sync nesta organização, ou `null` quando não foi
 * configurado. **Sem padrão:** sem caminho, o sync não roda — chutar um
 * endereço no sistema do cliente não é opção. Mora em
 * `organization_integrations.config.syncs`, com a mesma validação dos outros.
 */
export function caminhoDoSync(config: unknown, tipo: TipoDeSync): string | null {
  const valor = (config as { syncs?: Record<string, unknown> } | null)?.syncs?.[tipo];
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  return limpo && caminhoValido(limpo) ? limpo : null;
}

/** Só o que foge do padrão, que é o que vale a pena guardar no banco: config
 *  vazia continua querendo dizer "como sempre foi". */
export function caminhosParaGravar(entrada: Partial<Record<OperacaoDoErp, string>>): Record<string, string> {
  const guardar: Record<string, string> = {};
  for (const operacao of OPERACOES) {
    const limpo = (entrada[operacao] ?? '').trim();
    if (limpo && limpo !== CAMINHOS_PADRAO[operacao]) guardar[operacao] = limpo;
  }
  return guardar;
}

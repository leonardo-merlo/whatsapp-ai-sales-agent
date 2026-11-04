// Quais ferramentas cada roteiro recebe.
//
// **O roteiro de atendimento recebe zero ferramentas, e isso não é provisório.**
// Com a lista vazia o motor nem manda o campo `tools`, então a requisição sai
// byte a byte igual à de antes do laço — é o que garante que nenhum cliente do
// Wappia Atendimento muda de comportamento por causa do Wappia Vendas.
//
// O copiloto também fica com zero: ele só recebe aviso, ninguém conversa com a
// IA por lá.
//
// A lista depende só do roteiro, e não de quem está conversando: o que cada
// ferramenta precisa saber (organização, conversa, contato, número, vendedor)
// chega no `ContextoDaFerramenta` na hora de executar, não na hora de montar a
// lista. Assim o caminho do atendimento não ganhou nem uma consulta a mais.
//
// **A ordem importa: o modelo lê a lista de cima para baixo e ela funciona como
// um roteiro implícito.** É por isso que ela é, hoje, a peça mais forte do
// fluxo — mais forte que a instrução escrita no painel, como 20/09 mostrou
// várias vezes.
//
// ⚠️ **E é por isso que ela estava errada até 21/09.** A ordem anterior era
// "primeiro achar o produto, depois identificar o cliente", e o comentário aqui
// afirmava que essa era a ordem do fluxo comercial. **Não era.** O fluxo
// acordado com a Distribuidora Exemplo é o contrário, e o Leonardo apontou isso olhando o
// fluxograma dele:
//
//     cadastro → cidade/região de entrega → produto → pagamento → orçamento
//
// A consequência apareceu no teste real de 20/09: com `buscar_produtos` no topo
// da lista, a IA saía caçando chapa de metalon antes de confirmar o cadastro e
// a região — e ofereceu duas bitolas que não existem no catálogo.
//
// **Onde isto dói de verdade:** este arquivo é um fluxograma que só existe no
// código. Ninguém fora dele consegue ver esta ordem, conferir contra o fluxo
// comercial e perceber a divergência. O spec da tela de Fluxo
// (`docs/superpowers/specs/2026-09-20-fluxo-do-agente-design.md`) existe
// justamente para acabar com isso, e esta linha é o argumento mais forte a
// favor dele.
//
// A região de entrega NÃO aparece aqui porque não é ferramenta — é passo de
// conversa, e por enquanto mora só na instrução.

import type { FerramentaDoAgente } from './tipos';
import { buscarProdutosDoCatalogo } from './buscar-produtos';
import { cadastrarClienteNoSistema, consultarClienteNoSistema } from './erp-cliente';
import { consultarPrecoNoSistema, criarOrcamentoNoSistema } from './erp-orcamento';
import { confirmarItensComOCliente } from './confirmar-itens';
import { levantarItensNaV2 } from '../../v2/integracao-v1';

export type { ContextoDaFerramenta, FerramentaDoAgente, VendedorDoNumero } from './tipos';

export interface ComoEstaOCatalogo {
  /**
   * O prompt levou só o ÍNDICE dos produtos (porque são muitos), em vez da
   * lista inteira.
   *
   * **É o único motivo pelo qual um número de ATENDIMENTO ganha ferramenta**, e
   * a regra vale desde 14/09: quem decide como o produto chega ao modelo é o
   * tamanho da lista, não o roteiro. Uma clínica com 400 procedimentos tem o
   * mesmo problema da Distribuidora Exemplo, e sem a ferramenta ela ficaria com um índice
   * que não dá para abrir.
   *
   * Quem está no ar hoje tem menos de 40 itens, então este campo é `false` e a
   * lista continua vazia: a requisição sai sem o campo `tools`, byte a byte
   * igual à de antes.
   */
  produtosPorIndice: boolean;
  /** O fiscal está ligado para a organização (`fiscal.ts`): entra
   *  `confirmar_itens` entre achar os produtos e consultar o preço. Desligado,
   *  a lista fica idêntica à de antes. */
  fiscal?: boolean;
  /** PIPELINE_VERSION=v2: a v2 levanta os itens (`levantar_itens` no lugar de `confirmar_itens`). */
  pipelineV2?: boolean;
}

export function ferramentasDoRoteiro(roteiro: string, catalogo?: ComoEstaOCatalogo): FerramentaDoAgente[] {
  if (roteiro === 'copiloto') return [];

  if (roteiro !== 'vendas') {
    // Atendimento com catálogo grande: a ferramenta de busca, e só ela. Nada de
    // ERP — cadastro, cotação e orçamento são do fluxo comercial.
    return catalogo?.produtosPorIndice ? [buscarProdutosDoCatalogo] : [];
  }

  return [
    consultarClienteNoSistema,
    cadastrarClienteNoSistema,
    buscarProdutosDoCatalogo,
    ...(catalogo?.pipelineV2 ? [levantarItensNaV2] : catalogo?.fiscal ? [confirmarItensComOCliente] : []),
    consultarPrecoNoSistema,
    criarOrcamentoNoSistema,
  ];
}

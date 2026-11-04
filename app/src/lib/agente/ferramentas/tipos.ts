// O contrato de uma ferramenta do agente.
//
// Uma ferramenta é a única forma de a IA sair do próprio texto e olhar o mundo
// (o catálogo da empresa, o sistema do cliente). O desenho aqui tem uma regra
// que vale para todas: **executar nunca lança**. Uma ferramenta que estoura
// derrubaria a conversa inteira; devolvendo o erro como texto, o modelo lê o
// que aconteceu e decide o que dizer ao cliente — que é exatamente o que um
// atendente faria.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import type { Rastreio } from '../rastreio/rastreio';

type Client = SupabaseClient<Database>;

/** Quem é o dono do número por onde o cliente escreveu. No Wappia Vendas é
 *  isso que o sistema do cliente recebe como `vendedor_id`. */
export interface VendedorDoNumero {
  memberId: string;
  nome: string;
  /** Código dele no sistema do cliente. Vazio significa que ninguém preencheu
   *  na tela do Agente — e aí o orçamento nasce sem vendedor. */
  codigoErp: string;
  telefoneWhatsapp: string;
}

/** O que a ferramenta sabe sobre onde está sendo usada. */
export interface ContextoDaFerramenta {
  supabase: Client;
  orgId: string;
  conversationId: string;
  contactId: string | null;
  /** Número por onde a conversa entrou — no Vendas, é ele que diz de qual
   *  vendedor é o atendimento. */
  waNumberId: string | null;
  /**
   * O roteiro deste número.
   *
   * A ferramenta do catálogo precisa dele por um motivo concreto: no roteiro de
   * VENDAS, o universo cotável é o do sistema do cliente, e lá só existe o que
   * tem código. Os produtos DIGITADOS na aba Empresa não têm código nenhum —
   * oferecê-los ao modelo num número de vendas é convidá-lo a pedir cotação de
   * uma coisa que o ERP não conhece, e foi assim que uma conversa de teste
   * terminou com PREGO 22 X 48 no lugar do 17 X 21.
   */
  roteiro?: string;
  /** A lista DIGITADA da aba Empresa conta nesta conversa? Vem de
   *  `buildSystemPrompt`, para a ferramenta enxergar a mesma lista que o
   *  prompt anunciou ao modelo. */
  usaListaDigitada?: boolean;
  /** Nome do contato, para o cadastro no sistema do cliente. */
  contatoNome?: string;
  /** Telefone do contato no formato da Cloud API. */
  contatoTelefone?: string | null;
  vendedor?: VendedorDoNumero | null;
  /**
   * O cliente que esta conversa já identificou no sistema do cliente (ERP).
   *
   * Vive em `conversations.erp_cliente_id` e é recarregado a cada resposta,
   * porque o que a ferramenta descobre morre no fim do laço. Sem isto, o
   * `cliente_id` achado na primeira mensagem não existe mais quando o cliente
   * confirma o pedido três mensagens depois — que foi o que derrubou o
   * primeiro teste real do fluxo (14/09).
   */
  erpClienteId?: string | null;
  erpClienteNome?: string | null;
  /**
   * O cliente foi identificado **nesta mesma resposta**?
   *
   * É o que separa "já sabíamos quem era" de "acabamos de descobrir". Quando a
   * identificação aconteceu agora, o cliente final **não falou nada desde
   * então** — logo ele não confirmou produto nem quantidade, e cotar preço aqui
   * é cotar o que ninguém confirmou. Ver a trava em `erp-orcamento.ts`.
   */
  clienteIdentificadoAgora?: boolean;
  /**
   * O cliente citou nesta mensagem um CPF/CNPJ **diferente** do que estava em
   * uso.
   *
   * Existe porque anular `erpClienteId` não bastou. Em 20/09 o cliente trocou
   * de CNPJ e o modelo chamou `consultar_preco` mandando na mão o
   * `cliente_id` do cadastro ANTERIOR — que ele ainda tinha em mãos, vindo do
   * resultado de uma ferramenta anterior. Como `clienteIdDaChamada` prefere o
   * id do modelo ao do contexto, esvaziar o contexto não impediu nada: a
   * cotação saiu para o cliente errado (janelas 17:35:48 e 17:36:23 em
   * `erp_chamadas`).
   *
   * Com esta marca, enquanto a consulta nova não responder, **só vale o que o
   * sistema redescobriu** — o id do modelo é ignorado.
   */
  documentoTrocado?: boolean;
  /** Id da mensagem do cliente que está sendo respondida. É metade da
   *  assinatura de idempotência: mesma mensagem reprocessada = mesmo pedido. */
  mensagemId?: string | null;
  /**
   * Mensagens escritas pelo CÓDIGO para sair ao cliente **depois** da resposta
   * do modelo, exatamente como estão aqui.
   *
   * É por este canal que os valores de um orçamento chegam ao cliente sem
   * passar pelo modelo. A ferramenta empurra o texto; quem envia é
   * `responder-conversa.ts`. O modelo fica sabendo que isso vai acontecer (o
   * resultado da ferramenta diz), e escreve só a moldura.
   */
  mensagensDoSistema?: string[];
  /** A ficha desta execução do motor (`agente_turnos`). As chamadas ao ERP
   *  apontam para ela; nenhuma ferramenta decide nada por causa dela. */
  rastreio?: Rastreio;
  /** O que o cliente escreveu desde a última lista ou orçamento enviado, de onde
   *  `confirmar_itens` conta as linhas que parecem item (o fiscal). */
  falasDoPedido?: string;
  /** Estado do fiscal nesta resposta: o aviso de item esquecido sai uma vez só. */
  fiscal?: { avisouEsquecidos: boolean };
}

export interface FerramentaDoAgente {
  /** O que vai no campo `tools` da requisição, no formato da Anthropic. */
  definicao: {
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
      additionalProperties: false;
    };
  };
  /** Roda a ferramenta e devolve o que o modelo vai ler. Texto, não objeto:
   *  é assim que a resposta chega ao modelo, e ver o texto exato no teste é o
   *  que prova o que ele leu. */
  executar(entrada: Record<string, unknown>, ctx: ContextoDaFerramenta): Promise<string>;
}

// A máquina de estados do orçamento, VALENDO (fases 2 e 3 do spec
// `docs/superpowers/specs/2026-09-21-maquina-de-estados-orcamento-design.md`),
// só até a lista de produtos confirmada.
//
// **Quem muda a etapa é o código.** A IA lê a mensagem e devolve o que ela
// diz (`Leitura`); o código decide a etapa, chama o ERP e escolhe o texto. Os
// textos das etapas são fixos (`textos.ts`): a IA só escreve quando o cliente
// muda de assunto.
//
// Este arquivo é só forma e as regras de "o mínimo que cada etapa exige" (R1).

import type { FormaDePagamentoDoErp } from '../../erp/contrato';
import type { ItemDoSnapshot } from '../../v2/armazem';

export type EtapaDaMaquina =
  | 'aguardando_documento'
  | 'consultando_cadastro'
  | 'coletando_cadastro'
  | 'criando_cadastro'
  | 'confirmando_regiao'
  | 'levantando_itens'
  | 'definindo_pagamento'
  // Nesta rodada o orçamento para aqui, com a forma de pagamento escolhida
  // (motivo `pagamento_escolhido`) ou, sem formas do ERP, só com a lista
  // (`lista_confirmada`): o vendedor manda o orçamento com os preços.
  | 'aguardando_vendedor'
  | 'encerrado'
  | 'expirado';

export const ETAPAS_FINAIS: readonly EtapaDaMaquina[] = ['encerrado', 'expirado'];

/** O superestado "coletando" (R3): onde vale X1, o cliente citar outro documento. */
export const ETAPAS_DE_COLETA: readonly EtapaDaMaquina[] = [
  'consultando_cadastro', 'coletando_cadastro', 'criando_cadastro', 'confirmando_regiao', 'levantando_itens', 'definindo_pagamento',
];

/** O que a IA perguntou por último e espera. */
export type PerguntaPendente =
  | 'documento' | 'mesmo_cadastro' | 'dados_do_cadastro' | 'confirmar_cliente' | 'cidade' | 'produtos'
  | 'pagamento' | 'parcelas' | 'bandeira' | 'opcao_de_pagamento';

export const CAMPOS_DO_CADASTRO = ['nome', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'inscricao_estadual'] as const;
export type CampoDoCadastro = typeof CAMPOS_DO_CADASTRO[number];
/** Sem estes o ERP recusa o cadastro. Bairro e inscrição estadual são opcionais. */
export const CAMPOS_OBRIGATORIOS: readonly CampoDoCadastro[] = ['nome', 'logradouro', 'numero', 'cidade', 'uf', 'cep'];
export type CamposDoCadastro = Partial<Record<CampoDoCadastro, string>>;

export interface ClienteDoOrcamento {
  id: string;
  nome: string;
  cidade: string | null;
  uf: string | null;
  situacao: string | null;
  pode_faturar: boolean | null;
  /** O cliente disse que é ele mesmo, depois de ver o nome (G-fala). */
  confirmado: boolean;
  /** Ausente: o ERP ainda não mandou (cadastro novo, ficha de antes de 14/10). */
  formas_pagamento?: FormaDePagamentoDoErp[];
  /** Só o ERP preenche este bloco. */
  origem: 'erp';
}

/** O cliente do orçamento anterior da mesma conversa, no mesmo dia (T20). */
export interface CadastroAnterior {
  documento: string;
  cliente: ClienteDoOrcamento;
  /** A entrega do orçamento de hoje: a pergunta é "mesmo cadastro e mesma entrega?" (E4, 23/10). */
  entrega?: { cidade: string; uf: string | null };
}

export interface DadosDoOrcamento {
  documento?: { valor: string; origem: 'cliente' };
  /** Oferecido na pergunta "é para o mesmo cadastro?"; vira `documento` e `cliente` no "sim". */
  cadastro_anterior?: CadastroAnterior;
  /** A cidade veio do orçamento anterior (o "sim" ao "mesma entrega?"): a frase seguinte diz qual é. */
  entrega_repetida?: true;
  cliente?: ClienteDoOrcamento;
  cadastro_novo?: { campos: CamposDoCadastro; faltando: CampoDoCadastro[] };
  entrega?: { cidade: string; uf: string | null; regioes: string[]; origem: 'cliente' };
  /** A última cidade de entrega que não atendemos, para o texto dizer qual foi. */
  cidade_recusada?: string;
  /** Cidades da lista com nome parecido com a recusada ("Jundiaé" → Jundiaí, Juniaí). */
  cidades_parecidas?: string[];
  /** Cidade que o cliente citou antes da hora (junto com o CNPJ, por exemplo). */
  cidade_citada?: { cidade: string; uf: string | null };
  /** O texto dos produtos que o cliente mandou antes da hora. Guardado, sem
   *  pular etapa: vai para a v2 quando o orçamento chegar aos itens. */
  produtos_guardados?: string;
  /** O pedido da v2 deste orçamento (os itens sendo levantados). */
  v2_pedido_id?: string;
  /** A lista que o cliente confirmou. */
  itens?: ItemDoSnapshot[];
  /** O que o cliente já disse da forma de pagamento, quando falta parcela ou bandeira. */
  pagamento_parcial?: PagamentoParcial;
  /** A condição escolhida. Com ela o código consulta o preço e confere os limites. */
  pagamento?: {
    codigo: string; descricao: string; rotulo: string;
    valor_minimo: number | null; valor_maximo: number | null; origem: 'cliente';
  };
  /** Condições que o total desta lista não cabe: saem do menu até a lista mudar. */
  pagamentos_recusados?: string[];
  /**
   * O total da lista no ERP, guardado na primeira recusa pelo limite: as formas
   * cujo mínimo ou máximo não comporta esse valor saem do menu até a lista mudar.
   */
  total_referencia?: number;
  /** A última condição recusada pelo limite, para o texto dizer qual foi. */
  pagamento_fora?: { rotulo: string; tipo: 'minimo' | 'maximo'; limite: number };
  /** O preço do ERP com a condição escolhida (`precos`). Não vai ao cliente ainda. */
  cotacao?: CotacaoDoOrcamento;
  /** A consulta de preço não deu: o orçamento segue para o vendedor conferir. */
  cotacao_falhou?: { codigo: string; mensagem: string };
  /** Válvula de escape (22/10): quantas mensagens seguidas não fizeram andar esta pergunta ("etapa:pergunta"). */
  sem_entender?: { pergunta: string; vezes: number; em?: string };
  /** O cliente pediu para cancelar ou recomeçar, e a confirmação está pendente (válvula de escape, 22/10). */
  cancelamento?: 'cancelar' | 'recomecar';
  /**
   * O orçamento ficou parado mais de um dia e o cliente voltou (25/10: a lista de segunda somou à de quinta). A mensagem
   * que chegou espera a resposta de "continuo ou faço um novo?"; `recomecar_com` é a mesma mensagem, levada ao orçamento novo.
   */
  retomada?: { texto: string; leitura: Leitura };
  recomecar_com?: { texto: string; leitura: Leitura };
  /**
   * Vários orçamentos (27/10, chave VARIOS_ORCAMENTOS): o orçamento saiu de foco e ficou aberto. Guarda onde ele estava
   * para voltar igual. Na tabela ele fica `encerrado` com motivo `em_espera`, porque só um pode estar ativo por conversa.
   */
  em_espera?: { etapa: EtapaDaMaquina; pergunta: PerguntaPendente | null; motivo: string | null };
  /** A IA perguntou "qual orçamento?" e guardou a mensagem que fez perguntar, para aplicar no escolhido. */
  escolha_pendente?: { acao: 'ver' | 'fechar' | 'mudar_lista'; texto: string; leitura: Leitura };
  /** O cliente escolheu este orçamento (pelo número ou respondendo "qual?"): mexer na lista não pergunta de novo. */
  foco_escolhido?: true;
}

export interface ItemCotadoDoOrcamento {
  codigo: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  estoque_disponivel: boolean | null;
  empresa: string | null;
}

export interface CotacaoDoOrcamento {
  condicao: string;
  valor_total: number;
  consultado_em: string | null;
  itens: ItemCotadoDoOrcamento[];
}

/** Os tipos de pagamento como o cliente fala. Os cartões se resolvem por parcela e bandeira. */
export type GrupoDePagamento = 'pix' | 'boleto' | 'credito' | 'debito' | 'bndes' | 'outra';

export interface PagamentoParcial {
  grupo: GrupoDePagamento;
  parcelas?: number;
  bandeira?: string;
}

export interface EstadoDoOrcamento {
  etapa: EtapaDaMaquina;
  pergunta: PerguntaPendente | null;
  dados: DadosDoOrcamento;
  /** A mensagem do cliente que fez entrar nesta etapa. Uma confirmação só vale
   *  numa mensagem DIFERENTE desta (G-fala). */
  desdeMensagem: string | null;
  motivoPausa?: string | null;
}

/** O que a IA entendeu da mensagem, já conferido pelo código. */
export interface Leitura {
  intencao: 'pedir_orcamento' | 'responde' | 'confirma' | 'nega' | 'produtos' | 'outro_assunto' | 'cancelar' | 'recomecar';
  campos: CamposDoCadastro;
  cidade: { cidade: string; uf: string | null } | null;
  /** A mensagem traz produtos (para guardar quando ainda não é a hora deles). */
  produtosCitados: boolean;
  /** Só o trecho dos produtos, como o cliente escreveu (sem o CNPJ e a cidade). */
  produtosTexto: string | null;
}

export const LEITURA_VAZIA: Leitura = { intencao: 'responde', campos: {}, cidade: null, produtosCitados: false, produtosTexto: null };

/**
 * R1: o mínimo que cada etapa exige em `dados`. A gravação confere isso e é
 * recusada se não valer, em vez de a IA seguir "sem cadastro" em silêncio.
 * Devolve o motivo da recusa, ou null.
 */
export function faltaParaAEtapa(estado: EstadoDoOrcamento): string | null {
  const d = estado.dados;
  const temDocumento = !!d.documento?.valor;
  const temCliente = !!d.cliente?.id && d.cliente.origem === 'erp';
  switch (estado.etapa) {
    case 'aguardando_documento':
    case 'encerrado':
    case 'expirado':
      return null;
    case 'consultando_cadastro':
    case 'coletando_cadastro':
    case 'criando_cadastro':
      return temDocumento ? null : 'sem documento';
    case 'confirmando_regiao':
      return temCliente ? null : 'sem cliente do ERP';
    case 'levantando_itens':
      if (!temCliente) return 'sem cliente do ERP';
      if (!d.cliente!.confirmado) return 'cliente não confirmado';
      return d.entrega?.cidade ? null : 'sem cidade de entrega';
    case 'definindo_pagamento':
      return d.itens?.length ? null : 'pagamento sem itens';
    case 'aguardando_vendedor':
      if (estado.motivoPausa === 'lista_confirmada' && !d.itens?.length) return 'lista confirmada sem itens';
      if (estado.motivoPausa === 'pagamento_escolhido' && (!d.itens?.length || !d.pagamento)) return 'pagamento escolhido sem itens ou sem condição';
      return null;
  }
}

// Os tipos do contrato da integração com o sistema do cliente (na Distribuidora Exemplo, o
// ERP deles). O documento que descreve tudo isto em português, e que é o que o
// Leonardo manda ao desenvolvedor deles, é o artefato "Integração Agente de IA
// × Distribuidora Exemplo v3".
//
// Este arquivo é só forma, sem nenhuma chamada HTTP: é o vocabulário que o
// simulador e o cliente de verdade têm que falar igual. Se um dia o contrato
// mudar, é aqui que o TypeScript aponta todos os lugares afetados.

/** Endereço completo. A Distribuidora Exemplo exige logradouro, número, cidade, UF e CEP
 *  para abrir cadastro — cidade e UF sozinhas não passam. */
export interface EnderecoDoErp {
  logradouro: string;
  numero: string;
  complemento?: string | null;
  bairro?: string | null;
  cidade: string;
  uf: string;
  cep: string;
}

export interface ClienteDoErp {
  /** Na Distribuidora Exemplo vem no formato `codigo/loja`, como `Z06586/01`. */
  id: string;
  nome: string;
  documento?: string;
  tipo?: 'PF' | 'PJ';
  telefone?: string | null;
  email?: string | null;
  endereco?: EnderecoDoErp | null;
  /** Atalhos para o endereço, que é o que a conversa costuma citar. */
  cidade?: string | null;
  uf?: string | null;
  /** Quando a entrega é em outra praça. Só existe se o cadastro foi aberto com
   *  ela — sem isso vale o endereço de cobrança. */
  cidade_entrega?: string | null;
  uf_entrega?: string | null;
  /** Dono da carteira no sistema deles. É por ele que se sabe se o cliente já
   *  é de outro vendedor. Pode vir null: cliente sem vendedor atribuído. */
  vendedor_id?: string | null;
  /** Sem inscrição estadual o cliente é não contribuinte, e isso muda o preço
   *  final: o ICMS-ST incide sobre não contribuinte e não sobre revenda. */
  inscricao_estadual?: string | null;
  contribuinte_icms?: boolean | null;
  /** Em quais empresas do grupo este cliente existe. */
  empresas?: string[];
  /** A classificação fiscal, que **nós nunca enviamos**: o cadastro aberto pelo
   *  Agente nasce pendente dela e o comercial confere antes de liberar. Chega
   *  aqui só quando a consulta já devolve um cadastro classificado. */
  tipo_cliente?: string | null;
  segmento?: string | null;

  /** `ATIVO` ou `BLOQUEADO`, como o sistema deles devolve.
   *
   *  **Bloqueado NÃO impede cotar — impede faturar.** Pessoa jurídica
   *  cadastrada pelo Agente nasce bloqueada de propósito: o cadastro entra sem
   *  classificação fiscal e o comercial confere antes de liberar, porque errar
   *  a classificação é errar ICMS. Pessoa física nasce ativa.
   *
   *  Tratar bloqueado como "não pode orçar" faria o Agente cadastrar o cliente
   *  e recusar-se a atendê-lo no gesto seguinte — o oposto do que a automação
   *  existe para fazer. */
  situacao?: 'ATIVO' | 'BLOQUEADO' | string | null;
  /** Derivado de `situacao`. Governa o PEDIDO, nunca o orçamento. */
  podeFaturar?: boolean;
  /** Uso interno. Nunca chega ao cliente final, e nem ao modelo. */
  motivo_bloqueio?: string | null;
  /** As condições que o ERP libera para ESTE cliente (vêm na consulta desde
   *  14/10). Ausente: o ERP não mandou, e não quer dizer "nenhuma". */
  formas_pagamento?: FormaDePagamentoDoErp[];
}

/** Uma condição de pagamento, como a consulta de cliente da Distribuidora Exemplo devolve. */
export interface FormaDePagamentoDoErp {
  /** O que vai no orçamento: `PIX`, `B00`, `CV3`. */
  codigo: string;
  /** Abreviada, do cadastro deles: `BOL ANTECIPADO`, `C.C. VISA 3 PARCELAS`. */
  descricao: string;
  /** O tipo: `PIX`, `BO` (boleto), `CC` (crédito), `CD` (débito), `R$`, `DP`. */
  forma: string;
  parcelas: number;
  /** Desde 21/10 (TI do cliente): `PIX`, `BOLETO`, `CARTAO_CREDITO` ou `CARTAO_DEBITO`. Ausente: deduzir de `forma`. */
  tipo?: string | null;
  /** Desde 21/10 (TI do cliente): `VISA`, `MASTERCARD`, ou null quando o cliente escolhe a bandeira no link. */
  bandeira?: string | null;
  disponivel: boolean;
  /** Null: sem mínimo. Valem para o total do orçamento. */
  valor_minimo: number | null;
  valor_maximo: number | null;
}

/** O que a IA pede: código do produto e quantidade. Nunca preço — preço quem
 *  diz é o sistema do cliente. */
export interface ItemPedido {
  produto_codigo: string;
  quantidade: number;
}

/** O que volta com preço. É a partir DESTES campos que o código monta a
 *  mensagem enviada ao cliente final, copiando número por número. */
export interface ItemComPreco extends ItemPedido {
  descricao: string;
  unidade?: string | null;
  preco_unitario: number;
  desconto_percentual: number;
  valor_total: number;
}

/** O item da consulta de preço. Além do preço, traz o que só o ERP sabe:
 *  saldo, a empresa do grupo que atende e a tabela usada. */
export interface ItemCotado extends ItemComPreco {
  saldo?: number | null;
  /** `saldo >= quantidade`, calculado por eles (medido em 08/10/2026). */
  estoque_disponivel?: boolean | null;
  empresa?: string | null;
  tabela_preco?: string | null;
  /** Estimativa; não entra no total (o ICMS-ST é apurado no faturamento). */
  icms_st_estimado?: number | null;
}

export interface Cotacao {
  itens: ItemCotado[];
  valor_total: number;
  desconto_total: number;
  validade?: string | null;
  condicao_pagamento?: string | null;
  consultado_em?: string | null;
}

/** Um produto na resposta de `precos` (Distribuidora Exemplo, 08/10/2026), como vem.
 *  Produto sem preço volta `encontrado: false` com `motivo`, e status 200. */
export interface PrecoDoErp {
  produto_id: string;
  encontrado: boolean;
  motivo?: string;
  descricao?: string;
  unidade?: string;
  quantidade?: number;
  preco_unitario?: number;
  total?: number;
  peso_kg?: number;
  empresa?: string;
  saldo?: number;
  estoque_disponivel?: boolean;
  tabela_preco?: string;
  icms_st_estimado?: number;
}

export interface RespostaDePrecos {
  condicao_pagamento: string;
  uf?: string;
  cliente_id?: string | null;
  vendedor_id?: string | null;
  produtos: PrecoDoErp[];
  consultado_em?: string;
}

export interface Orcamento {
  id: string;
  numero?: string | null;
  situacao?: string | null;
  validade?: string | null;
  itens: ItemComPreco[];
  valor_total: number;
  desconto_total: number;
  /** Opcional desde 13/09: no fluxo automático o desconto já vem aplicado, e o
   *  vendedor não precisa abrir nada para concluir. Quando existe, entra no
   *  aviso que ele recebe no copiloto. */
  link?: string | null;
}

/** O corpo de erro, igual em todas as operações.
 *
 *  A Distribuidora Exemplo manda `campos` como lista; o simulador manda `campo` avulso.
 *  `erroDoCorpo`, no cliente HTTP, aceita as duas formas e normaliza. */
export interface ErroDoErp {
  erro: {
    codigo: string;
    mensagem: string;
    campo?: string | null;
    campos?: string[] | null;
    ocorrido_em?: string | null;
  };
}

/** Códigos de erro que o nosso lado trata de forma específica. Qualquer outro
 *  código é tratado como recusa genérica — o contrato é de fora, e a lista
 *  fechada seria a primeira coisa a ficar desatualizada.
 *
 *  Comparados sempre em minúsculas: a Distribuidora Exemplo manda em maiúsculas e o
 *  simulador em minúsculas, e `erroDoCorpo` normaliza antes de comparar. */
export const ERRO_CLIENTE_NAO_ENCONTRADO = 'cliente_nao_encontrado';
export const ERRO_PRODUTO_NAO_ENCONTRADO = 'produto_nao_encontrado';
export const ERRO_CLIENTE_SEM_CREDITO = 'cliente_sem_credito';
export const ERRO_CLIENTE_BLOQUEADO = 'cliente_bloqueado';
export const ERRO_DOCUMENTO_JA_CADASTRADO = 'documento_ja_cadastrado';
export const ERRO_DADOS_OBRIGATORIOS_AUSENTES = 'dados_obrigatorios_ausentes';
export const ERRO_ENDERECO_INVALIDO = 'endereco_invalido';
/** A Distribuidora Exemplo ainda está gravando a mesma Idempotency-Key. Esperar e repetir
 *  é o que o documento deles manda fazer — por isso este é retentável. */
export const ERRO_REQUISICAO_EM_ANDAMENTO = 'requisicao_em_andamento';

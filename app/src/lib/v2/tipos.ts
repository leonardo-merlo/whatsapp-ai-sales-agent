// Tipos do pipeline v2 de identificação de produto.
//
// Princípio: a IA só lê e etiqueta; o código decide. Os tipos de cima são os
// dados (famílias, regras); os de baixo, o que circula a cada mensagem.

export type Unidade = 'mm' | 'pol' | 'chapa' | 'm' | 'cm' | 'l' | 'kg_m' | 'numero';
export type UnidadeDeVenda = 'peca' | 'kg' | 'metro' | 'rolo' | 'caixa';

// ── dados (versionados em src/lib/v2/dados) ──

export interface MedidaDoMolde {
  etiqueta: string;
  unidade: Unidade;
  /** Coluna de `catalogo_produtos.medidas` de onde sai o valor do produto. */
  coluna?: string;
  /** Sem coluna: padrão lido na descrição (sem acento, maiúscula). */
  regex_descricao?: string;
  /** Medidas do mesmo grupo podem vir em qualquer ordem ("30x20" = "20X30"). */
  ordem_livre?: string;
  /** O cliente costuma omitir: documenta a regra, sem preferência. */
  opcional?: string;
  /** Se o cliente não disse, ficam só os produtos SEM esta medida (regra citada). */
  ausente_por_padrao?: string;
}

export interface AtributoDaFamilia {
  nome: string;
  /** valor → regex na descrição. */
  valores: Record<string, string>;
  /** Se o cliente não disse, ficam só os produtos sem o atributo (regra citada). */
  ausente_por_padrao?: string;
}

export interface Familia {
  id: string;
  nome: string;
  grupos: string[];
  filtro_descricao?: string;
  medidas?: MedidaDoMolde[];
  /** Família sem molde: as medidas do produto são os números da descrição. */
  medidas_da_descricao?: boolean;
  atributos?: AtributoDaFamilia[];
  /** Barra chata e cantoneira: espessura escrita antes da largura é o mesmo produto, mas confirma. */
  confirmar_ordem_trocada?: boolean;
  /** A IA não escolhe esta família (ex.: códigos ME). */
  fora_da_extracao?: boolean;
  /** Feito sob medida, sem código: vai para o vendedor. */
  sob_medida?: boolean;
  unidade_venda: UnidadeDeVenda;
  faixa_quantidade: [number, number];
  peso?: { formula: FormulaDePeso; comprimentos_m?: number[] };
}

export type FormulaDePeso =
  | 'redondo_macico' | 'quadrado_macico' | 'barra_retangular' | 'cantoneira' | 'tubo_retangular'
  | 'tubo_redondo' | 'perfil_u' | 'perfil_u_enrijecido' | 'chapa';

/** Campos comuns a toda linha de regra (plano, Fase C). */
export interface Rastro {
  id: string;
  origem: string;
  data: string;
  status: 'ativa' | 'a_revisar';
  a_validar_vendedor: boolean;
  /** O texto da regra como estava em regras.md / dicionario.md. */
  texto_original?: string;
  exemplo_positivo: string;
  exemplo_negativo: string;
  /** O exemplo negativo foi criado aqui, não pelo vendedor: vai ao checklist. */
  negativo_criado_pela_v2?: boolean;
}

// ── catálogo estruturado ──

export interface ProdutoDoCatalogo {
  codigo: string;
  descricao: string;
  unidade: string | null;
  grupo: string | null;
  molde: string | null;
  medidas: Record<string, string> | null;
  peso_kg?: number | null;
}

export interface MedidaCanonica {
  etiqueta: string;
  valor: string;
}

export interface ProdutoV2 {
  codigo: string;
  descricao: string;
  familia: string;
  medidas: MedidaCanonica[];
  /** nome do atributo → valor (só os presentes). */
  atributos: Record<string, string>;
  unidade: string | null;
  peso_kg: number | null;
  grupo: string | null;
}

export interface SaudeDoProduto {
  codigo: string;
  status: 'ok' | 'suspeito';
  motivos: string[];
}

// ── extração (o que a IA devolve) ──

export interface Trecho { valor: string; trecho: string }

export interface MedidaExtraida {
  valor: string;
  etiqueta: string;
  unidade_escrita: string | null;
  trecho: string;
}

export interface NumeroAuxiliar {
  valor: string;
  papel: 'mesma_medida_em_outra_unidade' | 'especificacao_aco' | 'outro';
  trecho: string;
}

export interface ItemExtraido {
  familia: string;
  quantidade: Trecho | null;
  medidas: MedidaExtraida[];
  numeros_auxiliares: NumeroAuxiliar[];
  qualificadores: string[];
  termos_nao_reconhecidos: string[];
  idem_resolvido_de_linha: number | null;
}

export interface LinhaExtraida {
  linha_id: number;
  texto_original: string;
  descartada: boolean;
  motivo_descarte: string | null;
  itens: ItemExtraido[];
}

/**
 * Uma mudança num item que já está na lista (chave V2_OPERACOES, 25/10). `item` é o número que a IA viu na lista;
 * `trecho`, as palavras do cliente que apontam o item. O código confere as duas coisas antes de aplicar.
 */
export type OperacaoNaLista =
  | { tipo: 'tirar'; item: number; trecho: string }
  | { tipo: 'trocar_produto'; item: number; trecho: string; por: ItemExtraido; trecho_novo: string }
  | { tipo: 'mudar_quantidade'; item: number; trecho: string; quantidade: Trecho; soma: boolean }
  | { tipo: 'mudar_medida'; item: number; trecho: string; medida: MedidaExtraida };

export interface Extracao {
  tipo_mensagem: 'novos_itens' | 'resposta_pergunta' | 'confirmacao' | 'outro';
  linhas: LinhaExtraida[];
  respostas_a_perguntas: { pergunta_id: string; opcao_escolhida: string }[];
  /** Só com a lista atual no pedido (V2_OPERACOES). */
  edicoes?: OperacaoNaLista[];
}

// ── conferências e resolução ──

export interface Conferencia {
  nome: 'literal' | 'cobertura_de_numeros' | 'cobertura_de_linhas' | 'molde' | 'outra_unidade' | 'familia';
  ok: boolean;
  detalhe: string;
}

export type StatusDaResolucao = 'resolvido' | 'confirmar' | 'ambiguo' | 'nao_encontrado' | 'nao_vende' | 'conflito' | 'vendedor';

export interface Candidato { codigo: string; descricao: string; diferenca: string }

export interface ValorResolvido { valor: string; origem: 'cliente' | 'padrao' | 'conversao'; regra_id?: string }

export interface Travas {
  familia: boolean;
  conferencias: boolean;
  termos: boolean;
  unico: boolean;
  cadastro: boolean;
  familia_liberada: boolean;
  quantidade: boolean;
}

export interface ResultadoResolucao {
  status: StatusDaResolucao;
  codigo: string | null;
  candidatos: Candidato[];
  /** O que distingue os candidatos ("chapa", "tipo", "furo"). */
  atributo_a_perguntar: string | null;
  /** Opções da pergunta, quando ela é por atributo e não por produto. */
  opcoes: { rotulo: string; codigos: string[] }[];
  medidas: Record<string, ValorResolvido>;
  regras_aplicadas: string[];
  travas: Travas;
  motivo: string;
}

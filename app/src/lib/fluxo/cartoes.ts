// Junta os passos de `passos.ts` às ferramentas de verdade, para a aba Fluxo.
//
// Roda no SERVIDOR: as ferramentas importam código que não vai ao navegador
// (`node:crypto`, Vault). A página monta os cards aqui e entrega à tela só o
// que é texto — nome, descrição, campos.
//
// Nada aqui é escrito à mão sobre uma ferramenta: a descrição e os campos saem
// do mesmo objeto que vai no campo `tools` da requisição à Anthropic. O que
// este arquivo acrescenta é a ligação ferramenta → operação do contrato e os
// erros que cada operação pode devolver, que o código não guarda em lugar
// nenhum hoje.

import { ferramentasDoRoteiro, type FerramentaDoAgente } from '../agente/ferramentas';
import type { OperacaoDoErp } from '../erp/caminhos';
import {
  ERRO_CLIENTE_BLOQUEADO,
  ERRO_CLIENTE_NAO_ENCONTRADO,
  ERRO_CLIENTE_SEM_CREDITO,
  ERRO_DADOS_OBRIGATORIOS_AUSENTES,
  ERRO_DOCUMENTO_JA_CADASTRADO,
  ERRO_ENDERECO_INVALIDO,
  ERRO_PRODUTO_NAO_ENCONTRADO,
  ERRO_REQUISICAO_EM_ANDAMENTO,
} from '../erp/contrato';
import { PASSOS_DO_ROTEIRO, type PassoDeConversa, type RoteiroDoFluxo } from './passos';

/** Qual operação do contrato cada ferramenta chama. `null` = não sai para o
 *  sistema do cliente (a busca é no catálogo que mora aqui). */
export const OPERACAO_DA_FERRAMENTA: Record<string, OperacaoDoErp | null> = {
  consultar_cliente: 'consultar_cliente',
  cadastrar_cliente: 'criar_cliente',
  buscar_produtos: null,
  consultar_preco: 'cotar',
  criar_orcamento: 'criar_orcamento',
};

/** Os erros que o contrato (`docs/contrato-api-exemplo.md`) prevê para cada
 *  operação. As operações 2 e 4 têm idempotência, e por isso podem devolver
 *  "requisição em andamento". */
export const ERROS_DA_OPERACAO: Record<OperacaoDoErp, string[]> = {
  consultar_cliente: [ERRO_CLIENTE_NAO_ENCONTRADO],
  criar_cliente: [
    ERRO_DOCUMENTO_JA_CADASTRADO,
    ERRO_DADOS_OBRIGATORIOS_AUSENTES,
    ERRO_ENDERECO_INVALIDO,
    ERRO_REQUISICAO_EM_ANDAMENTO,
  ],
  cotar: [ERRO_PRODUTO_NAO_ENCONTRADO],
  criar_orcamento: [
    ERRO_CLIENTE_SEM_CREDITO,
    ERRO_CLIENTE_BLOQUEADO,
    ERRO_PRODUTO_NAO_ENCONTRADO,
    ERRO_REQUISICAO_EM_ANDAMENTO,
  ],
};

/** As ferramentas que empurram texto para `ctx.mensagensDoSistema` — a
 *  mensagem com valores que o CÓDIGO monta e manda depois da resposta do
 *  modelo (`erp-orcamento.ts`). */
export const ESCREVEM_AO_CLIENTE = new Set(['consultar_preco', 'criar_orcamento']);

export const AVISO_DO_TEXTO_DO_CODIGO =
  'Os valores vêm do sistema de gestão, não da IA.';

export interface CampoDaFerramenta {
  nome: string;
  tipo: string;
  descricao: string;
  obrigatorio: boolean;
  /** Os campos de cada item, quando o campo é uma lista de objetos. */
  subcampos?: CampoDaFerramenta[];
}

export interface CartaoDeSistema {
  tipo: 'sistema';
  id: string;
  ferramenta: string;
  /** Posição da ferramenta na lista que vai ao modelo, começando em 1. */
  posicaoNaLista: number;
  descricao: string;
  campos: CampoDaFerramenta[];
  operacao: OperacaoDoErp | null;
  erros: string[];
  /** Presente só nas ferramentas que escrevem ao cliente pelo código. */
  avisoDoTexto: string | null;
}

export type Cartao = PassoDeConversa | CartaoDeSistema;

interface EsquemaSolto {
  type?: string;
  description?: string;
  properties?: Record<string, EsquemaSolto>;
  required?: readonly string[];
  items?: EsquemaSolto;
}

function camposDoEsquema(esquema: EsquemaSolto): CampoDaFerramenta[] {
  const obrigatorios = new Set(esquema.required ?? []);
  return Object.entries(esquema.properties ?? {}).map(([nome, campo]) => {
    const item = campo.items;
    const listaDeObjetos = campo.type === 'array' && item?.type === 'object';
    return {
      nome,
      tipo: campo.type === 'array' ? `lista de ${item?.type === 'object' ? 'itens' : (item?.type ?? '?')}` : (campo.type ?? '?'),
      descricao: campo.description ?? '',
      obrigatorio: obrigatorios.has(nome),
      ...(listaDeObjetos && item ? { subcampos: camposDoEsquema(item) } : {}),
    };
  });
}

function cartaoDaFerramenta(id: string, ferramenta: FerramentaDoAgente, posicao: number): CartaoDeSistema {
  const nome = ferramenta.definicao.name;
  const operacao = OPERACAO_DA_FERRAMENTA[nome] ?? null;
  return {
    tipo: 'sistema',
    id,
    ferramenta: nome,
    posicaoNaLista: posicao,
    descricao: ferramenta.definicao.description,
    campos: camposDoEsquema(ferramenta.definicao.input_schema as EsquemaSolto),
    operacao,
    erros: operacao ? ERROS_DA_OPERACAO[operacao] : [],
    avisoDoTexto: ESCREVEM_AO_CLIENTE.has(nome) ? AVISO_DO_TEXTO_DO_CODIGO : null,
  };
}

/**
 * Os cards de um roteiro, na ordem de `passos.ts`.
 *
 * As ferramentas vêm de `ferramentasDoRoteiro('vendas')`, a mesma chamada que o
 * motor faz — é a única lista que tem todas. Passo apontando para ferramenta
 * que não existe é pulado aqui (a tela não quebra) e reprovado no teste.
 */
export function cartoesDoRoteiro(roteiro: RoteiroDoFluxo): Cartao[] {
  const ferramentas = ferramentasDoRoteiro('vendas');
  const cartoes: Cartao[] = [];
  for (const passo of PASSOS_DO_ROTEIRO[roteiro]) {
    if (passo.tipo === 'conversa') {
      cartoes.push(passo);
      continue;
    }
    const indice = ferramentas.findIndex(f => f.definicao.name === passo.ferramenta);
    if (indice === -1) continue;
    cartoes.push(cartaoDaFerramenta(passo.id, ferramentas[indice], indice + 1));
  }
  return cartoes;
}

export type CartoesDosFluxos = Record<RoteiroDoFluxo, Cartao[]>;

export function cartoesDosFluxos(): CartoesDosFluxos {
  return { vendas: cartoesDoRoteiro('vendas'), atendimento: cartoesDoRoteiro('atendimento') };
}

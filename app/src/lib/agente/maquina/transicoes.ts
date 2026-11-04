// As transições da máquina: etapa + evento entram, etapa nova + ação + fala saem.
//
// Tudo aqui é PURO. Quem lê o banco, chama o ERP, a v2 e a IA é `conduzir.ts`;
// ele traduz o que aconteceu em `Evento` e chama `passo` de novo, até o
// orçamento parar numa etapa de espera (ajuste A2). Os nomes T1, T2, X1 são as
// linhas do spec; as guardas leem só `dados`, nunca o histórico.

import { familiaDoTexto } from '../../v2/dicionario';
import { validarCampo } from './cadastro';
import { escolherPagamento, limiteEstourado, opcoesDoOrcamento, opcoesOferecidas, rotuloDaOpcao } from './pagamento';
import {
  CAMPOS_OBRIGATORIOS, ETAPAS_DE_COLETA,
  type CadastroAnterior, type CamposDoCadastro, type CotacaoDoOrcamento, type ClienteDoOrcamento, type DadosDoOrcamento, type EstadoDoOrcamento, type EtapaDaMaquina, type Leitura,
} from './tipos';
import { simClaro } from '../../v2/sim-claro';
import type { FormaDePagamentoDoErp } from '../../erp/contrato';
import type { ItemDoSnapshot } from '../../v2/armazem';

export interface MensagemDoCliente {
  mensagemId: string;
  texto: string;
  /** O primeiro CPF ou CNPJ válido citado (dígito verificador conferido). */
  documento: string | null;
  /** Havia número com cara de documento, mas que não passa no dígito. */
  documentoInvalido: boolean;
  leitura: Leitura;
  /** O cliente de um orçamento anterior desta conversa, hoje (T20). Só vem quando a mensagem abre um orçamento. */
  cadastroAnterior?: CadastroAnterior | null;
  /** O orçamento aberto está parado há mais de um dia, já com número: pergunta se continua ou começa outro (25/10). */
  orcamentoParado?: boolean;
  /** V2_OPERACOES: a frase sobre a lista vai para a v2, que lê a mudança com a IA. */
  operacoes?: boolean;
}

export type Evento =
  | { tipo: 'mensagem'; mensagem: MensagemDoCliente }
  | { tipo: 'erp_consulta'; resultado: 'encontrado'; cliente: ClienteDoOrcamento }
  | { tipo: 'erp_consulta'; resultado: 'nao_encontrado' | 'falhou' }
  | { tipo: 'erp_cadastro'; resultado: 'criado'; cliente: ClienteDoOrcamento }
  | { tipo: 'erp_cadastro'; resultado: 'ja_existe' | 'falhou' }
  | { tipo: 'erp_cadastro'; resultado: 'recusado'; campo: string | null }
  | { tipo: 'cidade_conferida'; cidade: string; uf: string | null; regioes: string[]; parecidas?: string[] }
  | { tipo: 'v2'; pedidoId: string; texto: string; confirmados: ItemDoSnapshot[] | null }
  /** Null: a consulta falhou ou não achou o cliente. */
  | { tipo: 'formas_de_pagamento'; formas: FormaDePagamentoDoErp[] | null }
  | { tipo: 'cotacao'; resultado: 'ok'; cotacao: CotacaoDoOrcamento }
  | { tipo: 'cotacao'; resultado: 'falhou'; codigo: string; mensagem: string }
  | { tipo: 'v2_fechado'; recomecar: boolean };

/** O que o código executa antes do próximo passo. */
export type Acao =
  | { tipo: 'consultar_cliente'; documento: string }
  | { tipo: 'cadastrar_cliente'; documento: string; campos: CamposDoCadastro }
  | { tipo: 'conferir_cidade'; cidade: string; uf: string | null }
  | { tipo: 'v2'; texto: string; pedidoId: string | null }
  /** Mostrar de novo a lista que já estava sendo montada (voltou aos itens depois de X1). */
  | { tipo: 'v2_lista'; pedidoId: string }
  /** O cliente não veio com as formas de pagamento (cadastro novo): consulta de novo. */
  | { tipo: 'buscar_formas'; documento: string }
  /** O preço da lista confirmada com a condição escolhida. */
  | { tipo: 'cotar'; condicao: string; clienteId: string; itens: { codigo: string; quantidade: string | null }[] }
  /** O cliente confirmou que cancela (ou recomeça): o pedido da v2 fecha junto com a ficha. */
  | { tipo: 'fechar_v2'; pedidoId: string; recomecar: boolean };

/** As frases fixas (ver `textos.ts`). */
export type ChaveDoTexto =
  | 'pedir_documento' | 'documento_invalido' | 'pedir_outro_documento' | 'confirmar_mesmo_cadastro'
  | 'pedir_dados_do_cadastro' | 'faltam_dados' | 'cadastro_recusado'
  | 'confirmar_cliente' | 'pedir_cidade' | 'cadastro_feito_pedir_cidade' | 'cidade_nao_atendida'
  | 'pedir_produtos' | 'lista_confirmada' | 'vou_confirmar'
  | 'lista_confirmada_pedir_pagamento' | 'pedir_pagamento' | 'pagamento_indisponivel' | 'forma_fora_do_total'
  | 'pedir_parcelas' | 'parcelas_fora_do_limite' | 'pedir_bandeira' | 'pedir_opcao_de_pagamento' | 'prazo_nao_liberado' | 'pagamento_escolhido'
  | 'pagamento_fora_do_limite'
  | 'confirmar_cancelamento' | 'confirmar_recomeco' | 'orcamento_cancelado' | 'cancelamento_desfeito' | 'continuar_orcamento' | 'lista_nao_entendi'
  | 'continuar_ou_novo';

export type Fala =
  | { tipo: 'fixa'; chave: ChaveDoTexto }
  /** A IA responde o outro assunto; `depois` é a pergunta da etapa, que o código acrescenta. */
  | { tipo: 'livre'; depois: ChaveDoTexto | null }
  | { tipo: 'v2'; texto: string }
  /** Outro assunto no meio da lista: a IA responde e o código mostra a lista em montagem de novo. */
  | { tipo: 'livre_e_lista'; pedidoId: string }
  /** Uma frase fixa e a lista em montagem de novo ("Certo, o orçamento continua." e a lista). */
  | { tipo: 'fixa_e_lista'; chave: ChaveDoTexto; pedidoId: string }
  | { tipo: 'nenhuma' };

export interface Passo {
  /** Nulo: não há orçamento em andamento (e a mensagem não abriu um). */
  estado: EstadoDoOrcamento | null;
  transicoes: string[];
  acao: Acao | null;
  fala: Fala;
}

const PERGUNTA_DA_ETAPA: Partial<Record<NonNullable<EstadoDoOrcamento['pergunta']>, ChaveDoTexto>> = {
  documento: 'pedir_documento',
  mesmo_cadastro: 'confirmar_mesmo_cadastro',
  dados_do_cadastro: 'faltam_dados',
  confirmar_cliente: 'confirmar_cliente',
  cidade: 'pedir_cidade',
  produtos: 'pedir_produtos',
  pagamento: 'pedir_pagamento',
  parcelas: 'pedir_parcelas',
  bandeira: 'pedir_bandeira',
  opcao_de_pagamento: 'pedir_opcao_de_pagamento',
};

/** A pergunta pendente desta etapa, como frase fixa. */
export function perguntaAtual(estado: EstadoDoOrcamento): ChaveDoTexto | null {
  if (estado.etapa === 'consultando_cadastro' || estado.etapa === 'criando_cadastro') return 'vou_confirmar';
  return estado.pergunta ? (PERGUNTA_DA_ETAPA[estado.pergunta] ?? null) : null;
}

function faltando(campos: CamposDoCadastro): (typeof CAMPOS_OBRIGATORIOS)[number][] {
  return CAMPOS_OBRIGATORIOS.filter(c => !campos[c]);
}

/** Junta o que o cliente mandou agora ao que já estava guardado, só o que passa na forma. */
function mesclarCampos(antes: CamposDoCadastro, novos: CamposDoCadastro): CamposDoCadastro {
  const saida = { ...antes };
  for (const [campo, valor] of Object.entries(novos) as [keyof CamposDoCadastro, string | undefined][]) {
    const limpo = valor === undefined ? null : validarCampo(campo, valor);
    if (limpo) saida[campo] = limpo;
  }
  return saida;
}

const semEspacos = (t: string): string => t.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * O que vai para a v2 quando os produtos chegam antes da hora: o trecho que a
 * IA separou, se ele estiver mesmo na fala do cliente; senão, a fala inteira.
 * No ensaio de 07/10 a fala inteira ("Opa, cnpj ..., entrega em Juniaí, preciso
 * de 20 kg de prego") virou a pergunta da v2, com CNPJ e tudo.
 */
export function trechoDosProdutos(m: MensagemDoCliente): string {
  const trecho = m.leitura.produtosTexto;
  if (!trecho) return m.texto;
  const fala = semEspacos(m.texto);
  return trecho.split(/\n+/).every(l => fala.includes(semEspacos(l))) ? trecho : m.texto;
}

function guardarCedo(dados: DadosDoOrcamento, m: MensagemDoCliente): DadosDoOrcamento {
  const novo = { ...dados };
  if (m.leitura.produtosCitados) {
    novo.produtos_guardados = [dados.produtos_guardados, trechoDosProdutos(m)].filter(Boolean).join('\n');
  }
  if (m.leitura.cidade) novo.cidade_citada = m.leitura.cidade;
  return novo;
}

/** Os dados sem estes blocos. */
function sem(dados: DadosDoOrcamento, ...chaves: (keyof DadosDoOrcamento)[]): DadosDoOrcamento {
  const copia = { ...dados };
  for (const c of chaves) delete copia[c];
  return copia;
}

const ficar = (estado: EstadoDoOrcamento, fala: Fala, acao: Acao | null = null): Passo =>
  ({ estado, transicoes: [], acao, fala });

/** A fala quando a mensagem não muda nada: outro assunto vira resposta livre + a pergunta. */
/** Cara de resposta a uma pergunta de item: sim/não, um número, uma opção. */
export function pareceRespostaDoItem(texto: string): boolean {
  // As opções têm letra desde 25/10 à noite: "b", "2b", "1a 2c" também são resposta.
  return /^\s*(?:sim|s|n[aã]o|ok|isso|pode|certo|nenhuma|op[cç][aã]o\s*\d+|\(?\d+(?:[.,/]\d+)?\)?)(?:\s|[.,!]|$)/i.test(texto)
    || /^\s*(?:(?:\d{1,2}\s*[.)\-:]?\s*)?[a-z](?![a-z])\)?[\s,;]*)+$/i.test(texto);
}

function semMudanca(estado: EstadoDoOrcamento, m: MensagemDoCliente): Passo {
  const pergunta = perguntaAtual(estado);
  return ficar(estado, m.leitura.intencao === 'outro_assunto'
    ? { tipo: 'livre', depois: pergunta }
    : pergunta ? { tipo: 'fixa', chave: pergunta } : { tipo: 'nenhuma' });
}

/**
 * X1: outro documento no meio da coleta. Limpa o cliente e a entrega; os itens ficam. Os produtos que vieram junto
 * com o documento ficam guardados para depois da cidade (25/10: o áudio de um cliente com CPF e seis produtos perdia os produtos).
 */
function trocarDeDocumento(estado: EstadoDoOrcamento, m: MensagemDoCliente): Passo {
  const documento = m.documento!;
  const mensagemId = m.mensagemId;
  const resto = guardarCedo(sem(estado.dados, 'cliente', 'entrega', 'cadastro_novo', 'cidade_recusada'), m);
  return {
    estado: {
      ...estado, etapa: 'consultando_cadastro', pergunta: null, desdeMensagem: mensagemId,
      dados: { ...resto, documento: { valor: documento, origem: 'cliente' } },
    },
    transicoes: ['X1'],
    acao: { tipo: 'consultar_cliente', documento },
    fala: { tipo: 'nenhuma' },
  };
}

function abrirComDocumento(dados: DadosDoOrcamento, documento: string, mensagemId: string, transicoes: string[]): Passo {
  return {
    estado: {
      etapa: 'consultando_cadastro', pergunta: null, desdeMensagem: mensagemId,
      dados: { ...dados, documento: { valor: documento, origem: 'cliente' } },
    },
    transicoes: [...transicoes, 'T2'],
    acao: { tipo: 'consultar_cliente', documento },
    fala: { tipo: 'nenhuma' },
  };
}

/**
 * A mensagem abre um orçamento novo? Vale quando não há nenhum em andamento, e
 * também depois da lista confirmada (o anterior se encerra).
 */
export function abreOrcamento(m: MensagemDoCliente): boolean {
  return !!m.documento || m.leitura.intencao === 'pedir_orcamento';
}

// ── cancelar e recomeçar (válvula de escape, 22/10) ──

const ETAPAS_QUE_CANCELAM: readonly EtapaDaMaquina[] = ['aguardando_documento', ...ETAPAS_DE_COLETA];

const PEDE_CANCELAR = /^(?:(?:mas|entao|ah|pode|quero|queria|vou)\s+)*(?:cancela|cancelar|cancele|desisti|desisto|desistir)(?:\s+(?:o|a|este|esse|essa|esta|meu|minha))?(?:\s+(?:orcamento|pedido|lista|compra|tudo|isso))?(?:\s+(?:por favor|pfv|pf))?$|^(?:tira|tirar|apaga|apagar|limpa|limpar)\s+tudo$|^nao (?:quero|vou querer) mais(?:\s+(?:nada|o orcamento|o pedido))?$/;
const PEDE_RECOMECAR = /^(?:(?:quero|vamos|vou|pode|bora)\s+)*(?:recomecar|comecar de novo|comecar do zero|refazer)(?:\s+(?:o|a)?\s*(?:orcamento|pedido|lista))?(?:\s+(?:do zero|de novo))?$/;
const QUER_NOVO = /\b(?:novo|nova|outro|outra|zero|recomec\w*)\b/;
export const QUER_FECHAR = /\b(?:fechar|fecha|feche|finaliz\w*|conclu\w*|so isso|e isso ai)\b/;
const QUER_CONTINUAR = /\b(?:continu\w*|segu\w*|mesmo|mesma|esse|este|ele)\b/;
const NAO_CANCELA =/^(?:nao|n|nao nao|nao quero|nao cancela|nao precisa|deixa|deixa pra la|continua|pode continuar|segue|pode seguir)$/;

const normal = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[!.,;]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * O cliente quer cancelar ou recomeçar o orçamento inteiro? Pelo texto, no código ("cancela tudo"), ou
 * pela leitura da IA, se a mensagem não traz produto ("tira o prego" é edição da lista, não cancelamento).
 */
export function pedidoDeCancelar(m: MensagemDoCliente): 'cancelar' | 'recomecar' | null {
  if (m.texto.includes('?')) return null;
  const t = normal(m.texto);
  if (PEDE_RECOMECAR.test(t) || (m.leitura.intencao === 'recomecar' && !m.leitura.produtosCitados)) return 'recomecar';
  if (PEDE_CANCELAR.test(t) || (m.leitura.intencao === 'cancelar' && !m.leitura.produtosCitados)) return 'cancelar';
  return null;
}

/** Confirmado: fecha o orçamento (e o pedido da v2 antes, se houver). Quem reabre no recomeçar é `conduzir.ts`. */
function encerrar(estado: EstadoDoOrcamento, tipo: 'cancelar' | 'recomecar', mensagemId: string): Passo {
  return {
    estado: { ...estado, etapa: 'encerrado', pergunta: null, desdeMensagem: mensagemId, motivoPausa: tipo === 'recomecar' ? 'recomecado' : 'cancelado' },
    transicoes: ['X6'], acao: null,
    fala: tipo === 'recomecar' ? { tipo: 'nenhuma' } : { tipo: 'fixa', chave: 'orcamento_cancelado' },
  };
}

function aMensagem(estado: EstadoDoOrcamento | null, m: MensagemDoCliente): Passo {
  // Sem orçamento ativo: só o pedido (ou um documento) abre um (T1).
  if (!estado) {
    if (!abreOrcamento(m)) return { estado: null, transicoes: [], acao: null, fala: { tipo: 'livre', depois: null } };
    const dados = guardarCedo({}, m);
    if (m.documento) return abrirComDocumento(dados, m.documento, m.mensagemId, ['T1']);
    // T20 (decisão do Leonardo, 21/10): no teste de 20/10 ele fez três
    // orçamentos seguidos com o mesmo CNPJ e confirmou o cadastro toda vez.
    if (m.cadastroAnterior && !m.documentoInvalido) {
      return {
        estado: { etapa: 'aguardando_documento', pergunta: 'mesmo_cadastro', desdeMensagem: m.mensagemId, dados: { ...dados, cadastro_anterior: m.cadastroAnterior } },
        transicoes: ['T1'],
        acao: null,
        fala: { tipo: 'fixa', chave: 'confirmar_mesmo_cadastro' },
      };
    }
    return {
      estado: { etapa: 'aguardando_documento', pergunta: 'documento', desdeMensagem: m.mensagemId, dados },
      transicoes: ['T1'],
      acao: null,
      fala: { tipo: 'fixa', chave: m.documentoInvalido ? 'documento_invalido' : 'pedir_documento' },
    };
  }

  // G-fala: esta mensagem já foi consumida (é a que fez entrar na etapa). Uma
  // execução repetida dela, pela varredura, só repete a pergunta da etapa.
  if (m.mensagemId === estado.desdeMensagem) {
    // A execução anterior morreu entre gravar e chamar o ERP: refaz a chamada.
    const pendente = acaoPendenteDoPagamento(estado);
    if (pendente) return ficar(estado, { tipo: 'nenhuma' }, pendente);
    const pergunta = perguntaAtual(estado);
    return ficar(estado, pergunta ? { tipo: 'fixa', chave: pergunta } : { tipo: 'nenhuma' });
  }

  // Voltou dias depois (25/10): "continuo ou faço um novo?". Continuar segue com a mensagem guardada; novo fecha este e
  // abre outro com ela. Outra resposta segue como mensagem normal neste orçamento, como antes.
  const retomada = estado.dados.retomada;
  if (retomada) {
    estado = { ...estado, dados: sem(estado.dados, 'retomada') };
    const t = normal(m.texto);
    const novo = QUER_NOVO.test(t);
    const continua = QUER_CONTINUAR.test(t) || simClaro(m.texto);
    if (novo && !continua) {
      const comNovo = { ...estado, dados: { ...estado.dados, recomecar_com: retomada } };
      const pedidoId = estado.dados.v2_pedido_id;
      if (pedidoId) return ficar(comNovo, { tipo: 'nenhuma' }, { tipo: 'fechar_v2', pedidoId, recomecar: true });
      return encerrar(comNovo, 'recomecar', m.mensagemId);
    }
    if (continua && !novo) return aMensagem(estado, { ...m, texto: retomada.texto, leitura: retomada.leitura });
  } else if (m.orcamentoParado && !pedidoDeCancelar(m)) {
    return ficar({ ...estado, dados: { ...estado.dados, retomada: { texto: m.texto, leitura: m.leitura } } }, { tipo: 'fixa', chave: 'continuar_ou_novo' });
  }

  // Cancelar e recomeçar são ações sem volta: só com o "sim" inteiro depois da pergunta.
  const pendente = estado.dados.cancelamento;
  if (pendente) {
    estado = { ...estado, dados: sem(estado.dados, 'cancelamento') };
    if (simClaro(m.texto)) {
      const pedidoId = estado.dados.v2_pedido_id;
      if (pedidoId) return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'fechar_v2', pedidoId, recomecar: pendente === 'recomecar' });
      return encerrar(estado, pendente, m.mensagemId);
    }
    // "não" aqui responde à pergunta do cancelamento, não à da etapa (não nega o cadastro).
    if (NAO_CANCELA.test(normal(m.texto))) {
      // Teste de 22/10: com a lista pronta, o "não" pedia os produtos de novo.
      const pedidoId = estado.dados.v2_pedido_id;
      if (estado.etapa === 'levantando_itens' && pedidoId) return ficar(estado, { tipo: 'fixa_e_lista', chave: 'cancelamento_desfeito', pedidoId });
      return ficar(estado, { tipo: 'fixa', chave: 'cancelamento_desfeito' });
    }
  }
  const pede = ETAPAS_QUE_CANCELAM.includes(estado.etapa) ? pedidoDeCancelar(m) : null;
  if (pede) {
    return ficar({ ...estado, dados: { ...estado.dados, cancelamento: pede } }, { tipo: 'fixa', chave: pede === 'recomecar' ? 'confirmar_recomeco' : 'confirmar_cancelamento' });
  }

  // Teste de 22/10, 15h: "quero um orçamento" com um orçamento aberto desde a manhã virou "não entendi"
  // e, na terceira mensagem, atendente. Pedir orçamento aqui é seguir o que já começou.
  // "quero fechar o orçamento" com a lista aberta (teste de 25/10 à tarde) é sobre a lista, que pede o "sim" final.
  if (estado.etapa === 'levantando_itens' && estado.dados.v2_pedido_id && QUER_FECHAR.test(normal(m.texto)) && !m.texto.includes('?')) {
    return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'v2', texto: m.texto, pedidoId: estado.dados.v2_pedido_id });
  }
  if (ETAPAS_DE_COLETA.includes(estado.etapa) && m.leitura.intencao === 'pedir_orcamento' && !m.leitura.produtosCitados && !m.documento) {
    const pedidoId = estado.dados.v2_pedido_id;
    if (estado.etapa === 'levantando_itens' && pedidoId) return ficar(estado, { tipo: 'fixa_e_lista', chave: 'continuar_orcamento', pedidoId });
    return ficar(estado, { tipo: 'fixa', chave: 'continuar_orcamento' });
  }

  const outroDocumento = !!m.documento && m.documento !== estado.dados.documento?.valor;
  if (outroDocumento && ETAPAS_DE_COLETA.includes(estado.etapa)) return trocarDeDocumento(estado, m);

  switch (estado.etapa) {
    case 'aguardando_documento': {
      const dados = guardarCedo(sem(estado.dados, 'cadastro_anterior'), m);
      if (m.documento) return abrirComDocumento(dados, m.documento, m.mensagemId, []);
      const anterior = estado.dados.cadastro_anterior;
      if (estado.pergunta === 'mesmo_cadastro' && anterior) {
        if (m.leitura.intencao === 'confirma') {
          // O mesmo cliente, já confirmado hoje: pula a consulta e vai para a cidade de entrega.
          // E4: a pergunta já trazia a entrega do orçamento anterior; o "sim" vale para as duas, e a cidade dita pelo cliente manda.
          const doAnterior = !m.leitura.cidade && !dados.cidade_citada && anterior.entrega ? anterior.entrega : null;
          const cidade = m.leitura.cidade ?? dados.cidade_citada ?? doAnterior;
          const confirmado: EstadoDoOrcamento = {
            etapa: 'confirmando_regiao', pergunta: 'cidade', desdeMensagem: m.mensagemId,
            dados: { ...dados, ...(doAnterior ? { entrega_repetida: true as const } : {}), documento: { valor: anterior.documento, origem: 'cliente' }, cliente: { ...anterior.cliente, confirmado: true } },
          };
          if (cidade) return { estado: confirmado, transicoes: ['T20'], acao: { tipo: 'conferir_cidade', ...cidade }, fala: { tipo: 'nenhuma' } };
          return { estado: confirmado, transicoes: ['T20'], acao: null, fala: { tipo: 'fixa', chave: 'pedir_cidade' } };
        }
        if (m.leitura.intencao === 'nega') {
          return {
            estado: { ...estado, pergunta: 'documento', desdeMensagem: m.mensagemId, dados },
            transicoes: ['X1b'], acao: null, fala: { tipo: 'fixa', chave: 'pedir_outro_documento' },
          };
        }
        if (!m.documentoInvalido) return semMudanca({ ...estado, dados: { ...dados, cadastro_anterior: anterior } }, m);
      }
      const comDados = { ...estado, pergunta: 'documento' as const, dados };
      if (m.documentoInvalido) return ficar(comDados, { tipo: 'fixa', chave: 'documento_invalido' });
      return semMudanca(comDados, m);
    }

    // O ERP falhou da última vez: a mensagem nova tenta de novo, com a mesma chave.
    case 'consultando_cadastro':
      return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'consultar_cliente', documento: estado.dados.documento!.valor });
    case 'criando_cadastro':
      return ficar(estado, { tipo: 'nenhuma' }, {
        tipo: 'cadastrar_cliente', documento: estado.dados.documento!.valor, campos: estado.dados.cadastro_novo?.campos ?? {},
      });

    case 'coletando_cadastro': {
      const campos = mesclarCampos(estado.dados.cadastro_novo?.campos ?? {}, m.leitura.campos);
      const falta = faltando(campos);
      const dados = { ...guardarCedo(estado.dados, m), cadastro_novo: { campos, faltando: falta } };
      if (!falta.length) {
        return {
          estado: { ...estado, etapa: 'criando_cadastro', pergunta: null, desdeMensagem: m.mensagemId, dados },
          transicoes: ['T5', 'T6'],
          acao: { tipo: 'cadastrar_cliente', documento: dados.documento!.valor, campos },
          fala: { tipo: 'nenhuma' },
        };
      }
      const chegouAlgo = Object.keys(campos).length > Object.keys(estado.dados.cadastro_novo?.campos ?? {}).length;
      const novo = { ...estado, dados };
      if (!chegouAlgo && m.leitura.intencao === 'outro_assunto') return ficar(novo, { tipo: 'livre', depois: 'faltam_dados' });
      return { estado: novo, transicoes: chegouAlgo ? ['T5'] : [], acao: null, fala: { tipo: 'fixa', chave: 'faltam_dados' } };
    }

    case 'confirmando_regiao': {
      const cliente = estado.dados.cliente!;
      if (estado.pergunta === 'confirmar_cliente') {
        if (m.leitura.intencao === 'confirma') {
          const cidade = m.leitura.cidade ?? estado.dados.cidade_citada ?? null;
          const confirmado: EstadoDoOrcamento = {
            ...estado, pergunta: 'cidade', desdeMensagem: m.mensagemId,
            dados: { ...estado.dados, cliente: { ...cliente, confirmado: true } },
          };
          if (cidade) return { estado: confirmado, transicoes: ['T10a'], acao: { tipo: 'conferir_cidade', ...cidade }, fala: { tipo: 'nenhuma' } };
          return { estado: confirmado, transicoes: ['T10a'], acao: null, fala: { tipo: 'fixa', chave: 'pedir_cidade' } };
        }
        if (m.leitura.intencao === 'nega') {
          // Não é este cadastro e ele não disse qual é: volta a pedir o documento.
          const resto = sem(estado.dados, 'cliente', 'documento');
          return {
            estado: { etapa: 'aguardando_documento', pergunta: 'documento', desdeMensagem: m.mensagemId, dados: resto },
            transicoes: ['X1b'],
            acao: null,
            fala: { tipo: 'fixa', chave: 'pedir_outro_documento' },
          };
        }
        return semMudanca({ ...estado, dados: guardarCedo(estado.dados, m) }, m);
      }
      // A pergunta é a cidade.
      // Teste de voz de 21/10: "Você quis dizer Jundiai?" e o cliente respondia "isso mesmo" ou repetia a
      // mesma cidade não achada ("Muriá"). Com uma sugestão só, o "sim" e a repetição aceitam a sugerida.
      const parecidas = estado.dados.cidades_parecidas ?? [];
      const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      const repetiu = !!m.leitura.cidade && !!estado.dados.cidade_recusada && semAcento(m.leitura.cidade.cidade) === semAcento(estado.dados.cidade_recusada);
      if (parecidas.length === 1 && (repetiu || (m.leitura.intencao === 'confirma' && !m.leitura.cidade))) {
        return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'conferir_cidade', cidade: parecidas[0], uf: null });
      }
      if (m.leitura.cidade) return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'conferir_cidade', ...m.leitura.cidade });
      if (m.leitura.intencao === 'confirma' && cliente.cidade && !estado.dados.cidade_recusada) {
        return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'conferir_cidade', cidade: cliente.cidade, uf: cliente.uf });
      }
      return semMudanca({ ...estado, dados: guardarCedo(estado.dados, m) }, m);
    }

    case 'levantando_itens': {
      const pedidoId = estado.dados.v2_pedido_id ?? null;
      // Teste de 08/10: "vocês abrem sábado?" no meio da lista foi para a v2,
      // que só repetiu a lista. Outro assunto é respondido; resposta curta
      // ("sim", "2", "5.0", "não, é…") é da pergunta do item e segue para a v2.
      // 21/10: "pode me dizer o prazo de entrega?" não foi lido como outro assunto e ficou sem resposta.
      // Pergunta sem número não é resposta de item ("é o 14 mesmo?" tem número e segue para a v2).
      const pergunta = m.texto.includes('?') && !/\d/.test(m.texto);
      if (pedidoId && !m.leitura.produtosCitados && (pergunta || (m.leitura.intencao === 'outro_assunto' && !pareceRespostaDoItem(m.texto)))) {
        // Teste de 22/10: "Arame", sem pergunta, foi para a IA livre, que respondeu "vou tirar os dois e deixar só 5 kg" e não
        // fez nada. Frase sem "?" que cita produto ou número é sobre a lista: a resposta é fixa, nunca da IA.
        if (!m.texto.includes('?') && (/\d/.test(m.texto) || familiaDoTexto(m.texto).familias.length)) {
          // Com as operações, a v2 lê a frase vendo a lista (25/10: "eu preciso de um arame trançado" virou "Não entendi").
          if (m.operacoes) return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'v2', texto: m.texto, pedidoId });
          return ficar(estado, { tipo: 'fixa_e_lista', chave: 'lista_nao_entendi', pedidoId });
        }
        return ficar(estado, { tipo: 'livre_e_lista', pedidoId });
      }
      if (pedidoId ||m.leitura.intencao === 'produtos' || m.leitura.produtosCitados) {
        return ficar(estado, { tipo: 'nenhuma' }, { tipo: 'v2', texto: m.texto, pedidoId });
      }
      return semMudanca(estado, m);
    }

    case 'definindo_pagamento': {
      const pendente = acaoPendenteDoPagamento(estado);
      if (pendente) return ficar(estado, { tipo: 'nenhuma' }, pendente);
      // "Adicione ou reduza produtos" (limite da condição): volta à lista, que pede confirmação de novo.
      const pedidoId = estado.dados.v2_pedido_id;
      if (pedidoId && m.leitura.produtosCitados) {
        return {
          estado: {
            ...estado, etapa: 'levantando_itens', pergunta: 'produtos', desdeMensagem: m.mensagemId,
            dados: sem(estado.dados, 'pagamento', 'pagamento_parcial', 'pagamentos_recusados', 'total_referencia', 'pagamento_fora', 'cotacao', 'cotacao_falhou'),
          },
          transicoes: ['T14b'], acao: { tipo: 'v2', texto: m.texto, pedidoId }, fala: { tipo: 'nenhuma' },
        };
      }
      const opcoes = opcoesDoOrcamento(estado.dados);
      const escolha = escolherPagamento(opcoes, m.texto, estado.dados.pagamento_parcial, estado.pergunta);
      if (escolha.tipo === 'escolhida') {
        const o = escolha.opcao;
        const novo: EstadoDoOrcamento = {
          ...estado, pergunta: null, desdeMensagem: m.mensagemId,
          dados: {
            ...sem(estado.dados, 'pagamento_parcial', 'pagamento_fora', 'cotacao', 'cotacao_falhou'),
            pagamento: {
              codigo: o.codigo, descricao: o.descricao, rotulo: rotuloDaOpcao(o, escolha.bandeira),
              valor_minimo: o.valor_minimo, valor_maximo: o.valor_maximo, origem: 'cliente',
            },
          },
        };
        return { estado: novo, transicoes: ['T15'], acao: acaoPendenteDoPagamento(novo), fala: { tipo: 'nenhuma' } };
      }
      if (escolha.tipo === 'falta') {
        const fora: ChaveDoTexto = escolha.pergunta === 'opcao_de_pagamento' ? 'prazo_nao_liberado' : 'parcelas_fora_do_limite';
        const chave: ChaveDoTexto = escolha.foraDoLimite ? fora : PERGUNTA_DA_ETAPA[escolha.pergunta]!;
        return ficar(
          { ...estado, pergunta: escolha.pergunta, dados: { ...estado.dados, pagamento_parcial: escolha.parcial } },
          { tipo: 'fixa', chave },
        );
      }
      if (escolha.tipo === 'indisponivel') {
        // Liberada no cadastro, mas fora do menu porque não comporta o total desta lista.
        const todas = opcoesOferecidas(estado.dados.cliente?.formas_pagamento);
        const peloTotal = escolherPagamento(todas, m.texto, estado.dados.pagamento_parcial, estado.pergunta).tipo !== 'indisponivel';
        return ficar(
          { ...estado, pergunta: 'pagamento', dados: sem(estado.dados, 'pagamento_parcial') },
          { tipo: 'fixa', chave: peloTotal ? 'forma_fora_do_total' : 'pagamento_indisponivel' },
        );
      }
      // "aceita pix?" não escolhe nada: a IA responde e o código repete a pergunta, leia ela o que ler.
      if (m.texto.includes('?')) return ficar(estado, { tipo: 'livre', depois: perguntaAtual(estado) });
      return semMudanca(estado, m);
    }

    case 'aguardando_vendedor':
    case 'encerrado':
    case 'expirado':
      // Quem abre outro orçamento é `conduzir.ts` (encerra este antes). Aqui, conversa solta.
      return ficar(estado, { tipo: 'livre', depois: null });
  }
}

/** Um passo da máquina. */
export function passo(estado: EstadoDoOrcamento | null, evento: Evento, mensagemId: string): Passo {
  if (evento.tipo === 'mensagem') return aMensagem(estado, evento.mensagem);
  if (!estado) return { estado: null, transicoes: [], acao: null, fala: { tipo: 'nenhuma' } };

  switch (evento.tipo) {
    case 'erp_consulta':
      if (estado.etapa !== 'consultando_cadastro') return ficar(estado, { tipo: 'nenhuma' });
      if (evento.resultado === 'encontrado') {
        return {
          estado: {
            ...estado, etapa: 'confirmando_regiao', pergunta: 'confirmar_cliente', desdeMensagem: mensagemId,
            dados: { ...estado.dados, cliente: { ...evento.cliente, confirmado: false } },
          },
          transicoes: ['T3'], acao: null, fala: { tipo: 'fixa', chave: 'confirmar_cliente' },
        };
      }
      if (evento.resultado === 'nao_encontrado') {
        return {
          estado: {
            ...estado, etapa: 'coletando_cadastro', pergunta: 'dados_do_cadastro', desdeMensagem: mensagemId,
            dados: { ...estado.dados, cadastro_novo: { campos: {}, faltando: [...CAMPOS_OBRIGATORIOS] } },
          },
          transicoes: ['T4'], acao: null, fala: { tipo: 'fixa', chave: 'pedir_dados_do_cadastro' },
        };
      }
      // X5, sem pausa nesta rodada: fica na etapa, e a próxima mensagem tenta de novo.
      return ficar(estado, { tipo: 'fixa', chave: 'vou_confirmar' });

    case 'erp_cadastro':
      if (estado.etapa !== 'criando_cadastro') return ficar(estado, { tipo: 'nenhuma' });
      if (evento.resultado === 'criado') {
        // O cliente acabou de digitar os dados dele: o cadastro já está confirmado.
        // A cidade é a que ele digitou, se o ERP não devolver.
        const digitados = estado.dados.cadastro_novo?.campos ?? {};
        const cliente: ClienteDoOrcamento = {
          ...evento.cliente,
          cidade: evento.cliente.cidade ?? digitados.cidade ?? null,
          uf: evento.cliente.uf ?? digitados.uf ?? null,
          confirmado: true,
        };
        return {
          estado: {
            ...estado, etapa: 'confirmando_regiao', pergunta: 'cidade', desdeMensagem: mensagemId,
            dados: { ...estado.dados, cliente },
          },
          transicoes: ['T8'], acao: null, fala: { tipo: 'fixa', chave: 'cadastro_feito_pedir_cidade' },
        };
      }
      if (evento.resultado === 'ja_existe') {
        return {
          estado: { ...estado, etapa: 'consultando_cadastro', pergunta: null },
          transicoes: ['T7'], acao: { tipo: 'consultar_cliente', documento: estado.dados.documento!.valor }, fala: { tipo: 'nenhuma' },
        };
      }
      if (evento.resultado === 'recusado') {
        const campo = campoDoErp(evento.campo);
        const campos = { ...(estado.dados.cadastro_novo?.campos ?? {}) };
        if (campo) delete campos[campo];
        return {
          estado: {
            ...estado, etapa: 'coletando_cadastro', pergunta: 'dados_do_cadastro',
            dados: { ...estado.dados, cadastro_novo: { campos, faltando: faltando(campos) } },
          },
          transicoes: ['T9'], acao: null, fala: { tipo: 'fixa', chave: campo ? 'faltam_dados' : 'cadastro_recusado' },
        };
      }
      return ficar(estado, { tipo: 'fixa', chave: 'vou_confirmar' });

    case 'cidade_conferida': {
      if (estado.etapa !== 'confirmando_regiao') return ficar(estado, { tipo: 'nenhuma' });
      if (!evento.regioes.length) {
        return ficar(
          { ...estado, pergunta: 'cidade', dados: { ...sem(estado.dados, 'cidades_parecidas'), cidade_recusada: evento.cidade, ...(evento.parecidas?.length ? { cidades_parecidas: evento.parecidas } : {}) } },
          { tipo: 'fixa', chave: 'cidade_nao_atendida' },
        );
      }
      const produtos_guardados = estado.dados.produtos_guardados;
      const resto = sem(estado.dados, 'cidade_recusada', 'cidades_parecidas', 'cidade_citada', 'produtos_guardados');
      const dados: DadosDoOrcamento = {
        ...resto, entrega: { cidade: evento.cidade, uf: evento.uf, regioes: evento.regioes, origem: 'cliente' },
      };
      const novo: EstadoDoOrcamento = { ...estado, etapa: 'levantando_itens', pergunta: 'produtos', dados };
      // Já havia lista sendo montada (o cliente trocou de CNPJ no meio): os produtos guardados entram nela; sem eles, mostra ela de novo.
      if (novo.dados.v2_pedido_id && produtos_guardados) return { estado: novo, transicoes: ['T10'], acao: { tipo: 'v2', texto: produtos_guardados, pedidoId: novo.dados.v2_pedido_id }, fala: { tipo: 'nenhuma' } };
      if (novo.dados.v2_pedido_id) return { estado: novo, transicoes: ['T10'], acao: { tipo: 'v2_lista', pedidoId: novo.dados.v2_pedido_id }, fala: { tipo: 'nenhuma' } };
      // Os produtos que chegaram antes da hora vão agora para a v2.
      if (produtos_guardados) return { estado: novo, transicoes: ['T10'], acao: { tipo: 'v2', texto: produtos_guardados, pedidoId: null }, fala: { tipo: 'nenhuma' } };
      return { estado: novo, transicoes: ['T10'], acao: null, fala: { tipo: 'fixa', chave: 'pedir_produtos' } };
    }

    case 'cotacao': {
      const pagamento = estado.dados.pagamento;
      if (estado.etapa !== 'definindo_pagamento' || !pagamento) return ficar(estado, { tipo: 'nenhuma' });
      // Sem preço não há como conferir: o vendedor confere.
      if (evento.resultado === 'falhou') return pagamentoAceito(estado, { cotacao_falhou: { codigo: evento.codigo, mensagem: evento.mensagem } });
      const fora = limiteEstourado(evento.cotacao.valor_total, pagamento);
      if (!fora) return pagamentoAceito(estado, { cotacao: evento.cotacao });
      const dados: DadosDoOrcamento = {
        ...sem(estado.dados, 'pagamento', 'cotacao'),
        pagamentos_recusados: [...(estado.dados.pagamentos_recusados ?? []), pagamento.codigo],
        total_referencia: evento.cotacao.valor_total,
        pagamento_fora: { rotulo: pagamento.rotulo, ...fora },
      };
      return {
        estado: { ...estado, pergunta: 'pagamento', dados },
        transicoes: ['T17'], acao: null, fala: { tipo: 'fixa', chave: 'pagamento_fora_do_limite' },
      };
    }

    case 'v2_fechado':
      return encerrar(estado, evento.recomecar ? 'recomecar' : 'cancelar', mensagemId);

    case 'formas_de_pagamento': {
      if (estado.etapa !== 'definindo_pagamento' || !estado.dados.cliente) return ficar(estado, { tipo: 'nenhuma' });
      const cliente = { ...estado.dados.cliente, formas_pagamento: evento.formas ?? [] };
      return entrarNoPagamento({ ...estado, dados: { ...estado.dados, cliente } });
    }

    case 'v2': {
      if (estado.etapa !== 'levantando_itens') return ficar(estado, { tipo: 'nenhuma' });
      if (evento.confirmados) {
        const comItens: EstadoDoOrcamento = {
          ...estado, etapa: 'definindo_pagamento', pergunta: null, desdeMensagem: mensagemId,
          dados: { ...sem(estado.dados, 'pagamento', 'pagamento_parcial'), v2_pedido_id: evento.pedidoId, itens: evento.confirmados },
        };
        if (estado.dados.cliente?.formas_pagamento === undefined) {
          return { estado: comItens, transicoes: ['T14'], acao: acaoPendenteDoPagamento(comItens), fala: { tipo: 'nenhuma' } };
        }
        return { ...entrarNoPagamento(comItens), transicoes: ['T14'] };
      }
      return {
        estado: { ...estado, dados: { ...estado.dados, v2_pedido_id: evento.pedidoId } },
        transicoes: ['T12'], acao: null, fala: { tipo: 'v2', texto: evento.texto },
      };
    }
  }
}

/**
 * O que o pagamento espera do ERP, quando espera: as formas (cadastro novo) ou
 * o preço com a condição escolhida.
 */
function acaoPendenteDoPagamento(estado: EstadoDoOrcamento): Acao | null {
  if (estado.etapa !== 'definindo_pagamento' || estado.pergunta !== null) return null;
  const d = estado.dados;
  if (!d.pagamento) return d.documento ? { tipo: 'buscar_formas', documento: d.documento.valor } : null;
  if (!d.cliente?.id || !d.itens?.length) return null;
  return {
    tipo: 'cotar', condicao: d.pagamento.codigo, clienteId: d.cliente.id,
    itens: d.itens.map(i => ({ codigo: i.codigo, quantidade: i.quantidade })),
  };
}

/** Escolhida e conferida (ou sem como conferir): para no vendedor. */
function pagamentoAceito(estado: EstadoDoOrcamento, extra: Partial<DadosDoOrcamento>): Passo {
  return {
    estado: {
      ...estado, etapa: 'aguardando_vendedor', pergunta: null, motivoPausa: 'pagamento_escolhido',
      dados: { ...sem(estado.dados, 'pagamento_fora'), ...extra },
    },
    transicoes: ['T16'], acao: null, fala: { tipo: 'fixa', chave: 'pagamento_escolhido' },
  };
}

/**
 * A lista confirmada pergunta a forma de pagamento. Sem nenhuma que o cliente
 * possa escolher (o ERP não mandou, ou só mandou o que não é por link), para
 * no vendedor como antes de 14/10.
 */
function entrarNoPagamento(estado: EstadoDoOrcamento): Passo {
  if (!opcoesDoOrcamento(estado.dados).length) {
    return {
      estado: { ...estado, etapa: 'aguardando_vendedor', pergunta: null, motivoPausa: 'lista_confirmada' },
      transicoes: [], acao: null, fala: { tipo: 'fixa', chave: 'lista_confirmada' },
    };
  }
  return {
    estado: { ...estado, etapa: 'definindo_pagamento', pergunta: 'pagamento' },
    transicoes: [], acao: null, fala: { tipo: 'fixa', chave: 'lista_confirmada_pedir_pagamento' },
  };
}

/** O campo que o ERP recusou ("endereco.cep") no nosso vocabulário. */
function campoDoErp(campo: string | null): keyof CamposDoCadastro | null {
  const nome = (campo ?? '').replace(/^endereco\./, '');
  return (['nome', 'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'inscricao_estadual'] as const)
    .find(c => c === nome) ?? null;
}

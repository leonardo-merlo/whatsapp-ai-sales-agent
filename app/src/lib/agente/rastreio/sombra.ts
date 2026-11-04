// A máquina de estados do orçamento, em SOMBRA.
//
// Fase 1 de `docs/superpowers/specs/2026-09-21-maquina-de-estados-orcamento-design.md`,
// no escopo que está no ar na Distribuidora Exemplo: até o cadastro. A cada execução do
// motor no roteiro de vendas, o código calcula em que etapa o orçamento
// estaria pela máquina e anota onde o motor atual fez algo que ela não teria
// deixado. **Ela não manda em nada**: o motor nunca lê o que sai daqui.
//
// Tudo neste arquivo é puro — etapa e eventos entram, etapa sai. Os eventos
// vêm de fontes que o código já tem (o documento na mensagem, as chamadas ao
// ERP desta execução). Nada é pedido ao modelo.

import { documentoCitado, documentosCitados } from '../documento-na-mensagem';

/** As etapas cobertas nesta fase. `cadastro_concluido` é final: é o destino
 *  de T3 e T8 enquanto a organização vai "só até o cadastro". */
export type EtapaSombra =
  | 'aguardando_documento'
  | 'consultando_cadastro'
  | 'coletando_cadastro'
  | 'criando_cadastro'
  | 'cadastro_concluido';

export const ETAPAS_FINAIS: readonly EtapaSombra[] = ['cadastro_concluido'];

/** O superestado "coletando" (refinamento R3 do spec): onde X1 vale. */
const ETAPAS_DE_COLETA: readonly EtapaSombra[] = [
  'aguardando_documento', 'consultando_cadastro', 'coletando_cadastro', 'criando_cadastro',
];

export type EventoSombra =
  | { tipo: 'pediu_orcamento' }
  | { tipo: 'documento'; documento: string }
  | { tipo: 'erp_consulta'; resultado: 'encontrado' | 'nao_encontrado' | 'falhou' }
  | { tipo: 'erp_cadastro'; resultado: 'criado' | 'ja_existe' | 'recusado' | 'falhou' };

/** Limite de segurança do ajuste A2: passar disso é um laço no desenho. */
export const MAX_TRANSICOES = 6;

export interface PassoDaSombra {
  depois: EtapaSombra | null;
  /** As etapas por onde o orçamento passou nesta execução, na ordem. */
  visitadas: EtapaSombra[];
  /** Os nomes das transições do spec (T1, T2, X1...), na ordem. */
  transicoes: string[];
}

/**
 * Aplica os eventos de uma execução, em ordem, até acabarem (A2: uma mensagem
 * pode atravessar várias etapas). Evento que não casa com a etapa é ignorado.
 */
export function proximaEtapaSombra(antes: EtapaSombra | null, eventos: EventoSombra[]): PassoDaSombra {
  let etapa = antes;
  const visitadas: EtapaSombra[] = [];
  const transicoes: string[] = [];
  const ir = (nome: string, para: EtapaSombra) => {
    transicoes.push(nome);
    visitadas.push(para);
    etapa = para;
  };
  const contadas = () => transicoes.filter(t => t !== 'X5_ignorado').length;

  for (const evento of eventos) {
    if (contadas() >= MAX_TRANSICOES) {
      transicoes.push('limite');
      break;
    }
    const agora: EtapaSombra | null = etapa;
    if (agora === null || ETAPAS_FINAIS.includes(agora)) {
      // Sem orçamento ativo: só o pedido abre um (T1).
      if (evento.tipo === 'pediu_orcamento') ir('T1', 'aguardando_documento');
      continue;
    }
    switch (evento.tipo) {
      case 'documento':
        if (agora === 'aguardando_documento') ir('T2', 'consultando_cadastro');
        else if (ETAPAS_DE_COLETA.includes(agora)) ir('X1', 'consultando_cadastro');
        break;
      case 'erp_consulta':
        if (agora !== 'consultando_cadastro') break;
        if (evento.resultado === 'encontrado') ir('T3', 'cadastro_concluido');
        else if (evento.resultado === 'nao_encontrado') ir('T4', 'coletando_cadastro');
        else transicoes.push('X5_ignorado');
        break;
      case 'erp_cadastro':
        if (agora !== 'coletando_cadastro' && agora !== 'criando_cadastro') break;
        if (agora === 'coletando_cadastro') ir('T6', 'criando_cadastro');
        if (evento.resultado === 'criado') ir('T8', 'cadastro_concluido');
        else if (evento.resultado === 'ja_existe') ir('T7', 'consultando_cadastro');
        else if (evento.resultado === 'recusado') ir('T9', 'coletando_cadastro');
        else transicoes.push('X5_ignorado');
        break;
      case 'pediu_orcamento':
        // Com um aberto, "quero um orçamento" é o MESMO orçamento: nada muda.
        break;
    }
  }
  return { depois: etapa, visitadas, transicoes };
}

/** Uma chamada ao ERP feita nesta execução, como o registro a viu. */
export interface ChamadaErpDaExecucao {
  operacao: string;
  ok: boolean;
  motivo: string | null;
  codigo: string | null;
  resposta: unknown;
}

/** A consulta achou alguém? O formato novo (`cliente_id`) e o antigo
 *  (`cliente`) valem, como em `consultar-cliente.ts`. */
function consultaEncontrou(resposta: unknown): boolean {
  const r = (resposta ?? {}) as { cliente?: unknown; cliente_id?: unknown; encontrado?: unknown };
  if (r.cliente) return true;
  return r.encontrado !== false && !!r.cliente_id;
}

/** Os eventos de uma execução, a partir do que o código já tem. */
export function eventosDaExecucao(entrada: {
  /** Havia orçamento em sombra ativo antes desta execução? */
  ativo: boolean;
  /** O motor ficou calado (a trava de `silencio.ts`)? Silêncio não abre orçamento. */
  silencio: boolean;
  falaDoCliente: string;
  /** O documento que o orçamento ativo já tem, só dígitos. */
  documentoGuardado: string | null;
  chamadasErp: ChamadaErpDaExecucao[];
}): EventoSombra[] {
  const eventos: EventoSombra[] = [];
  if (!entrada.ativo) {
    if (entrada.silencio) return eventos;
    eventos.push({ tipo: 'pediu_orcamento' });
  }
  const citado = documentoCitado(entrada.falaDoCliente);
  if (citado && citado !== entrada.documentoGuardado) eventos.push({ tipo: 'documento', documento: citado });

  for (const c of entrada.chamadasErp) {
    if (c.operacao === 'consultar_cliente') {
      if (c.ok) eventos.push({ tipo: 'erp_consulta', resultado: consultaEncontrou(c.resposta) ? 'encontrado' : 'nao_encontrado' });
      else if (c.motivo === 'nao_encontrado') eventos.push({ tipo: 'erp_consulta', resultado: 'nao_encontrado' });
      else eventos.push({ tipo: 'erp_consulta', resultado: 'falhou' });
    } else if (c.operacao === 'criar_cliente') {
      if (c.ok) eventos.push({ tipo: 'erp_cadastro', resultado: 'criado' });
      else if ((c.codigo ?? '').toLowerCase() === 'documento_ja_cadastrado') eventos.push({ tipo: 'erp_cadastro', resultado: 'ja_existe' });
      else if (c.motivo === 'recusado') eventos.push({ tipo: 'erp_cadastro', resultado: 'recusado' });
      else eventos.push({ tipo: 'erp_cadastro', resultado: 'falhou' });
    }
  }
  return eventos;
}

export type Divergencia =
  | 'respondeu_sem_consultar'
  | 'acao_fora_da_etapa'
  | 'cliente_sem_origem_erp'
  | 'execucao_repetida'
  | 'dois_orcamentos';

/** Razão social citada na resposta: o sinal de que ela "cita um cliente". */
const RAZAO_SOCIAL = /\b(LTDA|EIRELI|ME|EPP|S\/A|S\.A\.)\b/;

/** Quais ferramentas cada etapa deixa acontecer. Na máquina, quem chama é o
 *  código; o motor de hoje chama pelo modelo, e é isso que se compara. */
function ferramentaPermitida(nome: string, visitadas: readonly string[]): boolean {
  if (nome === 'consultar_cliente') return visitadas.includes('consultando_cadastro');
  if (nome === 'cadastrar_cliente') return visitadas.includes('coletando_cadastro') || visitadas.includes('criando_cadastro');
  return false;
}

/** Onde o motor atual fez o que a máquina não teria deixado. */
export function divergencias(entrada: {
  transicoes: readonly string[];
  /** As etapas desta execução, INCLUINDO a de antes (se havia). */
  visitadas: readonly string[];
  /** As ferramentas que o motor chamou, na ordem. */
  ferramentas: readonly string[];
  resposta: string;
  /** A sombra tem `cliente` com origem `erp` depois desta execução? */
  clienteDoErp: boolean;
  /** O nome do cliente guardado na conversa (`erp_cliente_nome`). */
  nomeGuardado: string | null;
  turnoAnteriorDaMesmaMensagem: boolean;
  falaDoCliente: string;
  havia_ativo: boolean;
}): Divergencia[] {
  const saida: Divergencia[] = [];
  const consultou = entrada.ferramentas.includes('consultar_cliente');
  const entrouPorDocumento = entrada.transicoes.includes('T2') || entrada.transicoes.includes('X1');
  if (entrouPorDocumento && !consultou) saida.push('respondeu_sem_consultar');

  if (entrada.ferramentas.some(f => !ferramentaPermitida(f, entrada.visitadas))) saida.push('acao_fora_da_etapa');

  const citaNome = RAZAO_SOCIAL.test(entrada.resposta)
    || (!!entrada.nomeGuardado && entrada.resposta.toLowerCase().includes(entrada.nomeGuardado.toLowerCase()));
  if (citaNome && !entrada.clienteDoErp) saida.push('cliente_sem_origem_erp');

  if (entrada.turnoAnteriorDaMesmaMensagem) saida.push('execucao_repetida');

  const doisDocumentos = documentosCitados(entrada.falaDoCliente).length >= 2;
  const outroOrcamento = entrada.havia_ativo && /\boutro or[cç]amento\b/i.test(entrada.falaDoCliente);
  if (doisDocumentos || outroOrcamento) saida.push('dois_orcamentos');

  return saida;
}

// Vários orçamentos abertos na mesma conversa (reunião de 27/10). Atrás da chave VARIOS_ORCAMENTOS=ligado; desligada,
// a máquina faz o que fazia: pedir outro orçamento encerra o anterior.
//
// **Orçamento em foco** é o único ativo da conversa (o banco só deixa um: índice `um_ativo`). É nele que a lista, a
// cidade e o pagamento acontecem. Os outros abertos ficam "em espera": na tabela, `encerrado` com motivo `em_espera`,
// e o lugar de onde saíram guardado em `dados.em_espera`, para voltar igual. Aberto é o que tem número e está na
// validade (5 dias), mais o em foco, mesmo sem número.
//
// Quando pergunta "qual orçamento?" (decidido com o Leonardo em 27/10, para não perguntar sempre): ao pedir para trocar
// de orçamento com dois ou mais abertos; ao fechar com dois ou mais abertos; ao tirar ou mudar item de uma lista que já
// foi para o vendedor, com dois ou mais abertos e sem ter escolhido; e "coloco no nº N ou abro um novo?" quando chega
// produto para uma lista que já foi para o vendedor. Escolhido (pelo número ou pela resposta), ele não pergunta de
// novo. Os textos são fixos: a IA não escolhe orçamento nem inventa número.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import { diaMesEmSP } from '../../fuso';
import { simClaro } from '../../v2/sim-claro';
import { fecharFicha, fichaDaLinha, gravarFicha, numerarFicha, type Ficha } from './ficha';
import { QUER_FECHAR, type MensagemDoCliente } from './transicoes';
import type { DadosDoOrcamento, EstadoDoOrcamento, Leitura } from './tipos';

type Client = SupabaseClient<Database>;

export function variosOrcamentosLigado(valor: string | undefined = process.env.VARIOS_ORCAMENTOS): boolean {
  return valor?.trim() === 'ligado';
}

// "aorçamento", "orçament" (teste de 29/10: "quero voltar pro aorçamento anterior" virou "recomeço do zero?").
const normal = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[!.,;?]+/g, ' ').replace(/\s+/g, ' ').trim()
  .replace(/\b[a-z]{0,2}orcament(os?)?\b/g, (_, fim: string | undefined) => (fim === 'os' ? 'orcamentos' : 'orcamento'));

// ── o que o cliente pede ──

const PEDE_LISTA = /\borcamentos\b.*\b(?:abert\w*|tenho|ativos?|pendentes?|andamento)\b|\b(?:quais|meus|ver|veja|lista\w*|mostr\w*)\b(?: \w+){0,3} orcamentos\b|\btenho\b(?: \w+){0,3} orcamentos?\b(?: \w+){0,2} abert/;
const PEDE_TROCAR = /\b(?:mud\w*|troc\w*) de orcamento\b|\b(?:falar|mexer|ver|ir|voltar|olhar|editar)\b(?: \w+){0,3} (?:outro|outra|o outro|aquele|anterior|primeiro|ultimo|segundo) orcamento\b|\bvolt\w* (?:pro|para o|ao|no) orcamento\b/;
const NUMERO_CITADO = /\borc(?:amento)?\.? ?(?:n[o°º]?\.? ?|numero ?|de numero ?)?(\d{1,6})\b|\bn[°º]\.? ?(\d{1,6})\b/;
const SO_O_NUMERO = /^(?:(?:e |eh |quero |pode ser |seria )?(?:o |no |do |a |pro )?(?:orc(?:amento)?\.? ?)?(?:n[o°º]?\.? ?|numero ?)?)(\d{1,6})(?: mesmo| esse| por favor)?$/;
const QUER_NOVO = /\b(?:novo|nova|outro|outra)\b/;
const COLOCA_NESSE = /\b(?:nesse|neste|nele|esse|este|coloca\w*|pode colocar|continu\w*|mesmo)\b/;
const MEXE_NA_LISTA = /\b(?:tira\w*|remov\w*|exclu\w*|mud\w*|troc\w*|alter\w*|aument\w*|diminu\w*|na verdade|corrig\w*)\b/;
const PEDE_COMPRA = /\b(?:quero|vou|pode|posso)\b(?: \w+){0,2} (?:comprar|fechar|finalizar|fazer o pedido)\b/;
// O que sobra de "quero mudar para o orçamento 10" sem o número: só o jeito de pedir a troca (teste de 29/10).
const SO_TROCA = /^(?:(?:quero|queria|vou|vamos|agora|entao|mud\w*|troc\w*|ir|vai|volt\w*|pass\w*|para|pra|pro|na|abr\w*|edit\w*|olhar|ver|por favor)\s*)*$/;
// "no orçamento 10," no começo da frase: sai antes de a lista ler o resto ("no orçamento 10, tira a chapa").
const CITACAO_NO_TEXTO = /(?:\b(?:no|do|o|ao|pro|para o|pra o|em)\s+)?\ba?or[cç](?:ament[oa]?s?)?\.?\s*(?:n[º°o]?\.?\s*|n[uú]mero\s*)?\d{1,6}\b\s*[,:;-]?\s*/i;

export const pedeListaDeOrcamentos = (texto: string): boolean => PEDE_LISTA.test(normal(texto));
export const pedeTrocarDeOrcamento = (texto: string): boolean => PEDE_TROCAR.test(normal(texto));
export const pedeFechar = (texto: string): boolean => { const t = normal(texto); return QUER_FECHAR.test(t) || PEDE_COMPRA.test(t); };

/** O número de orçamento citado ("orçamento 12", "nº 12"); com `soNumero`, também "12" ou "o 12" sozinho (resposta a "qual?"). */
export function numeroCitado(texto: string, soNumero = false): number | null {
  const t = normal(texto);
  const m = t.match(NUMERO_CITADO);
  if (m) return Number(m[1] ?? m[2]);
  if (!soNumero) return null;
  const s = t.match(SO_O_NUMERO);
  return s ? Number(s[1]) : null;
}

// ── os textos (fixos) ──

export const PERGUNTA_QUAL_VER = 'Qual orçamento você quer ver? Me diga o número.';
export const PERGUNTA_QUAL_FECHAR = 'Qual orçamento você quer fechar? Me diga o número.';
export const PERGUNTA_QUAL_MUDAR = 'Em qual orçamento? Me diga o número, ou responda NOVO para abrir outro.';
const MARCAS_DE_QUAL = [PERGUNTA_QUAL_VER, PERGUNTA_QUAL_FECHAR, PERGUNTA_QUAL_MUDAR, 'ou abro um novo?'];

export interface OrcamentoAberto {
  ficha: Ficha;
  numero: number | null;
  criadoEm: string;
  emFoco: boolean;
  itens: number;
}

/** A lista já foi confirmada (está com o vendedor, ou estava quando saiu de foco): só aí a validade vale (Leonardo, 29/10). */
function aceito(f: Ficha): boolean {
  const e = f.estado;
  return e.etapa === 'aguardando_vendedor' || (e.etapa === 'encerrado' && (e.dados.em_espera?.etapa ?? 'aguardando_vendedor') === 'aguardando_vendedor');
}

/** "*nº 12* · 25/10 · vale até 30/10 · 3 itens". O valor fica de fora: o preço ainda não vai ao cliente (sai pelo vendedor). */
export function linhaDoOrcamento(o: OrcamentoAberto): string {
  const nome = o.numero !== null ? `*nº ${o.numero}*` : '*o atual*';
  const partes = [nome, diaMesEmSP(o.criadoEm)];
  if (o.ficha.expiraEm && aceito(o.ficha)) partes.push(`vale até ${diaMesEmSP(o.ficha.expiraEm)}`);
  partes.push(o.itens ? `${o.itens} ${o.itens === 1 ? 'item' : 'itens'}` : 'lista em montagem');
  if (o.emFoco) partes.push('em andamento');
  return partes.join(' · ');
}

export function textoDaLista(abertos: OrcamentoAberto[], pergunta: string | null): string {
  if (!abertos.length) return 'Você não tem orçamento em aberto. Se quiser, me manda o que precisa que eu monto um.';
  const titulo = abertos.length === 1 ? 'Você tem 1 orçamento em aberto:' : `Você tem ${abertos.length} orçamentos em aberto:`;
  return [titulo, ...abertos.map(o => `- ${linhaDoOrcamento(o)}`), pergunta ?? 'Para mexer em um deles, me diga o número.'].join('\n');
}

function textoDoEscolhido(o: OrcamentoAberto): string {
  const itens = o.ficha.estado.dados.itens ?? [];
  const nome = o.numero !== null ? `orçamento nº ${o.numero}` : 'orçamento atual';
  const validade = o.ficha.expiraEm && aceito(o.ficha) ? `, vale até ${diaMesEmSP(o.ficha.expiraEm)}` : '';
  return [
    `Certo, agora estamos no ${nome}${validade}.`,
    ...(itens.length ? itens.map(i => `- ${i.quantidade ? `${i.quantidade} × ` : ''}${i.descricao}`) : []),
    'O que você quer fazer nele?',
  ].join('\n');
}

// ── banco ──

const ABERTO_QUE_ENCERROU = (d: DadosDoOrcamento, motivo: string | null): boolean =>
  motivo === 'em_espera' || (!!d.itens?.length && motivo !== 'cancelado' && motivo !== 'recomecado');

/** Os orçamentos abertos da conversa, o em foco primeiro e depois pelo número. */
export async function listarAbertos(supabase: Client, conversationId: string, foco: Ficha | null, agora = Date.now()): Promise<OrcamentoAberto[]> {
  const { data, error } = await supabase.from('orcamentos_em_andamento').select('*')
    .eq('conversation_id', conversationId).eq('modo', 'valendo');
  if (error) throw new Error(`Máquina: orçamentos abertos: ${error.message}`);
  const abertos: OrcamentoAberto[] = [];
  for (const linha of data ?? []) {
    const ficha = linha.id === foco?.id ? foco : fichaDaLinha(linha);
    const naValidade = ficha.numero !== null && !!ficha.expiraEm && agora <= Date.parse(ficha.expiraEm);
    const emFoco = linha.id === foco?.id;
    const etapa = ficha.estado.etapa;
    const aberto = emFoco || (naValidade && (etapa === 'aguardando_vendedor' || (etapa === 'encerrado' && ABERTO_QUE_ENCERROU(ficha.estado.dados, ficha.estado.motivoPausa ?? null))));
    if (aberto) abertos.push({ ficha, numero: ficha.numero, criadoEm: linha.created_at, emFoco, itens: ficha.estado.dados.itens?.length ?? 0 });
  }
  return abertos.sort((a, b) => (a.emFoco === b.emFoco ? (a.numero ?? 0) - (b.numero ?? 0) : a.emFoco ? -1 : 1));
}

function semChaves(d: DadosDoOrcamento, ...chaves: (keyof DadosDoOrcamento)[]): DadosDoOrcamento {
  const copia = { ...d };
  for (const c of chaves) delete copia[c];
  return copia;
}

/**
 * Tira o orçamento de foco sem fechar. Com a lista em montagem ele ganha número (senão não teria como ser achado);
 * antes da lista (CPF, cadastro, cidade) não há o que guardar e ele é encerrado como antes.
 */
export async function estacionar(supabase: Client, ficha: Ficha): Promise<void> {
  const e = ficha.estado;
  let atual = ficha;
  if (atual.numero === null) {
    if (e.etapa !== 'levantando_itens' && e.etapa !== 'definindo_pagamento') {
      await fecharFicha(supabase, ficha, 'encerrado');
      return;
    }
    atual = await numerarFicha(supabase, ficha);
  }
  await gravarFicha(supabase, atual, {
    ...e, etapa: 'encerrado', motivoPausa: 'em_espera',
    dados: { ...semChaves(e.dados, 'escolha_pendente', 'foco_escolhido'), em_espera: { etapa: e.etapa, pergunta: e.pergunta, motivo: e.motivoPausa ?? null } },
  });
}

/** Põe em foco um orçamento em espera (o em foco de antes tem de ter sido estacionado). */
async function retomar(supabase: Client, ficha: Ficha): Promise<Ficha> {
  const e = ficha.estado;
  const volta = e.dados.em_espera ?? { etapa: 'aguardando_vendedor' as const, pergunta: null, motivo: e.motivoPausa };
  return gravarFicha(supabase, ficha, {
    ...e, etapa: volta.etapa, pergunta: volta.pergunta, motivoPausa: volta.motivo,
    dados: { ...semChaves(e.dados, 'em_espera'), foco_escolhido: true },
  });
}

/** A lista que já foi para o vendedor volta a ser montada (como o T14b, da forma de pagamento): pede o "sim" de novo. */
// A mensagem que reabre ainda vai ser lida pela lista: `desdeMensagem` fica o de antes, senão a máquina a trataria como
// já consumida (G-fala) e só repetiria a pergunta.
function reabrirLista(estado: EstadoDoOrcamento): EstadoDoOrcamento | null {
  if (estado.etapa !== 'aguardando_vendedor' || !estado.dados.v2_pedido_id) return null;
  return {
    ...estado, etapa: 'levantando_itens', pergunta: 'produtos', motivoPausa: null,
    dados: semChaves(estado.dados, 'pagamento', 'pagamento_parcial', 'pagamentos_recusados', 'total_referencia', 'pagamento_fora', 'cotacao', 'cotacao_falhou', 'escolha_pendente'),
  };
}

/** Lida com o orçamento já fechado, a frase vinha como "pedir orçamento"; na lista reaberta ela é sobre os produtos. */
const paraALista = (l: Leitura): Leitura => ({ ...l, intencao: 'produtos' });

// ── a decisão ──

export type DecisaoDosOrcamentos =
  /** Responde com um texto fixo e para aqui. */
  | { tipo: 'responder'; texto: string }
  /** Segue a máquina normal, com este orçamento em foco e esta mensagem; `cabecalho` vai antes da resposta (trocou de orçamento). */
  | { tipo: 'seguir'; ficha: Ficha | null; mensagem: MensagemDoCliente; cabecalho?: string }
  /** O em foco foi estacionado: a mensagem abre um orçamento novo. */
  | { tipo: 'abrir_novo'; mensagem: MensagemDoCliente };

async function trocarPara(supabase: Client, foco: Ficha | null, alvo: OrcamentoAberto): Promise<Ficha> {
  if (alvo.emFoco) {
    if (alvo.ficha.estado.dados.foco_escolhido) return alvo.ficha;
    return gravarFicha(supabase, alvo.ficha, { ...alvo.ficha.estado, dados: { ...semChaves(alvo.ficha.estado.dados, 'escolha_pendente'), foco_escolhido: true } });
  }
  if (foco) await estacionar(supabase, foco);
  return retomar(supabase, alvo.ficha);
}

/** Teste de 29/10: ao entrar num orçamento a resposta ia direto para o "Anotei"; o número vem antes, para o cliente ver a troca. */
const cabecalhoDo = (o: OrcamentoAberto): string => (o.numero !== null ? `*Orçamento nº ${o.numero}*` : '*Orçamento atual*');

/** O texto sem "no orçamento 10,": o resto é o que a lista lê. Sem resto, fica como estava. */
export function semCitacao(texto: string): string {
  const resto = texto.replace(CITACAO_NO_TEXTO, ' ').replace(/\s+/g, ' ').trim();
  return resto || texto;
}

async function aplicarEscolha(
  supabase: Client, foco: Ficha | null, alvo: OrcamentoAberto, pendente: DadosDoOrcamento['escolha_pendente'], m: MensagemDoCliente,
): Promise<DecisaoDosOrcamentos> {
  let ficha = await trocarPara(supabase, foco, alvo);
  if (pendente?.acao === 'mudar_lista') {
    const reaberto = reabrirLista(ficha.estado);
    if (reaberto) ficha = await gravarFicha(supabase, ficha, reaberto);
    return {
      tipo: 'seguir', ficha, cabecalho: cabecalhoDo(alvo),
      mensagem: { ...m, texto: semCitacao(pendente.texto), leitura: paraALista(pendente.leitura), documento: null, documentoInvalido: false },
    };
  }
  const escolhido = { ...alvo, ficha, emFoco: true };
  if (pendente?.acao === 'fechar') {
    const nome = escolhido.numero !== null ? `orçamento nº ${escolhido.numero}` : 'orçamento atual';
    return { tipo: 'responder', texto: `Certo, o ${nome}. O vendedor segue com ele e te manda o pedido.` };
  }
  return { tipo: 'responder', texto: textoDoEscolhido(escolhido) };
}

async function perguntar(supabase: Client, foco: Ficha | null, pendente: NonNullable<DadosDoOrcamento['escolha_pendente']>, texto: string): Promise<DecisaoDosOrcamentos> {
  if (foco) await gravarFicha(supabase, foco, { ...foco.estado, dados: { ...foco.estado.dados, escolha_pendente: pendente } });
  return { tipo: 'responder', texto };
}

/**
 * Antes da máquina normal: a mensagem fala de outro orçamento, pede a lista dos abertos, responde a "qual orçamento?",
 * ou mexe numa lista que já foi para o vendedor? Null: nada disso, a máquina segue como sempre.
 */
export async function decidirOrcamento(
  supabase: Client, conversationId: string, foco: Ficha | null, m: MensagemDoCliente, ultimaFalaDaCasa: string | null, agora = Date.now(),
): Promise<DecisaoDosOrcamentos | null> {
  const texto = m.texto;
  const respondendoQual = !!ultimaFalaDaCasa && MARCAS_DE_QUAL.some(marca => ultimaFalaDaCasa.includes(marca));
  const pendente = foco?.estado.dados.escolha_pendente;
  const t = normal(texto);

  // 1. Resposta a "qual orçamento?" / "coloco no nº N ou abro um novo?".
  if (respondendoQual) {
    const abertos = await listarAbertos(supabase, conversationId, foco, agora);
    const n = numeroCitado(texto, true);
    const alvo = n !== null ? abertos.find(o => o.numero === n) : undefined;
    if (alvo) return aplicarEscolha(supabase, foco, alvo, pendente, m);
    const perguntouNovo = ultimaFalaDaCasa!.includes('abro um novo') || ultimaFalaDaCasa!.includes('responda NOVO');
    if (perguntouNovo && QUER_NOVO.test(t) && !COLOCA_NESSE.test(t)) {
      if (foco) await estacionar(supabase, foco);
      const levar = pendente?.acao === 'mudar_lista' ? pendente : null;
      return { tipo: 'abrir_novo', mensagem: { ...m, ...(levar ? { texto: levar.texto } : {}), leitura: { ...(levar?.leitura ?? m.leitura), intencao: 'pedir_orcamento' } } };
    }
    const noAtual = ultimaFalaDaCasa!.includes('ou abro um novo?') && (simClaro(texto) || COLOCA_NESSE.test(t));
    const atual = abertos.find(o => o.emFoco);
    if (noAtual && atual) return aplicarEscolha(supabase, foco, atual, pendente, m);
    if (n !== null) return { tipo: 'responder', texto: textoDaLista(abertos, `Não achei o orçamento nº ${n} em aberto. ${PERGUNTA_QUAL_VER}`) };
    // Outra resposta: a pergunta caiu, a mensagem segue normal.
  }

  // 2. "Quais orçamentos eu tenho em aberto?"
  if (pedeListaDeOrcamentos(texto)) {
    return { tipo: 'responder', texto: textoDaLista(await listarAbertos(supabase, conversationId, foco, agora), null) };
  }

  // 3. Citou o número de um orçamento: ele entra em foco e a mensagem segue nele.
  const citado = numeroCitado(texto);
  const sobra = citado === null ? '' : t.replace(NUMERO_CITADO, ' ').replace(/\b(?:no|do|o|ao|pro|para o|quero|ver|falar|mexer|em|de)\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (citado !== null && citado !== foco?.numero) {
    const abertos = await listarAbertos(supabase, conversationId, foco, agora);
    const alvo = abertos.find(o => o.numero === citado);
    if (!alvo) return { tipo: 'responder', texto: textoDaLista(abertos, `Não achei o orçamento nº ${citado} em aberto. Para mexer em um deles, me diga o número.`) };
    // "quero mudar para o orçamento 10" é só trocar: o "mudar" não é sobre a lista (teste de 29/10).
    if (!sobra || SO_TROCA.test(sobra)) return aplicarEscolha(supabase, foco, alvo, undefined, m);
    if (MEXE_NA_LISTA.test(t) || m.leitura.produtosCitados) return aplicarEscolha(supabase, foco, alvo, { acao: 'mudar_lista', texto, leitura: m.leitura }, m);
    if (pedeFechar(texto)) return aplicarEscolha(supabase, foco, alvo, { acao: 'fechar', texto, leitura: m.leitura }, m);
    // Outra coisa sobre ele ("até quando vale o orçamento 12?"): entra em foco e a máquina responde como sempre.
    return { tipo: 'seguir', ficha: await trocarPara(supabase, foco, alvo), mensagem: m, cabecalho: cabecalhoDo(alvo) };
  }
  // Citou o que já está em foco: "no orçamento 10, tira a chapa" é só "tira a chapa" (teste de 29/10).
  // Citar o número é escolher: depois disso mexer na lista não pergunta "em qual?".
  if (citado !== null && foco) {
    const escolhido = foco.estado.dados.foco_escolhido ? foco
      : await gravarFicha(supabase, foco, { ...foco.estado, dados: { ...semChaves(foco.estado.dados, 'escolha_pendente'), foco_escolhido: true } });
    if (!sobra || SO_TROCA.test(sobra)) return { tipo: 'responder', texto: `Já estamos no orçamento nº ${citado}. O que você quer fazer nele?` };
    const semNumero = { ...m, texto: semCitacao(texto) };
    if (numeroCitado(semNumero.texto) === null) {
      return await decidirOrcamento(supabase, conversationId, escolhido, semNumero, ultimaFalaDaCasa, agora) ?? { tipo: 'seguir', ficha: escolhido, mensagem: semNumero };
    }
  }

  // 4. "Quero mudar de orçamento" / "falar de outro orçamento".
  if (pedeTrocarDeOrcamento(texto)) {
    const abertos = await listarAbertos(supabase, conversationId, foco, agora);
    if (abertos.length >= 2) return perguntar(supabase, foco, { acao: 'ver', texto, leitura: m.leitura }, textoDaLista(abertos, PERGUNTA_QUAL_VER));
    if (abertos.length === 1 && !abertos[0].emFoco) return aplicarEscolha(supabase, foco, abertos[0], undefined, m);
    return { tipo: 'responder', texto: textoDaLista(abertos, abertos.length ? 'É só esse por enquanto.' : null) };
  }

  // 5. O orçamento em foco já foi para o vendedor (lista confirmada) e a mensagem mexe em lista ou quer fechar.
  if (!foco || foco.estado.etapa !== 'aguardando_vendedor' || m.documento) return null;
  const mexe = m.leitura.produtosCitados || (MEXE_NA_LISTA.test(t) && /\d|[a-z]{4,}/.test(t) && !pedeFechar(texto));
  if (pedeFechar(texto) && !m.leitura.produtosCitados) {
    const abertos = await listarAbertos(supabase, conversationId, foco, agora);
    if (abertos.length < 2) return null;
    return perguntar(supabase, foco, { acao: 'fechar', texto, leitura: m.leitura }, textoDaLista(abertos, PERGUNTA_QUAL_FECHAR));
  }
  if (!mexe) return null;
  const nome = foco.numero !== null ? `orçamento nº ${foco.numero}` : 'orçamento atual';
  if (foco.estado.dados.foco_escolhido) {
    const reaberto = reabrirLista(foco.estado);
    if (reaberto) return { tipo: 'seguir', ficha: await gravarFicha(supabase, foco, reaberto), mensagem: { ...m, leitura: paraALista(m.leitura) } };
    return null;
  }
  const abertos = await listarAbertos(supabase, conversationId, foco, agora);
  const ehEdicao = MEXE_NA_LISTA.test(t);
  if (ehEdicao && abertos.length >= 2) {
    return perguntar(supabase, foco, { acao: 'mudar_lista', texto, leitura: m.leitura }, textoDaLista(abertos, PERGUNTA_QUAL_MUDAR));
  }
  return perguntar(supabase, foco, { acao: 'mudar_lista', texto, leitura: m.leitura }, `Coloco no ${nome} ou abro um novo?`);
}

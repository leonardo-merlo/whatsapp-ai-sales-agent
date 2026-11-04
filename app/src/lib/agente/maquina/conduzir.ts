// O condutor: a cada mensagem do cliente, aplica as transições até o
// orçamento parar numa etapa de espera (ajuste A2), e devolve o texto da
// etapa onde parou.
//
//   ler a ficha → a IA lê a mensagem → passo → (ação: ERP, cidade, v2) → passo …
//
// Cada transição é gravada com a versão; se outra execução andou antes, esta
// desiste inteira (regra 3). As ações que dependem uma da outra rodam em
// sequência, nunca em paralelo (regra 2). Quem chama o ERP é o código: a IA
// não tem ferramenta nenhuma aqui.
//
// O que fala com o mundo de fora (ERP, v2, IA, regiões) entra por
// `Executores`, para o laço ser testado sem nada disso.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import { documentoCitado } from '../documento-na-mensagem';
import { midiaAindaSendoLida, midiaQueNaoAbriu } from '../midia-do-cliente';
import { marcar, type Rastreio } from '../rastreio/rastreio';
import { cidadesParecidas, estadosAtendidos, normalizarCidade, regioesDaCidade, type RegiaoDeEntrega } from './cidades';
import { cadastroDeHoje, criarFicha, ErroDeEtapa, ErroDeVersao, fecharFicha, gravarFicha, lerFicha, numerarFicha, PRAZO_SEM_RESPOSTA_MS, venceu, type Ficha, type Onde } from './ficha';
import { NAO_ABRE_ESSA_MENSAGEM, NAO_OUVI_O_AUDIO, PASSAR_AO_ATENDENTE, textoDaEtapa, textoDeNaoEntendi } from './textos';
import { abreOrcamento, passo, perguntaAtual, type Acao, type Evento, type Fala, type MensagemDoCliente, type Passo } from './transicoes';
import { ETAPAS_DE_COLETA, ETAPAS_FINAIS, LEITURA_VAZIA, type CamposDoCadastro, type DadosDoOrcamento, type CotacaoDoOrcamento, type ClienteDoOrcamento, type EstadoDoOrcamento, type Leitura } from './tipos';
import type { ItemDoSnapshot } from '../../v2/armazem';
import { operacoesLigadas } from '../../v2/pipeline';
import { decidirOrcamento, estacionar, variosOrcamentosLigado } from './varios-orcamentos';

type Client = SupabaseClient<Database>;

/** Limite de segurança do ajuste A2: passar disso é um laço no desenho. */
export const MAX_TRANSICOES = 6;

export interface Executores {
  interpretar(estado: EstadoDoOrcamento | null, perguntaFeita: string | null, fala: string): Promise<Leitura>;
  consultarCliente(documento: string): Promise<
    { resultado: 'encontrado'; cliente: ClienteDoOrcamento } | { resultado: 'nao_encontrado' | 'falhou' }>;
  cadastrarCliente(documento: string, campos: CamposDoCadastro, chave: string): Promise<
    | { resultado: 'criado'; cliente: ClienteDoOrcamento }
    | { resultado: 'ja_existe' | 'falhou' }
    | { resultado: 'recusado'; campo: string | null }>;
  regioes(): Promise<RegiaoDeEntrega[]>;
  v2(pedidoId: string | null, texto: string): Promise<{ pedidoId: string; texto: string; confirmados: ItemDoSnapshot[] | null }>;
  listaDaV2(pedidoId: string): Promise<string>;
  /** A IA responde o outro assunto, sem perguntar nada (a pergunta da etapa vem do código). */
  responderLivre(comPerguntaDepois: boolean): Promise<string>;
  /** O preço da lista com a condição escolhida (`precos`). */
  cotar(condicao: string, clienteId: string, itens: { codigo: string; quantidade: string | null }[]): Promise<
    { resultado: 'ok'; cotacao: CotacaoDoOrcamento } | { resultado: 'falhou'; codigo: string; mensagem: string }>;
  /** Há pedido da v2 aberto de ANTES da máquina (conversa no meio quando a chave ligou)? */
  pedidoV2DeAntes(): Promise<boolean>;
  /** Fecha o pedido da v2 do orçamento cancelado (válvula de escape, 22/10). */
  fecharPedidoV2(pedidoId: string): Promise<void>;
}

export interface MensagemDaVez {
  mensagemId: string;
  /** As falas do cliente desde a última resposta da casa. */
  texto: string;
  /** A última fala da casa, se houver: a pergunta que o cliente está respondendo. */
  ultimaFalaDaCasa: string | null;
}

export type ResultadoDaConducao =
  /**
   * `transferir`: 3ª vez sem entender; quem chama passa a conversa para uma pessoa.
   * `daIA`: o trecho que a IA escreveu (resposta a outro assunto), que vale mesmo se chegar fala nova.
   */
  | { tipo: 'respondeu'; resposta: string; etapa: string | null; transicoes: string[]; transferir?: true; daIA?: string }
  | { tipo: 'nao_responder'; motivo: string }
  /** Não é com a máquina: o caminho de antes cuida (conversa que já estava na v2). */
  | { tipo: 'caminho_antigo' };

/**
 * Tentativa de CPF/CNPJ que não é um: um número de 9 a 15 dígitos (com ou sem
 * ponto, barra e traço) ou, separado por espaços, um de 11 ou 14. Teste de
 * 20/10 (T5): "1122333000181", um dígito a menos, só repetiu o pedido do
 * documento, sem aviso. Espaço só conta no tamanho exato, porque uma lista
 * de quantidades ("2 3 4 5 6 7 8 9 10") também vira uma fileira de dígitos.
 */
export function temDocumentoInvalido(texto: string): boolean {
  if (documentoCitado(texto)) return false;
  const digitos = (s: string): string => s.replace(/\D/g, '');
  const juntos = (texto.match(/\d[\d.\-/]*\d/g) ?? []).map(digitos).some(d => d.length >= 9 && d.length <= 15);
  const comEspacos = (texto.match(/\d[\d.\-/\s]{9,}\d/g) ?? []).map(digitos).some(d => d.length === 11 || d.length === 14);
  return juntos || comEspacos;
}

async function executar(acao: Acao, ex: Executores, ficha: Ficha | null): Promise<Evento> {
  switch (acao.tipo) {
    case 'consultar_cliente': {
      const r = await ex.consultarCliente(acao.documento);
      return r.resultado === 'encontrado'
        ? { tipo: 'erp_consulta', resultado: 'encontrado', cliente: r.cliente }
        : { tipo: 'erp_consulta', resultado: r.resultado };
    }
    case 'cadastrar_cliente': {
      // A chave de idempotência vem do orçamento, não da mensagem: repetir o
      // cadastro deste orçamento, com os mesmos dados, nunca cria dois.
      const r = await ex.cadastrarCliente(acao.documento, acao.campos, `orcamento:${ficha?.id ?? 'novo'}`);
      if (r.resultado === 'criado') return { tipo: 'erp_cadastro', resultado: 'criado', cliente: r.cliente };
      if (r.resultado === 'recusado') return { tipo: 'erp_cadastro', resultado: 'recusado', campo: r.campo };
      return { tipo: 'erp_cadastro', resultado: r.resultado };
    }
    case 'conferir_cidade': {
      const lista = await ex.regioes();
      const regioes = regioesDaCidade(lista, acao.cidade, acao.uf);
      return { tipo: 'cidade_conferida', cidade: acao.cidade, uf: acao.uf, regioes, parecidas: regioes.length ? [] : cidadesParecidas(lista, acao.cidade) };
    }
    case 'v2': {
      const r = await ex.v2(acao.pedidoId, acao.texto);
      return { tipo: 'v2', pedidoId: r.pedidoId, texto: r.texto, confirmados: r.confirmados };
    }
    case 'v2_lista':
      return { tipo: 'v2', pedidoId: acao.pedidoId, texto: await ex.listaDaV2(acao.pedidoId), confirmados: null };
    case 'cotar': {
      const r = await ex.cotar(acao.condicao, acao.clienteId, acao.itens);
      return r.resultado === 'ok'
        ? { tipo: 'cotacao', resultado: 'ok', cotacao: r.cotacao }
        : { tipo: 'cotacao', resultado: 'falhou', codigo: r.codigo, mensagem: r.mensagem };
    }
    case 'fechar_v2':
      await ex.fecharPedidoV2(acao.pedidoId);
      return { tipo: 'v2_fechado', recomecar: acao.recomecar };
    case 'buscar_formas': {
      const r = await ex.consultarCliente(acao.documento);
      return { tipo: 'formas_de_pagamento', formas: r.resultado === 'encontrado' ? (r.cliente.formas_pagamento ?? []) : null };
    }
  }
}

/**
 * A cidade só vale se o CLIENTE a escreveu. No ensaio de 07/10 a IA leu
 * "Jundiai" da pergunta ("Achei aqui: ..., de Jundiai/MG. É esse cadastro
 * mesmo?") e o "sim" pulou a pergunta da cidade. A regra é do código, não do prompt.
 */
export function cidadeEscritaPeloCliente(leitura: Leitura, texto: string): Leitura {
  if (!leitura.cidade) return leitura;
  const escrita = ` ${normalizarCidade(texto)} `.includes(` ${normalizarCidade(leitura.cidade.cidade)} `);
  return escrita ? leitura : { ...leitura, cidade: null };
}

/**
 * A IA só lê a mensagem quando a leitura muda alguma coisa. Nos itens ela lê
 * sempre: é a leitura que separa outro assunto da resposta ao item (teste de 08/10).
 */
function precisaLer(estado: EstadoDoOrcamento | null): boolean {
  if (!estado) return true;
  return !(estado.etapa === 'consultando_cadastro' || estado.etapa === 'criando_cadastro');
}

/**
 * Tira as frases com pergunta da resposta livre. A pergunta da etapa é do
 * código; no ensaio de 07/10 a IA pediu o CPF mesmo instruída a não perguntar,
 * e o pedido saiu duas vezes.
 */
export function semPerguntas(texto: string): string {
  return (texto.match(/[^.!?\n]+[.!?]*\s*/g) ?? [])
    .filter(frase => !frase.trim().endsWith('?'))
    .join('').trim();
}

/** `daIA` recebe o trecho escrito pela IA, quando há: ele não fica velho com a mensagem seguinte. */
async function textoDaFala(fala: Fala, estado: EstadoDoOrcamento | null, ex: Executores, ficha: Ficha | null, daIA?: string[]): Promise<string> {
  const orcamento = ficha?.numero != null && ficha.expiraEm ? { numero: ficha.numero, expiraEm: ficha.expiraEm } : null;
  const ctx = { estados: estadosAtendidos(await ex.regioes()), orcamento };
  switch (fala.tipo) {
    case 'fixa': return textoDaEtapa(fala.chave, estado, ctx);
    case 'v2': return fala.texto;
    case 'livre': {
      const bruta = (await ex.responderLivre(!!fala.depois)).trim();
      const livre = fala.depois ? semPerguntas(bruta) : bruta;
      if (livre) daIA?.push(livre);
      const depois = fala.depois ? textoDaEtapa(fala.depois, estado, ctx) : '';
      return [livre, depois].filter(Boolean).join('\n\n');
    }
    case 'livre_e_lista': {
      const livre = semPerguntas((await ex.responderLivre(true)).trim());
      if (livre) daIA?.push(livre);
      return [livre, await ex.listaDaV2(fala.pedidoId)].filter(Boolean).join('\n\n');
    }
    case 'fixa_e_lista': return [textoDaEtapa(fala.chave, estado, ctx), await ex.listaDaV2(fala.pedidoId)].join('\n\n');
    case 'nenhuma': {
      const pergunta = estado ? perguntaAtual(estado) : null;
      return pergunta ? textoDaEtapa(pergunta, estado, ctx) : '';
    }
  }
}

// ── válvula de escape (22/10) ──
//
// A mesma pergunta repetida sem fim. Cada mensagem que não faz a pergunta
// andar conta em `dados.sem_entender`: na 1ª vez sai o de sempre, na 2ª a
// frase fixa com as opções da etapa, na 3ª a conversa passa para uma pessoa.

export type MotivoDoNaoEntendi = 'repetiu_pergunta' | 'outro_assunto' | 'lista_nao_entendida' | 'audio' | 'mensagem_que_nao_abre';

/** A v2 não entendeu a edição, nem achou item, nem ficou claro o "sim". */
const LISTA_NAO_ENTENDIDA = /Não sei qual (?:tirar|trocar|mudar)|Não entendi o que mudar\. Diga o item como está na lista|Não encontrei itens de pedido|Fecho a lista assim, sem mudar nada\?/;

export const VEZES_ATE_O_ATENDENTE = 3;

/** Por que esta mensagem não fez a pergunta andar; null se andou (ou se não conta). */
export function motivoDoNaoEntendi(
  antes: EstadoDoOrcamento | null, final: EstadoDoOrcamento | null, transicoes: string[], fala: Fala,
  midia: 'audio' | 'outra' | null, mensagemId: string,
): MotivoDoNaoEntendi | null {
  if (!antes || !final || final.pergunta === null) return null;
  if (antes.etapa !== final.etapa || antes.pergunta !== final.pergunta) return null;
  // A mesma mensagem de novo (varredura): só repete a pergunta, não conta.
  if (mensagemId === antes.desdeMensagem) return null;
  if (midia) return midia === 'audio' ? 'audio' : 'mensagem_que_nao_abre';
  if (fala.tipo === 'v2') return LISTA_NAO_ENTENDIDA.test(fala.texto) ? 'lista_nao_entendida' : null;
  if (fala.tipo === 'fixa_e_lista' && fala.chave === 'lista_nao_entendi') return 'lista_nao_entendida';
  if (transicoes.length) return null;
  if (fala.tipo === 'livre' || fala.tipo === 'livre_e_lista') return 'outro_assunto';
  if (fala.tipo === 'nenhuma') return 'repetiu_pergunta';
  if (fala.tipo === 'fixa' && (fala.chave === perguntaAtual(final) || fala.chave === 'documento_invalido')) return 'repetiu_pergunta';
  return null;
}

/**
 * As 3 vezes têm de ser seguidas, numa mesma conversa de agora: no teste de 22/10 uma mensagem
 * das 12h contou junto com duas das 15h e passou para o atendente. Depois deste intervalo, recomeça.
 */
export const JANELA_DO_NAO_ENTENDI_MS = 30 * 60 * 1000;

/** A contagem nova. Zera quando a pergunta muda, a etapa anda ou passou a janela; na passagem ao atendente também. */
export function contagemNova(final: EstadoDoOrcamento, motivo: MotivoDoNaoEntendi | null, transicoes: string[], agora = Date.now()): DadosDoOrcamento['sem_entender'] | null {
  const pergunta = `${final.etapa}:${final.pergunta}`;
  const guardada = final.dados.sem_entender;
  const anterior = guardada && guardada.em && agora - Date.parse(guardada.em) > JANELA_DO_NAO_ENTENDI_MS ? undefined : guardada;
  if (motivo) {
    const vezes = (anterior?.pergunta === pergunta ? anterior.vezes : 0) + 1;
    return vezes >= VEZES_ATE_O_ATENDENTE ? null : { pergunta, vezes, em: new Date(agora).toISOString() };
  }
  return anterior && anterior.pergunta === pergunta && !transicoes.length ? anterior : null;
}

/** Outra execução andou com este orçamento desde que esta o leu? Então esta desiste, sem responder (regra 3). */
async function conferirVersao(supabase: Client, conversationId: string, ficha: Ficha | null): Promise<void> {
  const agora = await lerFicha(supabase, conversationId);
  if ((agora?.id ?? null) !== (ficha?.id ?? null) || (agora?.versao ?? null) !== (ficha?.versao ?? null)) throw new ErroDeVersao();
}

/** Grava a contagem, se mudou. `vezes`: a desta mensagem (0 quando ela não conta). */
async function contar(supabase: Client, ficha: Ficha, motivo: MotivoDoNaoEntendi | null, transicoes: string[]): Promise<{ ficha: Ficha; vezes: number }> {
  const estado = ficha.estado;
  const nova = contagemNova(estado, motivo, transicoes);
  const vezes = motivo ? (nova?.vezes ?? VEZES_ATE_O_ATENDENTE) : 0;
  if (JSON.stringify(nova ?? null) === JSON.stringify(estado.dados.sem_entender ?? null)) return { ficha, vezes };
  const dados: DadosDoOrcamento = { ...estado.dados };
  if (nova) dados.sem_entender = nova;
  else delete dados.sem_entender;
  return { ficha: await gravarFicha(supabase, ficha, { ...estado, dados }), vezes };
}

function marcarNaoEntendi(rastreio: Rastreio | undefined, final: EstadoDoOrcamento, vezes: number, motivo: MotivoDoNaoEntendi): void {
  marcar(rastreio, 'maquina_nao_entendeu');
  if (vezes >= VEZES_ATE_O_ATENDENTE) marcar(rastreio, 'maquina_passou_ao_atendente');
  if (rastreio) rastreio.estadoDepois = { ...rastreio.estadoDepois, nao_entendeu: { etapa: final.etapa, pergunta: final.pergunta, vezes, motivo } };
}

/** Áudio que não deu para ouvir ou mensagem que não abre: pede para escrever e repete a pergunta, sem a IA. */
async function responderMidia(
  supabase: Client, conversationId: string, vez: MensagemDaVez, ex: Executores, ficha: Ficha | null, midia: 'audio' | 'outra', rastreio?: Rastreio,
): Promise<ResultadoDaConducao> {
  const estado = ficha?.estado ?? null;
  const motivo = motivoDoNaoEntendi(estado, estado, [], { tipo: 'nenhuma' }, midia, vez.mensagemId);
  const contagem = ficha ? await contar(supabase, ficha, motivo, []) : null;
  if (contagem) ficha = contagem.ficha;
  const final = ficha?.estado ?? null;
  if (rastreio) rastreio.estadoDepois = { etapa: final?.etapa ?? null, pergunta: final?.pergunta ?? null, transicoes: [] };
  if (contagem?.vezes) marcarNaoEntendi(rastreio, final!, contagem.vezes, motivo!);
  if (contagem?.vezes === VEZES_ATE_O_ATENDENTE) {
    return { tipo: 'respondeu', resposta: PASSAR_AO_ATENDENTE, etapa: final?.etapa ?? null, transicoes: [], transferir: true };
  }
  const depois = contagem?.vezes === 2 ? textoDeNaoEntendi(final!, false) : await textoDaFala({ tipo: 'nenhuma' }, final, ex, ficha);
  const prefixo = midia === 'audio' ? NAO_OUVI_O_AUDIO : NAO_ABRE_ESSA_MENSAGEM;
  await conferirVersao(supabase, conversationId, ficha);
  return { tipo: 'respondeu', resposta: [prefixo, depois].filter(Boolean).join('\n\n'), etapa: final?.etapa ?? null, transicoes: [] };
}

/**
 * Conduz uma mensagem. Nunca deixa a etapa andar sem gravar: se a gravação
 * falha por versão, desiste sem responder (a outra execução responde).
 */
export async function conduzirMensagem(
  supabase: Client, onde: Onde, vez: MensagemDaVez, ex: Executores, rastreio?: Rastreio,
): Promise<ResultadoDaConducao> {
  let ficha = await lerFicha(supabase, onde.conversationId);
  if (!ficha && await ex.pedidoV2DeAntes()) return { tipo: 'caminho_antigo' };
  marcar(rastreio, 'maquina');
  if (rastreio) rastreio.estadoAntes = { etapa: ficha?.estado.etapa ?? null, pergunta: ficha?.estado.pergunta ?? null };

  try {
    if (ficha && venceu(ficha)) {
      await fecharFicha(supabase, ficha, 'expirado');
      ficha = null;
    }

    let estado = ficha?.estado ?? null;
    // Áudio que não deu para ouvir, figurinha, reação: não vai à IA de leitura e não confirma nada.
    // Nas etapas que esperam o ERP (sem pergunta), a mensagem segue: ela só faz tentar de novo.
    const midiaBruta = midiaQueNaoAbriu(vez.texto);
    const midia = midiaBruta && !(estado && estado.pergunta === null && ETAPAS_DE_COLETA.includes(estado.etapa)) ? midiaBruta : null;
    if (midia) return await responderMidia(supabase, onde.conversationId, vez, ex, ficha, midia, rastreio);
    const perguntaFeita = vez.ultimaFalaDaCasa;
    const leitura = precisaLer(estado)
      ? cidadeEscritaPeloCliente(await ex.interpretar(estado, perguntaFeita, vez.texto), vez.texto)
      : LEITURA_VAZIA;
    if (rastreio) rastreio.estadoAntes = { ...rastreio.estadoAntes, leitura };
    let mensagem: MensagemDoCliente = {
      mensagemId: vez.mensagemId,
      texto: vez.texto,
      documento: documentoCitado(vez.texto),
      documentoInvalido: temDocumentoInvalido(vez.texto),
      leitura,
      orcamentoParado: !!ficha && ficha.numero !== null && estado?.etapa !== 'aguardando_vendedor'
        && Date.now() - Date.parse(ficha.atualizadoEm) > PRAZO_SEM_RESPOSTA_MS,
      operacoes: operacoesLigadas(),
    };

    // Vários orçamentos (27/10, chave VARIOS_ORCAMENTOS): a mensagem pode trocar o orçamento em foco, pedir a lista
    // dos abertos ou responder "qual orçamento?" antes de a máquina seguir.
    const varios = variosOrcamentosLigado();
    let cabecalho: string | null = null;
    if (varios) {
      const decisao = await decidirOrcamento(supabase, onde.conversationId, ficha, mensagem, vez.ultimaFalaDaCasa);
      if (decisao?.tipo === 'responder') {
        marcar(rastreio, 'maquina_varios_orcamentos');
        await conferirVersao(supabase, onde.conversationId, await lerFicha(supabase, onde.conversationId));
        return { tipo: 'respondeu', resposta: decisao.texto, etapa: (await lerFicha(supabase, onde.conversationId))?.estado.etapa ?? null, transicoes: [] };
      }
      if (decisao?.tipo === 'seguir') {
        marcar(rastreio, 'maquina_varios_orcamentos');
        ficha = decisao.ficha ?? await lerFicha(supabase, onde.conversationId);
        estado = ficha?.estado ?? null;
        mensagem = decisao.mensagem;
        cabecalho = decisao.cabecalho ?? null;
      }
      if (decisao?.tipo === 'abrir_novo') {
        marcar(rastreio, 'maquina_varios_orcamentos');
        ficha = null;
        estado = null;
        mensagem = decisao.mensagem;
      }
    }

    // Depois da lista confirmada, um pedido novo (ou um documento) encerra este e abre outro. Com vários orçamentos,
    // ele fica em espera em vez de encerrar.
    if (ficha && estado?.etapa === 'aguardando_vendedor' && abreOrcamento(mensagem)) {
      if (varios) await estacionar(supabase, ficha);
      else await fecharFicha(supabase, ficha, 'encerrado');
      ficha = null;
      estado = null;
    }
    // T20: abrindo outro orçamento sem documento, oferece o cliente de hoje.
    if (!estado && abreOrcamento(mensagem) && !mensagem.documento) {
      mensagem.cadastroAnterior = await cadastroDeHoje(supabase, onde.conversationId);
    }

    const antes = estado;
    const transicoes: string[] = [];
    let p: Passo = passo(estado, { tipo: 'mensagem', mensagem }, vez.mensagemId);
    let fala: Fala = p.fala;
    for (let voltas = 0; ; voltas++) {
      transicoes.push(...p.transicoes);
      if (p.estado && (p.transicoes.length || JSON.stringify(p.estado) !== JSON.stringify(ficha?.estado ?? null))) {
        ficha = ficha ? await gravarFicha(supabase, ficha, p.estado) : await criarFicha(supabase, onde, p.estado);
      }
      if (!p.acao) break;
      if (voltas >= MAX_TRANSICOES) {
        console.error(`Máquina: limite de ${MAX_TRANSICOES} passos na conversa ${onde.conversationId} (${transicoes.join(',')}).`);
        marcar(rastreio, 'maquina_limite_de_transicoes');
        fala = { tipo: 'fixa', chave: 'vou_confirmar' };
        break;
      }
      // A v2 grava itens: com o orçamento já mudado por outra execução, a lista entraria duas vezes.
      if (p.acao.tipo === 'v2') await conferirVersao(supabase, onde.conversationId, ficha);
      const evento = await executar(p.acao, ex, ficha);
      p = passo(p.estado, evento, vez.mensagemId);
      // A fala é a do último passo; sem fala, sai a pergunta da etapa onde parou.
      fala = p.fala;
    }

    // Item 4: cancelado ou recomeçado, o orçamento fechou; o recomeçar abre outro nesta mesma mensagem.
    let recomecou = false;
    if (ficha && ETAPAS_FINAIS.includes(ficha.estado.etapa)) {
      recomecou = ficha.estado.motivoPausa === 'recomecado';
      // "novo" ao "continuo ou faço um novo?": a mensagem que trouxe os produtos vai para o orçamento novo.
      const levar = ficha.estado.dados.recomecar_com;
      ficha = null;
      if (recomecou) {
        const reaberto: MensagemDoCliente = {
          ...mensagem, documento: null, documentoInvalido: false,
          ...(levar ? { texto: levar.texto, documento: documentoCitado(levar.texto) } : {}),
          leitura: { ...(levar?.leitura ?? LEITURA_VAZIA), intencao: 'pedir_orcamento' },
          orcamentoParado: false,
          cadastroAnterior: await cadastroDeHoje(supabase, onde.conversationId),
        };
        p = passo(null, { tipo: 'mensagem', mensagem: reaberto }, vez.mensagemId);
        transicoes.push(...p.transicoes);
        if (p.estado) ficha = await criarFicha(supabase, onde, p.estado);
        fala = p.fala;
      }
    }

    // T1: a lista confirmada ganha o número e a validade de 5 dias.
    if (ficha && ficha.numero === null && ficha.estado.dados.itens?.length) ficha = await numerarFicha(supabase, ficha);
    const motivo = motivoDoNaoEntendi(antes, ficha?.estado ?? p.estado, transicoes, fala, null, vez.mensagemId);
    const contagem = ficha ? await contar(supabase, ficha, motivo, transicoes) : null;
    if (contagem) ficha = contagem.ficha;
    const final = ficha?.estado ?? p.estado;
    if (rastreio) rastreio.estadoDepois = { etapa: final?.etapa ?? null, pergunta: final?.pergunta ?? null, transicoes };
    if (contagem?.vezes) marcarNaoEntendi(rastreio, final!, contagem.vezes, motivo!);

    let resposta: string;
    const daIA: string[] = [];
    if (contagem?.vezes === VEZES_ATE_O_ATENDENTE) {
      resposta = PASSAR_AO_ATENDENTE;
    } else if (contagem?.vezes === 2) {
      const livre = fala.tipo === 'livre' || fala.tipo === 'livre_e_lista';
      const opcoes = textoDeNaoEntendi(final!, !livre);
      if (livre) daIA.push(semPerguntas((await ex.responderLivre(true)).trim()));
      resposta = livre
        ? [...daIA, opcoes].filter(Boolean).join('\n\n')
        : opcoes ?? await textoDaFala(fala, final, ex, ficha);
    } else {
      resposta = await textoDaFala(fala, final, ex, ficha, daIA);
    }
    if (recomecou) resposta = `Certo, vamos recomeçar. ${resposta}`;
    if (cabecalho) resposta = `${cabecalho}\n${resposta}`;
    // Item 3: se outra execução andou com o orçamento enquanto esta pensava, a resposta é velha.
    await conferirVersao(supabase, onde.conversationId, ficha);
    return {
      tipo: 'respondeu', resposta, etapa: final?.etapa ?? null, transicoes,
      ...(daIA.filter(Boolean).length ? { daIA: daIA.filter(Boolean).join('\n\n') } : {}),
      ...(contagem?.vezes === VEZES_ATE_O_ATENDENTE ? { transferir: true as const } : {}),
    };
  } catch (err) {
    if (err instanceof ErroDeVersao) {
      marcar(rastreio, 'maquina_versao_mudou');
      return { tipo: 'nao_responder', motivo: 'maquina-versao-mudou' };
    }
    if (err instanceof ErroDeEtapa) {
      // R1: a etapa ia ser gravada sem o que ela exige. Não grava, não anda.
      console.error(`Máquina: ${err.message} (conversa ${onde.conversationId})`);
      return { tipo: 'respondeu', resposta: textoDaEtapa('vou_confirmar', null, { estados: [] }), etapa: ficha?.estado.etapa ?? null, transicoes: [] };
    }
    throw err;
  }
}

/**
 * A mensagem desta vez: as falas do cliente desde a última fala da casa.
 * Null quando a última fala não é do cliente (outra execução já respondeu) ou
 * quando ainda há mídia sendo lida (quem lê responde depois).
 */
export function mensagemDaVez(
  historico: { id: string; autor: string; texto: string; created_at: string }[],
): { vez: MensagemDaVez } | { naoResponder: string } {
  const conversaveis = historico.filter(m => m.autor === 'cliente' || m.autor === 'ia' || m.autor === 'humano');
  const ultima = conversaveis[conversaveis.length - 1];
  if (!ultima || ultima.autor !== 'cliente') return { naoResponder: 'ja-respondida' };
  const inicio = conversaveis.map(m => m.autor).findLastIndex(a => a !== 'cliente') + 1;
  const doCliente = conversaveis.slice(inicio);
  if (doCliente.some(m => midiaAindaSendoLida(m.texto, m.created_at))) return { naoResponder: 'midia-sendo-lida' };
  return {
    vez: {
      mensagemId: ultima.id,
      texto: doCliente.map(m => m.texto).join('\n'),
      ultimaFalaDaCasa: inicio > 0 ? conversaveis[inicio - 1].texto : null,
    },
  };
}

/** Quantas vezes a execução volta para buscar falas que chegaram enquanto ela pensava. */
export const MAX_RODADAS_DE_FALAS_NOVAS = 3;

/**
 * As falas do cliente que chegaram depois de `depoisDe`, ainda sem resposta da casa.
 * Null: nenhuma, outra execução já respondeu, ou alguma ainda é mídia sendo lida
 * (quem lê responde depois, como em `mensagemDaVez`).
 */
export function falasNovas(
  historico: { id: string; autor: string; texto: string; created_at: string }[], depoisDe: string,
): { mensagemId: string; texto: string } | null {
  const conversaveis = historico.filter(m => m.autor === 'cliente' || m.autor === 'ia' || m.autor === 'humano');
  const i = conversaveis.findIndex(m => m.id === depoisDe);
  if (i < 0) return null;
  const depois = conversaveis.slice(i + 1);
  if (!depois.length || depois.some(m => m.autor !== 'cliente' || midiaAindaSendoLida(m.texto, m.created_at))) return null;
  return { mensagemId: depois[depois.length - 1].id, texto: depois.map(m => m.texto).join('\n') };
}

/**
 * Item 3 da válvula de escape (22/10): cada mensagem dispara uma execução, e a
 * que chega depois perde na versão e fica calada. O que vinha nela (o CNPJ, o
 * "sim", a cidade, metade da lista) sumia. Agora a execução que ganhou, antes de
 * responder, relê a conversa e conduz também as falas que chegaram enquanto ela
 * pensava. Sai a última resposta, que já reflete tudo; da anterior fica só o que
 * a IA escreveu (a resposta a outro assunto), porque a pergunta da etapa ficou velha.
 */
export async function conduzirComFalasNovas(
  supabase: Client, onde: Onde, vez: MensagemDaVez, ex: Executores,
  historicoAtual: () => Promise<{ id: string; autor: string; texto: string; created_at: string }[]>, rastreio?: Rastreio,
): Promise<ResultadoDaConducao> {
  let r = await conduzirMensagem(supabase, onde, vez, ex, rastreio);
  const estadoAntes = rastreio?.estadoAntes ?? null;
  const daIA: string[] = [];
  for (let rodada = 0; rodada < MAX_RODADAS_DE_FALAS_NOVAS && r.tipo === 'respondeu' && !r.transferir; rodada++) {
    const novas = falasNovas(await historicoAtual(), vez.mensagemId);
    if (!novas) break;
    marcar(rastreio, 'maquina_juntou_falas_novas');
    if (r.daIA) daIA.push(r.daIA);
    vez = { mensagemId: novas.mensagemId, texto: novas.texto, ultimaFalaDaCasa: r.resposta };
    const seguinte = await conduzirMensagem(supabase, onde, vez, ex, rastreio);
    // Perdeu a versão desta vez: quem ganhou responde tudo.
    if (seguinte.tipo !== 'respondeu') return seguinte;
    r = { ...seguinte, transicoes: [...r.transicoes, ...seguinte.transicoes] };
  }
  if (rastreio && estadoAntes) rastreio.estadoAntes = estadoAntes;
  if (r.tipo !== 'respondeu' || !daIA.length) return r;
  return { ...r, resposta: [...daIA, r.resposta].join('\n\n') };
}

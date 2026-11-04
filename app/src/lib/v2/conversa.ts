// A conversa da v2 (Fase F): orquestração fixa, controlada pelo backend.
//
// A cada mensagem do cliente, sempre na mesma ordem:
//   transcrever (se foto) → extrair (IA, com cache) → conferir → resolver →
//   gravar o estado de cada item → montar a resposta.
// A IA não tem ferramenta para pular etapa nem para escolher código.
//
// A resposta é montada pelo código: os itens resolvidos (os que vieram de
// padrão, sinalizados), e todas as perguntas juntas, numeradas, com opções.
// Os resolvidos não esperam as perguntas. Quando nada mais está pendente, a
// lista é congelada (snapshot com hash) e o cliente confirma; preço e
// orçamento só aceitam snapshot confirmado.

import { createHash } from 'node:crypto';
import type { ArmazemV2, ItemDoPedido, ItemDoSnapshot, Pergunta, Snapshot, StatusDoItem } from './armazem';
import { chamarComCache, type CacheDeIA, type ClienteIA } from './cache-ia';
import type { CatalogoV2 } from './catalogo';
import { conferirCoberturaDeLinhas, conferirItem } from './conferencias';
import {
  conteudoDaExtracao, lerExtracao, linhasDaMensagem, MODELO_DA_EXTRACAO, pedidoDeExtracao, PROMPT_VERSION, PROMPT_VERSION_OPERACOES, SCHEMA_VERSION,
  SCHEMA_VERSION_OPERACOES, type ItemNaLista, type PerguntaPendente,
} from './extracao';
import { formatar, lerValor, limpar, mesmoNumero, numerosEscritos } from './numeros';
import { NAO_VENDE, VERSAO_DAS_REGRAS } from './regras';
import { familiaDoTexto, lerQualificador } from './dicionario';
import { avisosDeEmbalagem, CALHA_EM_PECAS, regraDeEmbalagem, totalEmCaixas, type AjusteDeEmbalagem } from './embalagem';
import { FAMILIAS } from './familias';
import { METROS_DA_PECA_DE_CALHA, resolverItem, rotulo, semOpcoesRepetidas } from './resolvedor';
import { simClaro } from './sim-claro';
import {
  entradaDaImagem, lerTranscricao, pedidoDeTranscricao, PROMPT_VERSION_TRANSCRICAO, SCHEMA_VERSION_TRANSCRICAO, textoDaTranscricao, type Imagem,
} from './transcricao';
import type { Extracao, ItemExtraido, OperacaoNaLista, ResultadoResolucao, SaudeDoProduto, Trecho } from './tipos';

export interface Dependencias {
  armazem: ArmazemV2;
  cache: CacheDeIA;
  cliente: ClienteIA;
  catalogo: CatalogoV2;
  saude: Map<string, SaudeDoProduto>;
  versaoDoCatalogo: string;
  liberadas?: string[];
  /** Sem cache, falha em vez de chamar a API (bancada). */
  offline?: boolean;
  aoGastar?: (usd: number) => void;
  /** Códigos que o cliente já comprou (se o ERP fornecer): nunca decide, só muda a pergunta para confirmação. */
  historico?: string[];
  /**
   * V2_OPERACOES (25/10): a IA vê a lista e devolve as mudanças nela (tirar, trocar, quantidade, medida), e o código
   * confere cada uma antes de aplicar. Desligada, tirar e trocar são lidos por frase no código, como antes.
   */
  operacoes?: boolean;
}

export interface MensagemDoCliente { texto?: string; imagens?: Imagem[] }

export interface RespostaDoTurno {
  texto: string;
  itens: ItemDoPedido[];
  snapshot: Snapshot | null;
  extracao: Extracao | null;
}

// ── perguntas ──

/** O nome que o cliente usa, no lugar do nome interno da medida ("prego 17x21", ninguém diz "bitola": Vendedor 1, 22/10). */
function nomeNaPergunta(r: ResultadoResolucao): string {
  if (r.atributo_a_perguntar === 'bitola' && /^PREGO\b/i.test(r.candidatos[0]?.descricao ?? '')) return 'a medida do prego, por exemplo 17x21';
  return (r.atributo_a_perguntar ?? '').replace(/_/g, ' ');
}

function textoDaPergunta(tipo: Pergunta['tipo'], item: { texto: string }, resultado: ResultadoResolucao | null, historico: string[] = []): string {
  const pedido = `"${item.texto}"`;
  switch (tipo) {
    case 'confirmacao': {
      const c = resultado?.candidatos[0];
      const daUltimaVez = c && historico.includes(c.codigo) ? ', como da última vez' : '';
      return `${pedido}: é o ${c?.descricao ?? 'produto abaixo'}${daUltimaVez}?`;
    }
    case 'escolha': {
      const lembra = resultado?.candidatos.find(c => historico.includes(c.codigo));
      if (lembra) return `${pedido}: é o ${lembra.descricao}, como da última vez? Se não, qual destes?`;
      const falta = resultado?.atributo_a_perguntar && !['leitura', 'confirmação', 'produto', 'família'].includes(resultado.atributo_a_perguntar)
        ? ` Falta saber: ${nomeNaPergunta(resultado)}.` : '';
      return resultado?.regras_aplicadas.some(r => r.startsWith('op_')) ? `${pedido}: ${resultado.motivo}` : `${pedido}: qual destes?${falta}`;
    }
    case 'nao_encontrado': return `${pedido}: não temos nessa medida. Temos estes, serve algum?`;
    case 'quantidade': return `${pedido}: qual a quantidade?`;
    case 'vendedor': return `${pedido}: este eu confirmo com o vendedor e te retorno. Quer seguir sem ele por enquanto?`;
    case 'ilegivel': return `Não consegui ler: ${pedido}. Pode digitar?`;
    case 'nao_entendi': return `Não entendi: ${pedido}. Pode escrever de outro jeito?`;
    case 'qual_item': return `${pedido}: qual destes?`;
  }
}

function novaPergunta(id: string, tipo: Pergunta['tipo'], item: { texto: string }, resultado: ResultadoResolucao | null, historico: string[] = []): Pergunta {
  const opcoes = tipo === 'confirmacao' || tipo === 'escolha' || tipo === 'nao_encontrado' ? resultado?.opcoes ?? [] : [];
  return { id, tipo, texto: textoDaPergunta(tipo, item, resultado, historico), opcoes };
}

/** O estado inicial de um item a partir do resultado do resolvedor. */
function estadoInicial(resultado: ResultadoResolucao, quantidade: string | null): { status: StatusDoItem; codigo: string | null; tipo: Pergunta['tipo'] | null } {
  switch (resultado.status) {
    case 'resolvido': return quantidade ? { status: 'resolvido', codigo: resultado.codigo, tipo: null } : { status: 'pergunta', codigo: resultado.codigo, tipo: 'quantidade' };
    case 'confirmar': return { status: 'pergunta', codigo: null, tipo: 'confirmacao' };
    case 'ambiguo': return { status: 'pergunta', codigo: null, tipo: 'escolha' };
    case 'nao_encontrado': return resultado.opcoes.length ? { status: 'pergunta', codigo: null, tipo: 'nao_encontrado' } : { status: 'vendedor', codigo: null, tipo: 'vendedor' };
    case 'nao_vende': return { status: 'nao_vende', codigo: null, tipo: null };
    case 'conflito':
    case 'vendedor': return { status: 'vendedor', codigo: null, tipo: 'vendedor' };
  }
}

async function proximoIdDePergunta(deps: Dependencias, pedidoId: string): Promise<string> {
  const p = await deps.armazem.pedido(pedidoId);
  const n = p?.proxima_pergunta ?? 1;
  await deps.armazem.atualizarPedido(pedidoId, { proxima_pergunta: n + 1 });
  return `p${n}`;
}

// ── extração ──

async function extrair(deps: Dependencias, pedidoId: string, texto: string, pendentes: PerguntaPendente[], lista: ItemNaLista[] | null = null): Promise<Extracao> {
  const inicio = Date.now();
  const entrada = conteudoDaExtracao(texto, pendentes, lista);
  const prompt_version = lista ? PROMPT_VERSION_OPERACOES : PROMPT_VERSION;
  const schema_version = lista ? SCHEMA_VERSION_OPERACOES : SCHEMA_VERSION;
  const { registro, doCache } = await chamarComCache(
    deps.cache, deps.cliente,
    { tipo: 'extracao', entrada, prompt_version, schema_version, modelo: MODELO_DA_EXTRACAO },
    pedidoDeExtracao(texto, pendentes, lista),
    { offline: deps.offline, aoGastar: deps.aoGastar },
  );
  const extracao = lerExtracao(registro.saida);
  await deps.armazem.gravarTrace({
    pedido_id: pedidoId, etapa: 'extracao', entrada: { texto, pendentes, ...(lista ? { lista } : {}), prompt_version, schema_version },
    saida: extracao, duracao_ms: Date.now() - inicio, tokens: { ...registro.uso, do_cache: doCache }, custo_usd: doCache ? 0 : registro.custo_usd,
  });
  return extracao;
}

async function transcrever(deps: Dependencias, pedidoId: string, imagem: Imagem): Promise<string> {
  const inicio = Date.now();
  const { registro, doCache } = await chamarComCache(
    deps.cache, deps.cliente,
    { tipo: 'transcricao', entrada: entradaDaImagem(imagem), prompt_version: PROMPT_VERSION_TRANSCRICAO, schema_version: SCHEMA_VERSION_TRANSCRICAO, modelo: MODELO_DA_EXTRACAO },
    pedidoDeTranscricao(imagem),
    { offline: deps.offline, aoGastar: deps.aoGastar },
  );
  const linhas = lerTranscricao(registro.saida);
  await deps.armazem.gravarTrace({
    pedido_id: pedidoId, etapa: 'transcricao', entrada: { imagem: entradaDaImagem(imagem) }, saida: linhas,
    duracao_ms: Date.now() - inicio, tokens: { ...registro.uso, do_cache: doCache }, custo_usd: doCache ? 0 : registro.custo_usd,
  });
  return textoDaTranscricao(linhas);
}

// ── registrar os itens novos ──

/**
 * Os pedaços de uma linha com vários itens, um por item, quando a própria
 * linha os separa: "(6 vigas U 75)(4 Metalon 100x100)", "6 cantoneira 3/4, 18
 * barra redonda 3/8", "10 3/8 e 7 varas 5/16". Cada pedaço tem de conter os
 * trechos do seu item (quantidade e medidas): "3 cantoneira de 3/4'' e 3
 * cantoneira de 1/2'', todas serralheiro" não se divide pela vírgula. Sem uma
 * divisão que feche, null: não dá para saber qual pedaço é de quem.
 */
export function segmentosDaLinha(texto: string, itens: number | ItemExtraido[]): string[] | null {
  const lista = typeof itens === 'number' ? null : itens;
  const n = lista ? lista.length : (itens as number);
  if (n < 2) return null;
  const solto = (t: string): string => limpar(t).replace(/[^a-z0-9/]+/g, '');
  const fecha = (pedacos: string[]): boolean => !lista || lista.every((item, k) =>
    [item.quantidade?.trecho, ...item.medidas.map(m => m.trecho)].filter((t): t is string => !!t && !!solto(t)).every(t => solto(pedacos[k]).includes(solto(t))));
  // O separador mais forte que a linha usa: ")(", depois vírgula ou ponto e vírgula, depois " e " antes de "número palavra"
  for (const separador of [/\)\s*\(/, /[;,](?!\d)/, /\s+e\s+(?=\d+\s+[a-z])/i]) {
    const pedacos = texto.split(separador).map(p => p.replace(/^\s*\(|\)\s*$/g, '').trim()).filter(Boolean);
    if (pedacos.length === n && fecha(pedacos)) return pedacos;
  }
  return null;
}

/**
 * O pedaço da fala do cliente que é deste item, num áudio de um fôlego só: a frase que tem a medida que só ele tem
 * ("perfil de 50"), sem o "preciso de preço do" da frente. No áudio de 25/10 à noite as aspas mostravam o nome da família
 * montado pela IA ("tubo galvanizado retangular 70 70 2mm") e não o que ele disse ("Tubo quadrado 7070 também na 2mm").
 * Sem frase que seja só dele, null.
 */
export function falaDoItem(texto: string, item: ItemExtraido, todos: ItemExtraido[] = [item]): string | null {
  const frases = texto.split(/(?<=[.;!?])\s+|,\s+/).map(f => f.trim()).filter(Boolean);
  const ancorasDe = (i: ItemExtraido): string[] => i.medidas.map(m => limpar(m.trecho ?? '')).filter(Boolean);
  const ancoras = ancorasDe(item);
  // Frase que tem a medida de outro item é de dois itens ("20 varas de 5/16 e 2 discos de corte"): não serve.
  const deOutros = todos.filter(i => i !== item).flatMap(ancorasDe).filter(a => !ancoras.includes(a));
  const daFrase = frases.filter(f => !deOutros.some(a => limpar(f).includes(a))).map(f => ({ f, tem: ancoras.filter(a => limpar(f).includes(a)) }));
  const soDela = (a: string): boolean => daFrase.filter(x => x.tem.includes(a)).length === 1;
  const escolhida = daFrase.filter(x => x.tem.some(soDela)).sort((a, b) => b.tem.length - a.tem.length)[0];
  if (!escolhida) return null;
  const fala = escolhida.f
    .replace(/^(?:e\s+)?(?:eu\s+)?(?:preciso|quero|queria|gostaria)\s+(?:de\s+)?(?:(?:um\s+)?(?:or[cç]amento|pre[cç]o)\s+)?/i, '')
    .replace(/^(?:d[oa]s?|de)\s+/i, '').replace(/[.;!?]+$/, '').trim();
  return fala.length >= 4 && fala.length <= 80 ? fala : null;
}

/** Material que a loja não vende: a linha descartada vira item e recebe "não trabalhamos". */
const FAMILIAS_QUE_NAO_VENDEMOS = new Set(NAO_VENDE.filter(n => !n.termo && !n.condicao).map(n => n.familia));
const MOTIVO_DE_DESCARTE_LEGITIMO = /correcao de pergunta|resposta de pergunta|edi[cç][aã]o da lista|pagamento|boleto|prazo|entrega|frete|endere|sauda|obra|vendedor|t[ií]tulo|cnpj|cpf|telefone|contato|assinatura|data|or[cç]amento n/i;

export function resgatarLinhaDescartada(texto: string, motivo: string | null): ItemExtraido | null {
  if (motivo && MOTIVO_DE_DESCARTE_LEGITIMO.test(motivo)) return null;
  if (!/\d/.test(texto)) return null;
  // "50Filito": número colado na palavra esconde a palavra do dicionário
  const familias = familiaDoTexto(texto.replace(/(\d)([a-zA-ZÀ-ú])/g, '$1 $2')).familias;
  // A própria IA pode dizer no motivo que é fora do ramo
  const foraPeloMotivo = motivo && /fora do ramo|n[aã]o (?:[eé] )?(?:de )?(?:ferro|a[cç]o|met[aá]lic)/i.test(motivo) ? 'fora_do_ramo' : undefined;
  const naoVendida = familias.find(f => FAMILIAS_QUE_NAO_VENDEMOS.has(f)) ?? foraPeloMotivo;
  const pareceMedida = /\d\s*(?:x|×|\*|por)\s*\d|\d\s*(?:m³|m3|mm|cm|kg|un\b|unid|pe[cç]as?|sacos?|latas?)/i.test(limpar(texto));
  if (!naoVendida && !familias.length && !pareceMedida) return null;
  return {
    familia: naoVendida ?? 'nao_identificado', quantidade: null, medidas: [], numeros_auxiliares: [],
    qualificadores: [], termos_nao_reconhecidos: [], idem_resolvido_de_linha: null,
  };
}

const MARCA_DA_FOTO = /^\s*\[(?:foto|pdf) da lista\]\s*$/im;
const MARCA_DE_ILEGIVEL = /^\s*\[ileg[ií]vel\]\s*/i;
/** "valor unitário", "preço da unidade", "quanto custa cada": cota 1 (Vendedor 1, 27/10). */
export const PEDE_UNITARIO = /\bunit[aá]ri[oa]s?\b|\b(?:valor|pre[cç]o)s? (?:d[ae] |por )?(?:uma )?unidade\b|\b(?:valor|pre[cç]o)s? (?:de )?cada\b|\bquanto (?:custa|sai|fica) (?:a |uma )?(?:unidade|cada)\b/i;

/**
 * Registra os itens da extração. Devolve as linhas da foto que não deu para
 * ler: em 20/10 a foto virou 11 linhas e 8 sumiram como "texto incompleto ou
 * ilegível" sem nada para o cliente (T14). Descarte legítimo (saudação,
 * título, CNPJ) não entra.
 */
/** O que registrar uma mensagem deixa para o cliente saber: linhas da foto não lidas e quantidades mudadas. */
export interface ItensRegistrados { naoLidas: string[]; mudancas: string[] }

/** `segundaTentativa`: o texto é o que o cliente reescreveu depois de um "Não entendi" ou "Não consegui ler". */
export async function registrarItens(
  deps: Dependencias, pedidoId: string, extracao: Extracao, textoDaMensagem: string, segundaTentativa = false, mudaOQueJaEsta = true,
): Promise<ItensRegistrados> {
  const existentes = await deps.armazem.itens(pedidoId);
  let ordem = existentes.length;
  const { conferencia: cobertura, faltando } = conferirCoberturaDeLinhas(textoDaMensagem, extracao);
  const base = { versao_regras: VERSAO_DAS_REGRAS, versao_catalogo: deps.versaoDoCatalogo, respostas: [] };
  const daFoto = MARCA_DA_FOTO.test(textoDaMensagem);
  const naoLidas: string[] = [];
  const mudancas: string[] = [];
  // Leonardo, 21/10: "na verdade são 400 parafusos" com 200 na lista virava uma segunda linha. O mesmo
  // produto, já na lista de uma mensagem anterior, com outra quantidade, muda a quantidade do que está lá.
  const naLista = new Map(existentes.filter(i => (i.status === 'resolvido' || i.status === 'respondido') && i.codigo_final).map(i => [i.codigo_final!, i]));

  // Linha que a transcrição marcou ilegível é pergunta numerada ("Não consegui ler: ... Pode digitar?"), nunca palpite
  // nem item do vendedor sem número (Leonardo, 21/10). O que o cliente digitar a substitui.
  const ilegiveis = new Set<string>();
  const perguntarIlegivel = async (linhaId: number, texto: string): Promise<void> => {
    // A mesma linha pode vir da IA (sem item) e da conferência de cobertura: uma pergunta só.
    if (ilegiveis.has(texto.trim())) return;
    ilegiveis.add(texto.trim());
    const sem = texto.replace(MARCA_DE_ILEGIVEL, '').trim();
    const pergunta = novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'ilegivel', { texto: sem }, null);
    const salvo = await deps.armazem.inserirItem({
      ...base, pedido_id: pedidoId, ordem: ordem++, linha_id: linhaId, texto_original: texto, extracao: null,
      conferencias: [], resultado: null, status: 'pergunta', codigo_final: null, quantidade: null, pergunta,
    });
    await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: salvo.id, etapa: 'conferencia', entrada: { linha: texto }, saida: { ilegivel: true } });
  };
  // Produto que ela não reconhece (Leonardo, 21/10): primeiro "Não entendi... Pode escrever de outro jeito?";
  // só se o texto novo também não for entendido o vendedor entra.
  const naoEntendi = async (texto: string): Promise<{ status: StatusDoItem; pergunta: Pergunta }> => {
    const id = await proximoIdDePergunta(deps, pedidoId);
    if (!segundaTentativa) return { status: 'pergunta', pergunta: novaPergunta(id, 'nao_entendi', { texto }, null) };
    return { status: 'vendedor', pergunta: { ...novaPergunta(id, 'vendedor', { texto }, null), texto: `Continuo sem entender "${texto}". Vou pedir ajuda ao vendedor e sigo com o resto, pode ser?` } };
  };

  for (const linha of extracao.linhas) {
    if (MARCA_DE_ILEGIVEL.test(linha.texto_original)) { await perguntarIlegivel(linha.linha_id, linha.texto_original); continue; }
    if (linha.descartada) {
      // Linha descartada que parece pedido não some em silêncio: material que a loja não vende vira
      // "não trabalhamos"; o resto ("PORTÃO 4x2") vai para o vendedor.
      const resgate = resgatarLinhaDescartada(linha.texto_original, linha.motivo_descarte);
      if (!resgate) {
        const ilegivel = MARCA_DE_ILEGIVEL.test(linha.texto_original);
        const legitimo = !!linha.motivo_descarte && MOTIVO_DE_DESCARTE_LEGITIMO.test(linha.motivo_descarte);
        if ((daFoto || ilegivel) && !MARCA_DA_FOTO.test(linha.texto_original) && (ilegivel || !legitimo)) {
          const texto = linha.texto_original.replace(MARCA_DE_ILEGIVEL, '').trim();
          if (texto) naoLidas.push(texto);
        }
        continue;
      }
      linha.itens = [resgate];
    }
    const segmentos = segmentosDaLinha(linha.texto_original, linha.itens);
    for (const [k, itemLido] of linha.itens.entries()) {
      // Vendedor 1, 27/10: "valor unitário" é a cotação de 1 (a linha pede, ou a mensagem toda quando tem um item só).
      const unitario = !itemLido.quantidade && (PEDE_UNITARIO.test(segmentos?.[k] ?? linha.texto_original)
        || (extracao.linhas.length === 1 && linha.itens.length === 1 && PEDE_UNITARIO.test(textoDaMensagem)));
      const item: ItemExtraido = unitario ? { ...itemLido, quantidade: { valor: '1', trecho: 'valor unitário' } } : itemLido;
      const idem = item.idem_resolvido_de_linha ? extracao.linhas.find(l => l.linha_id === item.idem_resolvido_de_linha)?.texto_original : undefined;
      const conferencias = [...conferirItem(item, linha, idem), ...(cobertura.ok ? [] : [cobertura])];
      // Vários itens na mesma linha: cada um fica com o seu pedaço ("(4 Metalon 100x100 na 14)"), para
      // as regras com texto e a pergunta ao cliente não misturarem os itens.
      // Sem pedaço (áudio de um fôlego só, 25/10): o texto do item é montado com o que a IA leu dele, e não a frase inteira
      // repetida em cada pergunta (C1). Linha muito comprida com um item só também.
      const textoDoItem = segmentos?.[k] ?? (linha.texto_original.length > 120
        ? falaDoItem(linha.texto_original, item, linha.itens) ?? textoCurtoDoItem(item)
        : linha.itens.length > 1 ? textoCurtoDoItem(item) : linha.texto_original);
      const inicio = Date.now();
      const resultado = resolverItem(item, {
        catalogo: deps.catalogo, saude: deps.saude, liberadas: deps.liberadas,
        textoOriginal: idem ? `${idem}\n${segmentos?.[k] ?? linha.texto_original}` : segmentos?.[k] ?? linha.texto_original, conferencias,
        textoDoItem: !segmentos && linha.itens.length > 1 ? textoDoItem : undefined,
      });
      const quantidade = item.quantidade?.valor ?? null;
      const estado = estadoInicial(resultado, quantidade);
      // A troca de um item ("a vara de 5/16 na bitola 3/8") com o mesmo produto já na lista soma na tela, não substitui.
      const jaNaLista = mudaOQueJaEsta && estado.status === 'resolvido' && estado.codigo ? naLista.get(estado.codigo) : undefined;
      if (jaNaLista && quantidade) {
        // "mais 2 de disco de corte", "adicione disco de corte 3kg": soma ao que já está (teste de 25/10 à tarde: virou de 6 para 2).
        // Sem essas palavras ("na verdade são 400 parafusos"), a quantidade nova substitui, como antes.
        // A linha da lista pode somar vários itens do mesmo produto (2 + 2 + 2 discos). A conta é com o total, e a quantidade
        // nova fica num item só: "são 5" mudava um dos três de 2 para 5 e a lista ia de 6 para 9 (teste de 25/10 à noite).
        const daLinha = linhasDaLista(deps, existentes).find(l => l.item.codigo_final === jaNaLista.codigo_final);
        const outros = existentes.filter(i => i.id !== jaNaLista.id && (i.status === 'resolvido' || i.status === 'respondido') && i.codigo_final === jaNaLista.codigo_final);
        const total = daLinha?.quantidade ?? jaNaLista.quantidade;
        const antes = Number(numeroDaQuantidade(total));
        const soma = SOMA.test(limpar(textoDaMensagem)) && Number.isFinite(antes) && Number.isFinite(Number(numeroDaQuantidade(quantidade)));
        const nova = soma ? formatar(antes + Number(numeroDaQuantidade(quantidade))) : quantidade;
        if (!mesmoNumero(nova, total ?? '')) {
          const extracaoNova = soma ? { ...item, quantidade: { valor: nova, trecho: (item.quantidade?.trecho ?? '').replace(/^\s*\d+(?:[.,]\d+)?/, nova) } } : item;
          await deps.armazem.atualizarItem(jaNaLista.id, { quantidade: nova, extracao: extracaoNova });
          for (const o of outros) await deps.armazem.atualizarItem(o.id, { status: 'fora_do_orcamento', pergunta: null });
          const p = deps.catalogo.porCodigo.get(jaNaLista.codigo_final!);
          mudancas.push(`Mudei ${p ? rotulo(p) : jaNaLista.codigo_final} de ${total ?? '?'} para ${nova}.`);
          await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: jaNaLista.id, etapa: 'resposta', entrada: { linha: linha.texto_original }, saida: { quantidade_antes: total, quantidade: nova, soma } });
        }
        continue;
      }
      const desconhecido = estado.status === 'vendedor' && item.familia === 'nao_identificado' ? await naoEntendi(textoDoItem) : null;
      const pergunta = desconhecido?.pergunta ?? (estado.tipo ? novaPergunta(await proximoIdDePergunta(deps, pedidoId), estado.tipo, { texto: textoDoItem }, resultado, deps.historico) : null);
      const salvo = await deps.armazem.inserirItem({
        ...base, pedido_id: pedidoId, ordem: ordem++, linha_id: linha.linha_id, texto_original: textoDoItem, extracao: item,
        conferencias, resultado, status: desconhecido?.status ?? estado.status, codigo_final: estado.codigo, quantidade, pergunta,
      });
      await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: salvo.id, etapa: 'conferencia', entrada: { item, linha: linha.texto_original }, saida: conferencias });
      await deps.armazem.gravarTrace({
        pedido_id: pedidoId, item_id: salvo.id, etapa: 'resolucao', entrada: item, saida: resultado,
        regras: resultado.regras_aplicadas, travas: resultado.travas, duracao_ms: Date.now() - inicio,
      });
    }
  }
  // Linha que a IA não cobriu não some: vira "Não entendi" (e, na segunda vez, o vendedor), e o cliente fica sabendo.
  for (const l of faltando) {
    if (MARCA_DE_ILEGIVEL.test(l.texto)) { await perguntarIlegivel(l.id, l.texto); continue; }
    // Só a linha com cara de item ganha o "Não entendi"; o resto ("bom dia, meu cnpj é ...") segue com o vendedor, como antes.
    const { status, pergunta } = resgatarLinhaDescartada(l.texto, null)
      ? await naoEntendi(l.texto)
      : { status: 'vendedor' as const, pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'vendedor', { texto: l.texto }, null) };
    const salvo = await deps.armazem.inserirItem({
      ...base, pedido_id: pedidoId, ordem: ordem++, linha_id: l.id, texto_original: l.texto, extracao: null,
      conferencias: [cobertura], resultado: null, status, codigo_final: null, quantidade: null, pergunta,
    });
    await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: salvo.id, etapa: 'conferencia', entrada: { linha: l.texto }, saida: [cobertura] });
  }
  if (naoLidas.length) await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'conferencia', entrada: { foto: daFoto }, saida: { linhas_nao_lidas: naoLidas } });
  return { naoLidas, mudancas };
}

/** O aviso ao cliente das linhas da foto que não deu para ler. */
export function avisoDeLinhasNaoLidas(linhas: string[]): string[] {
  return linhas.length ? [`Não consegui ler ${linhas.length > 1 ? 'estas linhas' : 'esta linha'} da foto: ${linhas.map(l => `"${l}"`).join(', ')}. Pode digitar?`] : [];
}

// ── respostas do cliente ──

// "isso não" e "esse não" (22/10) começam como sim e negam: não contam.
const SIM = /^(?:sim|s|isso|ok|pode|certo|correto|confirmo|esse|e esse|e isso|1|perfeito|exato|beleza|blz)\b(?![\s,.]*nao\b)/;
const COMECA_COMO_SIM = /^(?:sim|s|isso|ok|pode|certo|correto|confirmo|esse|e esse|e isso|perfeito|exato|beleza|blz|fechado)\b/;
/** Pergunta, negação ou pedido de mudança: a mensagem não é só um "sim". */
const DUVIDA_OU_EDICAO = /\?|\b(?:nao|n|sem)\b|\bs\/|\b(?:tir|troc|mud|adicion|acrescent|inclu|cancel|esper|aguard|aument|diminu|reduz|falt)\w*/;
export const FECHO_A_LISTA_ASSIM = 'Fecho a lista assim, sem mudar nada? Responda sim.';
// Sem "esse" e "é isso" no começo, que o COMECA_COMO_SIM aceita: "esse disco é o de 4.5" não é sim à lista.
const LISTA_COMECA_COM_SIM = /^(?:sim|s|isso|ok|okay|pode|certo|correto|confirmo|perfeito|exato|beleza|blz|fechado|fechou|show)\b/;
const SIM_A_LISTA = /\b(?:sim|confirmo|confirmado|confirma|pode seguir|pode fechar|pode mandar|pode fazer|pode prosseguir|esta certo|esta certa|ta certo|ta certa|esta correto|esta correta|ta correto|ta correta|isso mesmo|tudo certo)\b/;

/** O cliente escreveu um sim: começa com sim/ok/pode/... ou diz "pode seguir", "está certo". O nome de um produto não é sim. */
export function disseSimALista(texto: string): boolean {
  const t = limpar(texto);
  return LISTA_COMECA_COM_SIM.test(t) || SIM_A_LISTA.test(t);
}
const NAO = /^(?:nao|n|nenhum|nenhuma|nenhuma dessas|nenhum desses|nenhuma das opcoes|outro|outra)\b/;
// Teste de campo de 21/10: "segue sem ele" chegava da IA como "não incluir" e a pergunta repetiu três vezes.
const SEGUIR_SEM_FORTE = /\bsegu(?:ir|e|imos)\b[^?]*\bsem\b|\bsem (?:este|esse|ele|ela|eles|esses|isso|o item|esse item)\b|\bnao (?:incluir|inclui|inclua|precisa d|quero (?:esse|ele|este))|\b(?:tirar|tira|tire)\s*(?:ele|ela|esse|essa|este|esta|o item|isso)?\s*$|\bdeixa(?:r)? (?:pra|para) la\b|\bdeixa(?:r)? (?:quieto|de lado|fora)\b/;
const SEGUIR_SEM_CURTO = /^(?:sim|pode|ok|pode ser|pode sim|claro|beleza|blz|tudo bem|fechado)\s*[.!]*$/;
/** Pergunta ou outro assunto ("pode me dizer o prazo?") nunca é "seguir sem ele": o texto com "?" não conta. */
export function seguirSemEle(texto: string, tipo: 'vendedor' | 'ilegivel' | 'nao_entendi'): boolean {
  if (texto.includes('?')) return false;
  const t = limpar(texto).replace(/[.!]+$/, '');
  return SEGUIR_SEM_FORTE.test(t) || (tipo === 'vendedor' && SEGUIR_SEM_CURTO.test(t));
}

/**
 * A posição da opção que o texto do cliente escolhe, ou -1. O rótulo inteiro vale mais que as palavras
 * soltas: "Prego 17 x 27" casava com o "PREGO 17 X 21" só pela palavra "prego" (teste de 21/10).
 */
export function opcaoDoTexto(p: Pick<Pergunta, 'opcoes'>, escolha: string): number {
  const e = limpar(escolha).replace(/[.!]+$/, '');
  const palavras = e.split(/[^a-z0-9/]+/).filter(w => w.length >= 4);
  const inteira = p.opcoes.findIndex(o => o.codigos.includes(escolha.trim()) || (e.length >= 2 && limpar(o.rotulo).includes(e)));
  if (inteira >= 0) return inteira;
  return p.opcoes.findIndex(o => palavras.length > 0 && palavras.every(w => limpar(o.rotulo).includes(w)));
}

/**
 * Aplica a resposta do cliente a uma pergunta pendente. Usada pela conversa
 * (resposta que a extração reconheceu) e pela bancada (cliente simulado).
 */
export async function aplicarResposta(deps: Dependencias, pedidoId: string, perguntaId: string, escolha: string): Promise<boolean> {
  const itens = await deps.armazem.itens(pedidoId);
  const item = itens.find(i => i.pergunta?.id === perguntaId);
  if (!item?.pergunta) return false;
  const p = item.pergunta;
  const e = limpar(escolha).replace(/[.!]+$/, '');
  const respostas = [...item.respostas, { pergunta_id: perguntaId, resposta: escolha }];
  const indice = /^\d+$/.test(e) ? Number(e) - 1 : -1;
  const porTexto = opcaoDoTexto(p, escolha);
  const opcao = p.opcoes[indice >= 0 && indice < p.opcoes.length ? indice : porTexto];
  // "não, é vergalhão 3/8": o "não" vem com outro produto; quem trata é correcaoDoItem.
  if (!opcao && p.tipo !== 'quantidade' && !SIM.test(e) && familiaDoTexto(semNegacao(escolha)).familias.length) return false;

  let campos: Partial<ItemDoPedido> = { respostas };
  const fechar = async (codigo: string): Promise<void> => {
    if (item.quantidade) { campos = { ...campos, status: 'respondido', codigo_final: codigo, pergunta: null }; return; }
    campos = { ...campos, status: 'pergunta', codigo_final: codigo, pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'quantidade', { texto: item.texto_original }, null) };
  };

  switch (p.tipo) {
    case 'quantidade': {
      const n = lerValor(e.replace(/[^\d.,/ ]/g, '').trim());
      if (!n) return false;
      campos = { ...campos, quantidade: String(n.valor), status: item.codigo_final ? 'respondido' : item.status, pergunta: item.codigo_final ? null : item.pergunta };
      // "5 kg": a unidade fica para a lista mostrar "5 kg de", como quando vem junto do pedido (25/10).
      if (item.extracao) campos = { ...campos, extracao: { ...item.extracao, quantidade: { valor: String(n.valor), trecho: escolha.trim() } } };
      break;
    }
    case 'confirmacao':
      if (SIM.test(e) || opcao) await fechar(p.opcoes[0].codigos[0]);
      else if (NAO.test(e)) campos = { ...campos, status: 'vendedor', pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'vendedor', { texto: item.texto_original }, null) };
      else return false;
      break;
    case 'escolha':
    case 'nao_encontrado':
      if (opcao) {
        if (opcao.codigos.length === 1) await fechar(opcao.codigos[0]);
        else if (!opcao.codigos.length) {
          // Opção sem código ("prontas (corte e dobra, sob medida)"): é do vendedor. Antes a
          // pergunta voltava sem nenhuma opção (Leonardo, 20/10, perguntas 3 e 4).
          campos = { ...campos, status: 'vendedor', pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'vendedor', { texto: item.texto_original }, null) };
        } else {
          // Opção por atributo com vários produtos: pergunta de novo, só entre eles.
          const produtos = opcao.codigos.map(c => deps.catalogo.porCodigo.get(c)).filter((x): x is NonNullable<typeof x> => !!x);
          const r: ResultadoResolucao = { ...(item.resultado as ResultadoResolucao), opcoes: semOpcoesRepetidas(produtos.map(x => ({ rotulo: rotulo(x), codigos: [x.codigo] }))), candidatos: produtos.map(x => ({ codigo: x.codigo, descricao: rotulo(x), diferenca: '' })), atributo_a_perguntar: 'produto' };
          campos = { ...campos, pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'escolha', { texto: item.texto_original }, r) };
        }
      } else if (NAO.test(e) || indice === p.opcoes.length) {
        // O número logo depois das opções é o "nenhuma dessas".
        campos = p.tipo === 'nao_encontrado'
          ? { ...campos, status: 'fora_do_orcamento', pergunta: null }
          : { ...campos, status: 'vendedor', pergunta: novaPergunta(await proximoIdDePergunta(deps, pedidoId), 'vendedor', { texto: item.texto_original }, null) };
      } else return false;
      break;
    case 'vendedor':
    case 'ilegivel':
    case 'nao_entendi':
      if (seguirSemEle(escolha, p.tipo)) campos = { ...campos, status: 'fora_do_orcamento', pergunta: null };
      else return false;
      break;
    case 'qual_item': {
      // A pergunta sai de qualquer jeito; com a opção, a mudança vai para o item escolhido, como está na lista agora.
      if (!opcao && !NAO.test(e) && indice !== p.opcoes.length) return false;
      campos = { ...campos, status: 'fora_do_orcamento', pergunta: null };
      const linha = opcao && p.operacao ? listaParaAIA(deps, itens).find(l => l.itens[0]?.codigo_final === opcao.codigos[0]) : undefined;
      if (linha && p.operacao) await executarOperacao(deps, pedidoId, { ...p.operacao, item: linha.numero }, linha);
      break;
    }
  }
  await deps.armazem.atualizarItem(item.id, campos);
  await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: item.id, etapa: 'resposta', entrada: { pergunta: p, escolha }, saida: campos });
  return true;
}

/**
 * O cliente respondeu com outro produto ("não, é vergalhão 3/8"): o item antigo
 * sai e a correção volta como texto de item novo, com a quantidade dele. Só
 * quando a resposta nomeia uma família do dicionário; senão não muda nada.
 */
async function correcaoDoItem(deps: Dependencias, pedidoId: string, item: ItemDoPedido, resposta: string): Promise<string | null> {
  // A pergunta "qual destes?" é sobre a lista: a resposta não vira produto novo.
  if (item.pergunta?.tipo === 'qual_item') return null;
  const ilegivel = item.pergunta?.tipo === 'ilegivel' || item.pergunta?.tipo === 'nao_entendi';
  const produto = ilegivel ? resposta.trim() : semNegacao(resposta);
  // A linha ilegível é substituída por qualquer coisa que o cliente digite; as outras só por um produto do dicionário.
  if (!item.pergunta || (!ilegivel && !familiaDoTexto(produto).familias.length)) return null;
  const campos: Partial<ItemDoPedido> = { status: 'fora_do_orcamento', pergunta: null, respostas: [...item.respostas, { pergunta_id: item.pergunta.id, resposta }] };
  await deps.armazem.atualizarItem(item.id, campos);
  await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: item.id, etapa: 'resposta', entrada: { pergunta: item.pergunta, escolha: resposta }, saida: { ...campos, correcao: true } });
  // A quantidade com a unidade que o cliente escreveu: "1 kg prego 17x21", e não "1 prego 17x21" (25/10).
  const trecho = item.extracao?.quantidade?.trecho?.trim();
  const quantidade = trecho && numeroDaQuantidade(trecho.replace(/[^\d.,/ ]/g, '').trim()) === numeroDaQuantidade(item.quantidade) ? trecho : item.quantidade;
  return ilegivel ? produto : [quantidade, produto].filter(Boolean).join(' ');
}

/** Sem os caracteres invisíveis que o WhatsApp põe na lista numerada ("2. ⁠chapa 18", 20/10). */
function semInvisiveis(texto: string): string {
  return texto.replace(/[​-‍⁠﻿]/g, '');
}

/**
 * A opção que a IA marcou contradiz o que o cliente escreveu na linha? 'familia': ele fala de outro produto (a resposta do
 * arame caiu na pergunta do prego). 'qualificador': ele pede algo que o produto escolhido não tem (rolinho, trançado).
 * Só olha palavras que o dicionário da família conhece; o resto não conta. Linha desconhecida: null.
 */
export function contradizOCliente(
  deps: Pick<Dependencias, 'catalogo'>, p: Pick<Pergunta, 'tipo' | 'opcoes'>, escolha: string, linha: string | null,
): 'familia' | 'qualificador' | 'medida' | null {
  if (!linha || !['escolha', 'nao_encontrado', 'confirmacao'].includes(p.tipo)) return null;
  const e = limpar(escolha).replace(/[.!]+$/, '');
  const indice = /^\d+$/.test(e) ? Number(e) - 1 : -1;
  const opcao = p.opcoes[indice >= 0 && indice < p.opcoes.length ? indice : opcaoDoTexto(p, escolha)];
  if (!opcao) return null;
  const produtos = opcao.codigos.map(c => deps.catalogo.porCodigo.get(c)).filter((x): x is NonNullable<typeof x> => !!x);
  const produto = opcao.codigos.length === 1 ? produtos[0] : undefined;
  if (produto) {
    const familias = familiaDoTexto(semInvisiveis(linha).replace(/(\d)([a-zA-ZÀ-ú])/g, '$1 $2')).familias;
    if (familias.length && !familias.includes(produto.familia)) return 'familia';
    for (const palavra of limpar(semInvisiveis(linha)).split(/[^a-z0-9]+/).filter(w => w.length >= 4)) {
      const q = lerQualificador(produto.familia, palavra);
      if (q.atributo && q.valor && produto.atributos[q.atributo] !== q.valor) return 'qualificador';
    }
  }
  if (medidaForaDaOpcao(linha, [opcao.rotulo, ...produtos.map(rotulo)])) return 'medida';
  return null;
}

// Um número de medida: "17", "2.5", "3/8", "1.1/2".
const NUMERO_DE_MEDIDA = String.raw`\d+(?:[.,]\d+)?(?:/\d+)?`;
const MEDIDA_ESCRITA = new RegExp(`${NUMERO_DE_MEDIDA}(?:\\s*x\\s*${NUMERO_DE_MEDIDA})+|\\d+(?:[.,]\\d+)?/\\d+`, 'g');

/**
 * O cliente escreveu uma medida ("17x21", "100 x 40", "3/8") que a opção escolhida não tem? Teste de 25/10: "17x21" à
 * pergunta "PREGO 13 X 15 ou 13 X 18" virou o 13 X 18 e ele confirmou a lista sem ver. Só olha medida com "x" e fração:
 * número solto ("arame 14", "2 kg") pode ser quantidade ou bitola e fica como está. A ordem não conta ("21x17").
 */
export function medidaForaDaOpcao(linha: string, rotulos: string[]): boolean {
  const numeros = (t: string): string[] => (t.match(new RegExp(NUMERO_DE_MEDIDA, 'g')) ?? []).map(n => n.replace(',', '.'));
  const daOpcao = new Set(rotulos.flatMap(r => numeros(limpar(r))));
  const escritas = limpar(semInvisiveis(linha)).match(MEDIDA_ESCRITA) ?? [];
  return escritas.some(m => numeros(m).some(n => !daOpcao.has(n)));
}

const DISSE_SIM = /\b(?:sim|sinm|s|isso|ok|pode|certo|correto|confirmo|esse|essa|mesmo|mesma|perfeito|exato|beleza|blz|fechado)\b/;

/**
 * A opção que a IA marcou foi dita pelo cliente? Número de opção: ele escreveu o número, ou escreveu o que a opção diz
 * ("arame 14" é a opção 3, ARAME 14). "sim": ele disse sim. Texto e quantidade passam.
 */
export function respostaFoiDita(escolha: string, texto: string, pergunta?: Pick<Pergunta, 'opcoes'>): boolean {
  const e = limpar(escolha).replace(/[.!]+$/, '').trim();
  const t = limpar(texto);
  const numeros: string[] = t.match(/\d+/g) ?? [];
  if (/^\d{1,2}$/.test(e)) {
    if (numeros.includes(e) || !pergunta) return numeros.includes(e);
    // O que ele escreveu cabe numa opção só: "arame 14" é o ARAME 14; "3kg de arame" cabe em todos os arames, não vale.
    // Com número escrito, vale o número ("chapa 18" é o 30X30X18: a palavra chapa não está no nome do produto).
    const todas = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').split(/[^a-z0-9/.]+/)
      .filter(w => (/\d/.test(w) ? w.length >= 2 : w.length >= 4));
    // "D.CORTE NORTON" é o disco de corte do catálogo; e palavra que nenhuma opção tem ("quero", "mais") não decide nada
    // (teste de 25/10 à noite: "quero mais 2 de disco de corte" não respondia o "mais de qual?").
    const rotulos = pergunta.opcoes.map((o, i) => ({ i, r: limpar(o.rotulo).replace(/\bd\.\s?(?=[a-z])/g, 'disco ') }));
    const comNumero = todas.filter(w => /\d/.test(w));
    const palavras = (comNumero.length ? comNumero : todas).filter(w => /\d/.test(w) || rotulos.some(o => o.r.includes(w)));
    const cabem = rotulos.filter(o => palavras.length > 0 && palavras.every(w => o.r.includes(w)));
    return cabem.length === 1 && cabem[0].i === Number(e) - 1;
  }
  if (/^(?:sim|s)$/.test(e)) return DISSE_SIM.test(t) || /\d/.test(t);
  // "nenhuma" que o cliente não disse ("17x21" virou "nenhuma - resposta customizada" e o prego foi para o vendedor, 25/10).
  if (/^(?:nao|nenhum)/.test(e)) return /\b(?:nao|n|nenhum\w*|outro|outra)\b/.test(t);
  return true;
}

/** Os números de pergunta que o cliente escreveu, quando toda linha da mensagem começa por um ("2. 3", "1 1kg / 2 arame 12"). */
export function numerosCitados(texto: string, perguntas: number): Set<number> | null {
  const linhas = linhasDaMensagem(texto).map(l => linhaNumerada(l.texto));
  if (!linhas.length || linhas.some(l => !l || l.numero < 1 || l.numero > perguntas)) return null;
  return new Set(linhas.map(l => l!.numero));
}

/**
 * "3", "3.", "1 (dever ser 20)": o cliente digitou o número da opção, e o número dele vale mais que o que a IA
 * devolveu (teste de 22/10: "1. 3" voltou da IA como a opção 1 e entrou o metalon errado). "3 kg" não é opção:
 * é quantidade. Sem número claro, null e vale a leitura da IA.
 */
export function numeroDigitado(linhaDoCliente: string | null): string | null {
  const m = /^\s*(\d{1,2})\s*(?:[).:\-–]|\(|$)/.exec(semInvisiveis(linhaDoCliente ?? ''));
  return m ? m[1] : null;
}

/** "2. chapa 18" → { numero: 2, resto: "chapa 18" }; "2 parafuso" também. */
export function linhaNumerada(texto: string): { numero: number; resto: string } | null {
  const m = /^\s*(\d{1,2})\s*(?:[.)\-:]\s*|\s+)(.*)$/.exec(semInvisiveis(texto));
  return m ? { numero: Number(m[1]), resto: m[2].trim() } : null;
}

/**
 * A linha é a resposta que a IA reconheceu? Pelo número ("N texto", com a
 * pergunta N respondida) ou pelo texto (a linha é a opção que ela escolheu).
 */
function linhaDeResposta(respostas: Extracao['respostas_a_perguntas'], perguntasNumeradas: number): (texto: string) => boolean {
  const numeros = new Set(respostas.map(r => r.pergunta_id.trim()).filter(id => /^\d+$/.test(id)).map(Number));
  // Só resposta com cara de produto ("Prego 17 x 21"); "sim" e "não" aparecem em linha de pedido ("SIMPLES").
  const palavras = (t: string): string => ` ${t.replace(/[^a-z0-9/]+/g, ' ').trim()} `;
  const textos = respostas.filter(r => r.pergunta_id !== 'lista').map(r => palavras(limpar(semInvisiveis(r.opcao_escolhida))))
    .filter(t => (t.match(/[a-z]/g) ?? []).length >= 4 && !SIM.test(t.trim()) && !NAO.test(t.trim()));
  // A linha que repete a própria resposta é resposta, mesmo curta: "5 kg" à pergunta da quantidade virou também
  // item novo, e a soma do L2 fez 10 kg (teste de 22/10).
  const repetidas = new Set(respostas.filter(r => r.pergunta_id !== 'lista').map(r => limpar(semInvisiveis(r.opcao_escolhida)).replace(/[.!\s]+$/, '').trim()).filter(Boolean));
  return texto => {
    if (repetidas.has(limpar(semInvisiveis(texto)).replace(/[.!\s]+$/, '').trim())) return true;
    const n = linhaNumerada(texto);
    if (n && n.resto && n.numero <= perguntasNumeradas && numeros.has(n.numero)) return true;
    const linha = palavras(limpar(n && n.numero <= perguntasNumeradas ? n.resto : semInvisiveis(texto)));
    return linha.trim().length >= 4 && textos.some(t => linha.includes(t) || t.includes(linha));
  };
}

/** "não, é vergalhão 3/8" → "vergalhão 3/8". */
function semNegacao(texto: string): string {
  return texto.replace(/^\s*(?:n[ãa]o|nenhuma?)(?=[\s,.:;-]|$)[\s,.:;-]*(?:(?:o certo é|é|e|era|eh|quero|seria)(?=[\s,.:;-]|$)[\s,.:;-]*)?/i, '').trim();
}

// ── a lista congelada ──

const FECHADOS: StatusDoItem[] = ['resolvido', 'respondido', 'nao_vende', 'fora_do_orcamento'];

export function hashDaLista(itens: ItemDoSnapshot[]): string {
  return createHash('sha256').update(JSON.stringify(itens.map(i => [i.item_id, i.codigo, i.quantidade]))).digest('hex');
}

export interface LinhaDaLista {
  item: ItemDoPedido; quantidade: string | null; ajustes: AjusteDeEmbalagem[]; somados: number;
  /** A unidade que todos os itens somados escreveram ("kg"), para a soma continuar "5 kg de"; null se algum não escreveu. */
  unidade: string | null;
}

/** A unidade escrita depois do número da quantidade: "2 kg" → "kg", "Um kilo" → "kilo", "10" → null. */
function unidadeEscrita(i: Pick<ItemDoPedido, 'extracao'>): string | null {
  const trecho = limpar(i.extracao?.quantidade?.trecho ?? '').match(/^(\d+(?:[.,]\d+)?|[a-z]+)\s*(.*)$/);
  return trecho && /^[a-z]/.test(trecho[2]) && E_UNIDADE.test(trecho[2].split(/\s+/)[0]) ? trecho[2].trim() : null;
}

const MESMA_UNIDADE: Record<string, string> = { k: 'kg', kilo: 'kg', kilos: 'kg', quilo: 'kg', quilos: 'kg', kgs: 'kg' };
const unidadeComparavel = (u: string | null): string | null => (u ? MESMA_UNIDADE[u] ?? u : null);

/**
 * Os itens anotados, um por produto. Duas linhas que viraram o mesmo produto somam
 * ("2 rolo" e "1 rolo" do mesmo farpado são 3, teste de 22/10). Só soma número com
 * número: "2 kg" e "5 barras" do mesmo código ficam separados.
 */
export function linhasDaLista(deps: Pick<Dependencias, 'catalogo'>, itens: ItemDoPedido[]): LinhaDaLista[] {
  const linhas: LinhaDaLista[] = [];
  for (const i of itens.filter(x => (x.status === 'resolvido' || x.status === 'respondido') && x.codigo_final)) {
    const venda = quantidadeDeVenda(deps, i);
    const n = venda.quantidade !== null ? Number(venda.quantidade) : NaN;
    const unidade = unidadeComparavel(unidadeEscrita(i));
    const mesma = Number.isFinite(n) ? linhas.find(l => l.item.codigo_final === i.codigo_final && l.quantidade !== null && Number.isFinite(Number(l.quantidade))
      && (!unidade || !l.unidade || unidade === unidadeComparavel(l.unidade))) : undefined;
    if (mesma) {
      mesma.quantidade = formatar(Number(mesma.quantidade) + n);
      mesma.somados++;
      // "2 kg" + "3 kg" de arame 14 são "5 kg de", não "5 ×" (teste de 25/10 à noite, a troca do trançado).
      if (!unidade || unidade !== unidadeComparavel(mesma.unidade)) mesma.unidade = null;
      if (venda.ajuste) mesma.ajustes.push(venda.ajuste);
      continue;
    }
    linhas.push({ item: i, quantidade: venda.quantidade, ajustes: venda.ajuste ? [venda.ajuste] : [], somados: 1, unidade: unidadeEscrita(i) });
  }
  return linhas;
}

/** A unidade da soma, só quando a linha soma itens sem ajuste de embalagem: um item só já mostra a dele. */
function unidadeDaSoma(l: LinhaDaLista): string | null {
  return l.somados > 1 && !l.ajustes.length ? l.unidade : null;
}

/** Gera o snapshot quando todos os itens estão fechados. Item com o vendedor só sai se o cliente escolheu seguir sem ele. */
export async function gerarSnapshot(deps: Dependencias, pedidoId: string): Promise<Snapshot | null> {
  const itens = await deps.armazem.itens(pedidoId);
  if (!itens.length || itens.some(i => !FECHADOS.includes(i.status))) return null;
  const lista: ItemDoSnapshot[] = linhasDaLista(deps, itens).map(({ item: i, quantidade }) => {
    const p = deps.catalogo.porCodigo.get(i.codigo_final!);
    return { item_id: i.id, codigo: i.codigo_final!, descricao: p ? rotulo(p) : i.codigo_final!, quantidade };
  });
  if (!lista.length) return null;
  const snapshot = await deps.armazem.gravarSnapshot({ pedido_id: pedidoId, hash: hashDaLista(lista), itens: lista });
  // A mesma lista já confirmada não volta atrás: em 16/10 a resposta ao "sim" gerava o snapshot de novo
  // e o v2_pedidos voltava a 'aguardando_confirmacao' (T12). Lista que mudou depois da confirmação volta a
  // esperar o "sim": em 21/10 o "sim" sozinho não confirmava mais nada.
  if (!snapshot.confirmado) await deps.armazem.atualizarPedido(pedidoId, { estado: 'aguardando_confirmacao' });
  return snapshot;
}

/** O cliente confirmou a lista: o último snapshot gerado passa a valer. */
export async function confirmarLista(deps: Dependencias, pedidoId: string): Promise<Snapshot | null> {
  const snapshot = (await deps.armazem.snapshots(pedidoId)).at(-1);
  if (!snapshot) return null;
  // Lista reaberta por um aviso e confirmada de novo sem mudar: o snapshot já valia, o pedido volta a confirmado.
  if (snapshot.confirmado) { await deps.armazem.atualizarPedido(pedidoId, { estado: 'confirmado' }); return snapshot; }
  const atual = await gerarSnapshot(deps, pedidoId);
  if (!atual || atual.hash !== snapshot.hash) return null;
  await deps.armazem.confirmarSnapshot(snapshot.id);
  await deps.armazem.atualizarPedido(pedidoId, { estado: 'confirmado' });
  return { ...snapshot, confirmado: true };
}

export class ErroListaNaoConfirmada extends Error {}

/**
 * Preço e criação do orçamento só aceitam um snapshot confirmado, pelo hash.
 * Sem ele, a chamada é recusada aqui, no servidor, antes de chegar ao ERP.
 */
export async function comListaConfirmada<T>(armazem: ArmazemV2, pedidoId: string, hash: string, operacao: (itens: ItemDoSnapshot[]) => Promise<T>): Promise<T> {
  const snapshot = (await armazem.snapshots(pedidoId)).find(s => s.hash === hash);
  if (!snapshot || !snapshot.confirmado) throw new ErroListaNaoConfirmada(`lista ${hash.slice(0, 8)} não confirmada pelo cliente: orçamento recusado`);
  return operacao(snapshot.itens);
}

// ── as perguntas como o cliente as vê ──

/** Uma pergunta numerada na mensagem. Perguntas iguais sobre o mesmo trecho viram uma só, e a resposta vale para todos os itens dela. */
export interface PerguntaNaTela { numero: number; pergunta: Pergunta; itens: ItemDoPedido[] }

/**
 * As perguntas na ordem e com o número que o cliente vê; a IA da extração
 * recebe os mesmos números. Antes ela via "p7" enquanto o cliente via "1", e
 * "Sim para 2 e 3" foi parar na pergunta errada (20/10). Teste de 20/10
 * também: a frase das vigas virou duas perguntas idênticas, 6 e 7 (T17).
 */
export function perguntasNaTela(itens: ItemDoPedido[]): { numeradas: PerguntaNaTela[]; comVendedor: ItemDoPedido[] } {
  const perguntas = itens.filter(i => i.status === 'pergunta' && i.pergunta);
  const comVendedor = itens.filter(i => i.status === 'vendedor' && i.pergunta);
  const numeradas: PerguntaNaTela[] = [];
  const porChave = new Map<string, PerguntaNaTela>();
  for (const i of perguntas.length ? perguntas : comVendedor) {
    const p = i.pergunta!;
    const chave = JSON.stringify([p.tipo, p.texto, p.opcoes.map(o => [o.rotulo, o.codigos])]);
    const igual = porChave.get(chave);
    if (igual) { igual.itens.push(i); continue; }
    const nova = { numero: numeradas.length + 1, pergunta: p, itens: [i] };
    porChave.set(chave, nova);
    numeradas.push(nova);
  }
  return { numeradas, comVendedor: perguntas.length ? comVendedor : [] };
}

/**
 * Os itens de uma resposta da IA, como estão agora: pelo número que o cliente
 * viu (na `tela` mostrada antes desta mensagem) ou, se vier, pelo id da pergunta.
 */
function itensDaPergunta(tela: PerguntaNaTela[], itens: ItemDoPedido[], perguntaId: string): ItemDoPedido[] {
  const id = perguntaId.trim();
  const numero = /^(?:pergunta\s*)?(\d+)$/i.exec(id);
  if (numero) {
    const ids = new Set(tela.find(g => g.numero === Number(numero[1]))?.itens.map(i => i.id) ?? []);
    return itens.filter(i => ids.has(i.id));
  }
  return itens.filter(i => i.pergunta?.id === id);
}

/**
 * Teste de 21/10, pergunta do Leonardo: o cliente responde a 2 no número 1 e a 1 no número 2. Quando o texto
 * da resposta não cabe nas opções da pergunta de número N e cabe, inteiro, nas de uma só outra, vale o conteúdo.
 * Resposta que é só um número não tem o que comparar: fica onde o cliente pôs.
 */
export function numeroPeloConteudo(tela: PerguntaNaTela[], numero: string, escolha: string, resolvidas: Set<number> = new Set()): string {
  const n = /^(?:pergunta\s*)?(\d+)$/i.exec(numero.trim());
  if (!n || /^\s*\d+\s*[.)]?\s*$/.test(escolha)) return numero;
  const comOpcoes = (g: PerguntaNaTela): boolean => g.pergunta.opcoes.length > 0 && g.pergunta.tipo !== 'quantidade';
  const alvo = tela.find(g => g.numero === Number(n[1]));
  if (!alvo || !comOpcoes(alvo) || opcaoDoTexto(alvo.pergunta, escolha) >= 0) return numero;
  const outras = tela.filter(g => g !== alvo && !resolvidas.has(g.numero) && comOpcoes(g) && opcaoDoTexto(g.pergunta, escolha) >= 0);
  return outras.length === 1 ? String(outras[0].numero) : numero;
}

/** Aplica a resposta a todos os itens da pergunta (as perguntas iguais agrupadas). */
async function responderNaTela(deps: Dependencias, pedidoId: string, tela: PerguntaNaTela[], perguntaId: string, escolha: string): Promise<boolean> {
  const alvo = itensDaPergunta(tela, await deps.armazem.itens(pedidoId), perguntaId);
  let aplicou = false;
  for (const i of alvo) if (i.pergunta && await aplicarResposta(deps, pedidoId, i.pergunta.id, escolha)) aplicou = true;
  return aplicou;
}

// ── editar a lista (T2, T6, T15) ──
//
// Até 20/10 a lista só sabia incluir: "Mas pode tirar os 2 primeiros..." foi
// para o vendedor e "Não teve esse produto não" repetiu a pergunta. Tirar e
// trocar são lidos aqui, no código, sem IA. Número na edição é sempre o da
// pergunta (é a única coisa numerada na mensagem); item da lista é pelo nome
// ou pela posição ("os 2 primeiros").

/** `soAnotados`: "o perfil de 68 colocar na chapa 1.8" só mexe em item já anotado; item com pergunta aberta se responde pela pergunta. */
export type Edicao = { tipo: 'tirar'; alvo: string } | { tipo: 'trocar'; alvo: string; por: string; soAnotados?: true };

// "sim, mas tira o prego" (22/10) também é edição.
const ANTES_DO_VERBO = String.raw`^(?:(?:sim|s|ok|beleza|certo|isso|mas|e|ah|entao|so)[\s,]+)*(?:(?:pode|podes|por favor|favor|quero|queria|preciso|vou)\s+)*`;
const TIRAR = new RegExp(`${ANTES_DO_VERBO}(?:tirar|tira|tire|retirar|retira|retire|remover|remove|remova|excluir|exclui|exclua|cancelar|cancela|cancele|apagar|apaga|apague)\\b\\s*(.*)$`);
const TROCAR = new RegExp(`${ANTES_DO_VERBO}(?:trocar|troca|troque|mudar|muda|mude|substituir|substitui|substitua)\\b\\s*(.*?)\\s*\\b(?:por|pelo|pela|pelos|pelas)\\s+(.+)$`);
const NAO_QUER = /^(?:(?:mas|e|ah)\s+)*nao\s+(?:teve|tem|tinha|existe|existia|pedi|quero|queria|preciso|precisa|vou querer|vai precisar)\b\s*(.*)$/;
// 22/10 (Vendedor 1): "Coloque o arame trançado no lugar do arame 14" e "o perfil de 68 colocar na chapa 1.8".
const NO_LUGAR = new RegExp(`${ANTES_DO_VERBO}(?:colocar|coloca|coloque|botar|bota|bote|usar|usa|use|poe|ponha)\\s+(.+?)\\s+no lugar\\s+d[eoa]s?\\s+(.+)$`);
const MUDAR_DETALHE = /^(?:(?:o|a|os|as)\s+)?(.+?)\s+(?:colocar|coloca|coloque|pode colocar|pode ser|botar|bota|ponha|poe|fica|ficar|deixa|deixar|mudar|muda|mude)\s+(?:na|no|em|para a|para o|pra)\s+((?:chapa|bitola|furo|espessura|largura)\s*\S+|\S+)$/;

const ALVO_DE_CANCELAR = /^(?:(?:o|a|os|as|esse|este|essa|esta|meu|minha)\s+)?(?:tudo|todos|todas|tudo isso|orcamento|pedido|lista|compra|mais|mais nada)$/;

/** O alvo sem o enfeite do fim: "esse produto não" → "esse produto". */
function alvoLimpo(alvo: string): string {
  return alvo.replace(/[,;:!.]+/g, ' ').replace(/(?:\s+(?:nao|por favor|favor|tambem|ai|da lista|do pedido|do orcamento))+\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** "tirar os 2 primeiros", "trocar o 2 por telha galvalume", "não teve esse produto". Pergunta ou outra coisa: null. */
export function lerEdicao(linha: string): Edicao | null {
  const t = limpar(semInvisiveis(linha)).replace(/[!.]+$/, '').trim();
  if (t.includes('?')) return null;
  const troca = TROCAR.exec(t);
  if (troca) return { tipo: 'trocar', alvo: alvoLimpo(troca[1]), por: troca[2].replace(/^(?:o|a|os|as|um|uma)\s+/, '').replace(/[!.]+$/, '').trim() };
  const noLugar = NO_LUGAR.exec(t);
  if (noLugar) return { tipo: 'trocar', alvo: alvoLimpo(noLugar[2]), por: noLugar[1].replace(/^(?:o|a|os|as|um|uma)\s+/, '').trim() };
  const detalhe = MUDAR_DETALHE.exec(t.replace(/\s+tambem$/, ''));
  if (detalhe) return { tipo: 'trocar', alvo: alvoLimpo(detalhe[1]), por: detalhe[2].trim(), soAnotados: true };
  const tira = TIRAR.exec(t) ?? NAO_QUER.exec(t);
  if (!tira) return null;
  // "não quero esse, quero o de 0.43": é correção de produto, segue pelo caminho da correção.
  if (/\b(?:quero|prefiro|seria|e sim)\b/.test(tira[1])) return null;
  const alvo = alvoLimpo(tira[1]);
  // Válvula de escape (22/10): "cancela tudo", "cancela o orçamento", "não quero mais" pedem para cancelar o
  // orçamento, não para tirar item; e "cancela" sozinho tirava o item da única pergunta pendente.
  if (ALVO_DE_CANCELAR.test(alvo) || (!alvo && /^(?:(?:mas|e|ah|so)\s+)*cancel/.test(t))) return null;
  return { tipo: 'tirar', alvo };
}

const PRONOME = /^(?:(?:o|a|os|as|esse|essa|este|esta|esses|essas|estes|estas|isso|isto|ele|ela|eles|elas|dele|dela|deles|delas|produto|produtos|item|itens|mesmo|mesma|aqui)\s*)*$/;
const POR_EXTENSO: Record<string, number> = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
const ORDINAL = /\b(?:(?:os|as)\s+)?(\d+|dois|duas|tres|quatro|cinco|seis)\s+(primeir|ultim)[oa]s\b|\b(?:(?:o|a)\s+)?(primeir|ultim)[oa]\b/;
const UNIDADE = String.raw`(?:kg|k|kilos?|quilos?|barras?|varas?|pecas?|unidades?|un|rolos?|metros?|mt|mts|m|caixas?|latas?|chapas?|folhas?)`;
const SEM_PESO = new Set(['de', 'do', 'da', 'dos', 'das', 'o', 'a', 'os', 'as', 'um', 'uma', 'e', 'com', 'pra', 'para', 'por', 'favor', 'mas', 'pode', 'tambem', 'kg', 'k', 'kilo', 'kilos', 'quilo', 'quilos', 'barra', 'barras', 'vara', 'varas', 'peca', 'pecas', 'unidade', 'unidades', 'un', 'rolo', 'rolos', 'metro', 'metros', 'mt', 'mts', 'm', 'x', 'esse', 'essa', 'aquele', 'aquela']);

const tokens = (t: string): string[] => limpar(t).replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)\s*x\s*(\d)/g, '$1 $2')
  .split(/[^a-z0-9/]+/).filter(Boolean).map(w => (w.length >= 5 && w.endsWith('s') ? w.slice(0, -1) : w));

/**
 * O que o cliente escreveu do item. Linha com um item só: a linha. Linha com vários (uma lista toda por áudio): só o
 * pedaço dele, montado da leitura da IA; a linha inteira faz "arame 14" casar com o perfil de medida 14 (teste de 22/10).
 */
function textoOriginalDoItem(item: ItemDoPedido, todos: ItemDoPedido[]): string {
  // A linha com vários itens guarda o texto de cada um com a família no fim: "10 varas, 2 discos (disco)".
  const base = (t: string): string => t.replace(/ \([^)]*\)$/, '');
  const sozinho = todos.filter(x => base(x.texto_original) === base(item.texto_original)).length <= 1;
  const e = item.extracao;
  if (sozinho || !e) return base(item.texto_original);
  return [...new Set([e.quantidade?.trecho, e.familia.replace(/_/g, ' '), ...e.medidas.map(m => m.trecho), ...e.qualificadores].filter((x): x is string => !!x))].join(' ');
}

/** As palavras do item para achar pelo nome: o produto anotado e o que o cliente escreveu dele. */
function palavrasDoItem(item: ItemDoPedido, todos: ItemDoPedido[], deps: Pick<Dependencias, 'catalogo'>): Set<string> {
  const p = item.codigo_final ? deps.catalogo.porCodigo.get(item.codigo_final) : undefined;
  return new Set(tokens(`${p ? rotulo(p) : ''} ${textoOriginalDoItem(item, todos)}`));
}

/** Os itens que o nome do pedaço descreve, sem desempatar: "arame 14" casa com o arame 14 e só. null: o pedaço não tem nome. */
function casamComONome(pedaco: string, ativos: ItemDoPedido[], deps: Pick<Dependencias, 'catalogo'>): { casam: ItemDoPedido[]; quantidade: string | null } | null {
  const solto = limpar(pedaco).replace(/(\d)([a-z])/g, '$1 $2');
  const q = new RegExp(String.raw`(?:^|\s)(\d+(?:[.,]\d+)?|${Object.keys(POR_EXTENSO).join('|')})\s+${UNIDADE}\b|^(\d+(?:[.,]\d+)?)\s`).exec(solto);
  const quantidade = q ? numeroDaQuantidade(q[1] ?? q[2]) : null;
  const semQuantidade = q ? solto.replace(q[0], ' ') : solto;
  const todas = tokens(semQuantidade);
  const palavras = todas.filter(w => !SEM_PESO.has(w));
  // "a vara de 5/16": o nome é a medida, e a palavra de unidade mostra que é um item e não uma quantidade solta.
  const peloNumero = palavras.length > 0 && todas.some(w => /^(?:vara|varas|barra|barras|rolo|rolos|peca|pecas)$/.test(w));
  if (!palavras.some(w => /[a-z]{3,}/.test(w)) && !peloNumero) return null;
  return { casam: ativos.filter(i => { const doItem = palavrasDoItem(i, ativos, deps); return palavras.every(w => doItem.has(w)); }), quantidade };
}

/** Os itens de um pedaço do alvo ("2kg de prego"): pelas palavras e, se repetir, pela quantidade. null: nenhum ou mais de um. */
function itensDoNome(pedaco: string, ativos: ItemDoPedido[], deps: Pick<Dependencias, 'catalogo'>): ItemDoPedido[] | null {
  const achado = casamComONome(pedaco, ativos, deps);
  if (!achado) return null;
  const { casam, quantidade } = achado;
  const certos = casam.length > 1 && quantidade ? casam.filter(i => numeroDaQuantidade(i.quantidade) === quantidade) : casam;
  return certos.length === 1 ? certos : null;
}

/**
 * Os itens que a edição aponta. `pergunta`: o número da linha ("2 não quero").
 * null quando não dá para saber com certeza: aí nada muda e o cliente é avisado.
 */
function alvosDaEdicao(alvo: string, pergunta: number | null, itens: ItemDoPedido[], tela: PerguntaNaTela[], deps: Pick<Dependencias, 'catalogo'>, soAnotados = false): ItemDoPedido[] | null {
  const daPergunta = (n: number): ItemDoPedido[] | null => {
    const ids = new Set(tela.find(g => g.numero === n)?.itens.map(i => i.id) ?? []);
    const achados = itens.filter(i => ids.has(i.id));
    return achados.length ? achados : null;
  };
  if (PRONOME.test(alvo)) return pergunta ? daPergunta(pergunta) : tela.length === 1 ? daPergunta(1) : null;
  const numero = /^(?:(?:o|a)\s+)?(?:numero|n|pergunta|opcao)?\s*(\d{1,2})$/.exec(alvo);
  if (numero) return daPergunta(Number(numero[1]));

  const todosAtivos = itens.filter(i => i.status !== 'fora_do_orcamento' && i.status !== 'nao_vende');
  const anotados = todosAtivos.filter(i => (i.status === 'resolvido' || i.status === 'respondido') && i.codigo_final);
  const ativos = soAnotados ? anotados : todosAtivos;
  const ordinal = ORDINAL.exec(alvo);
  const pelaPosicao = ((): ItemDoPedido[] | null => {
    if (!ordinal) return null;
    const n = ordinal[1] ? (POR_EXTENSO[ordinal[1]] ?? Number(ordinal[1])) : 1;
    const doFim = (ordinal[2] ?? ordinal[3]) === 'ultim';
    const lista = doFim ? anotados.slice(-n) : anotados.slice(0, n);
    return n > 0 && lista.length === n ? lista : null;
  })();
  const resto = ordinal ? alvo.replace(ordinal[0], ' ').trim() : alvo;
  // "2kg de prego e 5 barras de vergalhão": um pedaço por item. "corte e dobra" não se divide: tenta inteiro antes.
  const inteiro = resto ? itensDoNome(resto, ativos, deps) : null;
  const pedacos = resto.split(/\s*,\s*|\s+e\s+/).filter(p => /[a-z]{3,}/.test(p));
  const porPedaco = pedacos.map(p => itensDoNome(p, ativos, deps));
  const pelosNomes = inteiro ?? (pedacos.length && porPedaco.every(Boolean) ? [...new Set(porPedaco.flatMap(x => x!))] : null);
  return pelosNomes ?? pelaPosicao;
}

/** Item novo de uma troca: mesma família, o texto antigo ganha a troca ("5 telhas com 5,5 metros galvalume"); outra família, a quantidade e o produto novo. */
function textoDaTroca(item: ItemDoPedido, por: string, todos: ItemDoPedido[]): string {
  const familias = familiaDoTexto(por).familias;
  // "arame 18 trançado" no lugar de "arame 14": o novo já diz o produto inteiro, e somar com o texto antigo daria duas
  // bitolas. Só quando o item tem no máximo uma medida; telha (comprimento e espessura) segue somando ao texto antigo.
  const completo = !!item.extracao && familias.includes(item.extracao.familia) && /\d/.test(por) && item.extracao.medidas.length <= 1;
  if (completo) return [numeroDaQuantidade(item.quantidade), por].filter(Boolean).join(' ');
  if (!familias.length || (item.extracao && familias.includes(item.extracao.familia))) return `${textoOriginalDoItem(item, todos)} ${por}`;
  return [numeroDaQuantidade(item.quantidade), por].filter(Boolean).join(' ');
}

interface EdicoesDaMensagem {
  /** Linhas da mensagem (id de linhasDaMensagem) que eram edição: não viram item. */
  linhas: Set<number>;
  /** Perguntas (número da tela) que a edição já resolveu: a resposta da IA a elas não vale. */
  perguntas: Set<number>;
  /** Textos de itens novos (as trocas), para a extração. */
  novos: string[];
  avisos: string[];
}

/** Lê e aplica os pedidos de tirar e trocar da mensagem. */
async function aplicarEdicoes(deps: Dependencias, pedidoId: string, texto: string, tela: PerguntaNaTela[]): Promise<EdicoesDaMensagem> {
  const feito: EdicoesDaMensagem = { linhas: new Set(), perguntas: new Set(), novos: [], avisos: [] };
  for (const l of linhasDaMensagem(texto)) {
    const n = linhaNumerada(l.texto);
    const pergunta = n && n.numero <= tela.length ? n.numero : null;
    const doCliente = pergunta ? n!.resto : l.texto;
    // Duas instruções na mesma frase ("trocar o arame 14 pelo 18 trançado e o perfil de 68 colocar na chapa 1.8"):
    // só se divide quando CADA pedaço é uma edição; senão a frase vai inteira, como antes.
    const pedacos = doCliente.split(/\s+e\s+/);
    const edicoes = pedacos.length > 1 && pedacos.every(p => lerEdicao(p)) ? pedacos.map(p => lerEdicao(p)!) : [lerEdicao(doCliente)];
    if (edicoes.some(e => !e)) continue;
    for (const edicao of edicoes as Edicao[]) {
      const itens = await deps.armazem.itens(pedidoId);
      const alvos = alvosDaEdicao(edicao.alvo, pergunta, itens, tela, deps, edicao.tipo === 'trocar' && !!edicao.soAnotados);
      // "O perfil de 100 pode colocar na chapa 1.8" a uma pergunta aberta é resposta, não edição: segue para a IA.
      if (!alvos && edicao.tipo === 'trocar' && edicao.soAnotados) continue;
      feito.linhas.add(l.id);
      if (!alvos) {
        const ativos = itens.filter(i => i.status !== 'fora_do_orcamento' && i.status !== 'nao_vende');
        const parecidos = casamComONome(edicao.alvo, ativos, deps)?.casam ?? [];
        const quais = parecidos.length > 1
          ? ` Combinam: ${parecidos.map(i => { const p = i.codigo_final ? deps.catalogo.porCodigo.get(i.codigo_final) : undefined; return `"${p ? rotulo(p) : textoOriginalDoItem(i, ativos)}"`; }).join(', ')}.`
          : '';
        feito.avisos.push(`Não sei qual ${edicao.tipo === 'tirar' ? 'tirar' : 'trocar'}: "${l.texto}".${quais} Pode escrever o nome como está na lista?`);
        continue;
      }
      if (pergunta) feito.perguntas.add(pergunta);
      for (const g of tela) if (g.itens.some(i => alvos.some(a => a.id === i.id))) feito.perguntas.add(g.numero);
      for (const item of alvos) {
        const campos: Partial<ItemDoPedido> = { status: 'fora_do_orcamento', pergunta: null, respostas: [...item.respostas, { pergunta_id: 'edicao', resposta: l.texto }] };
        await deps.armazem.atualizarItem(item.id, campos);
        await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: item.id, etapa: 'resposta', entrada: { edicao, linha: l.texto }, saida: campos });
        if (edicao.tipo === 'trocar') feito.novos.push(textoDaTroca(item, edicao.por, itens));
      }
    }
  }
  return feito;
}

/**
 * Palavras que não dizem qual produto nem qual número: o jeito de pedir a troca. Uma mensagem com
 * UM número, o nome de um item da lista e só estas palavras é troca de quantidade, escrita de
 * qualquer jeito ("na verdade são 4 discos", "são quatro discos, na verdade", "o que eu quis dizer
 * foi 4 discos", "aumenta para 4"). Palavra fora daqui e fora do nome do item ("desbaste") deixa
 * a mensagem para a IA: pode ser outro produto.
 */
const SO_O_JEITO = new Set(['na', 'no', 'em', 'verdade', 'sao', 'e', 'era', 'eram', 'foi', 'fica', 'ficam', 'vai', 'vao', 'ser', 'seria', 'serao',
  'quero', 'queria', 'quis', 'dizer', 'digo', 'que', 'eu', 'so', 'mesmo', 'mesma', 'entao', 'desculpa', 'desculpe', 'ops', 'opa', 'errei', 'erro',
  'corrigindo', 'corrige', 'corrigir', 'corrija', 'aumenta', 'aumentar', 'aumente', 'diminui', 'diminuir', 'diminua', 'muda', 'mudar', 'mude',
  'altera', 'alterar', 'altere', 'coloca', 'colocar', 'coloque', 'poe', 'bota', 'botar', 'mais', 'adiciona', 'adicionar', 'adicione',
  'acrescenta', 'acrescentar', 'acrescente', 'nao', 'sim', 'ok', 'total', 'preciso', 'precisa', 'quantidade', 'item', 'ai', 'la', 'isso', 'certo',
  'correto', 'ao', 'inves', 'lugar', 'vez']);

/** As palavras de SO_O_JEITO que dizem que a mensagem muda um item ("são 4", "na verdade", "aumenta"), e não que pede outro. */
const MARCA_DE_TROCA = new Set([...SO_O_JEITO].filter(w => !['na', 'no', 'em', 'e', 'que', 'eu', 'quero', 'queria', 'preciso', 'precisa',
  'ok', 'sim', 'nao', 'mesmo', 'mesma', 'entao', 'ai', 'la', 'isso', 'certo', 'correto', 'ao', 'item', 'adiciona', 'adicionar', 'adicione',
  'acrescenta', 'acrescentar', 'acrescente'].includes(w)));

export type TrocaDeQuantidade ={ item: ItemDoPedido; quantidade: string } | { aviso: string };

/** Lê "são 4 discos" e afins. null: não é troca de quantidade (ou não dá para ter certeza do item). */
export function lerTrocaDeQuantidade(deps: Pick<Dependencias, 'catalogo'>, texto: string, itens: ItemDoPedido[]): TrocaDeQuantidade | null {
  if (texto.includes('?') || linhasDaMensagem(texto).length !== 1) return null;
  const t = numerosEscritos(texto);
  const numeros = t.match(/\d+(?:[.,]\d+)?/g) ?? [];
  if (numeros.length !== 1) return null;
  const n = Number(numeros[0].replace(',', '.'));
  if (!(n > 0)) return null;
  const anotados = itens.filter(i => (i.status === 'resolvido' || i.status === 'respondido') && i.codigo_final);
  if (!anotados.length) return null;
  const palavras = tokens(t.replace(numeros[0], ' ')).filter(w => !SO_O_JEITO.has(w) && !SEM_PESO.has(w));
  const familias = familiaDoTexto(texto).familias;
  const candidatos = anotados
    .filter(i => !familias.length || familias.includes(i.extracao?.familia ?? ''))
    .filter(i => { const nome = palavrasDoItem(i, itens, deps); return palavras.every(w => nome.has(w)); });
  if (!palavras.length && !familias.length && !/\b(?:aumenta|diminui|muda|altera|coloca|poe|bota|corrig)\w*/.test(t)) return null;
  // "3 kg de arame" com dois arames na lista é um arame novo, não "qual fica com 3?" (25/10). Só pergunta qual item
  // quando a mensagem diz que é troca ("são", "na verdade", "muda", "mais"...).
  if (candidatos.length > 1 && !tokens(t).some(w => MARCA_DE_TROCA.has(w))) return null;
  if (candidatos.length > 1) return { aviso: `Qual item fica com ${formatar(n)}? Escreve o nome, por exemplo: ${formatar(n)} ${palavras[0] ?? 'barras de vergalhão'}.` };
  if (candidatos.length !== 1) return null;
  const alvo = candidatos[0];
  const soma = /\b(?:mais|adicion\w*|acrescent\w*)\b/.test(t);
  const antes = Number(numeroDaQuantidade(alvo.quantidade));
  const quantidade = formatar(soma && Number.isFinite(antes) ? antes + n : n);
  return quantidade === numeroDaQuantidade(alvo.quantidade) ? null : { item: alvo, quantidade };
}

// ── mudar a lista pelas operações da IA (V2_OPERACOES, 25/10) ──
//
// A IA vê a lista numerada e diz o que mudar, com as palavras do cliente. O código confere antes de aplicar: as
// palavras estão na mensagem, apontam aquele item (família e medida escritas batem) e só ele, e o valor novo também
// foi escrito pelo cliente. O que não confere não muda nada e vira pergunta.

/** Uma linha da lista como a IA vê: o número, o que o cliente lê e os itens por trás (o mesmo produto em duas linhas soma). */
export interface LinhaParaAIA { numero: number; descricao: string; nome: string; familia: string; quantidade: string | null; itens: ItemDoPedido[] }

export function listaParaAIA(deps: Pick<Dependencias, 'catalogo'>, itens: ItemDoPedido[]): LinhaParaAIA[] {
  return linhasDaLista(deps, itens).map((l, k) => {
    const p = deps.catalogo.porCodigo.get(l.item.codigo_final!);
    const nome = p ? rotulo(p) : l.item.codigo_final!;
    return {
      numero: k + 1,
      descricao: `${quantidadeNaLista(l.item, l.quantidade, unidadeDaSoma(l))} ${nome}`,
      nome,
      familia: p?.familia ?? l.item.extracao?.familia ?? '',
      quantidade: l.quantidade,
      itens: itens.filter(i => (i.status === 'resolvido' || i.status === 'respondido') && i.codigo_final === l.item.codigo_final),
    };
  });
}

const POSICAO = /\b(?:primeir|segund|terceir|quart|quint|ultim|penultim)\w*/;

/** As linhas da lista que as palavras do cliente podem apontar: a família e a medida escritas têm de bater. */
function linhasApontadas(trecho: string, lista: LinhaParaAIA[], mensagem: string): LinhaParaAIA[] {
  const familias = familiaDoTexto(trecho).familias;
  let apontadas = lista.filter(l => (!familias.length || familias.includes(l.familia)) && !medidaForaDaOpcao(trecho, [l.descricao]));
  // Medição de 25/10: "o perfil de 68" com dois perfis, e "5 kg / de arame trançado" com dois arames, ficavam sem
  // dono. Desempata o número solto do trecho (68) e, depois, a palavra da mensagem que só um dos itens tem (trançado).
  const numeros = (t: string): string[] => (limpar(t).match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => n.replace(',', '.'));
  const soltos = numeros(trecho.replace(MEDIDA_ESCRITA, ' '));
  const comOsNumeros = apontadas.filter(l => soltos.length > 0 && soltos.every(n => numeros(l.descricao).includes(n)));
  if (apontadas.length > 1 && comOsNumeros.length >= 1) apontadas = comOsNumeros;
  // A medida escrita na mensagem ("troca o metalon por outro tipo 100x40"), quando só um item a tem.
  if (apontadas.length > 1) {
    const comAMedida = apontadas.filter(l => (limpar(mensagem).match(MEDIDA_ESCRITA) ?? []).some(m => !medidaForaDaOpcao(m, [l.descricao])));
    if (comAMedida.length === 1) apontadas = comAMedida;
  }
  // "disco de corte" com dois discos de corte e um de desbaste: a palavra do cliente que só parte dos itens tem ("corte")
  // tira os outros da conta. "D.CORTE" do catálogo é o disco de corte (teste de 25/10 à noite).
  if (apontadas.length > 1) {
    const doItem = (l: LinhaParaAIA): string => limpar(l.descricao).replace(/\bd\.\s?(?=[a-z])/g, 'disco ');
    const quePesam = limpar(trecho).split(/[^a-z]+/).filter(w => w.length >= 4
      && apontadas.some(l => doItem(l).includes(w)) && !apontadas.every(l => doItem(l).includes(w)));
    const comTodas = apontadas.filter(l => quePesam.every(w => doItem(l).includes(w)));
    if (quePesam.length && comTodas.length) apontadas = comTodas;
  }
  if (apontadas.length > 1) {
    const palavras = (t: string): string[] => limpar(t).split(/[^a-z]+/).filter(w => w.length >= 4);
    const daMensagem = new Set(palavras(mensagem));
    const comPalavra = apontadas.filter(l => palavras(l.descricao).some(w => daMensagem.has(w)
      && apontadas.filter(o => palavras(o.descricao).includes(w)).length === 1));
    if (comPalavra.length === 1) apontadas = comPalavra;
  }
  return apontadas;
}

// "são 4", "na verdade", "é só 5", "muda": a mensagem diz que o item muda. "mais 2", "acrescenta": soma.
const SOMA = /\b(?:mais|adicion\w*|acrescent\w*|soma\w*|outr[oa]s?|tambem)\b/;
const E_TROCA_DE_QUANTIDADE = /\b(?:sao|so|verdade|era|eram|fica\w*|muda\w*|mude|altera\w*|aumenta\w*|diminu\w*|corrig\w*|total|quantidade|errei|quis|troc\w*)\b/;

function numerosDaMensagem(texto: string): string[] {
  return (numerosEscritos(texto).match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => formatar(Number(n.replace(',', '.'))));
}

/** O trecho sem o valor novo, que às vezes vem dentro dele ("vergalhão de 3/8 colocar na bitola 1/2", medição de 25/10): ele não aponta o item. */
function trechoDoItem(op: OperacaoNaLista): string {
  const novos = op.tipo === 'mudar_medida' ? [op.medida.valor] : op.tipo === 'trocar_produto' ? [op.trecho_novo, ...op.por.medidas.map(m => m.valor)] : [];
  return novos.filter(Boolean).reduce((t, v) => limpar(t).split(limpar(v)).join(' '), op.trecho);
}

// Palavras que dizem que um produto sai para outro entrar.
const TROCA = /\b(?:troc\w*|substitu\w*|lugar|vez|inves|mud\w*|pass\w*|coloc\w*|bot\w*|ponh\w*|poe|volt\w*)\b/;
// "quero fechar o orçamento", "pode finalizar", "só isso".
const QUER_FECHAR_A_LISTA = /\b(?:fechar|fecha|feche|finaliz\w*|conclu\w*|so isso|e isso ai)\b/;
// Pedido de mais um produto: "adiciona", "acrescenta", "quero", "preciso", "também".
const PEDE_PRODUTO = /\b(?:adicion\w*|acrescent\w*|inclu\w*|quero|preciso|tambem|mais)\b/;

/** Null: a operação confere. Senão, o aviso ao cliente. */
export function conferirOperacao(op: OperacaoNaLista, lista: LinhaParaAIA[], texto: string): string | null {
  const mensagem = limpar(texto);
  const verbo = op.tipo === 'tirar' ? 'tirar' : op.tipo === 'mudar_quantidade' ? 'mudar' : 'trocar';
  const naoSei = (combinam: LinhaParaAIA[] = []): string => `Não sei qual ${verbo}: "${op.trecho}".${combinam.length > 1 && combinam.length <= 3 ? ` Combinam: ${combinam.map(l => `"${l.descricao}"`).join(', ')}.` : ''} Pode escrever o nome como está na lista?`;
  const linha = lista.find(l => l.numero === op.item);
  if (!linha || !mensagem.includes(limpar(op.trecho))) return naoSei();
  const apontadas = linhasApontadas(trechoDoItem(op), lista, texto);
  if (!apontadas.includes(linha)) return naoSei(apontadas);
  // "o arame" com dois arames na lista: a IA escolheu um, mas o cliente não disse qual. Posição ("o primeiro") vale.
  if (apontadas.length > 1 && !POSICAO.test(limpar(op.trecho))) return naoSei(apontadas);
  switch (op.tipo) {
    case 'tirar': return null;
    case 'mudar_quantidade': {
      const n = numeroDaQuantidade(op.quantidade.valor);
      if (!n || !numerosDaMensagem(texto).includes(n)) return naoSei();
      // Medição de 25/10: "3kg de arame uai" virou "mais 3 no arame 12". Sem palavra que diga soma ou troca, pode ser outro produto.
      const disse = op.soma ? SOMA.test(mensagem) : E_TROCA_DE_QUANTIDADE.test(mensagem) || SOMA.test(mensagem);
      return disse ? null : `Não entendi se "${op.trecho}" muda o ${linha.nome} ou é outro produto. Se for o mesmo, escreva: são ${n}. Se for outro, escreva o nome completo.`;
    }
    case 'mudar_medida': {
      const familia = FAMILIAS.find(f => f.id === linha.familia);
      const daEtiqueta = (familia?.medidas ?? []).filter(m => m.etiqueta === op.medida.etiqueta).length;
      // Metalon tem dois "lado": sem saber qual, a medida nova não tem lugar certo.
      return daEtiqueta === 1 && linha.itens[0]?.extracao && mensagem.includes(limpar(op.medida.valor)) ? null : naoSei();
    }
    case 'trocar_produto': {
      const novoNaMensagem = !!op.trecho_novo && mensagem.includes(limpar(op.trecho_novo));
      const medidasNaMensagem = op.por.medidas.every(m => mensagem.includes(limpar(m.valor)));
      return novoNaMensagem && medidasNaMensagem && FAMILIAS.some(f => f.id === op.por.familia) ? null : naoSei();
    }
  }
}

/** O item como o cliente leria: "perfil u enrijecido 75 2mm", "5 kg prego 17 21". */
function textoCurtoDoItem(item: ItemExtraido): string {
  // O id da família, curto ("disco", "perfil u enrijecido"): o nome do cadastro ("disco de corte ou desbaste") repetia o tipo (25/10).
  const nome = item.familia.replace(/_/g, ' ');
  return [item.quantidade?.trecho, nome, ...item.medidas.map(m => `${m.valor}${m.unidade_escrita ?? ''}`), ...item.qualificadores].filter(Boolean).join(' ');
}

/** O texto de um item montado pelo código, com os trechos que a conferência procura. */
function textoDoItemMontado(item: ItemExtraido): string {
  // Só o nome, sem os sinônimos entre parênteses: "arame (recozido, liso, ...)" virava parte do texto do item (25/10).
  // O id da família, curto ("disco", "perfil u enrijecido"): o nome do cadastro ("disco de corte ou desbaste") repetia o tipo (25/10).
  const nome = item.familia.replace(/_/g, ' ');
  return [item.quantidade?.trecho, nome, ...item.medidas.map(m => m.trecho), ...item.qualificadores].filter(Boolean).join(' ');
}

/** A quantidade da linha com a unidade que o cliente escreveu: "20", "3 kg". */
function quantidadeComUnidade(linha: LinhaParaAIA): ItemExtraido['quantidade'] {
  if (!linha.quantidade) return linha.itens[0]?.extracao?.quantidade ?? null;
  const unidade = (linha.itens[0]?.extracao?.quantidade?.trecho ?? '').replace(/^[\d.,\s]+/, '').trim();
  return { valor: linha.quantidade, trecho: [linha.quantidade, unidade].filter(Boolean).join(' ') };
}

export async function aplicarOperacoes(
  deps: Dependencias, pedidoId: string, texto: string, ops: OperacaoNaLista[], lista: LinhaParaAIA[], perguntasNaTela = 0,
): Promise<{ avisos: string[]; aplicadas: OperacaoNaLista[]; itensNovos: string[] }> {
  const avisos: string[] = [];
  const aplicadas: OperacaoNaLista[] = [];
  const itensNovos: string[] = [];
  const perguntadas = new Set<string>();
  const avisoDaOperacao = new Map<string, OperacaoNaLista>();
  for (let op of ops) {
    // "troca a chapa por 5" (teste de 29/10): a IA leu troca de produto sem produto novo. "por" e só um número é a quantidade.
    if (op.tipo === 'trocar_produto' && op.por.familia === 'nao_identificado' && !op.por.medidas.length) {
      const porNumero = quantidadeDepoisDoPor(texto, op.trecho);
      if (porNumero) op = { tipo: 'mudar_quantidade', item: op.item, trecho: op.trecho, quantidade: porNumero, soma: false };
    }
    // Palavras que o cliente nem escreveu: a IA inventou a mudança. Não aplica e não pergunta sobre o que ele não disse
    // (medição de 25/10: "5 kg" à pergunta da quantidade virou "Não sei qual mudar: 2 kg de ARAME").
    // "2. pode ser 250 também" é a resposta da pergunta 2, não uma troca (medição de 25/10): sai sem aviso.
    const numerada = linhaNumerada(op.trecho);
    const ehResposta = !!numerada && /^\s*\d{1,2}\s*[.)\-:]/.test(op.trecho) && numerada.numero <= perguntasNaTela;
    // E palavras que não apontam nenhum item da lista ("17x21" com o prego ainda em pergunta): não é sobre a lista.
    // Sobrar nada depois de tirar o valor novo ("17x21" que é só o prego novo) também não aponta item nenhum.
    const doItem = trechoDoItem(op);
    const naoAponta = !/[a-z0-9]/.test(limpar(doItem)) || !linhasApontadas(doItem, lista, texto).length;
    if (ehResposta || naoAponta || !limpar(texto).includes(limpar(op.trecho))) {
      await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', entrada: { operacao: op }, saida: { aplicada: false, motivo: 'trecho fora da mensagem ou da lista' } });
      continue;
    }
    // "adiciona 10 vergalhao 12mm" com o de 8 mm na lista somou 10 no de 8 mm (teste de 29/10). Número na frase que o item
    // não tem é outro produto: com "adiciona" ou "mais" ele entra como item novo, sem isso nada muda e o cliente é avisado.
    if (op.tipo === 'mudar_quantidade') {
      const alvo = lista.find(l => l.numero === op.item);
      const oracao = oracaoDoTrecho(texto, op.trecho);
      if (alvo && temNumeroDeOutroProduto(oracao, numeroDaQuantidade(op.quantidade.valor) ?? '', alvo)) {
        await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', entrada: { operacao: op }, saida: { aplicada: false, motivo: 'medida de outro produto' } });
        if (PEDE_PRODUTO.test(oracao) || SOMA.test(oracao)) itensNovos.push(oracao);
        else avisos.push(`Não mudei ${alvo.nome}: "${op.trecho}" tem outra medida. Se for outro produto, escreva só ele.`);
        continue;
      }
    }
    // "adiciona disco de desbaste" não é trocar (teste de 25/10 à tarde: o disco de corte sumiu). Sem palavra de troca, o
    // produto novo entra como item novo, com o que a IA já leu dele.
    if (op.tipo === 'trocar_produto' && !TROCA.test(limpar(texto)) && PEDE_PRODUTO.test(limpar(texto))) {
      const novo: ItemExtraido = { ...op.por, medidas: op.por.medidas.map(m => ({ ...m, trecho: m.valor })) };
      const textoNovo = textoDoItemMontado(novo);
      await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', entrada: { operacao: op }, saida: { aplicada: false, motivo: 'sem palavra de troca: item novo' } });
      await registrarItens(deps, pedidoId, {
        tipo_mensagem: 'novos_itens', respostas_a_perguntas: [],
        linhas: [{ linha_id: 1, texto_original: textoNovo, descartada: false, motivo_descarte: null, itens: [novo] }],
      }, textoNovo, false, false);
      aplicadas.push(op);
      continue;
    }
    // "na verdade são 5 disco de corte" com dois discos de corte na lista (teste de 25/10 à noite): o aviso "Não sei qual
    // mudar" ficava solto, a resposta do cliente ("é o disco de corte 4.5") não tinha a que responder e virava "Não entendi".
    // Agora é pergunta numerada com os itens possíveis; enquanto ela está aberta, a lista não pede o sim.
    const candidatos = candidatosDaOperacao(op, lista, texto);
    if (candidatos) {
      const chave = `${op.tipo}|${limpar(op.trecho)}`;
      await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', entrada: { operacao: op }, saida: { aplicada: false, pergunta: candidatos.map(l => l.numero) } });
      if (!perguntadas.has(chave)) {
        perguntadas.add(chave);
        await perguntarQualItem(deps, pedidoId, op, candidatos);
      }
      continue;
    }
    const aviso = conferirOperacao(op, lista, texto);
    const linha = lista.find(l => l.numero === op.item);
    await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', entrada: { operacao: op }, saida: { aplicada: !aviso, aviso } });
    if (aviso || !linha) { if (aviso && !avisos.includes(aviso)) { avisos.push(aviso); avisoDaOperacao.set(aviso, op); } continue; }
    // A mesma linha não muda duas vezes na mesma mensagem: a segunda já veria a lista velha.
    if (aplicadas.some(a => a.item === op.item)) continue;
    aplicadas.push(op);
    const feito = await executarOperacao(deps, pedidoId, op, linha);
    if (feito) avisos.push(feito);
  }
  // A IA às vezes manda a mesma mudança para dois itens; uma conferiu e foi feita, a outra não: o "Não sei qual" da que
  // não conferiu sobrava ao lado do "Mudei" (teste de 25/10 à noite).
  const mesma = (a: OperacaoNaLista, b: OperacaoNaLista): boolean => a.tipo === b.tipo && limpar(a.trecho) === limpar(b.trecho);
  return { avisos: avisos.filter(a => { const op = avisoDaOperacao.get(a); return !op || !aplicadas.some(x => mesma(x, op)); }), aplicadas, itensNovos };
}

/** O pedaço da mensagem onde está o trecho: "tira a telha e adiciona 10 vergalhao 12mm" → "adiciona 10 vergalhao 12mm". */
export function oracaoDoTrecho(texto: string, trecho: string): string {
  const alvo = limpar(trecho);
  return limpar(texto).split(/[,;\n]| e (?=[a-z])/).map(p => p.trim()).find(p => p.includes(alvo)) ?? alvo;
}

/** Algum número da frase, fora a quantidade, que o item da lista não tem ("12" com o vergalhão de 8 mm). */
export function temNumeroDeOutroProduto(oracao: string, quantidade: string, linha: Pick<LinhaParaAIA, 'nome'>): boolean {
  const numeros = (t: string): string[] => (t.match(new RegExp(NUMERO_DE_MEDIDA, 'g')) ?? []).map(n => n.replace(',', '.'));
  const daOracao = numeros(oracao);
  const k = daOracao.findIndex(n => Number(n) === Number(quantidade));
  if (k >= 0) daOracao.splice(k, 1);
  const daLinha = numeros(limpar(linha.nome));
  const cabe = (n: string): boolean => daLinha.some(d => d === n || Number(d) === Number(n) || d.startsWith(`${n}.`));
  return daOracao.some(n => !cabe(n));
}

/** "troca a chapa por 5": a quantidade depois do "por", quando é só um número (com unidade, se houver). */
export function quantidadeDepoisDoPor(texto: string, trecho: string): Trecho | null {
  const alvo = limpar(trecho);
  const oracao = oracaoDoTrecho(texto, trecho);
  const depois = oracao.slice(oracao.indexOf(alvo) + alvo.length);
  const m = /^\s*(?:por|pra|para)\s+(\d+(?:[.,]\d+)?)\s*([a-z]+)?\s*$/.exec(depois);
  if (!m || (m[2] && !E_UNIDADE.test(m[2]))) return null;
  return { valor: m[1], trecho: [m[1], m[2]].filter(Boolean).join(' ') };
}

/**
 * A mudança confere, mas as palavras do cliente servem a mais de um item ("o arame" com dois arames): os itens possíveis,
 * para perguntar qual. Null quando o problema é outro (palavras fora da mensagem, valor não escrito).
 */
export function candidatosDaOperacao(op: OperacaoNaLista, lista: LinhaParaAIA[], texto: string): LinhaParaAIA[] | null {
  if (!limpar(texto).includes(limpar(op.trecho)) || POSICAO.test(limpar(op.trecho))) return null;
  const apontadas = linhasApontadas(trechoDoItem(op), lista, texto);
  if (apontadas.length < 2) return null;
  // O valor novo tem de conferir em cada um, como se fosse o único da lista.
  const servem = apontadas.filter(l => conferirOperacao({ ...op, item: l.numero }, [l], texto) === null);
  return servem.length >= 2 ? servem : null;
}

async function perguntarQualItem(deps: Dependencias, pedidoId: string, op: OperacaoNaLista, candidatos: LinhaParaAIA[]): Promise<void> {
  const n = op.tipo === 'mudar_quantidade' ? numeroDaQuantidade(op.quantidade.valor) : null;
  const acao = op.tipo === 'tirar' ? 'qual destes eu tiro?'
    : op.tipo === 'mudar_quantidade' ? (op.soma ? `em qual destes somo ${n}?` : `qual destes passa a ser ${n}?`)
      : op.tipo === 'trocar_produto' ? 'qual destes eu troco?' : 'qual destes eu mudo?';
  const pergunta: Pergunta = {
    id: await proximoIdDePergunta(deps, pedidoId), tipo: 'qual_item', texto: `"${op.trecho}": ${acao}`,
    opcoes: candidatos.map(l => ({ rotulo: l.descricao, codigos: [l.itens[0].codigo_final!] })), operacao: op,
  };
  await deps.armazem.inserirItem({
    pedido_id: pedidoId, ordem: (await deps.armazem.itens(pedidoId)).length, linha_id: null, texto_original: op.trecho,
    extracao: null, conferencias: [], resultado: null, status: 'pergunta', codigo_final: null, quantidade: null, pergunta,
    respostas: [], versao_regras: VERSAO_DAS_REGRAS, versao_catalogo: deps.versaoDoCatalogo,
  });
}

/** Aplica uma mudança que já conferiu numa linha da lista. Devolve o aviso de quantidade mudada, se houver. */
async function executarOperacao(deps: Dependencias, pedidoId: string, op: OperacaoNaLista, linha: LinhaParaAIA): Promise<string | null> {
  const fechar = async (l: LinhaParaAIA): Promise<void> => {
    for (const i of l.itens) await deps.armazem.atualizarItem(i.id, { status: 'fora_do_orcamento', pergunta: null });
  };
  const primeiro = linha.itens[0];
  const p = deps.catalogo.porCodigo.get(primeiro.codigo_final!);
  switch (op.tipo) {
    case 'tirar':
      await fechar(linha);
      return null;
    case 'mudar_quantidade': {
      const antes = Number(numeroDaQuantidade(linha.quantidade));
      const n = Number(numeroDaQuantidade(op.quantidade.valor));
      const nova = formatar(op.soma && Number.isFinite(antes) ? antes + n : n);
      // "É só 5 kg de trançado" com 5 kg na lista: já está assim, nada a mudar nem a dizer.
      if (nova === numeroDaQuantidade(linha.quantidade)) return null;
      // Só a palavra logo depois do número ("2 discos" → discos): "mais 2" virava "6 mais 2 de DISCO" (teste de 25/10 à tarde).
      const unidadeDe = (t: string): string => { const u = /\d+(?:[.,]\d+)?\s*([a-z]+)/.exec(limpar(t))?.[1] ?? ''; return E_UNIDADE.test(u) ? u : ''; };
      const unidade = unidadeDe(op.quantidade.trecho) || unidadeDe(primeiro.extracao?.quantidade?.trecho ?? '');
      for (const i of linha.itens.slice(1)) await deps.armazem.atualizarItem(i.id, { status: 'fora_do_orcamento', pergunta: null });
      await deps.armazem.atualizarItem(primeiro.id, {
        quantidade: nova,
        ...(primeiro.extracao ? { extracao: { ...primeiro.extracao, quantidade: { valor: nova, trecho: [nova, unidade].filter(Boolean).join(' ') } } } : {}),
      });
      return `Mudei ${p ? rotulo(p) : primeiro.codigo_final} de ${linha.quantidade ?? '?'} para ${nova}.`;
    }
    case 'mudar_medida':
    case 'trocar_produto': {
      const base = primeiro.extracao!;
      const novo: ItemExtraido = op.tipo === 'mudar_medida'
        ? { ...base, quantidade: quantidadeComUnidade(linha), medidas: [...base.medidas.filter(m => m.etiqueta !== op.medida.etiqueta), { ...op.medida, trecho: op.medida.valor }] }
        : { ...op.por, quantidade: op.por.quantidade ?? quantidadeComUnidade(linha), medidas: op.por.medidas.map(m => ({ ...m, trecho: m.valor })) };
      await fechar(linha);
      const textoNovo = textoDoItemMontado(novo);
      await registrarItens(deps, pedidoId, {
        tipo_mensagem: 'novos_itens', respostas_a_perguntas: [],
        linhas: [{ linha_id: 1, texto_original: textoNovo, descartada: false, motivo_descarte: null, itens: [novo] }],
      }, textoNovo, false, false);
      return null;
    }
  }
}

// ── a resposta ao cliente ──

/**
 * A quantidade como o cliente escreveu, com a unidade dele ("2 kg", "3 rolos");
 * sem unidade, "10 ×". No teste de 08/10 "2 kg de prego" virou "2 × PREGO" e
 * parecia 2 unidades. A unidade do catálogo não serve: a quantidade não é
 * convertida, e "50 kg de vergalhão" viraria "50 varas".
 */
// Só palavra que é unidade vai para a tela: "30 adiciona de VERGALHÃO" (teste de 29/10) veio de "10 adiciona vergalhão".
const E_UNIDADE = /^(?:k|kgs?|kilos?|quilos?|g|gramas?|ton|toneladas?|m|mts?|metros?|m2|m3|cm|mm|barras?|varas?|pecas?|pc|pcs|un|und|unid|unidades?|rolos?|rolinhos?|caixas?|cx|sacos?|saquinhos?|pacotes?|pct|latas?|galao|galoes|litros?|l|folhas?|chapas?|tubos?|duzias?|centos?|milheiros?|pares?|conjuntos?|jogos?|kits?|fardos?|bobinas?|baldes?|frascos?|cartelas?|feixes?|amarrados?|laminas?|telhas?|discos?|parafusos?)$/;

export function quantidadeNaLista(i: Pick<ItemDoPedido, 'quantidade' | 'extracao'>, quantidade: string | null = i.quantidade, unidadeDaSoma: string | null = null): string {
  const numero = numeroDaQuantidade(quantidade);
  const naTela = numero?.replace('.', ',') ?? '?';
  if (unidadeDaSoma && numero) return `${naTela} ${unidadeDaSoma} de`;
  // A unidade escrita fica, com o número normalizado: "Um kilo" → "1 kilo de", "2  rolo" → "2 rolo de".
  const trecho = limpar(i.extracao?.quantidade?.trecho ?? '').match(/^(\d+(?:[.,]\d+)?|[a-z]+)\s*(.*)$/);
  const doTrecho = trecho ? numeroDaQuantidade(trecho[1]) : null;
  // Comparado com o número que vai para a tela: "12 metros" de calha virou 2 peças, e "2 metros" estaria errado (22/10).
  const mesmoNumero = !!doTrecho && doTrecho === numero;
  if (mesmoNumero && trecho && /^[a-z]/.test(trecho[2]) && E_UNIDADE.test(trecho[2].split(/\s+/)[0])) return `${naTela} ${trecho[2]} de`;
  return `${naTela} ×`;
}

/** A quantidade como número: "dois" → 2, "Uma" → 1, "04" → 4 (teste de campo de 20/10). Sem número, fica como veio. */
export function numeroDaQuantidade(quantidade: string | null): string | null {
  if (!quantidade) return null;
  const v = lerValor(quantidade.trim());
  return v ? formatar(v.valor) : quantidade.trim();
}

/**
 * A quantidade que vai para a lista e para o orçamento: o número do cliente,
 * arredondado para a caixa quando o produto só sai em caixa (T9, embalagem.ts).
 * Com unidade escrita ("2 caixas", "1 kg") não mexe: não dá para converter.
 */
export function quantidadeDeVenda(deps: Pick<Dependencias, 'catalogo'>, i: Pick<ItemDoPedido, 'quantidade' | 'extracao' | 'codigo_final'>): { quantidade: string | null; ajuste: AjusteDeEmbalagem | null } {
  const quantidade = numeroDaQuantidade(i.quantidade);
  const produto = i.codigo_final ? deps.catalogo.porCodigo.get(i.codigo_final) : undefined;
  const pecas = pecasDeCalha(i, produto ? rotulo(produto) : null);
  if (pecas) return { quantidade: String(pecas.ajustado), ajuste: pecas };
  const regra = regraDeEmbalagem(i.extracao?.familia, produto ? rotulo(produto) : null);
  const n = quantidade ? Number(quantidade) : NaN;
  const unidadeEscrita = /[a-z]/.test(limpar(i.extracao?.quantidade?.trecho ?? '').replace(/^[a-z]+(?=\s|$)/, '').replace(/\b(?:un|unid|unidades?|pc|pcs|pecas?|parafusos?)\b/g, ''));
  if (!regra || !Number.isFinite(n) || n <= 0 || unidadeEscrita) return { quantidade, ajuste: null };
  const ajustado = totalEmCaixas(n, regra.caixas);
  return ajustado === n ? { quantidade, ajuste: null } : { quantidade: formatar(ajustado), ajuste: { regra, pedido: n, ajustado } };
}

/**
 * Calha pedida em metros ("12 metros de calha", "10 metros de calha de 40") vira peças
 * do comprimento do produto, arredondando para cima (Vendedor 1, 22/10: 12 m são 2 de 6 m).
 * Os metros vêm da quantidade escrita em metros, ou do comprimento maior que a peça.
 */
function pecasDeCalha(i: Pick<ItemDoPedido, 'quantidade' | 'extracao'>, rotuloDoProduto: string | null): AjusteDeEmbalagem | null {
  const e = i.extracao;
  const porPeca = Number(/\((\d+(?:[.,]\d+)?)\s*MTS?\)/i.exec(rotuloDoProduto ?? '')?.[1]?.replace(',', '.'));
  if (e?.familia !== 'calha' || !Number.isFinite(porPeca) || porPeca <= 0) return null;
  const emMetros = /^\s*\d+(?:[.,]\d+)?\s*(?:m|mt|mts|metros?)\s*$/i.test(e.quantidade?.trecho ?? '') ? Number(numeroDaQuantidade(i.quantidade)) : NaN;
  const comprimento = e.medidas.map(m => (m.etiqueta === 'comprimento' ? Number(String(m.valor).replace(',', '.')) : NaN)).find(v => v > METROS_DA_PECA_DE_CALHA);
  const metros = Number.isFinite(emMetros) ? emMetros : !i.quantidade && comprimento ? comprimento : NaN;
  if (!Number.isFinite(metros) || metros <= 0) return null;
  const ajustado = Math.ceil(metros / porPeca);
  return { regra: CALHA_EM_PECAS, pedido: metros, ajustado, aviso: `Calha vem em peça de ${formatar(porPeca)} m: ${formatar(metros)} m são ${ajustado} ${ajustado > 1 ? 'peças' : 'peça'}.` };
}

// Teste de campo de 21/10: a frase que ensinava a editar a lista confundiu o Leonardo; a edição continua entendida sem ela.
export function comoResponder(numeradas: PerguntaNaTela[]): string {
  if (!numeradas.some(g => opcoesNaTela(g.pergunta) > 0)) return 'Pode responder do seu jeito.';
  return numeradas.length > 1 ? 'Pode responder com o número e a letra (ex.: 1a) ou do seu jeito.' : 'Pode responder com a letra ou do seu jeito.';
}

const temNenhumaDessas = (p: Pergunta): boolean => p.tipo === 'nao_encontrado' || p.tipo === 'escolha' || p.tipo === 'qual_item';

/** Quantas opções a pergunta mostra, com o "nenhuma dessas". A confirmação ("é o X?") não mostra nenhuma. */
function opcoesNaTela(p: Pergunta): number {
  return (p.tipo === 'confirmacao' ? 0 : p.opcoes.length) + (temNenhumaDessas(p) ? 1 : 0);
}

/** a, b, c...; passou do z, o número. */
export function letraDaOpcao(k: number): string {
  return k < 26 ? String.fromCharCode(97 + k) : String(k + 1);
}

/** O que está entre aspas (as palavras do cliente) em negrito do WhatsApp. */
function emNegrito(texto: string): string {
  return texto.replace(/"([^"\n]+)"/, '*"$1"*');
}

const PAR_NUMERO_LETRA = /(\d{1,2})\s*[.)\-:]?\s*([a-z])(?![a-z0-9])/gi;

/**
 * A resposta com a letra da opção ("b", "2b", "2. b", "1a 2c") vira o número que o resto do código e a IA já entendem
 * ("2. 2"). Só letra que a pergunta mostrou; o resto da mensagem fica como veio.
 */
export function letrasParaNumeros(texto: string, tela: PerguntaNaTela[]): string {
  if (!tela.some(g => opcoesNaTela(g.pergunta) > 0)) return texto;
  const opcao = (numero: number, letra: string): number | null => {
    const g = tela.find(x => x.numero === numero);
    const k = letra.toLowerCase().charCodeAt(0) - 97;
    return g && k >= 0 && k < opcoesNaTela(g.pergunta) ? k + 1 : null;
  };
  return texto.split('\n').map(linha => {
    const l = semInvisiveis(linha).trim();
    const sozinha = /^([a-z])\s*[.)]?$/i.exec(l);
    if (sozinha) {
      const k = tela.length === 1 ? opcao(tela[0].numero, sozinha[1]) : null;
      return k ? String(k) : linha;
    }
    const pares = [...l.matchAll(PAR_NUMERO_LETRA)];
    const sobra = l.replace(PAR_NUMERO_LETRA, ' ').replace(/\be\b|[\s,;]/gi, '');
    if (!pares.length || sobra) return linha;
    const numeros = pares.map(m => { const k = opcao(Number(m[1]), m[2]); return k ? `${m[1]}. ${k}` : null; });
    return numeros.every(Boolean) ? numeros.join('\n') : linha;
  }).join('\n');
}

/**
 * `avisos`: o que esta mensagem precisa dizer além da lista (edição que não deu para entender).
 * `perguntaDaLista`: outra frase no lugar do "Confere a lista?".
 */
export async function montarResposta(deps: Dependencias, pedidoId: string, avisos: string[] = [], perguntaDaLista?: string): Promise<{ texto: string; snapshot: Snapshot | null }> {
  const itens = await deps.armazem.itens(pedidoId);
  const partes: string[] = [];
  const anotadas = linhasDaLista(deps, itens);
  if (anotadas.length) {
    partes.push('Anotei:');
    const ajustes: AjusteDeEmbalagem[] = [];
    for (const l of anotadas) {
      const p = deps.catalogo.porCodigo.get(l.item.codigo_final!);
      ajustes.push(...l.ajustes);
      partes.push(`- ${quantidadeNaLista(l.item, l.quantidade, unidadeDaSoma(l))} ${p ? rotulo(p) : l.item.codigo_final}`);
    }
    partes.push(...avisosDeEmbalagem(ajustes));
  }
  const naoVende = itens.filter(i => i.status === 'nao_vende');
  if (naoVende.length) partes.push(`Não trabalhamos com: ${naoVende.map(i => `"${i.texto_original}"`).join(', ')}.`);
  partes.push(...avisos);

  const { numeradas, comVendedor } = perguntasNaTela(itens);
  if (numeradas.length) {
    partes.push(numeradas.length > 1 ? 'Preciso confirmar:' : 'Preciso confirmar uma coisa:');
    for (const { numero, pergunta: p } of numeradas) {
      // Uma opção por linha (Leonardo, 25/10: em fila era difícil de ler). A confirmação ("é o X?") não repete o X como opção.
      // Opções com letra e o produto em negrito (Leonardo, 25/10 à noite: número na pergunta e na opção embaralhava um
      // produto com o outro). A letra é só da tela: a resposta "2b" vira "2. 2" em `letrasParaNumeros`.
      const rotulos = [...(p.tipo === 'confirmacao' ? [] : p.opcoes.map(o => o.rotulo)), ...(temNenhumaDessas(p) ? ['nenhuma dessas'] : [])];
      partes.push([`${numero}. ${emNegrito(p.texto)}`, ...rotulos.map((r, k) => `${letraDaOpcao(k)}) ${r}`)].join('\n'));
    }
    // "Com o vendedor:" era anotação interna e o Leonardo não entendeu (T10, 20/10).
    if (comVendedor.length) partes.push(`${comVendedor.length > 1 ? 'Estes' : 'Este'} eu confirmo com o vendedor e te retorno: ${comVendedor.map(i => `"${i.texto_original}"`).join(', ')}.`);
    // Em 20/10 o Vendedor 1 não sabia que podia responder só com o número, nem tirar ou trocar (T6).
    partes.push(comoResponder(numeradas));
  }
  const gerado = numeradas.length ? null : await gerarSnapshot(deps, pedidoId);
  // Pedido de mudança que não deu para fazer depois da lista confirmada ("tira o arame" com dois arames, 25/10 à noite):
  // a lista igual continuava confirmada e a etapa do pagamento respondia por cima do aviso. O aviso sai e a lista
  // volta a esperar o sim.
  const reaberta = !!gerado?.confirmado && avisos.length > 0;
  if (reaberta) await deps.armazem.atualizarPedido(pedidoId, { estado: 'aguardando_confirmacao' });
  const snapshot = reaberta && gerado ? { ...gerado, confirmado: false } : gerado;
  if (snapshot && !snapshot.confirmado) partes.push(perguntaDaLista ?? 'Confere a lista? Se estiver certa, responda "sim" que eu sigo com o orçamento.');
  if (!partes.length) partes.push('Não encontrei itens de pedido na mensagem. Pode mandar a lista?');
  const texto = partes.join('\n');
  await deps.armazem.gravarTrace({ pedido_id: pedidoId, etapa: 'resposta', saida: { texto, snapshot: snapshot?.hash ?? null } });
  return { texto, snapshot };
}

// ── a mensagem ──

export async function processarMensagem(deps: Dependencias, pedidoId: string, mensagem: MensagemDoCliente): Promise<RespostaDoTurno> {
  let texto = mensagem.texto?.trim() ?? '';
  for (const imagem of mensagem.imagens ?? []) texto = [texto, await transcrever(deps, pedidoId, imagem)].filter(Boolean).join('\n');
  if (!texto) {
    const r = await montarResposta(deps, pedidoId);
    return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
  }

  const itensAntes = await deps.armazem.itens(pedidoId);
  const comPergunta = itensAntes.filter(i => i.pergunta);
  const tela = perguntasNaTela(itensAntes);
  texto = letrasParaNumeros(texto, tela.numeradas);
  const curta = texto.length <= 40 && !texto.includes('\n');
  const pedido = await deps.armazem.pedido(pedidoId);

  // Com as operações ligadas, quem lê tirar, trocar e mudar é a IA, vendo a lista; o código só confere (25/10).
  const listaDaIA = deps.operacoes ? listaParaAIA(deps, itensAntes) : [];
  const usaOperacoes = listaDaIA.length > 0;
  // Tirar e trocar vêm antes de tudo, no código. Mensagem só de edição não chama a IA.
  const edicoes: EdicoesDaMensagem = itensAntes.length && !usaOperacoes
    ? await aplicarEdicoes(deps, pedidoId, texto, tela.numeradas)
    : { linhas: new Set(), perguntas: new Set(), novos: [], avisos: [] };
  if (edicoes.linhas.size && linhasDaMensagem(texto).every(l => edicoes.linhas.has(l.id))) {
    if (edicoes.novos.length) {
      const textoNovo = edicoes.novos.join('\n');
      await registrarItens(deps, pedidoId, await extrair(deps, pedidoId, textoNovo, []), textoNovo);
    }
    const r = await montarResposta(deps, pedidoId, edicoes.avisos);
    return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
  }

  // Mudar a quantidade de um item da lista também é do código, sem pergunta aberta na tela (L3, 22/10).
  if (!tela.numeradas.length && !edicoes.linhas.size && !usaOperacoes) {
    const troca = lerTrocaDeQuantidade(deps, texto, itensAntes);
    if (troca) {
      const avisos: string[] = [];
      if ('aviso' in troca) avisos.push(troca.aviso);
      else {
        const p = deps.catalogo.porCodigo.get(troca.item.codigo_final!);
        await deps.armazem.atualizarItem(troca.item.id, { quantidade: troca.quantidade });
        await deps.armazem.gravarTrace({ pedido_id: pedidoId, item_id: troca.item.id, etapa: 'resposta', entrada: { linha: texto }, saida: { quantidade_antes: troca.item.quantidade, quantidade: troca.quantidade } });
        avisos.push(`Mudei ${p ? rotulo(p) : troca.item.codigo_final} de ${numeroDaQuantidade(troca.item.quantidade) ?? '?'} para ${troca.quantidade}.`);
      }
      const r = await montarResposta(deps, pedidoId, avisos);
      return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
    }
  }

  // "quero fechar o orçamento, só isso" (teste de 25/10 à tarde) não fechava nada. Fechar é seguir sem o que ficou com o
  // vendedor e mostrar a lista para o "sim" final; pergunta de produto aberta continua: sem ela a lista não fecha.
  // Sem pergunta aberta, "pode fechar" é o sim de sempre e segue o caminho de baixo.
  if (tela.numeradas.length && QUER_FECHAR_A_LISTA.test(limpar(texto)) && !/\d/.test(texto) && !texto.includes('?')) {
    const doVendedor = tela.numeradas.filter(g => ['vendedor', 'nao_entendi', 'ilegivel'].includes(g.pergunta.tipo));
    for (const g of doVendedor) for (const i of g.itens) await deps.armazem.atualizarItem(i.id, { status: 'fora_do_orcamento', pergunta: null });
    const faltam = tela.numeradas.length - doVendedor.length;
    const r = await montarResposta(deps, pedidoId, faltam ? [faltam > 1 ? 'Para fechar, falta responder as perguntas abaixo.' : 'Para fechar, falta responder a pergunta abaixo.'] : []);
    return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
  }

  // Resposta curta e sem ambiguidade não precisa de IA: o "sim" da lista, ou
  // "2" / "sim" quando há uma pergunta só pendente. O da lista é a mensagem inteira (22/10).
  if (pedido?.estado === 'aguardando_confirmacao' && !comPergunta.length && simClaro(texto)) {
    await confirmarLista(deps, pedidoId);
    const r = await montarResposta(deps, pedidoId);
    return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
  }
  // Só a palavra ("sim", "não, obrigado", "2"): "não, é vergalhão 3/8" traz uma correção e vai para a IA.
  const soAPalavra = limpar(texto).replace(/[.,!]+/g, ' ').trim().split(/\s+/).length <= 2;
  if (curta && soAPalavra && tela.numeradas.length === 1 && !tela.comVendedor.length && (SIM.test(limpar(texto)) || NAO.test(limpar(texto)) || /^\d+$/.test(texto.trim()))) {
    // "1. 3" começa com "1" e o SIM leria isso como sim: o número depois do ponto é a opção (22/10).
    const daLinha = linhaNumerada(texto);
    if (await responderNaTela(deps, pedidoId, tela.numeradas, '1', (daLinha && numeroDigitado(daLinha.resto)) || texto)) {
      const r = await montarResposta(deps, pedidoId);
      return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
    }
  }

  // "Segue sem ele" com só perguntas do vendedor pendentes não precisa de IA.
  if (curta && tela.numeradas.length && tela.numeradas.every(g => g.pergunta.tipo === 'vendedor') && seguirSemEle(texto, 'vendedor')) {
    let aplicou = false;
    for (const g of tela.numeradas) aplicou = (await responderNaTela(deps, pedidoId, tela.numeradas, String(g.numero), texto)) || aplicou;
    if (aplicou) {
      const r = await montarResposta(deps, pedidoId);
      return { ...r, itens: await deps.armazem.itens(pedidoId), extracao: null };
    }
  }

  // A IA vê as perguntas com o número que o cliente vê; as do vendedor fora da numeração, pelo id.
  // As que a edição já resolveu ficam de fora.
  const pendentes: PerguntaPendente[] = [
    ...tela.numeradas.filter(g => !edicoes.perguntas.has(g.numero)).map(g => ({ id: String(g.numero), texto: g.pergunta.texto, opcoes: g.pergunta.opcoes.map(o => o.rotulo) })),
    ...tela.comVendedor.map(i => ({ id: i.pergunta!.id, texto: i.pergunta!.texto, opcoes: [] })),
  ];
  // Lista esperando o "sim": a IA precisa saber disso para reconhecer a confirmação.
  if (pedido?.estado === 'aguardando_confirmacao') pendentes.push({ id: 'lista', texto: 'Confere a lista? Responda sim para seguir com o orçamento.', opcoes: ['sim'] });
  let extracao = await extrair(deps, pedidoId, texto, pendentes, usaOperacoes ? listaDaIA.map(({ numero, descricao, familia }) => ({ numero, descricao, familia })) : null);
  const operacoes = usaOperacoes && extracao.edicoes?.length
    ? await aplicarOperacoes(deps, pedidoId, texto, extracao.edicoes, listaDaIA, tela.numeradas.length)
    : { avisos: [], aplicadas: [], itensNovos: [] };
  // A mudança que estava em "qual destes?" e que o cliente agora escreveu inteira ("são 5 disco de corte norton 4.5") já foi
  // feita: a pergunta sai, para a resposta não aplicar a mesma mudança outra vez (somaria duas vezes).
  const resolvidasPelaMudanca = new Set<number>();
  for (const g of tela.numeradas) {
    const pendente = g.pergunta.tipo === 'qual_item' ? g.pergunta.operacao : undefined;
    if (!pendente || !operacoes.aplicadas.some(op => op.tipo === pendente.tipo)) continue;
    resolvidasPelaMudanca.add(g.numero);
    for (const i of g.itens) await deps.armazem.atualizarItem(i.id, { status: 'fora_do_orcamento', pergunta: null });
  }
  // A linha que só pedia a troca não vira item, mesmo que a IA a tenha lido também como pedido. Só na troca: em
  // "quero mais 2 de disco de desbaste e 2 de disco de corte" o disco de corte é item novo na mesma linha (teste de 25/10 à tarde).
  const ehLinhaDaOperacao = (l: Extracao['linhas'][number]): boolean => operacoes.aplicadas.some(op => {
    if (op.tipo !== 'trocar_produto' && op.tipo !== 'mudar_medida') return false;
    const familias = new Set([listaDaIA.find(x => x.numero === op.item)?.familia, op.tipo === 'trocar_produto' ? op.por.familia : undefined]);
    return limpar(l.texto_original).includes(limpar(op.trecho)) && l.itens.length === 1 && l.itens.every(i => familias.has(i.familia));
  });
  // "quero mais 2 discos" com três discos na lista (teste de 25/10 à tarde): a IA leu um disco novo e perguntou o diâmetro.
  // Disco sem medida nem tipo, pedido com "mais": é mais de um dos que já estão. Um só: soma nele. Vários: "mais de qual?".
  let maisDeQual = 0;
  if (usaOperacoes && SOMA.test(limpar(texto))) {
    for (const l of extracao.linhas) {
      if (l.descartada) continue;
      const fica: ItemExtraido[] = [];
      for (const item of l.itens) {
        const daFamilia = listaDaIA.filter(x => x.familia === item.familia);
        if (!daFamilia.length || item.medidas.length || item.qualificadores.length || !item.quantidade) { fica.push(item); continue; }
        // A IA já somou num deles pela mudança: o item repetido não entra.
        if (operacoes.aplicadas.some(op => op.tipo === 'mudar_quantidade' && daFamilia.some(x => x.numero === op.item))) continue;
        maisDeQual++;
        const pergunta: Pergunta | null = daFamilia.length > 1 ? {
          id: await proximoIdDePergunta(deps, pedidoId), tipo: 'escolha', texto: `"${l.texto_original}": mais de qual destes?`,
          opcoes: daFamilia.map(x => ({ rotulo: x.nome, codigos: [x.itens[0].codigo_final!] })),
        } : null;
        await deps.armazem.inserirItem({
          pedido_id: pedidoId, ordem: (await deps.armazem.itens(pedidoId)).length, linha_id: l.linha_id, texto_original: l.texto_original,
          extracao: item, conferencias: [], resultado: null, status: pergunta ? 'pergunta' : 'resolvido',
          codigo_final: pergunta ? null : daFamilia[0].itens[0].codigo_final, quantidade: item.quantidade.valor, pergunta,
          respostas: [], versao_regras: VERSAO_DAS_REGRAS, versao_catalogo: deps.versaoDoCatalogo,
        });
      }
      l.itens = fica;
      // Não é "edição da lista": essa o resgate de pedido perdido lia de novo, e "mais 2 discos" virava também um disco
      // novo que perguntava o diâmetro (teste de 25/10 à noite).
      if (!fica.length) { l.descartada = true; l.motivo_descarte = 'mais de um item da lista'; }
    }
  }
  // A IA leu "adiciona disco de corte" como mudança da lista e não devolveu mudança nenhuma: a linha sumia. Pedido de produto
  // sem palavra de troca nem de tirar é lido de novo como item, sem a lista (uma leitura a mais, só neste caso).
  const pedidosPerdidos = usaOperacoes ? extracao.linhas.filter(l => l.descartada && /edi[cç][aã]o da lista/i.test(l.motivo_descarte ?? '')
    && !operacoes.aplicadas.some(op => limpar(l.texto_original).includes(limpar(op.trecho)))
    && PEDE_PRODUTO.test(limpar(l.texto_original)) && !TROCA.test(limpar(l.texto_original)) && !/\b(?:tir\w*|remov\w*|exclu\w*|cancel\w*)\b/.test(limpar(l.texto_original))
    && familiaDoTexto(l.texto_original).familias.length > 0) : [];

  const correcoes: string[] = [];
  const reescritos: string[] = [];
  const respostasDeCorrecao: string[] = [];
  let listaConfirmada = false;
  // O que o cliente escreveu na linha "N ...". A IA às vezes devolve só um pedaço (21/10: "4. 1 kilo de
  // eletrodo 2/5" voltou como "2/5"), ou reescreve ("segue sem ele" virou "não incluir").
  const linhaDoCliente = (id: string): string | null => {
    const n = /^\d+$/.test(id.trim()) ? Number(id) : null;
    const numerada = n === null ? undefined : linhasDaMensagem(texto).map(l => linhaNumerada(l.texto)).find(x => x?.numero === n);
    if (numerada?.resto) return numerada.resto;
    return linhasDaMensagem(texto).length === 1 ? texto.trim() : null;
  };
  // Só a linha numerada ("1. 3") vale como número da opção; "12" solto pode ser a medida, não a 12ª opção.
  const numeroDaLinhaNumerada = (id: string): string | null => {
    const n = /^\d+$/.test(id.trim()) ? Number(id) : null;
    const numerada = n === null ? undefined : linhasDaMensagem(texto).map(l => linhaNumerada(l.texto)).find(x => x?.numero === n);
    return numerada?.resto ? numeroDigitado(numerada.resto) : null;
  };
  // Mensagem toda numerada ("2. 3"): só vale resposta ao número que o cliente escreveu. Em 25/10 a IA devolveu também as
  // perguntas 1 e 3, que ele não digitou, e o metalon entrou e o lambri foi confirmado sem ele dizer.
  const citados = numerosCitados(texto, tela.numeradas.length);
  const estaNaMensagem = (t: string): boolean => (limpar(t).match(/[a-z]/g) ?? []).length >= 4 && limpar(texto).includes(limpar(t));
  // A linha que respondeu uma pergunta não vira item novo do mesmo produto (25/10: "arame 14" respondeu a bitola e
  // ainda entrou como outro arame 14, que perguntou a quantidade de novo e depois somou).
  const linhasQueResponderam: { linha: string; familia: string | undefined }[] = [];
  for (let r of extracao.respostas_a_perguntas) {
    // O "sim" da lista só vale depois de ver se a mensagem trouxe itens (21/10: "adicione esses outros produtos" confirmou a lista).
    if (r.pergunta_id === 'lista') { if (SIM.test(limpar(r.opcao_escolhida))) listaConfirmada = true; continue; }
    if (edicoes.perguntas.has(Number(r.pergunta_id.trim())) || resolvidasPelaMudanca.has(Number(r.pergunta_id.trim()))) continue;
    if (citados && /^\d+$/.test(r.pergunta_id.trim()) && !citados.has(Number(r.pergunta_id)) && !estaNaMensagem(r.opcao_escolhida)) continue;
    // A linha do cliente é a do número que a IA citou; `numeroPeloConteudo` pode mandar a resposta para outra pergunta
    // (números trocados), e a linha continua sendo a dele.
    const numeroDaIA = r.pergunta_id;
    r = { ...r, pergunta_id: numeroPeloConteudo(tela.numeradas, r.pergunta_id, r.opcao_escolhida, edicoes.perguntas) };
    const alvo = itensDaPergunta(tela.numeradas, await deps.armazem.itens(pedidoId), r.pergunta_id);
    const tipo = alvo[0]?.pergunta?.tipo;
    const doCliente = linhaDoCliente(r.pergunta_id);
    const linhaDaIA = numeroDaIA === r.pergunta_id ? doCliente : linhaDoCliente(numeroDaIA);
    // A resposta que a IA marcou contradiz o que o cliente escreveu (22/10: "trançado" virou ARAME 14; "arame 12" respondeu o
    // prego). Família trocada: a fala não é para esta pergunta. Qualificador que o produto não tem: sem item novo na mesma
    // mensagem, as palavras do cliente substituem o item; com item novo ("2 kg de arame 18 rolinho"), ele já cobre.
    const pergunta = alvo[0]?.pergunta;
    // A medida que o cliente escreveu não está em nenhuma opção ("17x21" com 13x15 e 13x18): procurar de novo, seja qual for
    // a opção que a IA marcou (teste de 25/10 à tarde: ela marcou "nenhuma" e o prego foi para o vendedor).
    const medidaNova = !!pergunta && ['escolha', 'nao_encontrado', 'confirmacao'].includes(pergunta.tipo) && !!linhaDaIA
      && (limpar(linhaDaIA).match(MEDIDA_ESCRITA) ?? []).length > 0 && medidaForaDaOpcao(linhaDaIA, pergunta.opcoes.map(o => o.rotulo));
    const conflito = medidaNova ? 'medida' as const
      : pergunta && tipo !== 'vendedor' ? contradizOCliente(deps, pergunta, numeroDaLinhaNumerada(numeroDaIA) ?? r.opcao_escolhida, linhaDaIA) : null;
    // A opção que a IA marcou tem de ter sido dita (medição de 25/10: "5 kg" respondeu também o lambri e o metalon, e
    // "3kg de arame uai" escolheu o ROLÃO). Com conflito, quem trata é a correção abaixo. Quantidade e "seguir sem ele"
    // não entram: a resposta deles é o próprio texto.
    const escolhaEfetiva = numeroDaLinhaNumerada(r.pergunta_id) ?? r.opcao_escolhida;
    if (!conflito && pergunta && tipo !== 'quantidade' && tipo !== 'vendedor' && !respostaFoiDita(escolhaEfetiva, doCliente ?? texto, pergunta)) continue;
    const familiaDoAlvo = alvo[0]?.extracao?.familia;
    const jaTemItemNovo = extracao.linhas.some(l => !l.descartada && l.itens.some(i => i.familia === familiaDoAlvo));
    if (conflito && (conflito === 'familia' || (conflito !== 'medida' && jaTemItemNovo))) continue;
    // A medida que ele escreveu não está na opção ("17x21" com 13x15 e 13x18, 25/10): o item novo da mesma mensagem fica
    // no lugar; sem ele, a correção vai com o nome do produto, para a medida ser procurada de novo.
    if (conflito === 'medida' && jaTemItemNovo) {
      for (const item of alvo) await deps.armazem.atualizarItem(item.id, { status: 'fora_do_orcamento', pergunta: null, respostas: [...item.respostas, { pergunta_id: item.pergunta!.id, resposta: doCliente ?? r.opcao_escolhida }] });
      // O item novo fica com a quantidade do antigo ("17x21" sozinho perdia o "1 kg" e perguntava a quantidade; medição de 25/10).
      const antigo = alvo[0];
      const quantidade = antigo?.extracao?.quantidade ?? (antigo?.quantidade ? { valor: antigo.quantidade, trecho: antigo.quantidade } : null);
      if (quantidade) {
        extracao = { ...extracao, linhas: extracao.linhas.map(l => ({ ...l, itens: l.itens.map(i => (i.familia === familiaDoAlvo && !i.quantidade ? { ...i, quantidade } : i)) })) };
      }
      continue;
    }
    // A resposta de quantidade vai com a unidade que o cliente escreveu ("1kg", 25/10: o "kg" sumia da lista).
    const pediuUnitario = tipo === 'quantidade' && PEDE_UNITARIO.test(doCliente ?? r.opcao_escolhida ?? '');
    const daQuantidade = pediuUnitario ? '1' : tipo === 'quantidade' && doCliente && /\d/.test(doCliente) ? doCliente : null;
    // "Seguir sem ele" só com as palavras do cliente: em 21/10 "pode me dizer o prazo de entrega?" tirou o item.
    if (conflito) { /* nada a aplicar: segue para a correção, com as palavras do cliente */ }
    else if (tipo === 'vendedor') {
      if (doCliente && await responderNaTela(deps, pedidoId, tela.numeradas, r.pergunta_id, doCliente)) continue;
    } else if (await responderNaTela(deps, pedidoId, tela.numeradas, r.pergunta_id, daQuantidade ?? numeroDaLinhaNumerada(r.pergunta_id) ?? r.opcao_escolhida)) {
      if (doCliente) linhasQueResponderam.push({ linha: doCliente, familia: familiaDoAlvo });
      continue;
    }
    const reescrito = tipo === 'ilegivel' || tipo === 'nao_entendi';
    const doClienteComONome = conflito === 'medida' && doCliente && familiaDoAlvo ? `${familiaDoAlvo.replace(/_/g, ' ')} ${doCliente}` : doCliente;
    const resposta = conflito ? doClienteComONome ?? r.opcao_escolhida : reescrito ? doCliente ?? r.opcao_escolhida : r.opcao_escolhida;
    for (const item of alvo) {
      const correcao = await correcaoDoItem(deps, pedidoId, item, resposta);
      if (!correcao) continue;
      (reescrito ? reescritos : correcoes).push(correcao);
      respostasDeCorrecao.push(limpar(semNegacao(resposta)));
    }
  }
  // A IA às vezes também põe a correção em "linhas", sem a quantidade: essa linha sai, a correção entra abaixo.
  const ehCorrecao = (t: string): boolean => respostasDeCorrecao.some(c => c.length > 0 && limpar(t).includes(c));
  // E põe a própria resposta em "linhas": em 20/10 "Prego 17 x 21" entrou como resposta E como item
  // novo, e "1 trocar pela telha galvalume" virou 1 telha (T16, T6). A linha da resposta não vira item.
  const ehRespostaPeloTexto = linhaDeResposta(extracao.respostas_a_perguntas, tela.numeradas.length);
  const ehResposta = (t: string, itens: ItemExtraido[] = []): boolean => ehRespostaPeloTexto(t)
    || (itens.length > 0 && linhasQueResponderam.some(x => limpar(x.linha) === limpar(t) && itens.every(i => i.familia === x.familia)));
  extracao = {
    ...extracao,
    linhas: extracao.linhas.map(l => (edicoes.linhas.has(l.linha_id) || (!l.descartada && ehLinhaDaOperacao(l))
      ? { ...l, descartada: true, motivo_descarte: 'edicao da lista', itens: [] }
      : ehCorrecao(l.texto_original)
        ? { ...l, descartada: true, motivo_descarte: 'correcao de pergunta', itens: [] }
        : ehResposta(l.texto_original, l.itens) ? { ...l, descartada: true, motivo_descarte: 'resposta de pergunta', itens: [] } : l)),
  };
  // A correção e a troca são itens novos: passam pela extração e pelo resolvedor como qualquer pedido.
  // A linha que respondeu uma pergunta não é pedido perdido: "quero mais 2 de disco de corte" respondeu o "mais de qual?"
  // e ainda somava outros 2 (teste de 25/10 à noite).
  const respondeu = (t: string): boolean => linhasQueResponderam.some(x => limpar(x.linha) === limpar(t));
  correcoes.push(...edicoes.novos, ...pedidosPerdidos.filter(l => !respondeu(l.texto_original)).map(l => l.texto_original));
  // A soma recusada por ter a medida de outro produto entra como item novo, se a leitura já não trouxe esse item.
  const jaLido = (o: string): boolean => extracao.linhas.some(l => !l.descartada && l.itens.length > 0
    && (limpar(l.texto_original).includes(o) || o.includes(limpar(l.texto_original))));
  correcoes.push(...operacoes.itensNovos.filter(o => !jaLido(o)));
  if (correcoes.length) {
    const textoDaCorrecao = correcoes.join('\n');
    await registrarItens(deps, pedidoId, await extrair(deps, pedidoId, textoDaCorrecao, []), textoDaCorrecao);
  }
  if (reescritos.length) {
    const textoReescrito = reescritos.join('\n');
    await registrarItens(deps, pedidoId, await extrair(deps, pedidoId, textoReescrito, []), textoReescrito, true);
  }
  const temItens = extracao.linhas.some(l => !l.descartada && l.itens.length);
  // Só resposta ou confirmação não registra itens; o resto passa pela cobertura e pelo resgate de linha descartada.
  const soResposta = (extracao.tipo_mensagem === 'resposta_pergunta' || extracao.tipo_mensagem === 'confirmacao') && !temItens;
  const { naoLidas, mudancas } = soResposta ? { naoLidas: [], mudancas: [] } : await registrarItens(deps, pedidoId, extracao, texto);
  const mudouALista = temItens || correcoes.length > 0 || reescritos.length > 0 || edicoes.linhas.size > 0 || operacoes.aplicadas.length > 0 || maisDeQual > 0;
  // A IA leu confirmação, mas a mensagem tem pergunta, "não" ou pedido de mudança: não fecha (22/10).
  const confirmacaoDaIA = listaConfirmada || extracao.tipo_mensagem === 'confirmacao';
  const duvida = DUVIDA_OU_EDICAO.test(limpar(texto));
  // A lista só fecha com o sim escrito pelo cliente. Em 25/10 à noite a IA marcou "sim" para "DISCO DE CORTE NORTON 4.5 X 3/4
  // AR302" e para "quero fechar o orçamento", e a lista fechou sem ele dizer sim. Sem o sim escrito, a pergunta de baixo
  // (`naoFicouClaro`) pede o sim de novo.
  if (confirmacaoDaIA && !mudouALista && !duvida && disseSimALista(texto)) await confirmarLista(deps, pedidoId);
  // Parecia sim e não ficou claro, e nada mudou: pergunta de volta, com frase fixa.
  const estadoDosItens = (itens: ItemDoPedido[]): string => JSON.stringify(itens.map(i => [i.id, i.status, i.codigo_final, i.quantidade]));
  const naoFicouClaro = pedido?.estado === 'aguardando_confirmacao' && (confirmacaoDaIA || COMECA_COMO_SIM.test(limpar(texto)))
    && (await deps.armazem.pedido(pedidoId))?.estado === 'aguardando_confirmacao'
    && estadoDosItens(await deps.armazem.itens(pedidoId)) === estadoDosItens(itensAntes);

  // Pedido de mudança que não mudou nada (medição de 25/10: "Troca o metalon por outro tipo 100x40" ficou sem resposta).
  // A palavra só decide se o aviso sai; nunca muda a lista.
  const pediuMudanca = usaOperacoes && /\b(?:troc|tir|mud|coloc|substitu|remov)\w*/.test(limpar(texto));
  const semEfeito = pediuMudanca && !operacoes.avisos.length && estadoDosItens(await deps.armazem.itens(pedidoId)) === estadoDosItens(itensAntes)
    ? ['Não entendi o que mudar. Diga o item como está na lista e o que fazer, por exemplo: troca o disco de corte pelo de desbaste.'] : [];
  const r = await montarResposta(deps, pedidoId, [...edicoes.avisos, ...operacoes.avisos, ...semEfeito, ...mudancas, ...avisoDeLinhasNaoLidas(naoLidas)], naoFicouClaro ? FECHO_A_LISTA_ASSIM : undefined);
  return { ...r, itens: await deps.armazem.itens(pedidoId), extracao };
}

export type { ItemExtraido };

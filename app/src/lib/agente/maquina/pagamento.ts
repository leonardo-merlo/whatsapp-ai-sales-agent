// A forma de pagamento: o que oferecer, como mostrar e o que o cliente escolheu.
//
// Tudo no código, sem IA (decisão do Leonardo em 14/10). O ERP manda dezenas
// de condições por cliente (o de teste tem 40, 24 só de cartão de crédito);
// a lista mostra os TIPOS, e o cartão se resolve por parcela e bandeira.
//
// Fica de fora o que não se paga por link: o Rodrigo disse que no WhatsApp o
// pagamento é só por link (`R$` = à vista no balcão, `DP` = receber na entrega).

import type { FormaDePagamentoDoErp } from '../../erp/contrato';
import { numerosPorExtenso } from '../../v2/numeros';
import type { DadosDoOrcamento, GrupoDePagamento, PagamentoParcial } from './tipos';

export const FORMAS_FORA_DO_LINK: readonly string[] = ['R$', 'DP'];

export interface OpcaoDePagamento {
  codigo: string;
  descricao: string;
  grupo: GrupoDePagamento;
  parcelas: number;
  /** `VISA`, `MASTER`... Null quando a descrição não diz. */
  bandeira: string | null;
  valor_minimo: number | null;
  valor_maximo: number | null;
}

const ORDEM: GrupoDePagamento[] = ['pix', 'boleto', 'credito', 'debito', 'bndes', 'outra'];
const CARTOES: readonly GrupoDePagamento[] = ['credito', 'debito', 'bndes'];
const BANDEIRAS = ['VISA', 'MASTER', 'CABAL', 'ELO', 'AMEX', 'HIPER'];

const NOME_DO_CARTAO: Record<string, string> = { credito: 'cartão de crédito', debito: 'cartão de débito', bndes: 'cartão BNDES' };

/** O `tipo` que o ERP manda desde 21/10, quando vem; senão, o código da forma. */
const GRUPO_DO_TIPO: Record<string, GrupoDePagamento> = { PIX: 'pix', BOLETO: 'boleto', CARTAO_CREDITO: 'credito', CARTAO_DEBITO: 'debito' };

export function grupoDa(f: FormaDePagamentoDoErp): GrupoDePagamento {
  const doTipo = f.tipo ? GRUPO_DO_TIPO[f.tipo] : undefined;
  if (doTipo) return doTipo === 'credito' && /BNDES/i.test(f.descricao) ? 'bndes' : doTipo;
  if (f.forma === 'PIX') return 'pix';
  if (f.forma === 'BO' || f.forma === 'BOL') return 'boleto';
  if (f.forma === 'CD') return 'debito';
  if (f.forma === 'CC') return /BNDES/i.test(f.descricao) ? 'bndes' : 'credito';
  return 'outra';
}

/**
 * A parcela pela descrição, quando ela diz. Na homologação de 14/10, CVD a CVO
 * dizem "C. C. 13 PARCELAS" a "24 PARCELAS" com `parcelas: 3`; a descrição é
 * a que o vendedor lê.
 */
function parcelasDa(f: FormaDePagamentoDoErp): number {
  const n = f.descricao.match(/(\d{1,2})\s*PARCELA/i);
  return n ? Number(n[1]) : Math.max(1, f.parcelas || 1);
}

function bandeiraDa(f: FormaDePagamentoDoErp): string | null {
  // O campo do ERP manda quando vem (21/10): MASTERCARD é o nosso MASTER; null é o cliente escolhendo no link.
  if (f.bandeira !== undefined) return f.bandeira ? (BANDEIRAS.find(b => f.bandeira!.toUpperCase().startsWith(b)) ?? f.bandeira.toUpperCase()) : null;
  const texto = f.descricao.toUpperCase();
  return BANDEIRAS.find(b => texto.includes(b)) ?? null;
}

/**
 * Teste de campo de 21/10: CVD a CVO ("C. C. 13 PARCELAS" com `parcelas: 3`, sem bandeira) serviam
 * a qualquer bandeira, e o Master, que só tem até 6x, dizia "vai até 24x". Cartão sem bandeira cuja
 * descrição contradiz o campo fica fora até a Distribuidora Exemplo responder (pergunta 24 do backlog).
 */
function cartaoSemBandeiraIncoerente(f: FormaDePagamentoDoErp): boolean {
  const naDescricao = f.descricao.match(/(\d{1,2})\s*PARCELA/i);
  return grupoDa(f) === 'credito' && !bandeiraDa(f) && !!naDescricao && Number(naDescricao[1]) !== f.parcelas;
}

/**
 * O que o cliente pode escolher: liberado pelo ERP, pagável por link e de um
 * tipo conhecido. Cheque e forma sem tipo ("35 DIAS") ficam de fora (16/10).
 */
export function opcoesOferecidas(formas: FormaDePagamentoDoErp[] | undefined): OpcaoDePagamento[] {
  return (formas ?? [])
    .filter(f => f.disponivel && !FORMAS_FORA_DO_LINK.includes(f.forma) && grupoDa(f) !== 'outra' && !cartaoSemBandeiraIncoerente(f))
    .map(f => ({
      codigo: f.codigo, descricao: f.descricao, grupo: grupoDa(f), parcelas: parcelasDa(f), bandeira: bandeiraDa(f),
      valor_minimo: f.valor_minimo, valor_maximo: f.valor_maximo,
    }));
}

/**
 * As opções deste orçamento: as do cliente, menos as que o total não cabe.
 * Teste de 16/10: com total de R$ 3.000 e todo boleto com máximo de R$ 2.000,
 * o menu seguia oferecendo "Boleto" e cada prazo era recusado um por um.
 */
export function opcoesDoOrcamento(dados: DadosDoOrcamento): OpcaoDePagamento[] {
  const recusados = dados.pagamentos_recusados ?? [];
  const total = dados.total_referencia;
  return opcoesOferecidas(dados.cliente?.formas_pagamento)
    .filter(o => !recusados.includes(o.codigo) && (total === undefined || !limiteEstourado(total, o)));
}

/** O total cabe na condição? Null: cabe. Limite nulo é "sem limite". */
export function limiteEstourado(
  total: number, p: { valor_minimo: number | null; valor_maximo: number | null },
): { tipo: 'minimo' | 'maximo'; limite: number } | null {
  if (p.valor_minimo !== null && total < p.valor_minimo) return { tipo: 'minimo', limite: p.valor_minimo };
  if (p.valor_maximo !== null && total > p.valor_maximo) return { tipo: 'maximo', limite: p.valor_maximo };
  return null;
}

/** "R$ 10.000,00", com espaço comum (o Intl põe um espaço que o WhatsApp mostra estranho). */
export const reais = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');

/** "BOL ANTECIPADO" → "Boleto antecipado". As abreviações do cadastro deles, por extenso. */
export function rotuloDaDescricao(descricao: string): string {
  const t = descricao.trim()
    .replace(/^BOL\b\.?/i, 'BOLETO')
    .replace(/^C\.\s*C\.\s*/i, 'CARTÃO DE CRÉDITO ')
    .replace(/\bA VISTA\b/i, 'À VISTA')
    .toLowerCase();
  const frase = t.charAt(0).toUpperCase() + t.slice(1);
  return frase.replace(/\bpix\b/gi, 'PIX').replace(/\bbndes\b/gi, 'BNDES');
}

const titulo = (b: string): string => b.charAt(0) + b.slice(1).toLowerCase();

function emLista(partes: string[], e = 'ou'): string {
  return partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} ${e} ${partes[partes.length - 1]}`;
}

const maxParcelas = (opcoes: OpcaoDePagamento[]): number => Math.max(1, ...opcoes.map(o => o.parcelas));

/** As linhas do menu: um tópico por tipo; o tipo com uma condição só mostra o nome dela. */
export function linhasDoMenu(opcoes: OpcaoDePagamento[]): string[] {
  const linhas: string[] = [];
  for (const grupo of ORDEM) {
    const doGrupo = opcoes.filter(o => o.grupo === grupo);
    if (!doGrupo.length) continue;
    if (grupo === 'credito') {
      const max = maxParcelas(doGrupo);
      linhas.push(max > 1 ? `Cartão de crédito em até ${max}x` : 'Cartão de crédito');
    } else if (grupo === 'debito') linhas.push('Cartão de débito');
    else if (grupo === 'bndes') linhas.push('Cartão BNDES');
    else if (grupo === 'boleto' && doGrupo.length > 1) linhas.push('Boleto');
    else linhas.push(...doGrupo.map(o => rotuloDaDescricao(o.descricao)));
  }
  return [...new Set(linhas)];
}

export const emTopicos = (linhas: string[]): string => linhas.map(l => `• ${l}`).join('\n');

/** Como a escolha aparece para o cliente e para o vendedor: "cartão de crédito Visa em 3x". */
export function rotuloDaOpcao(o: OpcaoDePagamento, bandeiraDoCliente?: string): string {
  if (!CARTOES.includes(o.grupo)) {
    const r = rotuloDaDescricao(o.descricao);
    return /^PIX/.test(r) ? r : r.charAt(0).toLowerCase() + r.slice(1);
  }
  // A forma sem bandeira no ERP (13 a 24x) vale para a que o cliente escolheu: o texto diz a dele (teste de 21/10).
  const nome = o.bandeira ?? bandeiraDoCliente;
  const bandeira = nome ? ` ${titulo(nome)}` : '';
  const vezes = o.grupo === 'credito' ? ` em ${o.parcelas}x` : '';
  return `${NOME_DO_CARTAO[o.grupo]}${bandeira}${vezes}`;
}

const normalizar = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Teste de 16/10: "não quero pix, quero boleto" escolhia PIX. Fica só o que o
 * cliente quer: sai o trecho com negação e, se ele disse a preferência, só ela vale.
 */
function oQueOClienteQuer(t: string): string {
  const trechos = t.split(/[,.;:!?\n]|\bmas\b|\bporem\b|(?=\be nao\b)/)
    .map(p => p.trim())
    .filter(p => p && !/\b(nao|nunca|nada de)\b/.test(p));
  const preferidos = trechos.filter(p => /\b(prefiro|prefere|preferencia|melhor)\b/.test(p));
  return (preferidos.length ? preferidos : trechos).join(', ');
}

/** "pix ou boleto": dois tipos sem preferência não se resolvem sozinhos. */
function tiposDistintos(t: string): number {
  const bndes = /\bbndes\b/.test(t);
  return [
    /\bpix\b/.test(t),
    /\bbol(eto)?s?\b/.test(t),
    bndes,
    /\bdebito\b/.test(t),
    // "metade pix metade cartão" (22/10): o cartão sem tipo também é o crédito.
    /\bcredito\b/.test(t) || (/\bcartao\b/.test(t) && !bndes && !/\bdebito\b/.test(t)) || (!bndes && !/\bbol(eto)?s?\b/.test(t) && /\bparcel|\b\d{1,2}\s*(x|vezes)\b/.test(t)),
  ].filter(Boolean).length;
}

/** Com `soOExplicito`, "3x" não é cartão: é a resposta à pergunta do prazo do boleto. */
function grupoCitado(t: string, soOExplicito = false): GrupoDePagamento | null {
  if (/\bpix\b/.test(t)) return 'pix';
  if (/\bbol(eto)?s?\b/.test(t)) return 'boleto';
  if (/\bbndes\b/.test(t)) return 'bndes';
  if (/\bdebito\b/.test(t)) return 'debito';
  if (/\bcredito\b|\bcartao\b|\bcc\b/.test(t)) return 'credito';
  if (!soOExplicito && /\bparcel|\b\d{1,2}\s*(x|vezes)\b/.test(t)) return 'credito';
  if (BANDEIRAS.some(b => new RegExp(`\\b${b.toLowerCase()}`).test(t))) return 'credito';
  return null;
}

function parcelasCitadas(t: string, perguntouParcelas: boolean): number | null {
  const n = t.match(/\b(\d{1,2})\s*(x\b|vez|vezes\b|parcelas?\b)/);
  if (n) return Number(n[1]);
  if (/\b(uma vez|a vista|sem parcelar)\b/.test(t)) return 1;
  if (perguntouParcelas) {
    const so = t.match(/^\D*(\d{1,2})\D*$/);
    if (so) return Number(so[1]);
  }
  return null;
}

const bandeiraCitada = (t: string): string | null =>
  BANDEIRAS.find(b => new RegExp(`\\b${b.toLowerCase()}`).test(t)) ?? null;

export type Escolha =
  | { tipo: 'escolhida'; opcao: OpcaoDePagamento; /** A bandeira que o cliente falou, para o texto da forma que vem sem ela. */ bandeira?: string }
  | { tipo: 'falta'; parcial: PagamentoParcial; pergunta: 'parcelas' | 'bandeira' | 'opcao_de_pagamento'; foraDoLimite?: boolean }
  /** O cliente pediu um tipo que o ERP não liberou para ele. */
  | { tipo: 'indisponivel' }
  | { tipo: 'nada' };

/** As opções que ainda servem ao que o cliente já disse. */
export function candidatas(opcoes: OpcaoDePagamento[], parcial: PagamentoParcial): OpcaoDePagamento[] {
  return opcoes.filter(o => o.grupo === parcial.grupo
    && (parcial.parcelas === undefined || o.parcelas === parcial.parcelas)
    && (parcial.bandeira === undefined || o.bandeira === null || o.bandeira === parcial.bandeira));
}

/** Uma condição não-cartão citada pelo que a descrição tem além do tipo ("antecipado", "30/60/90"). */
function condicaoCitada(t: string, doGrupo: OpcaoDePagamento[]): OpcaoDePagamento | null {
  const achadas = doGrupo.filter(o => {
    const palavras = normalizar(rotuloDaDescricao(o.descricao)).split(/\s+/).slice(1).filter(p => p.length > 1);
    return palavras.length > 0 && palavras.every(p => t.includes(p));
  });
  return achadas.length === 1 ? achadas[0] : null;
}

export interface Prazo { dias: number[]; vezes: number | null; antecipado: boolean }

/** "BOLETO 30/60/90 DIAS", "10,20,40 DIAS BOLETO", "BOLETO 5X", ou o que o cliente escreveu. */
export function prazoDe(texto: string): Prazo {
  const t = normalizar(texto);
  const vezes = t.match(/\b(\d{1,2})\s*(x|vezes)\b/);
  const semVezes = vezes ? t.replace(vezes[0], ' ') : t;
  return {
    dias: (semVezes.match(/\d{1,3}/g) ?? []).map(Number),
    vezes: vezes ? Number(vezes[1]) : null,
    antecipado: /\b(antecipad[oa]|a vista)\b/.test(t),
  };
}

const mesmosDias = (a: number[], b: number[]): boolean => a.length === b.length && a.every((d, i) => d === b[i]);

/**
 * O boleto pelo prazo (16/10: o ERP manda dezenas de prazos por cliente).
 * Null: o cliente citou um prazo que não está liberado; `sem_prazo`: não citou.
 */
function boletoCitado(t: string, doGrupo: OpcaoDePagamento[]): OpcaoDePagamento | null | 'sem_prazo' {
  const pedido = prazoDe(t);
  // "entrada + 30" é condição de duplicata, não de boleto: não vira "30 dias".
  if (/\bentrada\b/.test(t)) return null;
  const comPrazo = doGrupo.map(o => ({ o, p: prazoDe(o.descricao) }));
  let achadas: typeof comPrazo;
  if (pedido.antecipado) achadas = comPrazo.filter(x => x.p.antecipado);
  else if (pedido.dias.length) {
    achadas = comPrazo.filter(x => mesmosDias(x.p.dias, pedido.dias) && (pedido.vezes === null || x.p.vezes === pedido.vezes));
    if (pedido.vezes === null && achadas.some(x => x.p.vezes === null)) achadas = achadas.filter(x => x.p.vezes === null);
  } else if (pedido.vezes !== null) {
    achadas = comPrazo.filter(x => x.p.vezes === pedido.vezes);
    if (achadas.some(x => !x.p.dias.length)) achadas = achadas.filter(x => !x.p.dias.length);
  } else return 'sem_prazo';
  return achadas[0]?.o ?? null;
}

const rotuloDoPrazo = (o: OpcaoDePagamento): string =>
  rotuloDaDescricao(o.descricao).replace(/^boleto\s*/i, '').replace(/\s*boleto$/i, '').toLowerCase();

/** Até cinco prazos de exemplo: os de costume primeiro, depois os mais curtos. */
function prazosDeExemplo(doGrupo: OpcaoDePagamento[]): string {
  const costume = [[28], [30], [30, 60], [30, 60, 90]];
  const comPrazo = doGrupo.map(o => ({ o, p: prazoDe(o.descricao) }));
  const escolhidos = [
    ...comPrazo.filter(x => x.p.antecipado).slice(0, 1),
    ...costume.flatMap(d => comPrazo.filter(x => !x.p.antecipado && x.p.vezes === null && mesmosDias(x.p.dias, d)).slice(0, 1)),
  ];
  const resto = comPrazo
    .filter(x => !escolhidos.includes(x))
    .sort((a, b) => a.p.dias.length - b.p.dias.length || (a.p.dias[0] ?? 0) - (b.p.dias[0] ?? 0));
  return emLista([...escolhidos, ...resto].slice(0, 5).map(x => rotuloDoPrazo(x.o)));
}

/**
 * Lê a resposta do cliente. `parcial` é o que ele já tinha dito; um tipo novo
 * citado ("não, pix") recomeça.
 */
export function escolherPagamento(
  opcoes: OpcaoDePagamento[], texto: string, parcial: PagamentoParcial | undefined, pergunta: string | null,
): Escolha {
  // Válvula de escape (22/10): "tem desconto no pix?" escolhia PIX. Pergunta nunca escolhe; a IA responde.
  if (texto.includes('?')) return { tipo: 'nada' };
  // A linha do menu copiada ("Cartão de crédito em até 10x") diz o teto, não a parcela escolhida.
  const t = oQueOClienteQuer(numerosPorExtenso(normalizar(texto))).replace(/\bate\s+\d{1,2}\s*(?:x|vezes)\b/g, ' ');
  if (tiposDistintos(t) > 1) return { tipo: 'nada' };
  const respondendoPrazo = parcial?.grupo === 'boleto' && pergunta === 'opcao_de_pagamento';
  const citado = grupoCitado(t, respondendoPrazo);
  // Teste de campo de 21/10: "master" respondendo à bandeira do débito virava cartão de crédito.
  const soABandeira = citado === 'credito' && !/\bcredito\b|\bcartao\b|\bcc\b|\bparcel|\b\d{1,2}\s*(x|vezes)\b/.test(t);
  const grupo = (soABandeira && parcial && CARTOES.includes(parcial.grupo) ? parcial.grupo : citado) ?? parcial?.grupo ?? null;
  if (!grupo) return { tipo: 'nada' };
  const doGrupo = opcoes.filter(o => o.grupo === grupo);
  if (!doGrupo.length) return { tipo: 'indisponivel' };
  const antes: PagamentoParcial = parcial && parcial.grupo === grupo ? parcial : { grupo };

  if (!CARTOES.includes(grupo)) {
    // Com um boleto só, "boleto 28 dias" não vira o antecipado em silêncio: o prazo citado tem de ser o dele.
    const prazoQueNaoTem = grupo === 'boleto' && boletoCitado(t, doGrupo) === null;
    if (doGrupo.length === 1 && !prazoQueNaoTem) return { tipo: 'escolhida', opcao: doGrupo[0] };
    if (grupo === 'boleto') {
      const boleto = boletoCitado(t, doGrupo);
      if (boleto === 'sem_prazo') return { tipo: 'falta', parcial: { grupo }, pergunta: 'opcao_de_pagamento' };
      return boleto
        ? { tipo: 'escolhida', opcao: boleto }
        : { tipo: 'falta', parcial: { grupo }, pergunta: 'opcao_de_pagamento', foraDoLimite: true };
    }
    const achada = condicaoCitada(t, doGrupo);
    return achada ? { tipo: 'escolhida', opcao: achada } : { tipo: 'falta', parcial: { grupo }, pergunta: 'opcao_de_pagamento' };
  }

  const parcelas = parcelasCitadas(t, pergunta === 'parcelas') ?? antes.parcelas;
  const bandeira = bandeiraCitada(t) ?? antes.bandeira;
  const novo: PagamentoParcial = { grupo };
  if (parcelas !== undefined) novo.parcelas = parcelas;
  if (bandeira !== undefined) novo.bandeira = bandeira;

  // Bandeira que o cliente não tem ("elo"): pergunta a bandeira de novo.
  if (bandeira !== undefined && !candidatas(opcoes, { grupo, bandeira }).length) {
    return { tipo: 'falta', parcial: parcelas !== undefined ? { grupo, parcelas } : { grupo }, pergunta: 'bandeira' };
  }
  // Parcela que não existe (ou não existe nessa bandeira, "10x no Master"): pergunta a parcela de novo.
  if (parcelas !== undefined && !candidatas(opcoes, novo).length) {
    return { tipo: 'falta', parcial: bandeira !== undefined ? { grupo, bandeira } : { grupo }, pergunta: 'parcelas', foraDoLimite: true };
  }

  const servem = candidatas(opcoes, novo);
  if (new Set(servem.map(o => o.parcelas)).size > 1) return { tipo: 'falta', parcial: novo, pergunta: 'parcelas' };
  if (servem.length > 1 && new Set(servem.map(o => o.bandeira)).size > 1) return { tipo: 'falta', parcial: novo, pergunta: 'bandeira' };
  return { tipo: 'escolhida', opcao: servem[0], ...(novo.bandeira !== undefined ? { bandeira: novo.bandeira } : {}) };
}

/** As bandeiras que ainda servem, por extenso: "Visa ou Master". */
export function bandeirasPossiveis(opcoes: OpcaoDePagamento[], parcial: PagamentoParcial): string {
  const nomes = [...new Set(candidatas(opcoes, { ...parcial, bandeira: undefined }).map(o => o.bandeira).filter((b): b is string => !!b))];
  return emLista(nomes.map(titulo));
}

/** Os textos das perguntas do pagamento (as chaves estão em `textos.ts`). */
export function textoDoPagamento(
  chave: 'menu' | 'parcelas' | 'parcelas_fora' | 'bandeira' | 'opcao' | 'opcao_fora', dados: DadosDoOrcamento,
): string {
  const opcoes = opcoesDoOrcamento(dados);
  const parcial = dados.pagamento_parcial ?? { grupo: 'credito' as const };
  switch (chave) {
    case 'menu':
      return `Como prefere pagar?\n\n${emTopicos(linhasDoMenu(opcoes))}`;
    case 'parcelas':
    case 'parcelas_fora': {
      const max = maxParcelas(candidatas(opcoes, { ...parcial, parcelas: undefined }));
      const bandeiras = parcial.bandeira ? '' : bandeirasPossiveis(opcoes, parcial);
      const qual = bandeiras.includes(' ou ') ? ` E é ${bandeiras}?` : '';
      const cartao = `${NOME_DO_CARTAO[parcial.grupo] ?? 'cartão'}${parcial.bandeira ? ` ${titulo(parcial.bandeira)}` : ''}`;
      if (chave === 'parcelas_fora') return `No ${cartao} vai até ${max}x. Em quantas vezes?${qual}`;
      return `Em quantas vezes? Vai até ${max}x.${qual}`;
    }
    case 'bandeira':
      return `Qual a bandeira do cartão: ${bandeirasPossiveis(opcoes, parcial)}?`;
    case 'opcao':
    case 'opcao_fora': {
      const doGrupo = opcoes.filter(o => o.grupo === parcial.grupo);
      if (parcial.grupo === 'boleto') {
        return chave === 'opcao_fora'
          ? `Esse prazo não está disponível para este pedido. Alguns que estão: ${prazosDeExemplo(doGrupo)}. Qual prefere?`
          : `Em qual prazo? Por exemplo: ${prazosDeExemplo(doGrupo)}.`;
      }
      return `Qual delas?\n\n${emTopicos(doGrupo.map(o => rotuloDaDescricao(o.descricao)))}`;
    }
  }
}

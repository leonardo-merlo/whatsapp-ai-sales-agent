// As conferências do código sobre a extração (Fase D, item 3). A IA etiqueta;
// aqui se confere, sem IA, que ela não inventou nem esqueceu nada:
//
//   literal: todo valor e trecho aparece no texto da linha (tolerando espaço,
//     vírgula/ponto e maiúscula);
//   cobertura de números: todo número da linha foi para quantidade, medida
//     ou número auxiliar;
//   cobertura de linhas: toda linha da mensagem virou item ou foi descartada;
//   molde: as etiquetas existem na família, na quantidade certa;
//   outra unidade: "3/4 (19MM)" só passa se a conversão fechar (5%);
//   família: a família da IA bate com a do dicionário.
//
// Falha em qualquer uma fecha a trava 2 do item: ele não se resolve sozinho.

import { familiaDoTexto } from './dicionario';
import { etiquetasDoMolde, familia as familiaPorId } from './familias';
import { linhasDaMensagem } from './extracao';
import { lerUnidade, lerValor, limpar, mesmoNumero, numerosDoTexto, numerosEscritos } from './numeros';
import type { Conferencia, Extracao, ItemExtraido, LinhaExtraida } from './tipos';

const POL = 25.4;
export const TOLERANCIA_OUTRA_UNIDADE = 0.05;

/** Texto para comparação literal: sem acento, minúsculo, sem espaço, vírgula vira ponto. */
const compacto = (t: string): string => limpar(t).replace(/[“”]/g, '"').replace(/''/g, '"').replace(/,/g, '.').replace(/\s+/g, '');

function aparece(trecho: string, texto: string): boolean {
  if (!trecho.trim()) return true;
  return compacto(texto).includes(compacto(trecho));
}

/** "4 metros e meio" e "4 e meio" → "4.5": a mesma medida com ou sem a unidade no meio (teste de campo de 21/10). */
const meioEmDecimal = (t: string): string => limpar(t).replace(/(\d+)\s*(?:[a-z]+\.?\s+)?e\s+meio\b/g, '$1.5');

export function conferirLiteral(item: ItemExtraido, textoDaLinha: string, textoDoIdem = ''): Conferencia {
  const faltando: string[] = [];
  const checar = (rotulo: string, valor: string, trecho: string): void => {
    if (!aparece(trecho, textoDaLinha)) faltando.push(`${rotulo} trecho "${trecho}"`);
    // Áudio transcrito (22/10): "três oitavos" é 3/8, "cinco quilos" é 5.
    else if (valor && !aparece(valor, trecho) && !aparece(valor, textoDaLinha) && !aparece(meioEmDecimal(valor), meioEmDecimal(trecho)) && !aparece(valor, numerosEscritos(trecho))) faltando.push(`${rotulo} valor "${valor}"`);
  };
  if (item.quantidade) checar('quantidade', item.quantidade.valor, item.quantidade.trecho);
  for (const m of item.medidas) checar(m.etiqueta, m.valor, m.trecho);
  for (const a of item.numeros_auxiliares) checar(`auxiliar ${a.papel}`, a.valor, a.trecho);
  // Qualificador também tem de estar no texto: a IA não pode acrescentar "galvanizado" que o cliente não escreveu.
  // Comparação solta (só letras e números): aspas e pontuação que a IA tirou não contam.
  const solto = (t: string): string => limpar(t).replace(/[^a-z0-9/]+/g, '');
  for (const q of item.qualificadores) if (!solto(`${textoDoIdem} ${textoDaLinha}`).includes(solto(q))) faltando.push(`qualificador "${q}"`);
  return { nome: 'literal', ok: !faltando.length, detalhe: faltando.length ? `não está no texto: ${faltando.join('; ')}` : 'tudo copiado do texto' };
}

/** Os números de um item: "1 1/4" e "1.1/4" contam como um; "50x30" como dois. */
function numerosDoItem(item: ItemExtraido): string[] {
  const valores = [
    ...(item.quantidade ? [item.quantidade.valor] : []),
    ...item.medidas.map(m => m.valor),
    ...item.numeros_auxiliares.map(a => a.valor),
  ];
  return valores.flatMap(v => (lerValor(v) ? [v] : numerosDoTexto(v)));
}

/** Todo número da linha está em algum item dela? (Um número pode cobrir mais de uma ocorrência igual.) */
export function conferirCoberturaDeNumeros(linha: LinhaExtraida): Conferencia {
  if (linha.descartada) return { nome: 'cobertura_de_numeros', ok: true, detalhe: 'linha descartada' };
  const doTexto = numerosDoTexto(linha.texto_original);
  const dosItens = linha.itens.flatMap(numerosDoItem);
  // "e meio" e "1 e 1/4" viram um número só no item; no texto, os pedaços aparecem.
  const textoDosItens = linha.itens.flatMap(i => [...i.medidas.map(m => m.valor), ...(i.quantidade ? [i.quantidade.trecho] : []), ...i.numeros_auxiliares.map(a => a.trecho), ...i.medidas.map(m => m.trecho)]).join(' ');
  const soltos = doTexto.filter(n => !dosItens.some(d => mesmoNumero(n, d)) && !numerosDoTexto(textoDosItens).some(d => mesmoNumero(n, d)));
  return { nome: 'cobertura_de_numeros', ok: !soltos.length, detalhe: soltos.length ? `números sem papel: ${soltos.join(', ')}` : 'todo número tem papel' };
}

/** Cada linha da mensagem tem uma linha na extração (pelo id ou pelo texto). */
export function conferirCoberturaDeLinhas(textoDaMensagem: string, extracao: Extracao): { conferencia: Conferencia; faltando: { id: number; texto: string }[] } {
  const faltando = linhasDaMensagem(textoDaMensagem).filter(l => {
    const porId = extracao.linhas.find(x => x.linha_id === l.id);
    if (porId && (porId.descartada ? !!porId.motivo_descarte : porId.itens.length > 0) && compacto(porId.texto_original) === compacto(l.texto)) return false;
    return !extracao.linhas.some(x => compacto(x.texto_original).includes(compacto(l.texto)) && (x.itens.length || (x.descartada && x.motivo_descarte)));
  });
  return {
    conferencia: { nome: 'cobertura_de_linhas', ok: !faltando.length, detalhe: faltando.length ? `linhas sem item nem descarte: ${faltando.map(l => l.id).join(', ')}` : 'toda linha coberta' },
    faltando,
  };
}

export function conferirMolde(item: ItemExtraido): Conferencia {
  const f = familiaPorId(item.familia);
  if (!f) return { nome: 'molde', ok: false, detalhe: `família desconhecida: ${item.familia}` };
  const permitidas = etiquetasDoMolde(f);
  const conta = new Map<string, number>();
  for (const m of item.medidas) conta.set(m.etiqueta, (conta.get(m.etiqueta) ?? 0) + 1);
  const erros: string[] = [];
  for (const [etiqueta, n] of conta) {
    // ordem livre: etiquetas do mesmo grupo se somam ("lado", "lado")
    const max = permitidas.get(etiqueta);
    if (max === undefined) erros.push(`etiqueta ${etiqueta} não existe em ${f.id}`);
    else if (n > max) erros.push(`${n}× ${etiqueta}, o molde tem ${max}`);
  }
  if (!f.medidas_da_descricao && item.medidas.length > (f.medidas?.length ?? 0)) erros.push(`${item.medidas.length} medidas, o molde tem ${f.medidas?.length ?? 0}`);
  return { nome: 'molde', ok: !erros.length, detalhe: erros.length ? erros.join('; ') : 'etiquetas do molde' };
}

/** A medida em mm, se der para saber (polegada vira mm por 25,4: é física, não tabela comercial). */
function emMm(valor: string, unidade: string | null): number | null {
  const lido = lerValor(valor);
  if (!lido) return null;
  const u = lido.unidade ?? lerUnidade(unidade);
  if (u === 'pol' || (u === null && lido.forma === 'fracao')) return lido.valor * POL;
  if (u === 'cm') return lido.valor * 10;
  return lido.valor;
}

/** "3/4 (19MM)": o auxiliar fecha com alguma medida do item, em 5%? */
export function conferirOutraUnidade(item: ItemExtraido): Conferencia {
  const auxiliares = item.numeros_auxiliares.filter(a => a.papel === 'mesma_medida_em_outra_unidade');
  if (!auxiliares.length) return { nome: 'outra_unidade', ok: true, detalhe: 'sem medida repetida' };
  const medidasMm = item.medidas.map(m => emMm(m.valor, m.unidade_escrita)).filter((x): x is number => x !== null);
  const conflitos = auxiliares.filter(a => {
    const v = lerValor(a.valor)?.valor;
    if (v === undefined) return true;
    // fração é polegada ("6,3mm (1/4)"); número com mm, ou sem unidade nenhuma, é mm
    const trechoEmMm = lerValor(a.valor)?.forma !== 'fracao' && (/mm/i.test(a.trecho) || !/"|pol/i.test(a.trecho));
    const aux = trechoEmMm ? v : v * POL;
    return !medidasMm.some(m => Math.abs(m - aux) / Math.max(m, aux) <= TOLERANCIA_OUTRA_UNIDADE);
  });
  return {
    nome: 'outra_unidade', ok: !conflitos.length,
    detalhe: conflitos.length ? `conflito: ${conflitos.map(a => `${a.valor} (${a.trecho})`).join(', ')} não fecha com as medidas` : 'a medida repetida fecha',
  };
}

export function conferirFamilia(item: ItemExtraido, textoDaLinha: string): Conferencia {
  const dic = familiaDoTexto(textoDaLinha);
  if (!dic.familias.length) return { nome: 'familia', ok: true, detalhe: 'dicionário silencioso' };
  const ok = dic.familias.includes(item.familia);
  return { nome: 'familia', ok, detalhe: ok ? `dicionário: ${dic.familias.join(', ')}` : `IA disse ${item.familia}, dicionário diz ${dic.familias.join(' ou ')}` };
}

/**
 * As conferências de um item. A de família fica fora da lista que fecha a
 * trava 2: ela já é a trava 1 no resolvedor (com a exceção do idem, cuja
 * palavra está noutra linha).
 */
export function conferirItem(item: ItemExtraido, linha: LinhaExtraida, textoDoIdem?: string): Conferencia[] {
  const textoDaFamilia = textoDoIdem ? `${textoDoIdem} ${linha.texto_original}` : linha.texto_original;
  return [
    conferirLiteral(item, linha.texto_original, textoDoIdem),
    conferirCoberturaDeNumeros(linha),
    conferirMolde(item),
    conferirOutraUnidade(item),
    conferirFamilia(item, textoDaFamilia),
  ];
}

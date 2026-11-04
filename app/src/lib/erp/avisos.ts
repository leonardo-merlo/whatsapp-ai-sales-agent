// O que o ERP mandou num formato que o código não lê.
//
// Em 16/10 vimos que mudar o FORMATO de um dado (um código de forma novo, uma
// descrição escrita de outro jeito) quebra a leitura sem aviso nenhum: a forma
// some do menu, o produto perde a medida. Valor novo (criar forma, mudar
// limite, produto novo) entra sozinho e não é aviso.
//
// Aqui só se avisa o que o código descarta ou lê errado. Cartão sem bandeira
// não é aviso (decisão do Leonardo em 16/10): o código aceita qualquer bandeira
// para ele, e os 12 do cadastro de teste encheriam o cartão à toa.
//
// Puro: a resposta entra, a lista de avisos sai. Quem grava é o observador das
// chamadas (`registro-de-chamadas.ts`), sem `await`.

import { FORMAS_FORA_DO_LINK, grupoDa, prazoDe } from '../agente/maquina/pagamento';
import { lerMedidas } from '../catalogo/moldes';
import type { FormaDePagamentoDoErp } from './contrato';
import { formasDaResposta } from './operacoes/consultar-cliente';
import type { TipoDeAviso } from './avisos-rotulos';
import { lerProdutosDoSync, lerRegioesDoSync } from './syncs/formato';

export type { TipoDeAviso } from './avisos-rotulos';

export interface AvisoDoErp {
  tipo: TipoDeAviso;
  /** Identifica o aviso dentro do tipo: o mesmo dado chegando de novo soma. */
  chave: string;
  origem: 'cliente' | 'produto' | 'regiao';
  /** O que chegou, em uma linha. */
  descricao: string;
  referencia: string | null;
}

const SITUACOES_CONHECIDAS = ['ATIVO', 'BLOQUEADO'];
const TIPOS_DE_PESSOA_CONHECIDOS = ['JURIDICA', 'FISICA'];

const semAcento = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();

function avisosDasFormas(formas: FormaDePagamentoDoErp[], clienteId: string | null): AvisoDoErp[] {
  const avisos: AvisoDoErp[] = [];
  for (const f of formas) {
    if (!f.disponivel || FORMAS_FORA_DO_LINK.includes(f.forma)) continue;
    const grupo = grupoDa(f);
    const forma = f.forma ? `forma ${f.forma}` : 'forma vazia';
    if (grupo === 'outra') {
      avisos.push({
        tipo: 'forma_desconhecida', chave: `${f.codigo}|${f.forma}`, origem: 'cliente',
        descricao: `${f.descricao}, ${forma}, código ${f.codigo}`, referencia: clienteId,
      });
    } else if (grupo === 'boleto') {
      const p = prazoDe(f.descricao);
      if (!p.dias.length && p.vezes === null && !p.antecipado) {
        avisos.push({
          tipo: 'boleto_sem_prazo', chave: f.codigo, origem: 'cliente',
          descricao: `${f.descricao}, código ${f.codigo}`, referencia: clienteId,
        });
      }
    }
  }
  return avisos;
}

function avisosDaConsulta(resposta: unknown): AvisoDoErp[] {
  const r = (resposta ?? {}) as Record<string, unknown>;
  const clienteId = typeof r.cliente_id === 'string' && r.cliente_id ? r.cliente_id : null;
  if (r.encontrado === false || !clienteId) return [];

  const avisos: AvisoDoErp[] = [];
  if (typeof r.situacao === 'string' && !SITUACOES_CONHECIDAS.includes(semAcento(r.situacao))) {
    avisos.push({
      tipo: 'situacao_desconhecida', chave: semAcento(r.situacao), origem: 'cliente',
      descricao: `situacao "${r.situacao}"`, referencia: clienteId,
    });
  }
  if (typeof r.tipo_pessoa === 'string' && !TIPOS_DE_PESSOA_CONHECIDOS.includes(semAcento(r.tipo_pessoa))) {
    avisos.push({
      tipo: 'tipo_pessoa_desconhecido', chave: semAcento(r.tipo_pessoa), origem: 'cliente',
      descricao: `tipo_pessoa "${r.tipo_pessoa}"`, referencia: clienteId,
    });
  }

  const brutas = r.formas_pagamento;
  if (brutas === undefined || brutas === null) return avisos;
  if (!Array.isArray(brutas)) {
    avisos.push({
      tipo: 'formas_fora_do_formato', chave: typeof brutas, origem: 'cliente',
      descricao: `formas_pagamento veio como ${typeof brutas}, não como lista`, referencia: clienteId,
    });
    return avisos;
  }
  const semCodigo = brutas.filter(f => !f || typeof (f as { codigo?: unknown }).codigo !== 'string' || !(f as { codigo: string }).codigo.trim());
  for (const f of semCodigo) {
    const descricao = String((f as { descricao?: unknown } | null)?.descricao ?? '').trim() || 'sem descrição';
    avisos.push({
      tipo: 'forma_sem_codigo', chave: descricao, origem: 'cliente',
      descricao, referencia: clienteId,
    });
  }
  avisos.push(...avisosDasFormas(formasDaResposta(brutas), clienteId));
  return avisos;
}

function avisosDoSyncDeProdutos(orgId: string, resposta: unknown): AvisoDoErp[] {
  const leitura = lerProdutosDoSync(resposta);
  if (!leitura.ok) {
    return [{ tipo: 'lista_fora_do_formato', chave: 'produtos', origem: 'produto', descricao: leitura.motivo, referencia: null }];
  }
  const avisos: AvisoDoErp[] = [];
  for (const problema of leitura.problemas) {
    const id = problema.split(':')[0];
    avisos.push({ tipo: 'produto_incompleto', chave: id, origem: 'produto', descricao: problema, referencia: id });
  }
  for (const falha of leitura.falhasDoErp) {
    avisos.push({ tipo: 'parte_do_erp_falhou', chave: `produtos|${falha}`, origem: 'produto', descricao: falha, referencia: null });
  }
  for (const p of leitura.itens) {
    const { molde, medidas } = lerMedidas(orgId, p.grupo, p.descricao);
    if (molde && !medidas) {
      avisos.push({
        tipo: 'produto_sem_medida', chave: p.produto_id, origem: 'produto',
        descricao: `${p.produto_id} ${p.descricao}, grupo ${p.grupo}`, referencia: p.produto_id,
      });
    }
  }
  return avisos;
}

function avisosDoSyncDeRegioes(resposta: unknown): AvisoDoErp[] {
  const leitura = lerRegioesDoSync(resposta);
  if (!leitura.ok) {
    return [{ tipo: 'lista_fora_do_formato', chave: 'regioes', origem: 'regiao', descricao: leitura.motivo, referencia: null }];
  }
  return [
    ...leitura.problemas.map((problema): AvisoDoErp => {
      const id = problema.split(':')[0];
      return { tipo: 'regiao_incompleta', chave: id, origem: 'regiao', descricao: problema, referencia: id };
    }),
    ...leitura.falhasDoErp.map((falha): AvisoDoErp => ({
      tipo: 'parte_do_erp_falhou', chave: `regioes|${falha}`, origem: 'regiao', descricao: falha, referencia: null,
    })),
  ];
}

/** Os avisos de uma chamada que deu certo. Um aviso por chave: o banco soma uma vez por chamada. */
export function avisosDaResposta(orgId: string, operacao: string, resposta: unknown): AvisoDoErp[] {
  const avisos = operacao === 'consultar_cliente' ? avisosDaConsulta(resposta)
    : operacao === 'sync_produtos' ? avisosDoSyncDeProdutos(orgId, resposta)
      : operacao === 'sync_regioes' ? avisosDoSyncDeRegioes(resposta)
        : [];
  const vistos = new Set<string>();
  return avisos.filter(a => {
    const k = `${a.tipo}|${a.chave}`;
    if (vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

// Histórico do agente: o que uma cópia guarda, e como ela volta para a tela.
//
// Salvar põe no ar na hora (decisão de 29/09, caminho B + D do item 9). A cópia
// serve para desfazer: carregar uma cópia preenche a tela, e quem põe no ar é o
// Salvar seguinte. Puro: roda no client e nos testes.

import type { AgenteConfigPayload } from '../data/mutations';
import type { Preco } from '../types';

/** O que a tela salva, menos o liga/desliga, que tem botão próprio. */
export type ConteudoDaVersao = Omit<AgenteConfigPayload, 'ativo'>;

export interface VersaoDoAgente {
  id: string;
  conteudo: ConteudoDaVersao;
  autor: string;
  criadaEm: string;
}

export function conteudoDaVersao(payload: AgenteConfigPayload): ConteudoDaVersao {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { ativo, ...conteudo } = payload;
  return conteudo;
}

/**
 * Os produtos de uma cópia antiga, com o saldo de estoque de AGORA.
 *
 * O saldo não é configuração: muda a cada venda aprovada. Voltar o texto de
 * terça não pode devolver o estoque de terça. Produto que não existe mais volta
 * com o saldo que tinha na cópia, que é a melhor informação disponível.
 */
export function produtosComEstoqueAtual(daVersao: Preco[], atuais: Preco[]): Preco[] {
  const saldo = new Map(atuais.filter(p => p.id).map(p => [p.id!, p.estoqueQtd ?? null]));
  return daVersao.map(p => (p.id && saldo.has(p.id) ? { ...p, estoqueQtd: saldo.get(p.id) } : p));
}

/** As abas que mudaram entre duas cópias, com os nomes que a tela usa. */
export function abasQueMudaram(nova: ConteudoDaVersao, anterior: ConteudoDaVersao): string[] {
  const semSaldo = (precos: Preco[]) => precos.map(p => ({ ...p, id: undefined, estoqueQtd: undefined }));
  const grupos: { aba: string; a: unknown; b: unknown }[] = [
    {
      aba: 'Empresa',
      a: [nova.nomeNegocio, nova.descricaoNegocio, nova.endereco, nova.faqs, nova.horario ?? [], nova.dadosSaude ?? null],
      b: [anterior.nomeNegocio, anterior.descricaoNegocio, anterior.endereco, anterior.faqs, anterior.horario ?? [], anterior.dadosSaude ?? null],
    },
    {
      aba: 'Produtos',
      a: [semSaldo(nova.precos ?? []), nova.textosDoCatalogo?.dicionario ?? ''],
      b: [semSaldo(anterior.precos ?? []), anterior.textosDoCatalogo?.dicionario ?? ''],
    },
    {
      aba: 'Agente',
      a: [nova.welcomeMsg, nova.agentPrompt, nova.limitacoes, nova.tom, nova.perguntas, nova.sucessos,
        nova.fallbackMode, nova.fallbackMsg, nova.fallbackAtendente, nova.gatilhos, nova.infoAdicional,
        nova.textosDoCatalogo?.regras ?? ''],
      b: [anterior.welcomeMsg, anterior.agentPrompt, anterior.limitacoes, anterior.tom, anterior.perguntas, anterior.sucessos,
        anterior.fallbackMode, anterior.fallbackMsg, anterior.fallbackAtendente, anterior.gatilhos, anterior.infoAdicional,
        anterior.textosDoCatalogo?.regras ?? ''],
    },
  ];
  return grupos.filter(g => textoEstavel(g.a) !== textoEstavel(g.b)).map(g => g.aba);
}

/** JSON com as chaves em ordem: o jsonb do Postgres reordena as chaves ao gravar. */
function textoEstavel(valor: unknown): string {
  return JSON.stringify(valor, (_chave, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
  });
}

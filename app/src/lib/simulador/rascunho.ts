// O que está na tela Conhecimento, salvo ou não, para o simulador testar.
//
// Decisão de 29/09 (item 9, caminho D): o simulador responde com o que o dono
// está vendo, sem precisar salvar antes. Assim dá para testar uma mudança sem
// ela chegar ao WhatsApp.
//
// O corpo vem do navegador, então é lido campo a campo: o que não tiver o tipo
// certo vira vazio. Só muda o prompt do simulador da própria empresa de quem
// está logado; nada é gravado.

import type { ConteudoDaVersao } from '../agente/versoes';
import type { Faq, Gatilho, HorarioDia, Pergunta, Preco, Sucessos, TipoSucesso, Tom } from '../types';
import { lerDadosDeSaude } from '../saude';

export type RascunhoDaTela = ConteudoDaVersao;

/** Teto por texto. A instrução mais longa em produção tem poucos milhares de caracteres. */
const MAX_TEXTO = 20_000;
/** Teto por lista. Acima de 40 produtos o prompt já vai por índice. */
const MAX_ITENS = 2_000;

const TONS: Tom[] = ['simpatico', 'direto', 'formal', 'descontraido'];
const OBJETIVOS: TipoSucesso[] = ['venda', 'agendamento', 'contato'];

type Obj = Record<string, unknown>;

function texto(v: unknown): string {
  return typeof v === 'string' ? v.slice(0, MAX_TEXTO) : '';
}

function lista(v: unknown): Obj[] {
  return Array.isArray(v) ? v.slice(0, MAX_ITENS).filter((x): x is Obj => !!x && typeof x === 'object') : [];
}

function numeroOuNulo(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function lerRascunho(valor: unknown): RascunhoDaTela | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const r = valor as Obj;

  const precos: Preco[] = lista(r.precos).map(p => ({
    proc: texto(p.proc),
    valor: texto(p.valor),
    descricao: texto(p.descricao),
    observacoes: texto(p.observacoes),
    estoque: texto(p.estoque),
    controlaEstoque: p.controlaEstoque === true,
    estoqueQtd: numeroOuNulo(p.estoqueQtd),
    estoqueMinimo: numeroOuNulo(p.estoqueMinimo),
  }));
  const faqs: Faq[] = lista(r.faqs).map(f => ({ q: texto(f.q), a: texto(f.a) }));
  const perguntas: Pergunta[] = lista(r.perguntas).map(p => ({
    pergunta: texto(p.pergunta),
    obrigatoria: p.obrigatoria === true,
    objetivo: OBJETIVOS.includes(p.objetivo as TipoSucesso) ? p.objetivo as TipoSucesso : 'contato',
  }));
  const gatilhos: Gatilho[] = lista(r.gatilhos).map(g => ({
    gatilho: texto(g.gatilho),
    ativo: g.ativo === true,
    acao: g.acao === 'responder' ? 'responder' : 'transferir',
    mensagem: texto(g.mensagem),
  }));
  const horario: HorarioDia[] = lista(r.horario).map(h => ({ dia: texto(h.dia), hora: texto(h.hora) }));

  const s = (r.sucessos && typeof r.sucessos === 'object' ? r.sucessos : {}) as Obj;
  const sucesso = (k: TipoSucesso) => {
    const x = (s[k] && typeof s[k] === 'object' ? s[k] : {}) as Obj;
    return { ativo: x.ativo === true, mensagem: texto(x.mensagem) };
  };
  const sucessos: Sucessos = { venda: sucesso('venda'), agendamento: sucesso('agendamento'), contato: sucesso('contato') };

  return {
    welcomeMsg: texto(r.welcomeMsg),
    agentPrompt: texto(r.agentPrompt),
    limitacoes: texto(r.limitacoes),
    tom: TONS.includes(r.tom as Tom) ? r.tom as Tom : 'simpatico',
    fallbackMode: r.fallbackMode === 'atendente' ? 'atendente' : 'mensagem',
    fallbackMsg: texto(r.fallbackMsg),
    fallbackAtendente: texto(r.fallbackAtendente),
    horarioVinculaAgenda: r.horarioVinculaAgenda === true,
    nomeNegocio: texto(r.nomeNegocio),
    descricaoNegocio: texto(r.descricaoNegocio),
    endereco: texto(r.endereco),
    precos, faqs, perguntas, gatilhos, sucessos, horario,
    dadosSaude: lerDadosDeSaude(r.dadosSaude),
    textosDoCatalogo: r.textosDoCatalogo && typeof r.textosDoCatalogo === 'object'
      ? { dicionario: texto((r.textosDoCatalogo as Obj).dicionario), regras: texto((r.textosDoCatalogo as Obj).regras) }
      : undefined,
    infoAdicional: texto(r.infoAdicional),
  };
}

/** O que está na tela de um número. Campo vazio segue o padrão, como no
 *  WhatsApp (`combinarComOPadrao`). */
export interface CamposDoNumeroNaTela {
  prompt: string;
  limitacoes: string;
  infoAdicional: string;
  welcomeMsg: string;
  /** `null` = herdado. */
  tom: Tom | null;
}

/** O número escolhido no seletor. `campos` fica `null` enquanto a tela dele
 *  ainda carrega: aí vale o que está gravado para o número. */
export interface NumeroNaTela {
  id: string;
  campos: CamposDoNumeroNaTela | null;
}

export function lerNumeroNaTela(valor: unknown): NumeroNaTela | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const n = valor as Obj;
  if (typeof n.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(n.id)) return null;
  const c = n.campos && typeof n.campos === 'object' && !Array.isArray(n.campos) ? n.campos as Obj : null;
  return {
    id: n.id,
    campos: c ? {
      prompt: texto(c.prompt),
      limitacoes: texto(c.limitacoes),
      infoAdicional: texto(c.infoAdicional),
      welcomeMsg: texto(c.welcomeMsg),
      tom: TONS.includes(c.tom as Tom) ? c.tom as Tom : null,
    } : null,
  };
}

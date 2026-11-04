'use client';

import { dadosDeSaudeNaTela } from './saude';
import { createContext, useContext, useReducer, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { AppState, InitialData, Preco, Faq, Pergunta, Gatilho, AgendaItem, Contato, Conversa, Campanha, Agente, Msg, HorarioDia, Label, RespostaPronta, TipoSucesso, SucessoConfig, ToastData, Historico, QuestionarioResposta, ProximoCompromisso, PerfilContato, Notificacao } from './types';
import { PERFIL_VAZIO } from './types';

type Action =
  | { type: 'SET'; key: keyof AppState; value: AppState[keyof AppState] }
  | { type: 'TOAST'; toast: ToastData | null }
  | { type: 'SET_DARK'; dark: boolean }
  | { type: 'UPD_FAQ'; i: number; k: keyof Faq; v: string }
  | { type: 'ADD_FAQ' }
  | { type: 'DEL_FAQ'; i: number }
  | { type: 'RESTORE_FAQ'; i: number; value: Faq }
  | { type: 'UPD_PREGUNTA'; i: number; k: keyof Pergunta; v: string | boolean }
  | { type: 'ADD_PERGUNTA'; objetivo: TipoSucesso }
  | { type: 'DEL_PERGUNTA'; i: number }
  | { type: 'RESTORE_PERGUNTA'; i: number; value: Pergunta }
  | { type: 'UPD_GATILHO'; i: number; k: keyof Gatilho; v: string | boolean }
  | { type: 'ADD_GATILHO' }
  | { type: 'DEL_GATILHO'; i: number }
  | { type: 'RESTORE_GATILHO'; i: number; value: Gatilho }
  | { type: 'UPD_PRECO'; i: number; k: keyof Preco; v: string | number | boolean | null }
  | { type: 'ADD_PRECO' }
  | { type: 'DEL_PRECO'; i: number }
  | { type: 'RESTORE_PRECO'; i: number; value: Preco }
  | { type: 'SET_PRECOS_SALVOS'; precos: Preco[] }
  | { type: 'NOTIF_RESOLVIDA'; id: string }
  | { type: 'NOTIF_MARCAR_LIDAS' }
  | { type: 'RT_NOTIF_INSERIDA'; notificacao: Notificacao }
  | { type: 'UPD_HORARIO_EDIT'; i: number; v: string }
  | { type: 'SET_CONTATO_BUF'; k: keyof Contato; v: string }
  | { type: 'SET_CONTATO_CUSTOM_FIELD'; key: string; v: string }
  | { type: 'TOGGLE_BUF_LABEL'; labelId: string }
  | { type: 'TOGGLE_CONV_LABEL'; conversationId: string; labelId: string }
  | { type: 'TOGGLE_CONTATO_LABEL'; contactId: string; labelId: string }
  | { type: 'ADD_LABEL'; label: Label }
  | { type: 'DEL_LABEL'; id: string }
  | { type: 'ADD_RESPOSTA_PRONTA'; resposta: RespostaPronta }
  | { type: 'UPD_RESPOSTA_PRONTA'; id: string; k: 'titulo' | 'texto'; v: string }
  | { type: 'DEL_RESPOSTA_PRONTA'; id: string }
  | { type: 'SALVAR_CONTATO' }
  | { type: 'OPEN_CONTATO'; id: string }
  | { type: 'FECHAR_CONTATO' }
  | { type: 'SET_CONV_SEL'; id: string }
  | { type: 'SEND_MSG'; atendenteNome: string; id?: string }
  | { type: 'TOGGLE_CONV_MODO'; id: string; modo: 'ia' | 'humano'; atendenteNome: string }
  | { type: 'ENCERRAR_CONV' }
  | { type: 'REABRIR_CONV'; id: string }
  | { type: 'ADD_CONVERSA'; conversa: Conversa }
  | { type: 'RT_MSG_INSERIDA'; conversationId: string; msg: Msg }
  | { type: 'RT_MSG_ATUALIZADA'; conversationId: string; id: string; text: string; tipo: string }
  | { type: 'RT_CONVERSA_UPSERT'; conversa: Conversa }
  | { type: 'RT_CONVERSA_ATUALIZADA'; id: string; modo?: 'ia' | 'humano'; status?: 'aberta' | 'encerrada'; atendente?: string }
  | { type: 'ABRIR_AGENDA_MODAL'; idx: number | 'new'; iso?: string; hora?: string; cliente?: string; duracaoMin?: number | null }
  | { type: 'SET_AGENDA_BUF'; k: keyof AgendaItem; v: string }
  // Duração é número, não texto — não dá para passar por SET_AGENDA_BUF.
  | { type: 'SET_AGENDA_DURACAO'; v: number | null }
  | { type: 'CONFIRMAR_REAGENDAR'; id: string }
  | { type: 'MOVER_AGENDAMENTO'; idx: number; data: string; hora: string }
  | { type: 'CONFIRMAR_CANCELAR' }
  | { type: 'RT_AGENDA_UPSERT'; item: AgendaItem }
  | { type: 'RT_AGENDA_REMOVIDA'; id: string }
  | { type: 'RT_CONTATO_HISTORICO'; contactId: string; entry: Historico }
  | { type: 'DEL_HISTORICO'; contactId: string; historicoId: string }
  | { type: 'ESQUECER_CONTATO'; contactId: string }
  | { type: 'SET_PERFIL'; contactId: string; perfil: PerfilContato }
  | { type: 'RT_CONTATO_QUESTIONARIO'; contactId: string; entry: QuestionarioResposta }
  | { type: 'RT_CONTATO_PROXIMO'; contactId: string; proximo: ProximoCompromisso | null }
  | { type: 'WIZ_NEXT' }
  | { type: 'CAMPANHA_CRIADA'; camp: Campanha }
  | { type: 'TOGGLE_AGENTE_DATA'; i: number; k: 'online' | 'ativo' }
  | { type: 'SET_AGENTE_CONHECIMENTO'; i: number; v: string }
  | { type: 'ADD_CATEGORIA' }
  | { type: 'DEL_CATEGORIA'; i: number }
  | { type: 'UPD_SUCESSO'; tipo: TipoSucesso; k: keyof SucessoConfig; v: boolean | string }
  | { type: 'SALVAR_AGENTE' }
  | { type: 'OPEN_AGENTE_MODAL'; i: number }
  | { type: 'FECHAR_AGENTE_MODAL' }
  | { type: 'SET_AGENTE_MODAL_BUF'; k: keyof Agente; v: string | boolean | Preco[] | Faq[] }
  | { type: 'SALVAR_AGENTE_DATA' }
  | { type: 'ADD_CONTATO'; contato: Contato }
  | { type: 'ADD_MEMBRO'; membro: Agente };

// Reinsere um item removido na posição original (Desfazer do toast).
function insertAt<T>(arr: T[], i: number, value: T): T[] {
  const copy = [...arr];
  copy.splice(Math.min(i, copy.length), 0, value);
  return copy;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET': return { ...state, [action.key]: action.value };
    case 'TOAST': return { ...state, toast: action.toast };
    case 'SET_DARK': return { ...state, dark: action.dark };
    case 'UPD_FAQ': return { ...state, faqs: state.faqs.map((f, j) => j === action.i ? { ...f, [action.k]: action.v } : f) };
    case 'ADD_FAQ': return { ...state, faqs: [...state.faqs, { q: 'Nova pergunta', a: 'Escreva aqui a resposta…' }], openFaq: state.faqs.length };
    case 'DEL_FAQ': return { ...state, faqs: state.faqs.filter((_, j) => j !== action.i), openFaq: null };
    case 'RESTORE_FAQ': return { ...state, faqs: insertAt(state.faqs, action.i, action.value) };
    case 'UPD_PREGUNTA': return { ...state, perguntas: state.perguntas.map((p, j) => j === action.i ? { ...p, [action.k]: action.v } : p) };
    case 'ADD_PERGUNTA': return { ...state, perguntas: [...state.perguntas, { pergunta: 'Nova pergunta', obrigatoria: false, objetivo: action.objetivo }] };
    case 'DEL_PERGUNTA': return { ...state, perguntas: state.perguntas.filter((_, j) => j !== action.i) };
    case 'RESTORE_PERGUNTA': return { ...state, perguntas: insertAt(state.perguntas, action.i, action.value) };
    case 'UPD_GATILHO': return { ...state, gatilhos: state.gatilhos.map((g, j) => j === action.i ? { ...g, [action.k]: action.v } : g) };
    case 'ADD_GATILHO': return { ...state, gatilhos: [...state.gatilhos, { gatilho: 'Nova regra', ativo: true, acao: 'transferir', mensagem: '' }] };
    case 'DEL_GATILHO': return { ...state, gatilhos: state.gatilhos.filter((_, j) => j !== action.i) };
    case 'RESTORE_GATILHO': return { ...state, gatilhos: insertAt(state.gatilhos, action.i, action.value) };
    case 'UPD_PRECO': return { ...state, precos: state.precos.map((p, j) => j === action.i ? { ...p, [action.k]: action.v } : p) };
    case 'ADD_PRECO': return { ...state, precos: [...state.precos, { proc: 'Novo produto', valor: 'R$ 0' }] };
    case 'DEL_PRECO': return { ...state, precos: state.precos.filter((_, j) => j !== action.i) };
    case 'RESTORE_PRECO': return { ...state, precos: insertAt(state.precos, action.i, action.value) };
    // Depois de salvar, os produtos novos voltam do banco já com id — sem isso o
    // salvamento seguinte os trataria como novos outra vez e duplicaria o catálogo.
    case 'SET_PRECOS_SALVOS': return { ...state, precos: action.precos };
    case 'NOTIF_RESOLVIDA': return { ...state, notificacoes: state.notificacoes.filter(n => n.id !== action.id) };
    case 'NOTIF_MARCAR_LIDAS': return { ...state, notificacoes: state.notificacoes.map(n => ({ ...n, lida: true })) };
    case 'RT_NOTIF_INSERIDA':
      return state.notificacoes.some(n => n.id === action.notificacao.id)
        ? state
        : { ...state, notificacoes: [action.notificacao, ...state.notificacoes] };
    case 'UPD_HORARIO_EDIT': return { ...state, horarioEdit: state.horarioEdit.map((h, j) => j === action.i ? { ...h, hora: action.v } : h) };
    case 'SET_CONTATO_BUF': return state.contatoBuffer ? { ...state, contatoBuffer: { ...state.contatoBuffer, [action.k]: action.v } } : state;
    case 'SET_CONTATO_CUSTOM_FIELD':
      return state.contatoBuffer
        ? { ...state, contatoBuffer: { ...state.contatoBuffer, customFields: { ...state.contatoBuffer.customFields, [action.key]: action.v } } }
        : state;
    case 'TOGGLE_BUF_LABEL':
      return state.contatoBuffer
        ? { ...state, contatoBuffer: { ...state.contatoBuffer, labelIds: state.contatoBuffer.labelIds.includes(action.labelId)
            ? state.contatoBuffer.labelIds.filter(x => x !== action.labelId)
            : [...state.contatoBuffer.labelIds, action.labelId] } }
        : state;
    case 'TOGGLE_CONV_LABEL':
      return {
        ...state,
        conversas: state.conversas.map(c => c.id === action.conversationId
          ? { ...c, labelIds: c.labelIds.includes(action.labelId) ? c.labelIds.filter(x => x !== action.labelId) : [...c.labelIds, action.labelId] }
          : c),
      };
    case 'TOGGLE_CONTATO_LABEL': {
      const flip = (ids: string[]) => ids.includes(action.labelId) ? ids.filter(x => x !== action.labelId) : [...ids, action.labelId];
      return {
        ...state,
        contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, labelIds: flip(c.labelIds) } : c),
        contatoBuffer: state.contatoBuffer?.id === action.contactId ? { ...state.contatoBuffer, labelIds: flip(state.contatoBuffer.labelIds) } : state.contatoBuffer,
      };
    }
    case 'ADD_LABEL': return { ...state, labels: [...state.labels, action.label] };
    case 'DEL_LABEL':
      return {
        ...state,
        labels: state.labels.filter(l => l.id !== action.id),
        contatos: state.contatos.map(c => c.labelIds.includes(action.id) ? { ...c, labelIds: c.labelIds.filter(x => x !== action.id) } : c),
        conversas: state.conversas.map(c => c.labelIds.includes(action.id) ? { ...c, labelIds: c.labelIds.filter(x => x !== action.id) } : c),
        contatoBuffer: state.contatoBuffer ? { ...state.contatoBuffer, labelIds: state.contatoBuffer.labelIds.filter(x => x !== action.id) } : state.contatoBuffer,
        fLabel: state.fLabel === action.id ? 'Todas' : state.fLabel,
      };
    case 'ADD_RESPOSTA_PRONTA': return { ...state, respostasProntas: [...state.respostasProntas, action.resposta] };
    case 'UPD_RESPOSTA_PRONTA': return { ...state, respostasProntas: state.respostasProntas.map(r => r.id === action.id ? { ...r, [action.k]: action.v } : r) };
    case 'DEL_RESPOSTA_PRONTA': return { ...state, respostasProntas: state.respostasProntas.filter(r => r.id !== action.id) };
    case 'SALVAR_CONTATO': {
      if (!state.contatoBuffer) return state;
      return { ...state, contatos: state.contatos.map(m => m.id === state.contatoBuffer!.id ? { ...state.contatoBuffer! } : m) };
    }
    case 'OPEN_CONTATO': {
      const m = state.contatos.find(c => c.id === action.id);
      if (!m) return state;
      return { ...state, contatoSel: action.id, contatoBuffer: JSON.parse(JSON.stringify(m)) };
    }
    case 'FECHAR_CONTATO': return { ...state, contatoSel: null, contatoBuffer: null };
    case 'SET_CONV_SEL': return { ...state, convSel: action.id, conversas: state.conversas.map(c => c.id === action.id ? { ...c, unread: 0, msgs: c.msgs.map(m => ({ ...m, read: true })) } : c) };
    case 'SEND_MSG': {
      const txt = state.draft.trim();
      if (!txt || !state.convSel) return state;
      const nota = state.msgTab === 'notas';
      return {
        ...state, draft: '',
        conversas: state.conversas.map(c => {
          if (c.id !== state.convSel) return c;
          const newMsgs = [...c.msgs, { id: action.id, from: nota ? 'nota' as const : 'humano' as const, text: txt, time: 'Agora', read: true }];
          return { ...c, msgs: newMsgs, modo: (!nota && c.modo === 'ia') ? 'humano' : c.modo, atendente: (!nota && c.modo === 'ia') ? action.atendenteNome : c.atendente };
        }),
      };
    }
    case 'RT_MSG_INSERIDA': {
      return {
        ...state,
        conversas: state.conversas.map(c => {
          if (c.id !== action.conversationId) return c;
          if (action.msg.id && c.msgs.some(m => m.id === action.msg.id)) return c; // dedupe (eco da própria mensagem otimista)
          const unreadDelta = action.msg.from === 'cliente' && !action.msg.read ? 1 : 0;
          return { ...c, msgs: [...c.msgs, action.msg], unread: c.unread + unreadDelta, hora: action.msg.time ?? c.hora };
        }),
      };
    }
    case 'RT_MSG_ATUALIZADA': {
      // Só texto e tipo: contagem de não lidas e hora não mudam quando a
      // descrição da foto ou a transcrição do áudio chega.
      return {
        ...state,
        conversas: state.conversas.map(c => {
          if (c.id !== action.conversationId || !c.msgs.some(m => m.id === action.id)) return c;
          return { ...c, msgs: c.msgs.map(m => (m.id === action.id ? { ...m, text: action.text, tipo: action.tipo } : m)) };
        }),
      };
    }
    case 'RT_CONVERSA_UPSERT': {
      if (state.conversas.some(c => c.id === action.conversa.id)) return state; // já existe, a mensagem chega via RT_MSG_INSERIDA
      return { ...state, conversas: [action.conversa, ...state.conversas] };
    }
    case 'RT_CONVERSA_ATUALIZADA': {
      return {
        ...state,
        conversas: state.conversas.map(c => {
          if (c.id !== action.id) return c;
          return {
            ...c,
            modo: action.modo ?? c.modo,
            status: action.status ?? c.status,
            atendente: action.atendente ?? c.atendente,
          };
        }),
      };
    }
    case 'TOGGLE_CONV_MODO': {
      return {
        ...state, conversas: state.conversas.map(c => {
          if (c.id !== action.id) return c;
          if (c.modo === action.modo) return c;
          const label = action.modo === 'ia' ? 'Modo de resposta travado em Atendente IA' : `Modo de resposta travado em Atendente humano (${action.atendenteNome})`;
          return { ...c, modo: action.modo, atendente: action.modo === 'ia' ? '—' : action.atendenteNome, msgs: [...c.msgs, { from: 'sys' as const, text: label }] };
        }),
      };
    }
    case 'ENCERRAR_CONV': {
      return { ...state, conversas: state.conversas.map(c => c.id === state.convSel ? { ...c, status: 'encerrada', msgs: [...c.msgs, { from: 'sys' as const, text: 'Conversa encerrada pela equipe' }] } : c) };
    }
    case 'REABRIR_CONV': {
      return { ...state, convTab: 'abertas', conversas: state.conversas.map(c => c.id === action.id ? { ...c, status: 'aberta', msgs: [...c.msgs, { from: 'sys' as const, text: 'Conversa reaberta pela equipe' }] } : c) };
    }
    case 'ADD_CONVERSA': {
      const exist = state.conversas.find(c => c.id === action.conversa.id);
      if (exist) return { ...state, convTab: 'abertas', convSel: exist.id };
      return { ...state, conversas: [action.conversa, ...state.conversas], convTab: 'abertas', convSel: action.conversa.id };
    }
    case 'ABRIR_AGENDA_MODAL': {
      if (action.idx === 'new') {
        const iso = action.iso || new Date().toISOString().slice(0, 10);
        return { ...state, agendaModalSel: 'new', agendaModalBuffer: { id: null, cliente: action.cliente ?? '', servico: '', atendente: state.agentesData[0]?.nome ?? '', data: iso, hora: action.hora || '09:00', duracaoMin: action.duracaoMin ?? null }, agendaModalConfirm: null };
      }
      const item = state.agendaItens[action.idx as number];
      return { ...state, agendaModalSel: action.idx as number, agendaModalBuffer: { ...item }, agendaModalConfirm: null };
    }
    case 'SET_AGENDA_BUF': return state.agendaModalBuffer ? { ...state, agendaModalBuffer: { ...state.agendaModalBuffer, [action.k]: action.v } } : state;
    case 'SET_AGENDA_DURACAO': return state.agendaModalBuffer ? { ...state, agendaModalBuffer: { ...state.agendaModalBuffer, duracaoMin: action.v } } : state;
    case 'CONFIRMAR_REAGENDAR': {
      if (!state.agendaModalBuffer) return state;
      const salvo: AgendaItem = { ...state.agendaModalBuffer, id: action.id };
      const itens = [...state.agendaItens];
      if (state.agendaModalSel === 'new') itens.push(salvo);
      else itens[state.agendaModalSel as number] = salvo;
      return { ...state, agendaItens: itens, agendaModalSel: null, agendaModalBuffer: null, agendaModalConfirm: null };
    }
    case 'MOVER_AGENDAMENTO': return { ...state, agendaItens: state.agendaItens.map((a, j) => j === action.idx ? { ...a, data: action.data, hora: action.hora } : a) };
    case 'CONFIRMAR_CANCELAR': return { ...state, agendaItens: state.agendaItens.filter((_, j) => j !== state.agendaModalSel), agendaModalSel: null, agendaModalBuffer: null, agendaModalConfirm: null };
    case 'RT_AGENDA_UPSERT': {
      const existe = state.agendaItens.some(a => a.id === action.item.id);
      const agendaItens = existe
        ? state.agendaItens.map(a => a.id === action.item.id ? action.item : a)
        : [...state.agendaItens, action.item];
      return { ...state, agendaItens };
    }
    case 'RT_AGENDA_REMOVIDA': return { ...state, agendaItens: state.agendaItens.filter(a => a.id !== action.id) };
    case 'RT_CONTATO_HISTORICO': return {
      ...state,
      contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, historico: [action.entry, ...c.historico] } : c),
      contatoBuffer: state.contatoBuffer?.id === action.contactId
        ? { ...state.contatoBuffer, historico: [action.entry, ...state.contatoBuffer.historico] }
        : state.contatoBuffer,
    };
    case 'DEL_HISTORICO': {
      const rm = (h: Historico[]) => h.filter(x => x.id !== action.historicoId);
      return {
        ...state,
        contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, historico: rm(c.historico) } : c),
        contatoBuffer: state.contatoBuffer?.id === action.contactId
          ? { ...state.contatoBuffer, historico: rm(state.contatoBuffer.historico) }
          : state.contatoBuffer,
      };
    }
    case 'ESQUECER_CONTATO': {
      const zera = (c: Contato): Contato => ({ ...c, historico: [], questionarios: [], perfil: PERFIL_VAZIO });
      return {
        ...state,
        contatos: state.contatos.map(c => c.id === action.contactId ? zera(c) : c),
        contatoBuffer: state.contatoBuffer?.id === action.contactId ? zera(state.contatoBuffer) : state.contatoBuffer,
      };
    }
    case 'SET_PERFIL': return {
      ...state,
      contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, perfil: action.perfil } : c),
      contatoBuffer: state.contatoBuffer?.id === action.contactId ? { ...state.contatoBuffer, perfil: action.perfil } : state.contatoBuffer,
    };
    case 'RT_CONTATO_QUESTIONARIO': {
      const add = (qs: QuestionarioResposta[]) => qs.some(q => q.id === action.entry.id) ? qs : [action.entry, ...qs];
      return {
        ...state,
        contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, questionarios: add(c.questionarios) } : c),
        contatoBuffer: state.contatoBuffer?.id === action.contactId
          ? { ...state.contatoBuffer, questionarios: add(state.contatoBuffer.questionarios) }
          : state.contatoBuffer,
      };
    }
    case 'RT_CONTATO_PROXIMO': return {
      ...state,
      contatos: state.contatos.map(c => c.id === action.contactId ? { ...c, proximoCompromisso: action.proximo } : c),
      contatoBuffer: state.contatoBuffer?.id === action.contactId
        ? { ...state.contatoBuffer, proximoCompromisso: action.proximo }
        : state.contatoBuffer,
    };
    case 'TOGGLE_AGENTE_DATA': return { ...state, agentesData: state.agentesData.map((a, j) => j === action.i ? { ...a, [action.k]: !a[action.k] } : a) };
    case 'SET_AGENTE_CONHECIMENTO': return { ...state, agentesData: state.agentesData.map((a, j) => j === action.i ? { ...a, conhecimento: action.v } : a) };
    case 'ADD_CATEGORIA': {
      const v = state.novaCategoriaTexto.trim();
      if (!v || state.campCategorias.includes(v)) return state;
      return { ...state, campCategorias: [...state.campCategorias, v], novaCategoriaTexto: '' };
    }
    case 'DEL_CATEGORIA': return { ...state, campCategorias: state.campCategorias.filter((_, j) => j !== action.i) };
    case 'WIZ_NEXT': return state.wizStep < 4 ? { ...state, wizStep: state.wizStep + 1 } : state;
    case 'CAMPANHA_CRIADA': return { ...state, campanhas: [action.camp, ...state.campanhas], wizStep: 5 };
    case 'UPD_SUCESSO':
      return { ...state, sucessos: { ...state.sucessos, [action.tipo]: { ...state.sucessos[action.tipo], [action.k]: action.v } } };
    case 'SALVAR_AGENTE': return { ...state, confirmSalvarOpen: false, confirmSalvarTexto: '' };
    case 'OPEN_AGENTE_MODAL': {
      const ag = state.agentesData[action.i];
      return { ...state, agenteModalSel: action.i, agenteModalTab: 'visao', agenteModalBuffer: JSON.parse(JSON.stringify(ag)) };
    }
    case 'FECHAR_AGENTE_MODAL': return { ...state, agenteModalSel: null, agenteModalBuffer: null };
    case 'SET_AGENTE_MODAL_BUF': return state.agenteModalBuffer ? { ...state, agenteModalBuffer: { ...state.agenteModalBuffer, [action.k]: action.v } } : state;
    case 'SALVAR_AGENTE_DATA': {
      if (state.agenteModalBuffer === null || state.agenteModalSel === null) return state;
      return { ...state, agentesData: state.agentesData.map((a, j) => j === state.agenteModalSel ? { ...state.agenteModalBuffer! } : a), agenteModalSel: null, agenteModalBuffer: null };
    }
    case 'ADD_CONTATO': return { ...state, contatos: [...state.contatos, action.contato] };
    case 'ADD_MEMBRO': return { ...state, agentesData: [...state.agentesData, action.membro] };
    default: return state;
  }
}

const DIAS_SEMANA_FIXOS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];

// Sempre 7 linhas, uma por dia da semana. Preserva o horário já salvo quando o
// dia bate por nome; senão cai num padrão comercial razoável (dias úteis
// abertos, fim de semana reduzido/fechado) — cobre tanto orgs novas quanto o
// formato antigo agrupado ("Segunda a sexta") que essa tela não usa mais.
function normalizarHorario7Dias(horario: HorarioDia[]): HorarioDia[] {
  const porDia = new Map(horario.map(h => [h.dia, h]));
  return DIAS_SEMANA_FIXOS.map(dia => {
    const existente = porDia.get(dia);
    if (existente) return existente;
    if (dia === 'Sábado') return { dia, hora: '08h às 12h' };
    if (dia === 'Domingo') return { dia, hora: 'Fechado' };
    return { dia, hora: '08h às 18h' };
  });
}

function makeInitialState(d: InitialData): AppState {
  return {
    toast: null,
    agenteAtivo: d.agente.ativo,
    welcomeMsg: d.agente.welcomeMsg,
    agentPrompt: d.agente.agentPrompt,
    limitacoes: d.agente.limitacoes,
    tom: d.agente.tom,
    precos: d.agente.precos,
    faqs: d.agente.faqs,
    openFaq: null,
    perguntas: d.agente.perguntas,
    gatilhos: d.agente.gatilhos,
    sucessos: d.agente.sucessos,
    infoAdicional: d.agente.infoAdicional,
    fallbackMode: d.agente.fallbackMode,
    fallbackMsg: d.agente.fallbackMsg,
    fallbackAtendente: d.agente.fallbackAtendente,
    confirmSalvarOpen: false,
    confirmSalvarTexto: '',
    horarioModalOpen: false,
    // Grade fixa de 7 dias (Segunda a Domingo) — sem adicionar/remover linha.
    horarioEdit: normalizarHorario7Dias(d.agente.horario),
    horarioVinculaAgenda: d.agente.horarioVinculaAgenda,
    agenteTab: 'empresa',
    agendaWeekOffset: 0,
    agendaItens: d.agendaItens,
    disponibilidades: d.disponibilidades,
    agendaModalSel: null,
    agendaModalBuffer: null,
    agendaModalConfirm: null,
    contatos: d.contatos,
    contatoSel: null,
    contatoBuffer: null,
    customFieldDefs: d.customFieldDefs,
    labels: d.labels,
    respostasProntas: d.respostasProntas,
    fStatus: 'Todos', fOrigem: 'Todos', busca: '',
    fInativos: false,
    fLabel: 'Todas',
    conversas: d.conversas,
    convTab: 'abertas', convSel: null, msgTab: 'mensagem', draft: '', soExcedidas: false, fConvLabel: 'Todas', fConvNumero: 'Todos',
    novaContato: '', novaModelo: d.templates.find(t => t.status === 'APPROVED' && !t.oculto)?.id ?? '',
    fichaConvOpen: true,
    campanhas: d.campanhas,
    templates: d.templates,
    campView: 'lista', wizStep: 1, wizNome: '',
    wizRemetente: d.waNumber ? `${d.waNumber} — ${d.cl.fantasia}` : d.cl.fantasia,
    wizModelo: d.templates.find(t => t.status === 'APPROVED' && !t.oculto)?.id ?? '', wizCategoria: d.campCategorias[0] ?? '',
    pubBairro: 'Todos', pubStatus: 'Todos',
    campCategorias: d.campCategorias, campFiltroCategoria: 'Todas', campFiltroStatus: 'Todos', campOrdenar: 'recentes',
    gerenciarCategoriasOpen: false, novaCategoriaTexto: '',
    configTab: 'negocio',
    cl: d.cl,
    dadosSaude: dadosDeSaudeNaTela(d.dadosSaude),
    textosDoCatalogo: d.textosDoCatalogo,
    waNumber: d.waNumber,
    waConectado: d.waConectado,
    numeros: d.numeros,
    notificacoes: d.notificacoes,
    planos: d.planos,
    planoAtual: d.planoAtual,
    assinatura: d.assinatura,
    faturas: d.faturas,
    msgsUsadasMes: d.msgsUsadasMes,
    notifNova: d.agente.notifNova, notifExcedido: d.agente.notifExcedido, notifResumo: d.agente.notifResumo,
    dark: false,
    agentesData: d.agentesData,
    agenteModalSel: null,
    agenteModalTab: 'visao',
    agenteModalBuffer: null,
    sidebarCollapsed: false,
    painelPeriodo: '7d',
    painelStats: d.painel,
  };
}

interface AppCtx {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  showToast: (msg: string, action?: ToastData['action']) => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ initial, children }: { initial: InitialData; children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial, makeInitialState);
  const toastSeq = useRef(0);

  const showToast = useCallback((msg: string, action?: ToastData['action']) => {
    const seq = ++toastSeq.current;
    dispatch({ type: 'TOAST', toast: { msg, action } });
    // Toast com ação (Desfazer) fica mais tempo na tela; o seq evita que o
    // timeout de um toast antigo apague um toast mais novo.
    setTimeout(() => {
      if (toastSeq.current === seq) dispatch({ type: 'TOAST', toast: null });
    }, action ? 5500 : 2800);
  }, []);

  useEffect(() => {
    try {
      if (localStorage.getItem('cm-theme') === 'dark') {
        dispatch({ type: 'SET_DARK', dark: true });
      }
    } catch {}
  }, []);

  useEffect(() => {
    try { localStorage.setItem('cm-theme', state.dark ? 'dark' : 'light'); } catch {}
    document.documentElement.classList.toggle('dark', state.dark);
  }, [state.dark]);

  return <Ctx.Provider value={{ state, dispatch, showToast }}>{children}</Ctx.Provider>;
}

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

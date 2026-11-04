// Conversões entre linhas do Supabase (snake_case, enums pt minúsculos)
// e os tipos de UI existentes (labels legíveis). Puro — roda no server e no client.

import type { Tables, Enums } from '../supabase/database.types';
import { cadastroGuardado, cadastrosGuardados } from '../erp/cadastro-do-contato';
import { dataBRemSP, diaEmSP, diaMesEmSP, horaEmSP } from '../fuso';
import type {
  Contato, Historico, Conversa, Msg, AgendaItem, Campanha, Template, Plano, Agente,
  Preco, HorarioDia, Faq, Pergunta, Gatilho, Fatura, ProximoCompromisso, QuestionarioResposta,
  PerfilContato,
} from '../types';

// ── Enums DB ↔ labels de UI ─────────────────────────────

export const ORIGEM_UI: Record<Enums<'contact_origem'>, string> = {
  whatsapp: 'WhatsApp', instagram: 'Instagram', google: 'Google', indicacao: 'Indicação', presencial: 'Presencial',
};
export const ORIGEM_DB: Record<string, Enums<'contact_origem'>> = {
  'WhatsApp': 'whatsapp', 'Instagram': 'instagram', 'Google': 'google', 'Indicação': 'indicacao', 'Presencial': 'presencial',
};

// ── Datas ───────────────────────────────────────────────

export function fmtDataBR(iso: string | null): string {
  if (!iso) return '—';
  // Timestamp (tem hora) vira o dia de São Paulo; coluna `date` (só o dia) é
  // fatiada como está, porque converter o fuso de quem não tem hora só faria o
  // dia andar para trás.
  if (iso.length > 10) return dataBRemSP(iso);
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function parseDataBR(br: string): string | null {
  const m = br.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

export function fmtHoraRelativa(ts: string, agora: Date = new Date()): string {
  const dia = diaEmSP(ts);
  if (dia === diaEmSP(agora)) return horaEmSP(ts);
  if (dia === diaEmSP(agora.getTime() - 86400000)) return 'Ontem';
  return diaMesEmSP(ts);
}

// ── Membros (para resolver nomes) ───────────────────────

export type MembroRow = Tables<'organization_members'>;
export type MembrosPorId = Map<string, MembroRow>;

function nomeMembro(id: string | null, membros: MembrosPorId): string {
  if (!id) return '—';
  return membros.get(id)?.nome ?? '—';
}

// ── Contatos ────────────────────────────────────────────

export function mapContato(
  row: Tables<'contacts'>,
  historico: Tables<'contact_history'>[],
  membros: MembrosPorId,
  ultimaMsgIso: string | null,
  proximoCompromisso: ProximoCompromisso | null,
  labelIds: string[] = [],
  questionarios: QuestionarioResposta[] = [],
): Contato {
  const histRows = historico.filter(h => h.contact_id === row.id);
  const hist: Historico[] = histRows
    .slice()
    .sort((a, b) => b.data.localeCompare(a.data))
    .map(h => ({ id: h.id, data: fmtDataBR(h.data), canal: h.canal, resumo: h.resumo }));

  const histMaxIso = histRows.map(h => h.data).sort().at(-1) ?? null;
  const candidatos = [histMaxIso, ultimaMsgIso, row.created_at].filter((x): x is string => !!x);
  const ultimoIso = candidatos.sort().at(-1)!;
  const diasSemContato = Math.floor((Date.now() - new Date(ultimoIso).getTime()) / 86400000);

  const perfilRaw = (row.perfil as Partial<PerfilContato> | null) ?? {};
  const perfil: PerfilContato = {
    preferencias: Array.isArray(perfilRaw.preferencias) ? perfilRaw.preferencias : [],
    dadosChave: Array.isArray(perfilRaw.dadosChave) ? perfilRaw.dadosChave : [],
    ultimoInteresse: perfilRaw.ultimoInteresse ?? '',
    observacoes: perfilRaw.observacoes ?? '',
    atualizadoEm: perfilRaw.atualizadoEm ?? null,
  };

  return {
    id: row.id,
    nome: row.nome,
    telefone: row.telefone ?? '',
    usuarioWhatsApp: row.wa_username ?? undefined,
    bairro: row.bairro,
    status: row.status === 'ativo' ? 'Ativo' : 'Inativo',
    responsavel: nomeMembro(row.responsavel_id, membros),
    ultimoContato: fmtDataBR(ultimoIso),
    diasSemContato,
    proximoCompromisso,
    cpf: row.cpf ?? '',
    nascimento: fmtDataBR(row.nascimento) === '—' ? '' : fmtDataBR(row.nascimento),
    email: row.email ?? '',
    erpClienteId: row.erp_cliente_id ?? '',
    documento: row.documento ?? '',
    erpCadastro: cadastroGuardado(row.erp_cadastro),
    erpCadastros: cadastrosGuardados(row.erp_cadastros),
    origem: ORIGEM_UI[row.origem],
    historico: hist,
    customFields: (row.custom_fields as Record<string, string> | null) ?? {},
    labelIds,
    questionarios,
    perfil,
  };
}

// ── Conversas + mensagens ───────────────────────────────

const EXCEDIDA_MS = 30 * 60 * 1000;

export function mapConversa(
  row: Tables<'conversations'>,
  msgs: Tables<'messages'>[],
  tags: Tables<'conversation_tags'>[],
  membros: MembrosPorId,
  labelIds: string[] = [],
): Conversa {
  const daConversa = msgs
    .filter(m => m.conversation_id === row.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const uiMsgs: Msg[] = daConversa.map(m => ({
    id: m.id,
    from: m.autor,
    text: m.texto,
    time: m.autor === 'sys' ? undefined : fmtHoraRelativa(m.created_at),
    read: m.read,
    camp: m.camp || undefined,
    tipo: m.tipo,
  }));
  const unread = daConversa.filter(m => m.autor === 'cliente' && !m.read).length;
  const ultimaDoCliente = [...daConversa].reverse().find(m => m.autor === 'cliente');
  const excedida = row.status === 'aberta' && !!ultimaDoCliente
    && daConversa[daConversa.length - 1]?.autor === 'cliente'
    && Date.now() - new Date(ultimaDoCliente.created_at).getTime() > EXCEDIDA_MS;
  const ultimaMsgIso = daConversa[daConversa.length - 1]?.created_at ?? null;
  return {
    id: row.id,
    mun: row.contact_id,
    assunto: row.assunto,
    hora: fmtHoraRelativa(ultimaMsgIso ?? row.updated_at),
    // `updated_at` de reserva porque conversa sem mensagem ainda tem que ter
    // um lugar na ordem — mas ele NÃO serve como critério geral: só muda quando
    // a linha da conversa é editada, e mensagem nova não edita a conversa.
    ultimaMsgIso: ultimaMsgIso ?? row.updated_at,
    unread,
    excedida,
    status: row.status,
    modo: row.modo,
    atendente: nomeMembro(row.atendente_id, membros),
    tags: tags.filter(t => t.conversation_id === row.id).map(t => t.tag),
    labelIds,
    msgs: uiMsgs,
    waNumberId: row.wa_number_id,
  };
}

// ── Agenda ──────────────────────────────────────────────

export function mapDisponibilidade(row: Tables<'availability'>): import('../types').Disponibilidade {
  return {
    id: row.id,
    atendenteId: row.atendente_id,
    tipo: row.tipo === 'data' ? 'data' : 'semanal',
    diaSemana: row.dia_semana,
    data: row.data,
    horaInicio: row.hora_inicio,
    horaFim: row.hora_fim,
    parentId: row.parent_id,
    cancelado: row.cancelado,
    capacidade: row.capacidade,
    duracaoMin: row.duracao_min,
  };
}

export function mapAgendaItem(row: Tables<'appointments'>, membros: MembrosPorId): AgendaItem {
  return {
    id: row.id,
    data: row.data,
    hora: row.hora,
    cliente: row.paciente_nome,
    servico: row.servico,
    atendente: nomeMembro(row.atendente_id, membros),
    duracaoMin: row.duracao_min,
  };
}

// ── Campanhas / templates ───────────────────────────────

export function mapTemplate(row: Tables<'wa_templates'>): Template {
  return {
    id: row.id, nome: row.nome, categoria: row.categoria, corpo: row.corpo, status: row.status,
    variaveis: row.variaveis as unknown as Template['variaveis'], wabaId: row.waba_id, oculto: row.oculto,
  };
}

export function mapCampanha(
  row: Tables<'campaigns'>,
  templates: Tables<'wa_templates'>[],
  categorias: Tables<'campaign_categories'>[],
): Campanha {
  const status = row.status === 'ativa' ? 'Ativa' : row.status === 'agendada' ? 'Agendada' : 'Encerrada';
  return {
    id: row.id,
    nome: row.nome,
    modelo: templates.find(t => t.id === row.wa_template_id)?.nome ?? '—',
    categoria: categorias.find(c => c.id === row.categoria_id)?.nome ?? '—',
    data: fmtDataBR(row.data_agendamento ?? row.created_at),
    disparos: row.disparos_count > 0 ? row.disparos_count.toLocaleString('pt-BR') : '—',
    taxa: row.taxa_abertura != null ? `${Math.round(Number(row.taxa_abertura))}%` : '—',
    status,
    falhas: row.falhas_count,
  };
}

// ── Equipe (agentes humanos) ────────────────────────────

export function mapAgente(
  m: MembroRow,
  prices: Tables<'agent_prices'>[],
  hours: Tables<'agent_business_hours'>[],
  faqs: Tables<'agent_faqs'>[],
  knowledge: Tables<'agent_knowledge'>[],
): Agente {
  const meu = <T extends { agent_id: string }>(rows: T[]) => rows.filter(r => r.agent_id === m.id);
  return {
    id: m.id,
    nome: m.nome,
    cargo: m.cargo,
    online: m.online,
    ativo: m.ativo,
    pendente: m.user_id === null && m.acessa_painel,
    acessaPainel: m.acessa_painel,
    precos: meu(prices).sort((a, b) => a.ordem - b.ordem).map(p => ({ proc: p.procedimento, valor: p.valor })),
    horario: meu(hours).sort((a, b) => a.ordem - b.ordem).map(h => ({ dia: h.dia, hora: h.hora, cor: h.cor ?? undefined })),
    faqs: meu(faqs).sort((a, b) => a.ordem - b.ordem).map(f => ({ q: f.pergunta, a: f.resposta })),
    conhecimento: knowledge.find(k => k.agent_id === m.id)?.conhecimento ?? '',
  };
}

// ── Planos ──────────────────────────────────────────────

export function mapPlano(row: Tables<'plans'>): Plano {
  return {
    key: row.key,
    nome: row.nome,
    preco: `R$ ${Math.round(row.preco_centavos / 100)}`,
    precoCentavos: row.preco_centavos,
    precoAnualCentavos: row.preco_anual_centavos,
    atend: `${row.max_atendentes} atendentes`,
    msg: `${row.max_msgs_mes.toLocaleString('pt-BR')} msgs/mês`,
    visivel: row.visivel,
  };
}

export function mapFatura(row: Tables<'invoices'>): Fatura {
  return {
    id: row.id,
    valor: `R$ ${(row.valor_centavos / 100).toFixed(2).replace('.', ',')}`,
    vencimento: fmtDataBR(row.vencimento),
    status: row.status as Fatura['status'],
    pagoEm: row.pago_em ? fmtDataBR(row.pago_em) : null,
  };
}

// ── Conhecimento da organização (tela Agente) ───────────

export function mapConhecimentoOrg(rows: {
  prices: Tables<'business_prices'>[];
  hours: Tables<'business_hours'>[];
  faqs: Tables<'business_faqs'>[];
  perguntas: Tables<'business_qualification_questions'>[];
  gatilhos: Tables<'business_triggers'>[];
}): { precos: Preco[]; horario: HorarioDia[]; faqs: Faq[]; perguntas: Pergunta[]; gatilhos: Gatilho[] } {
  return {
    precos: rows.prices.sort((a, b) => a.ordem - b.ordem).map(p => ({
      id: p.id,
      proc: p.procedimento,
      valor: p.valor,
      descricao: p.descricao,
      observacoes: p.observacoes,
      estoque: p.estoque,
      controlaEstoque: p.controla_estoque,
      estoqueQtd: p.estoque_qtd,
      estoqueMinimo: p.estoque_minimo,
    })),
    horario: rows.hours.sort((a, b) => a.ordem - b.ordem).map(h => ({ dia: h.dia, hora: h.hora, cor: h.cor ?? undefined })),
    faqs: rows.faqs.sort((a, b) => a.ordem - b.ordem).map(f => ({ q: f.pergunta, a: f.resposta })),
    perguntas: rows.perguntas.sort((a, b) => a.ordem - b.ordem).map(p => ({ pergunta: p.pergunta, obrigatoria: p.obrigatoria, objetivo: (['venda', 'agendamento', 'contato'].includes(p.objetivo) ? p.objetivo : 'contato') as import('../types').TipoSucesso })),
    gatilhos: rows.gatilhos.sort((a, b) => a.ordem - b.ordem).map(g => ({ gatilho: g.gatilho, ativo: g.ativo, acao: (g.acao === 'responder' ? 'responder' : 'transferir') as 'transferir' | 'responder', mensagem: g.mensagem })),
  };
}

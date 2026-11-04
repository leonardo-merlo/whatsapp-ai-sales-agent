// Funções de escrita no Supabase, chamadas pelas telas (client).
// Padrão: recebem dados no formato da UI, convertem via mappers,
// persistem e retornam o dado mapeado de volta (com id real).

import { createClient } from '../supabase/client';
import type { Json, TablesInsert } from '../supabase/database.types';
import type { DadosDeSaude } from '../saude';
import type { Contato, AgendaItem, Agente, Preco, Faq, Pergunta, Gatilho, HorarioDia, Tom, Label, RespostaPronta, Sucessos, Disponibilidade, PerfilContato, TextosDoCatalogo } from '../types';
import { PERFIL_VAZIO } from '../types';
import { ORIGEM_DB, parseDataBR, fmtDataBR, mapDisponibilidade } from './mappers';
import { analisarHorario } from '../agenda/capacidade';

function membroIdPorNome(agentes: Agente[], nome: string): string | null {
  return agentes.find(a => a.nome === nome)?.id ?? null;
}

// ── Contatos ────────────────────────────────────────────

// Os três campos do sistema de gestão ficam de fora de propósito: quem os
// escreve é a IA, pelo `lembrarClienteDoErp`. Se entrassem aqui, salvar a ficha
// à mão devolveria ao banco um cadastro que a tela não sabe editar.
type NovoContato = Omit<Contato, 'id' | 'historico' | 'ultimoContato' | 'diasSemContato' | 'proximoCompromisso' | 'questionarios' | 'perfil' | 'erpClienteId' | 'documento' | 'erpCadastro' | 'erpCadastros'>;

function contatoParaRow(orgId: string, c: NovoContato, agentes: Agente[]): TablesInsert<'contacts'> {
  return {
    organization_id: orgId,
    nome: c.nome,
    // Vazio só existe em contato criado pelo webhook sem telefone (BSUID);
    // salvar a ficha dele não pode gravar '' no lugar de "não sabemos".
    telefone: c.telefone || null,
    bairro: c.bairro,
    status: c.status === 'Ativo' ? 'ativo' : 'inativo',
    responsavel_id: membroIdPorNome(agentes, c.responsavel),
    cpf: c.cpf || null,
    nascimento: parseDataBR(c.nascimento),
    email: c.email || null,
    origem: ORIGEM_DB[c.origem] ?? 'whatsapp',
    custom_fields: c.customFields ?? {},
  };
}

export async function addContato(
  orgId: string,
  c: NovoContato,
  agentes: Agente[],
): Promise<Contato> {
  const supabase = createClient();
  const { data, error } = await supabase.from('contacts').insert(contatoParaRow(orgId, c, agentes)).select('id, created_at').single();
  if (error) throw error;
  const { data: histData, error: histError } = await supabase.from('contact_history').insert({
    organization_id: orgId, contact_id: data.id, canal: 'Manual', resumo: 'Contato adicionado manualmente',
  }).select('id').single();
  if (histError) throw histError;
  if (c.labelIds.length > 0) {
    await supabase.from('contact_labels').insert(c.labelIds.map(label_id => ({ contact_id: data.id, label_id })));
  }
  const hojeBR = fmtDataBR(data.created_at);
  // Contato criado à mão nunca nasce identificado no sistema de gestão: quem o
  // identifica é a IA, na primeira vez que o cliente disser o documento.
  return { ...c, id: data.id, ultimoContato: hojeBR, diasSemContato: 0, proximoCompromisso: null, questionarios: [], perfil: PERFIL_VAZIO, erpClienteId: '', documento: '', erpCadastro: null, erpCadastros: [], historico: [{ id: histData.id, data: hojeBR, canal: 'Manual', resumo: 'Contato adicionado manualmente' }] };
}

export async function saveContato(orgId: string, c: Contato, agentes: Agente[]): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('contacts')
    .update(contatoParaRow(orgId, c, agentes))
    .eq('id', c.id);
  if (error) throw error;
  await sincronizarLabelsContato(c.id, c.labelIds);
}

export async function apagarHistorico(historicoId: string): Promise<void> {
  const supabase = createClient();
  const { error, count } = await supabase.from('contact_history').delete({ count: 'exact' }).eq('id', historicoId);
  if (error) throw error;
  if (!count) throw new Error('Nada foi apagado — verifique permissão.');
}

// LGPD: apaga toda a memória derivada de um contato (resumos, questionários).
// Não apaga o contato nem as mensagens da conversa — só o que a IA "aprendeu".
export async function esquecerContato(contactId: string): Promise<void> {
  const supabase = createClient();
  const [h, q, p] = await Promise.all([
    supabase.from('contact_history').delete({ count: 'exact' }).eq('contact_id', contactId),
    supabase.from('questionnaire_responses').delete({ count: 'exact' }).eq('contact_id', contactId),
    supabase.from('contacts').update({ perfil: PERFIL_VAZIO as never }).eq('id', contactId),
  ]);
  if (h.error) throw h.error;
  if (q.error) throw q.error;
  if (p.error) throw p.error;
  // questionnaire_responses é permitido pra qualquer membro; contact_history só
  // pra admin. Se havia histórico mas nada foi apagado, quem clicou não tem
  // permissão — melhor avisar do que fingir que funcionou.
  if (h.count === 0 && q.count === 0) throw new Error('Nada foi apagado — verifique permissão.');
}

export async function salvarPerfilContato(contactId: string, perfil: PerfilContato): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('contacts')
    .update({ perfil: { ...perfil, atualizadoEm: new Date().toISOString() } as never })
    .eq('id', contactId);
  if (error) throw error;
}

// ── Etiquetas ───────────────────────────────────────────

export async function criarLabel(orgId: string, nome: string, cor: string): Promise<Label> {
  const supabase = createClient();
  const { data, error } = await supabase.from('labels')
    .insert({ organization_id: orgId, nome, cor })
    .select('id, nome, cor')
    .single();
  if (error) throw error;
  return { id: data.id, nome: data.nome, cor: data.cor };
}

export async function deletarLabel(id: string): Promise<void> {
  const supabase = createClient();
  // contact_labels/conversation_labels caem por ON DELETE CASCADE.
  const { error } = await supabase.from('labels').delete().eq('id', id);
  if (error) throw error;
}

// Conversas aplicam/removem etiqueta na hora (não há fluxo de rascunho).
export async function aplicarLabelConversa(conversationId: string, labelId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('conversation_labels').insert({ conversation_id: conversationId, label_id: labelId });
  if (error && error.code !== '23505') throw error; // 23505 = já existe, ignora
}

export async function removerLabelConversa(conversationId: string, labelId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('conversation_labels').delete().eq('conversation_id', conversationId).eq('label_id', labelId);
  if (error) throw error;
}

// Aplica/remove etiqueta de um contato na hora (usado no painel de Conversas,
// que compartilha a mesma etiqueta do contato mostrada em Contatos).
export async function aplicarLabelContato(contactId: string, labelId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('contact_labels').insert({ contact_id: contactId, label_id: labelId });
  if (error && error.code !== '23505') throw error; // 23505 = já existe, ignora
}

export async function removerLabelContato(contactId: string, labelId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('contact_labels').delete().eq('contact_id', contactId).eq('label_id', labelId);
  if (error) throw error;
}

// Reescreve o conjunto de etiquetas de um contato: apaga as atuais e insere o novo set.
export async function sincronizarLabelsContato(contactId: string, labelIds: string[]): Promise<void> {
  const supabase = createClient();
  const del = await supabase.from('contact_labels').delete().eq('contact_id', contactId);
  if (del.error) throw del.error;
  if (labelIds.length > 0) {
    const ins = await supabase.from('contact_labels').insert(labelIds.map(label_id => ({ contact_id: contactId, label_id })));
    if (ins.error) throw ins.error;
  }
}

// ── Respostas prontas ───────────────────────────────────

export async function criarRespostaPronta(orgId: string, titulo: string, texto: string): Promise<RespostaPronta> {
  const supabase = createClient();
  const { data, error } = await supabase.from('quick_replies')
    .insert({ organization_id: orgId, titulo, texto })
    .select('id, titulo, texto')
    .single();
  if (error) throw error;
  return { id: data.id, titulo: data.titulo, texto: data.texto };
}

export async function atualizarRespostaPronta(id: string, titulo: string, texto: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('quick_replies').update({ titulo, texto }).eq('id', id);
  if (error) throw error;
}

export async function deletarRespostaPronta(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('quick_replies').delete().eq('id', id);
  if (error) throw error;
}


// ── Agenda ──────────────────────────────────────────────

// Erros de checagem de horário (o painel os transforma em aviso com "marcar mesmo assim").
export const FORA_DE_JANELA = 'FORA_DE_JANELA';
export const HORARIO_CHEIO = 'HORARIO_CHEIO';

export async function salvarAgendamento(orgId: string, item: AgendaItem, agentes: Agente[], contatos: Contato[], forcar = false): Promise<string> {
  const supabase = createClient();
  const atendenteId = membroIdPorNome(agentes, item.atendente);
  const row: TablesInsert<'appointments'> = {
    organization_id: orgId,
    contact_id: contatos.find(c => c.nome === item.cliente)?.id ?? null,
    paciente_nome: item.cliente,
    servico: item.servico,
    data: item.data,
    hora: item.hora,
    atendente_id: atendenteId,
  };
  const { dentroDeJanela, vagas, duracaoMin } = await analisarHorario(supabase, orgId, item.data, item.hora, atendenteId, item.duracaoMin);
  if (item.id) {
    const { error } = await supabase.from('appointments').update({ ...row, duracao_min: duracaoMin }).eq('id', item.id);
    if (error) throw error;
    return item.id;
  }
  if (!forcar) {
    if (!dentroDeJanela) throw new Error(FORA_DE_JANELA);
    if (vagas !== null && vagas <= 0) throw new Error(HORARIO_CHEIO);
  }
  const { data, error } = await supabase.from('appointments').insert({ ...row, duracao_min: duracaoMin }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function cancelarAgendamento(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('appointments').update({ status: 'cancelado' }).eq('id', id);
  if (error) throw error;
}

// ── Disponibilidade da agenda ───────────────────────────

export async function listarDisponibilidades(orgId: string): Promise<Disponibilidade[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from('availability').select('*').eq('organization_id', orgId);
  if (error) throw error;
  return (data ?? []).map(mapDisponibilidade);
}

export async function criarDisponibilidade(orgId: string, p: {
  atendenteId: string | null; tipo: 'semanal' | 'data'; diaSemana: number | null; data: string | null; horaInicio: string; horaFim: string; capacidade: number | null; duracaoMin: number | null;
}): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('availability').insert({
    organization_id: orgId, atendente_id: p.atendenteId, tipo: p.tipo,
    dia_semana: p.tipo === 'semanal' ? p.diaSemana : null,
    data: p.tipo === 'data' ? p.data : null,
    hora_inicio: p.horaInicio, hora_fim: p.horaFim, capacidade: p.capacidade, duracao_min: p.duracaoMin,
  });
  if (error) throw error;
}

export async function atualizarDisponibilidade(id: string, p: { horaInicio: string; horaFim: string; atendenteId: string | null; capacidade: number | null; duracaoMin: number | null }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('availability').update({ hora_inicio: p.horaInicio, hora_fim: p.horaFim, atendente_id: p.atendenteId, capacidade: p.capacidade, duracao_min: p.duracaoMin }).eq('id', id);
  if (error) throw error;
}

export async function deletarDisponibilidade(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('availability').delete().eq('id', id);
  if (error) throw error;
}

// Override de uma ocorrência de recorrência num dia específico: apaga o override
// anterior daquele dia (se houver) e insere um novo (com horas novas, ou cancelado=true).
export async function definirOverrideDisponibilidade(
  orgId: string, parentId: string, data: string,
  p: { horaInicio: string; horaFim: string; cancelado: boolean; atendenteId: string | null; capacidade: number | null; duracaoMin: number | null },
): Promise<void> {
  const supabase = createClient();
  const del = await supabase.from('availability').delete().eq('parent_id', parentId).eq('data', data);
  if (del.error) throw del.error;
  const { error } = await supabase.from('availability').insert({
    organization_id: orgId, atendente_id: p.atendenteId, tipo: 'data', data,
    hora_inicio: p.horaInicio, hora_fim: p.horaFim, parent_id: parentId, cancelado: p.cancelado, capacidade: p.capacidade, duracao_min: p.duracaoMin,
  });
  if (error) throw error;
}

// ── Conversas ───────────────────────────────────────────

export async function enviarMensagem(
  orgId: string, convId: string, texto: string,
  autor: 'humano' | 'nota', assumirAtendenteId: string | null,
): Promise<{ id: string }> {
  // Nota interna não vai para o cliente — grava direto e para por aqui.
  if (autor === 'nota') {
    const supabase = createClient();
    const { data, error } = await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: convId, autor, texto, read: true,
    }).select('id').single();
    if (error) throw error;
    return { id: data.id };
  }

  // Resposta do atendente: passa pelo servidor, que entrega no WhatsApp e só
  // então grava. O token de envio é secreto e não existe aqui no navegador.
  const resp = await fetch('/api/conversas/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: convId, texto, assumir: assumirAtendenteId !== null }),
  });
  const body: { id?: string; error?: string } = await resp.json();
  if (!resp.ok || !body.id) throw new Error(body.error ?? 'Falha ao enviar mensagem');
  return { id: body.id };
}

export async function setConversaModo(
  orgId: string, convId: string, modo: 'ia' | 'humano', atendenteId: string | null, sysLabel: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('conversations')
    .update({ modo, atendente_id: modo === 'ia' ? null : atendenteId })
    .eq('id', convId);
  if (error) throw error;
  await supabase.from('messages').insert({
    organization_id: orgId, conversation_id: convId, autor: 'sys', texto: sysLabel, read: true,
  });
}

export async function encerrarConversa(_orgId: string, convId: string): Promise<void> {
  // O encerramento passa pelo servidor porque gera o resumo do atendimento (que
  // chama a IA) para a memória do contato. O token da IA é secreto e não fica aqui.
  const resp = await fetch('/api/conversas/encerrar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversationId: convId }),
  });
  if (!resp.ok) {
    const body: { error?: string } = await resp.json().catch(() => ({}));
    throw new Error(body.error ?? 'Falha ao encerrar a conversa');
  }
}

export async function reabrirConversa(orgId: string, convId: string): Promise<void> {
  // Reabrir é só voltar o status para 'aberta' — não gera resumo nem chama a IA,
  // então roda direto no client (RLS garante que só a org dona altere).
  const supabase = createClient();
  const { error } = await supabase.from('conversations').update({ status: 'aberta' }).eq('id', convId);
  if (error) throw error;
  await supabase.from('messages').insert({
    organization_id: orgId, conversation_id: convId, autor: 'sys', texto: 'Conversa reaberta pela equipe', read: true,
  });
}

export async function iniciarConversa(
  contactId: string,
  mensagem: { assunto: string; texto: string } | { templateId: string; valores: string[] },
): Promise<string> {
  // Envio ativo: entrega a primeira mensagem no WhatsApp antes de criar a conversa.
  // Vai pelo servidor porque o token de envio é secreto.
  const resp = await fetch('/api/campanhas/enviar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactId, ...mensagem }),
  });
  const body: { conversationId?: string; error?: string } = await resp.json().catch(() => ({}));
  if (!resp.ok || !body.conversationId) throw new Error(body.error ?? 'Falha ao iniciar a conversa');
  return body.conversationId;
}

export async function marcarLidas(convId: string): Promise<void> {
  const supabase = createClient();
  // update em messages não tem policy (imutabilidade); marcar leitura é exceção
  // tratada no futuro — por ora só zera localmente. Mantido como no-op documentado.
  void convId;
}

// ── Configuração do agente de IA ────────────────────────

export interface AgenteConfigPayload {
  ativo: boolean;
  welcomeMsg: string;
  agentPrompt: string;
  limitacoes: string;
  tom: Tom;
  fallbackMode: 'mensagem' | 'atendente';
  fallbackMsg: string;
  fallbackAtendente: string; // "Nome — cargo"
  horarioVinculaAgenda: boolean;
  // Campos de organizations editados na aba Empresa (fonte única).
  nomeNegocio: string;
  descricaoNegocio: string;
  endereco: string;
  precos: Preco[];
  faqs: Faq[];
  perguntas: Pergunta[];
  gatilhos: Gatilho[];
  sucessos: Sucessos;
  infoAdicional: string;
  /** Os horários da aba Empresa. Gravam junto desde 29/09 (antes tinham botão
   *  próprio). Ausente = não mexer: o cadastro inicial não manda. */
  horario?: HorarioDia[];
  /** Convênios e valor da consulta (S8). Gravam junto desde 29/09. Ausente = não mexer. */
  dadosSaude?: DadosDeSaude;
  /** Dicionário e regras do catálogo. Gravam juntos desde 29/09. Ausente = não mexer. */
  textosDoCatalogo?: TextosDoCatalogo;
}

/** Salva o catálogo preservando o id de cada produto.
 *
 *  As outras listas do rascunho (FAQs, perguntas, gatilhos) podem ser recriadas
 *  à vontade, mas `business_prices` é referenciada por `sale_items`: apagar e
 *  reinserir a cada salvamento apontaria o histórico de vendas para o vazio e
 *  zeraria o estoque. Então: remove só o que saiu da lista, atualiza quem já
 *  tem id e insere o que é novo.
 *
 *  Devolve a lista na mesma ordem, com os ids dos itens recém-criados, para o
 *  estado do client não duplicar produto no salvamento seguinte. */
async function salvarPrecos(
  supabase: ReturnType<typeof createClient>, orgId: string, precos: Preco[],
): Promise<Preco[]> {
  const linha = (x: Preco, i: number) => ({
    organization_id: orgId,
    procedimento: x.proc,
    valor: x.valor,
    descricao: x.descricao ?? '',
    observacoes: x.observacoes ?? '',
    estoque: x.estoque ?? '',
    controla_estoque: x.controlaEstoque ?? false,
    // Sem controle de estoque não faz sentido guardar saldo nem mínimo.
    estoque_qtd: x.controlaEstoque ? (x.estoqueQtd ?? null) : null,
    estoque_minimo: x.controlaEstoque ? (x.estoqueMinimo ?? null) : null,
    ordem: i,
  });

  const mantidos = precos.map(x => x.id).filter((id): id is string => !!id);
  const del = mantidos.length
    ? await supabase.from('business_prices').delete().eq('organization_id', orgId).not('id', 'in', `(${mantidos.join(',')})`)
    : await supabase.from('business_prices').delete().eq('organization_id', orgId);
  if (del.error) throw del.error;

  // Duas chamadas em vez de um upsert só: o PostgREST exige o mesmo conjunto de
  // colunas em todas as linhas do lote, e item novo não tem id para enviar.
  const existentes = precos.map((x, i) => ({ x, i })).filter(e => e.x.id);
  if (existentes.length > 0) {
    const up = await supabase.from('business_prices')
      .upsert(existentes.map(e => ({ id: e.x.id!, ...linha(e.x, e.i) })));
    if (up.error) throw up.error;
  }

  const novos = precos.map((x, i) => ({ x, i })).filter(e => !e.x.id);
  const idsNovos = new Map<number, string>();
  if (novos.length > 0) {
    const ins = await supabase.from('business_prices')
      .insert(novos.map(e => linha(e.x, e.i)))
      .select('id, ordem');
    if (ins.error) throw ins.error;
    (ins.data ?? []).forEach(r => idsNovos.set(r.ordem, r.id));
  }

  return precos.map((x, i) => (x.id ? x : { ...x, id: idsNovos.get(i) }));
}

export async function salvarAgenteConfig(orgId: string, p: AgenteConfigPayload, agentes: Agente[]): Promise<Preco[]> {
  const supabase = createClient();
  const fallbackNome = p.fallbackAtendente.split(' — ')[0];
  const { error } = await supabase.from('ai_agent_config').update({
    ativo: p.ativo,
    welcome_msg: p.welcomeMsg,
    prompt: p.agentPrompt,
    limitacoes: p.limitacoes,
    tom: p.tom,
    fallback_mode: p.fallbackMode === 'atendente' ? 'transferir' : 'encerrar',
    fallback_msg: p.fallbackMsg,
    fallback_atendente_id: p.fallbackMode === 'atendente' ? membroIdPorNome(agentes, fallbackNome) : null,
    horario_vincula_agenda: p.horarioVinculaAgenda,
    sucessos: p.sucessos as never,
    info_adicional: p.infoAdicional,
  }).eq('organization_id', orgId).is('wa_number_id', null);
  if (error) throw error;

  // A aba Empresa é a fonte única de nome fantasia, descrição e localização do
  // negócio — são fatos que entram no prompt do agente, então salvam junto com
  // o rascunho. A razão social (organizations.nome) fica em Configurações →
  // Dados do negócio, porque é o nome jurídico usado na cobrança.
  const org = await supabase.from('organizations').update({
    nome_fantasia: p.nomeNegocio,
    descricao: p.descricaoNegocio,
    endereco: p.endereco || null,
    ...(p.dadosSaude ? { dados_saude: p.dadosSaude as unknown as Json } : {}),
  }).eq('id', orgId);
  if (org.error) throw org.error;

  if (p.textosDoCatalogo) {
    const textos = await supabase.from('catalogo_config').upsert({
      organization_id: orgId,
      dicionario: p.textosDoCatalogo.dicionario,
      regras: p.textosDoCatalogo.regras,
    }, { onConflict: 'organization_id' });
    if (textos.error) throw textos.error;
  }

  if (p.horario) {
    const delHoras = await supabase.from('business_hours').delete().eq('organization_id', orgId);
    if (delHoras.error) throw delHoras.error;
    if (p.horario.length > 0) {
      const insHoras = await supabase.from('business_hours').insert(
        p.horario.map((h, i) => ({ organization_id: orgId, dia: h.dia, hora: h.hora, cor: h.cor ?? null, ordem: i })),
      );
      if (insHoras.error) throw insHoras.error;
    }
  }

  // Conhecimento: substituição completa (listas pequenas, editadas em bloco).
  // business_prices é a exceção — ver salvarPrecos.
  const replace = async (
    table: 'business_faqs' | 'business_qualification_questions' | 'business_triggers',
    rows: Record<string, unknown>[],
  ) => {
    const del = await supabase.from(table).delete().eq('organization_id', orgId);
    if (del.error) throw del.error;
    if (rows.length === 0) return;
    const ins = await supabase.from(table).insert(rows as never);
    if (ins.error) throw ins.error;
  };

  const precos = await salvarPrecos(supabase, orgId, p.precos);
  await replace('business_faqs', p.faqs.map((x, i) => ({ organization_id: orgId, pergunta: x.q, resposta: x.a, ordem: i })));
  await replace('business_qualification_questions', p.perguntas.map((x, i) => ({ organization_id: orgId, pergunta: x.pergunta, campo: '', obrigatoria: x.obrigatoria, objetivo: x.objetivo, ordem: i })));
  await replace('business_triggers', p.gatilhos.map((x, i) => ({ organization_id: orgId, gatilho: x.gatilho, ativo: x.ativo, ordem: i, acao: x.acao, mensagem: x.mensagem })));

  return precos;
}

export async function setAgenteAtivo(orgId: string, ativo: boolean): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('ai_agent_config').update({ ativo }).eq('organization_id', orgId).is('wa_number_id', null);
  if (error) throw error;
}

// ── Campanhas ───────────────────────────────────────────

/**
 * Dispara a campanha pelo servidor (o envio lê o token do cliente no Vault).
 * Devolve quantos a Meta aceitou e quantos recusou; erro de validação vem com
 * a frase pronta para a tela.
 */
export async function dispararCampanha(p: {
  nome: string;
  categoriaNome: string | null;
  waNumberId: string;
  templateId: string;
  variaveis: ({ tipo: 'texto'; valor: string } | { tipo: 'nome' })[];
  filtros: { bairro: string | null; status: 'ativo' | 'inativo' | null };
}): Promise<{ campanhaId: string; enviados: number; falhas: number }> {
  const resp = await fetch('/api/campanhas/disparar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(p),
  });
  const body = await resp.json().catch(() => ({})) as { campanhaId?: string; enviados?: number; falhas?: number; error?: string };
  if (!resp.ok || !body.campanhaId) throw new Error(body.error ?? 'Não foi possível disparar.');
  return { campanhaId: body.campanhaId, enviados: body.enviados ?? 0, falhas: body.falhas ?? 0 };
}

export async function addCategoriaCampanha(orgId: string, nome: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('campaign_categories').insert({ organization_id: orgId, nome });
  if (error) throw error;
}

export async function delCategoriaCampanha(orgId: string, nome: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('campaign_categories').delete().eq('organization_id', orgId).eq('nome', nome);
  if (error) throw error;
}

// ── Notificações ────────────────────────────────────────

/** Aprova a venda detectada pela IA e dá baixa no estoque.
 *  Toda a lógica (checagem de permissão, baixa sem deixar saldo negativo,
 *  resolução da notificação e alerta de estoque mínimo) vive na função
 *  `aprovar_venda` no Postgres: é uma transação só, então não existe estado
 *  intermediário com estoque baixado e venda ainda pendente. */
export async function aprovarVenda(saleId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('aprovar_venda', { p_sale_id: saleId });
  if (error) throw error;
}

export async function descartarVenda(saleId: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.rpc('descartar_venda', { p_sale_id: saleId });
  if (error) throw error;
}

/** Marca notificações como lidas (apaga o badge). Não resolve nada: uma venda
 *  lida continua pendente de aprovação. */
export async function marcarNotificacoesLidas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const supabase = createClient();
  const { error } = await supabase.from('notificacoes')
    .update({ lida_em: new Date().toISOString() })
    .in('id', ids)
    .is('lida_em', null);
  if (error) throw error;
}

/** Dispensa um alerta de estoque mínimo (não tem venda para aprovar). */
export async function dispensarNotificacao(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('notificacoes')
    .update({ status: 'descartada', resolvida_em: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

// ── Configurações ───────────────────────────────────────

/** `wa_number` não entra aqui: o número do WhatsApp deixou de ser texto
 *  digitado e passou a sair de `wa_numbers`, que é quem sabe a verdade. */
export async function salvarOrganizacao(orgId: string, cl: { razao: string; cnpj: string; endereco: string; telefone: string }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('organizations').update({
    nome: cl.razao, cnpj: cl.cnpj || null, endereco: cl.endereco || null, telefone: cl.telefone || null,
  }).eq('id', orgId);
  if (error) throw error;
}

export async function salvarNotifs(orgId: string, n: { nova: boolean; excedido: boolean; resumo: boolean }): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('ai_agent_config').update({
    notif_nova_conversa: n.nova, notif_excedido: n.excedido, notif_resumo: n.resumo,
  }).eq('organization_id', orgId).is('wa_number_id', null);
  if (error) throw error;
}

const ERRO_LIMITE_ATENDENTES = 'Limite de atendentes do plano atingido — mude de plano em Configurações para adicionar mais.';

function relancarSeLimiteAtendentes(error: { code?: string; message?: string }): never {
  if (error.code === 'P0001' || error.message?.includes('LIMITE_ATENDENTES_ATINGIDO')) {
    throw new Error(ERRO_LIMITE_ATENDENTES);
  }
  throw error;
}

export async function adicionarMembro(orgId: string, p: {
  nome: string; cargo: string; email: string; role: 'admin' | 'atendente';
}): Promise<Agente> {
  const supabase = createClient();
  const { data, error } = await supabase.from('organization_members').insert({
    organization_id: orgId,
    nome: p.nome,
    cargo: p.cargo,
    role: p.role,
    invite_email: p.email.trim().toLowerCase(),
    online: false,
    ativo: true,
  }).select('id').single();
  if (error) relancarSeLimiteAtendentes(error);
  return {
    id: data.id, nome: p.nome, cargo: p.cargo, online: false, ativo: true,
    pendente: true, acessaPainel: true, precos: [], horario: [], faqs: [], conhecimento: '',
  };
}

export async function toggleMembro(memberId: string, campo: 'online' | 'ativo', valor: boolean): Promise<void> {
  const supabase = createClient();
  const patch = campo === 'online' ? { online: valor } : { ativo: valor };
  const { error } = await supabase.from('organization_members').update(patch).eq('id', memberId);
  if (error) relancarSeLimiteAtendentes(error);
}

export async function salvarMembro(orgId: string, a: Agente): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('organization_members').update({
    nome: a.nome, cargo: a.cargo, online: a.online, ativo: a.ativo,
  }).eq('id', a.id);
  if (error) throw error;

  const delP = await supabase.from('agent_prices').delete().eq('agent_id', a.id);
  if (delP.error) throw delP.error;
  if (a.precos.length > 0) {
    const insP = await supabase.from('agent_prices').insert(
      a.precos.map((p, i) => ({ organization_id: orgId, agent_id: a.id, procedimento: p.proc, valor: p.valor, ordem: i })),
    );
    if (insP.error) throw insP.error;
  }

  const delF = await supabase.from('agent_faqs').delete().eq('agent_id', a.id);
  if (delF.error) throw delF.error;
  if (a.faqs.length > 0) {
    const insF = await supabase.from('agent_faqs').insert(
      a.faqs.map((f, i) => ({ organization_id: orgId, agent_id: a.id, pergunta: f.q, resposta: f.a, ordem: i })),
    );
    if (insF.error) throw insF.error;
  }

  const up = await supabase.from('agent_knowledge').upsert(
    { organization_id: orgId, agent_id: a.id, conhecimento: a.conhecimento },
    { onConflict: 'agent_id' },
  );
  if (up.error) throw up.error;
}

// ── Campos customizados de contato ──────────────────────

export async function addCampoCustomizado(orgId: string, label: string, ordem: number): Promise<{ key: string; label: string }> {
  const supabase = createClient();
  const key = label.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const { error } = await supabase.from('custom_field_definitions')
    .insert({ organization_id: orgId, key, label: label.trim(), ordem });
  if (error) throw error;
  return { key, label: label.trim() };
}

export async function removeCampoCustomizado(orgId: string, key: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from('custom_field_definitions')
    .delete().eq('organization_id', orgId).eq('key', key);
  if (error) throw error;
}


// Catálogo de templates da Meta (tabela `wa_templates`, migration 20260925000001).
//
// Template é da WABA, não do app. Este arquivo é a única porta entre o
// catálogo no banco e a Meta: criar (padrão ou do cliente), sincronizar o que
// já existe lá, receber a mudança de status do webhook e, antes de todo envio,
// dizer se o template pode sair.
//
// **Não enviar o que não está APPROVED.** A Meta recusaria de qualquer jeito,
// mas a recusa dela chega como erro genérico no meio de um lote; aqui o motivo
// é dito antes, fica na conversa e vai para o sino — mesmo padrão de
// billing-status.ts.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import { GRAPH_API_VERSION, type TemplateParaEnviar } from './send-message';
import { NOMES_PADRAO, TEMPLATES_PADRAO } from './templates';
import {
  contarVariaveis, nomeDaCategoria, rotuloDoStatus,
  type NovoTemplate, type VariavelDoTemplate,
} from './regras-de-template';

export * from './regras-de-template';

type Client = SupabaseClient<Database>;
type LinhaDoCatalogo = Database['public']['Tables']['wa_templates']['Row'];

const GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const IDIOMA_PADRAO = 'pt_BR';

// ── Meta ──

interface RespostaDeCriacao {
  id?: string;
  status?: string;
  category?: string;
  error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
}

/**
 * Cria o template na WABA. Template com o mesmo nome e idioma já existente
 * volta como `jaExistia` em vez de erro: é o caso de reconectar um número, ou
 * de uma WABA onde o padrão foi criado à mão antes deste código existir. O
 * estado real dele vem depois, pela sincronização.
 */
export async function criarNaMeta(
  wabaId: string,
  token: string,
  t: NovoTemplate,
): Promise<{ id: string | null; status: string; categoria: string | null; jaExistia: boolean }> {
  const resp = await fetch(`${GRAPH}/${wabaId}/message_templates`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: t.nome,
      category: t.categoria,
      language: t.idioma ?? IDIOMA_PADRAO,
      parameter_format: 'positional',
      components: [{
        type: 'BODY',
        text: t.corpo,
        ...(t.variaveis.length ? { example: { body_text: [t.variaveis.map(v => v.exemplo)] } } : {}),
      }],
    }),
  });
  const corpo = await resp.json().catch(() => ({})) as RespostaDeCriacao;
  if (!resp.ok) {
    // 2388024 é "Content in This Language Already Exists" (doc da Meta, 25/09).
    if (corpo.error?.error_subcode === 2388024) {
      return { id: null, status: 'PENDING', categoria: null, jaExistia: true };
    }
    throw new Error(corpo.error?.error_user_msg ?? corpo.error?.message ?? `HTTP ${resp.status}`);
  }
  return { id: corpo.id ?? null, status: corpo.status ?? 'PENDING', categoria: corpo.category ?? null, jaExistia: false };
}

interface TemplateDaMeta {
  id: string;
  name: string;
  status: string;
  category: string;
  language: string;
  rejected_reason?: string;
  components?: { type?: string; text?: string; example?: { body_text?: string[][] } }[];
}

/** Tudo o que a WABA tem, seguindo a paginação. */
async function listarDaMeta(wabaId: string, token: string): Promise<TemplateDaMeta[]> {
  const todos: TemplateDaMeta[] = [];
  let url: string | null =
    `${GRAPH}/${wabaId}/message_templates?fields=id,name,status,category,language,components,rejected_reason&limit=100`;
  while (url) {
    const resp: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const corpo = await resp.json().catch(() => ({})) as {
      data?: TemplateDaMeta[]; paging?: { next?: string }; error?: { message?: string };
    };
    if (!resp.ok) throw new Error(corpo.error?.message ?? `HTTP ${resp.status}`);
    todos.push(...(corpo.data ?? []));
    url = corpo.paging?.next ?? null;
  }
  return todos;
}

function motivoLegivel(motivo: string | null | undefined): string | null {
  return motivo && motivo !== 'NONE' ? motivo : null;
}

/**
 * Traz para o catálogo o que existe na WABA. Linha que já existe só tem
 * status, categoria e id atualizados — os nomes das variáveis foram dados
 * aqui e a Meta não os conhece. Linha nova entra com nomes genéricos.
 */
export async function sincronizarDaMeta(
  supabase: Client,
  dados: { orgId: string; wabaId: string; token: string },
): Promise<number> {
  const daMeta = await listarDaMeta(dados.wabaId, dados.token);
  const { data: existentes } = await supabase
    .from('wa_templates')
    .select('id, nome, idioma')
    .eq('organization_id', dados.orgId)
    .eq('waba_id', dados.wabaId);
  const porChave = new Map((existentes ?? []).map(l => [`${l.nome}|${l.idioma}`, l.id]));

  for (const t of daMeta) {
    const atual = {
      meta_template_id: t.id,
      status: t.status,
      categoria: t.category,
      motivo_rejeicao: t.status === 'REJECTED' ? motivoLegivel(t.rejected_reason) : null,
      updated_at: new Date().toISOString(),
    };
    const id = porChave.get(`${t.name}|${t.language}`);
    if (id) {
      await supabase.from('wa_templates').update(atual).eq('id', id);
      continue;
    }
    const body = t.components?.find(c => c.type === 'BODY');
    const exemplos = body?.example?.body_text?.[0] ?? [];
    const quantas = contarVariaveis(body?.text ?? '') ?? exemplos.length;
    const variaveis: VariavelDoTemplate[] = Array.from({ length: quantas }, (_, i) => ({
      nome: TEMPLATES_PADRAO.find(p => p.nome === t.name)?.variaveis[i]?.nome ?? `variavel_${i + 1}`,
      exemplo: exemplos[i] ?? '',
    }));
    await supabase.from('wa_templates').insert({
      organization_id: dados.orgId,
      waba_id: dados.wabaId,
      nome: t.name,
      idioma: t.language,
      corpo: body?.text ?? '',
      variaveis: variaveis as unknown as Json,
      origem: NOMES_PADRAO.has(t.name) ? 'wappia' : 'cliente',
      ...atual,
    });
  }
  return daMeta.length;
}

/**
 * Manda UM modelo pronto para aprovação, quando o cliente pede. Não é mais
 * automático na conexão (decisão do Leonardo, 25/09): quem ainda não vai
 * disparar nada não precisa de template nenhum na conta.
 *
 * Se o nome já existe na Meta, o catálogo se sincroniza e devolve o que está
 * lá, com o status de verdade.
 */
export async function criarTemplatePadrao(
  supabase: Client,
  dados: { orgId: string; wabaId: string; token: string; nome: string },
): Promise<LinhaDoCatalogo> {
  const padrao = TEMPLATES_PADRAO.find(t => t.nome === dados.nome);
  if (!padrao) throw new Error('Modelo pronto não encontrado.');

  const criado = await criarNaMeta(dados.wabaId, dados.token, padrao);
  if (criado.jaExistia) {
    await sincronizarDaMeta(supabase, dados);
  } else {
    const { error } = await supabase.from('wa_templates').insert({
      organization_id: dados.orgId,
      waba_id: dados.wabaId,
      nome: padrao.nome,
      idioma: IDIOMA_PADRAO,
      categoria: criado.categoria ?? padrao.categoria,
      corpo: padrao.corpo,
      variaveis: padrao.variaveis as unknown as Json,
      meta_template_id: criado.id,
      status: criado.status,
      origem: 'wappia',
    });
    if (error) throw new Error(error.message);
  }
  const { data } = await supabase
    .from('wa_templates').select('*')
    .eq('organization_id', dados.orgId).eq('waba_id', dados.wabaId)
    .eq('nome', padrao.nome).eq('idioma', IDIOMA_PADRAO)
    .maybeSingle();
  if (!data) throw new Error('Enviado para a Meta, mas não apareceu no catálogo. Use Atualizar status.');
  return data;
}

/** A WABA tem número copiloto? É o que decide se os avisos ao vendedor entram. */
export async function wabaTemCopiloto(supabase: Client, orgId: string, wabaId: string): Promise<boolean> {
  const { data } = await supabase
    .from('wa_numbers')
    .select('id')
    .eq('organization_id', orgId)
    .eq('waba_id', wabaId)
    .eq('papel', 'copiloto')
    .limit(1);
  return (data ?? []).length > 0;
}

// ── Webhook ──

export interface EventoDeTemplate {
  event?: string;
  message_template_id?: number | string;
  message_template_name?: string;
  message_template_language?: string;
  reason?: string;
  message_template_category?: string;
  previous_category?: string;
  new_category?: string;
}

async function linhaDoEvento(supabase: Client, wabaId: string | null, e: EventoDeTemplate): Promise<LinhaDoCatalogo | null> {
  if (e.message_template_id != null) {
    const { data } = await supabase
      .from('wa_templates').select('*').eq('meta_template_id', String(e.message_template_id)).limit(1);
    if (data?.[0]) return data[0];
  }
  // Template criado antes de o id ser guardado: casa pela chave natural.
  if (wabaId && e.message_template_name) {
    const { data } = await supabase
      .from('wa_templates').select('*')
      .eq('waba_id', wabaId)
      .eq('nome', e.message_template_name)
      .eq('idioma', e.message_template_language ?? IDIOMA_PADRAO)
      .limit(1);
    if (data?.[0]) return data[0];
  }
  return null;
}

/**
 * `message_template_status_update` e `template_category_update`. O `entry.id`
 * desses eventos é a WABA.
 */
export async function tratarEventoDeTemplate(
  supabase: Client,
  wabaId: string | null,
  campo: string,
  evento: EventoDeTemplate,
): Promise<void> {
  const linha = await linhaDoEvento(supabase, wabaId, evento);
  if (!linha) {
    console.warn(`Templates: evento ${campo} de template fora do catálogo`, evento.message_template_name);
    return;
  }
  const agora = new Date().toISOString();

  if (campo === 'template_category_update') {
    const nova = evento.new_category;
    if (!nova || nova === linha.categoria) return;
    // O mesmo campo chega duas vezes: um aviso até 24 h antes (sem
    // `previous_category`) e a mudança feita (com ela). Só a segunda muda o
    // catálogo; as duas avisam, porque o aviso é a chance de reagir antes.
    const concluida = evento.previous_category != null;
    if (concluida) {
      await supabase.from('wa_templates').update({ categoria: nova, updated_at: agora }).eq('id', linha.id);
    }
    // A recategorização muda o preço de cada envio. Quem paga precisa saber.
    await supabase.from('notificacoes').insert({
      organization_id: linha.organization_id,
      tipo: 'template_recategorizado',
      titulo: concluida ? `Template ${linha.nome} mudou de categoria` : `Template ${linha.nome} vai mudar de categoria`,
      corpo: `A Meta ${concluida ? 'passou' : 'vai passar'} de ${nomeDaCategoria(linha.categoria)} para ${nomeDaCategoria(nova)}. O preço de cada envio muda junto.`,
      wa_template_id: linha.id,
      status: 'pendente',
    });
    return;
  }

  const status = evento.event;
  if (!status) return;
  await supabase.from('wa_templates').update({
    status,
    ...(evento.message_template_category ? { categoria: evento.message_template_category } : {}),
    motivo_rejeicao: status === 'REJECTED' ? motivoLegivel(evento.reason) : null,
    meta_template_id: linha.meta_template_id ?? (evento.message_template_id != null ? String(evento.message_template_id) : null),
    updated_at: agora,
  }).eq('id', linha.id);

  if (status === 'APPROVED') {
    // Fecha o ciclo como marcarEnvioOk: o aviso de "não aprovado" some sozinho.
    await supabase.from('notificacoes')
      .update({ status: 'resolvida', resolvida_em: agora })
      .eq('wa_template_id', linha.id)
      .eq('tipo', 'template_nao_aprovado')
      .eq('status', 'pendente');
  } else if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED') {
    await avisarTemplateNaoAprovado(supabase, linha, `A Meta marcou como ${rotuloDoStatus(status).toLowerCase()}${
      motivoLegivel(evento.reason) ? ` (${evento.reason})` : ''}.`);
  }
}

// ── Envio ──

/** Um aviso por template em aberto, como billing-status.ts faz por número. */
async function avisarTemplateNaoAprovado(supabase: Client, linha: LinhaDoCatalogo, corpo: string): Promise<void> {
  const { data: existente } = await supabase
    .from('notificacoes')
    .select('id')
    .eq('wa_template_id', linha.id)
    .eq('tipo', 'template_nao_aprovado')
    .eq('status', 'pendente')
    .maybeSingle();
  if (existente) return;
  const { error } = await supabase.from('notificacoes').insert({
    organization_id: linha.organization_id,
    tipo: 'template_nao_aprovado',
    titulo: `Template ${linha.nome} não pode ser enviado`,
    corpo,
    wa_template_id: linha.id,
    status: 'pendente',
  });
  if (error) console.error('Templates: falha ao criar notificação', error.message);
}

export type TemplatePronto =
  | { ok: true; template: TemplateParaEnviar; linha: LinhaDoCatalogo }
  | { ok: false; motivo: string };

/**
 * Consulta o catálogo antes de qualquer envio de template. Não chama a Meta.
 * Quando a resposta é não, o motivo já foi para o sino (se houver linha no
 * catálogo para apontar) e volta para quem chamou registrar na conversa.
 *
 * `valores` por nome segue a ordem da linha do catálogo; por posição, é usado
 * como veio.
 */
export async function prepararTemplate(
  supabase: Client,
  dados: { orgId: string; phoneNumberId: string; nome: string; valores: Record<string, string> | string[] },
): Promise<TemplatePronto> {
  const { data: numero } = await supabase
    .from('wa_numbers')
    .select('waba_id')
    .eq('phone_number_id', dados.phoneNumberId)
    .maybeSingle();
  if (!numero?.waba_id) {
    return { ok: false, motivo: 'Este número não tem a conta do WhatsApp registrada. Refaça a conexão do número.' };
  }
  const { data: linha } = await supabase
    .from('wa_templates')
    .select('*')
    .eq('organization_id', dados.orgId)
    .eq('waba_id', numero.waba_id)
    .eq('nome', dados.nome)
    .eq('idioma', IDIOMA_PADRAO)
    .maybeSingle();
  if (!linha) {
    return { ok: false, motivo: `O template ${dados.nome} não existe na conta do WhatsApp deste número.` };
  }
  if (linha.status !== 'APPROVED') {
    const motivo = `O template ${linha.nome} está ${rotuloDoStatus(linha.status).toLowerCase()} na Meta e não foi enviado.`;
    await avisarTemplateNaoAprovado(supabase, linha, `${motivo} Só template aprovado pode sair.`);
    return { ok: false, motivo };
  }
  // Escondido não sai nem pelos avisos automáticos (decisão do Leonardo,
  // 25/09): um fluxo ligado a um template que alguém escondeu seguiria
  // mandando uma mensagem que ninguém vê mais no painel.
  if (linha.oculto) {
    const motivo = `O template ${linha.nome} está escondido no Wappia e não foi enviado.`;
    await avisarTemplateNaoAprovado(supabase, linha, `${motivo} Mostre de novo na aba Templates para ele voltar a sair.`);
    return { ok: false, motivo };
  }
  const nomes = (linha.variaveis as unknown as VariavelDoTemplate[]).map(v => v.nome);
  const valores = Array.isArray(dados.valores)
    ? dados.valores
    : nomes.map(n => (dados.valores as Record<string, string>)[n] ?? '');
  return { ok: true, template: { nome: linha.nome, variaveis: valores, idioma: linha.idioma }, linha };
}

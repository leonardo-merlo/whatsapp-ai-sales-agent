// Lembrete antes da consulta e aviso de remarcação (S5 e S6, Bloco B).
//
// Envio: a varredura (/api/cron/lembretes) acha as consultas que entram na
// janela de "X horas antes" e manda o template `lembrete_agendamento` pelo
// número de atendimento da empresa. O template passa por `prepararTemplate`:
// sem template aprovado na conta, nada sai e o sino avisa.
//
// Resposta: quando o contato tem um lembrete sem resposta, o motor recebe uma
// seção a mais no prompt e o campo `confirmacao_agendamento` no formato
// estruturado. "sim" confirma a consulta; "nao" avisa a clínica pelo sino e a
// IA oferece remarcar. Sem lembrete pendente, o prompt e o formato saem
// idênticos aos de antes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { prepararTemplate } from '../whatsapp/catalogo-de-templates';
import { enviarTemplateNaConversa } from '../whatsapp/template-na-conversa';
import { diaEmSP } from '../fuso';

type Client = SupabaseClient<Database>;

/** Depois de 3 tentativas sem sucesso, a varredura desiste daquela consulta. */
export const MAX_TENTATIVAS_DO_LEMBRETE = 3;

// ── Horário ──

/**
 * Minutos desde a meia-noite. A coluna `hora` é texto livre: a IA grava
 * "14:30", o painel antigo gravava "14h30" e há seed com "10". Formato que não
 * dá para ler devolve `null`, e a consulta fica sem lembrete.
 */
export function horaEmMinutos(hora: string): number | null {
  const m = hora.trim().toLowerCase().match(/^(\d{1,2})(?:\s*[:h]\s*(\d{2})?)?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** O instante da consulta. Brasília é UTC-3 o ano todo desde 2019. */
export function instanteDaConsulta(data: string, hora: string): Date | null {
  const minutos = horaEmMinutos(hora);
  if (minutos === null || !/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  const instante = new Date(`${data}T${hh}:${mm}:00-03:00`);
  return Number.isNaN(instante.getTime()) ? null : instante;
}

/** "14h" ou "14h30", como a clínica fala. */
export function horaFalada(hora: string): string {
  const minutos = horaEmMinutos(hora);
  if (minutos === null) return hora;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** "12/10". */
export function dataFalada(data: string): string {
  const [, mes, dia] = data.split('-');
  return dia && mes ? `${dia}/${mes}` : data;
}

export interface ConsultaParaLembrete {
  data: string;
  hora: string;
  created_at: string;
}

/**
 * A consulta está na janela do lembrete: começa daqui a no máximo
 * `horasAntes` e ainda não começou. Consulta marcada já dentro da janela (o
 * paciente agendou hoje para amanhã cedo) não recebe lembrete: acabou de
 * combinar o horário.
 */
export function estaNaJanelaDoLembrete(c: ConsultaParaLembrete, agora: Date, horasAntes: number): boolean {
  const inicio = instanteDaConsulta(c.data, c.hora);
  if (!inicio) return false;
  const abreEm = inicio.getTime() - horasAntes * 60 * 60 * 1000;
  if (agora.getTime() < abreEm || agora.getTime() >= inicio.getTime()) return false;
  return new Date(c.created_at).getTime() < abreEm;
}

// ── Sino ──

/** Um aviso em aberto por empresa e template: o mesmo problema em dez
 *  consultas é um item só para resolver. */
export async function avisarAvisoNaoEnviado(
  supabase: Client, orgId: string, template: string, motivo: string,
): Promise<void> {
  const titulo = template === 'aviso_remarcacao' ? 'Aviso de remarcação não enviado' : 'Lembrete de consulta não enviado';
  const { data: existente } = await supabase
    .from('notificacoes').select('id')
    .eq('organization_id', orgId).eq('tipo', 'aviso_nao_enviado').eq('titulo', titulo).eq('status', 'pendente')
    .limit(1).maybeSingle();
  if (existente) return;
  const { error } = await supabase.from('notificacoes').insert({
    organization_id: orgId, tipo: 'aviso_nao_enviado', titulo, corpo: motivo, status: 'pendente',
  });
  if (error) console.error('Lembrete: falha ao criar notificação', error.message);
}

// ── Envio ──

interface ConsultaCompleta {
  id: string;
  organization_id: string;
  contact_id: string | null;
  paciente_nome: string;
  servico: string;
  data: string;
  hora: string;
  lembrete_tentativas: number;
}

/** O número de atendimento por onde lembrete e aviso saem. */
async function numeroDeAtendimento(supabase: Client, orgId: string) {
  const { data } = await supabase
    .from('wa_numbers')
    .select('id, phone_number_id')
    .eq('organization_id', orgId)
    .eq('papel', 'atendimento')
    .eq('ativo', true)
    .order('created_at')
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export type ResultadoDoAvisoAoPaciente = { enviado: true } | { enviado: false; motivo: string };

/**
 * Manda um template de agenda ao paciente de uma consulta. Confere o template
 * ANTES de escrever na conversa: um lembrete que não saiu não pode aparecer
 * como mensagem enviada.
 */
export async function enviarAvisoDaConsulta(
  supabase: Client,
  consulta: ConsultaCompleta,
  template: 'lembrete_agendamento' | 'aviso_remarcacao',
): Promise<ResultadoDoAvisoAoPaciente> {
  const orgId = consulta.organization_id;
  if (!consulta.contact_id) return { enviado: false, motivo: 'consulta sem contato' };

  const [{ data: contato }, { data: org }, numero] = await Promise.all([
    supabase.from('contacts').select('nome, telefone').eq('id', consulta.contact_id).maybeSingle(),
    supabase.from('organizations').select('nome, nome_fantasia').eq('id', orgId).maybeSingle(),
    numeroDeAtendimento(supabase, orgId),
  ]);
  const telefone = contato?.telefone?.replace(/\D/g, '') ?? '';
  if (!telefone) return { enviado: false, motivo: 'contato sem telefone' };
  if (!numero) {
    const motivo = 'A empresa não tem número de atendimento conectado.';
    await avisarAvisoNaoEnviado(supabase, orgId, template, motivo);
    return { enviado: false, motivo };
  }

  const nome = (contato?.nome || consulta.paciente_nome).split(' ')[0];
  const empresa = org?.nome_fantasia || org?.nome || '';
  const valores = { nome, empresa, data: dataFalada(consulta.data), hora: horaFalada(consulta.hora) };

  const pronto = await prepararTemplate(supabase, {
    orgId, phoneNumberId: numero.phone_number_id, nome: template, valores,
  });
  if (!pronto.ok) {
    // Com a linha no catálogo o sino já foi avisado por prepararTemplate;
    // sem linha nenhuma, avisa aqui.
    await avisarAvisoNaoEnviado(supabase, orgId, template, `${pronto.motivo} Crie e aprove o template na aba Templates.`);
    return { enviado: false, motivo: pronto.motivo };
  }

  const textoNaConversa = template === 'lembrete_agendamento'
    ? `Lembrete enviado: ${consulta.servico} em ${valores.data} às ${valores.hora}. Aguardando confirmação.`
    : `Aviso de remarcação enviado: ${consulta.servico} agora em ${valores.data} às ${valores.hora}.`;

  const resultado = await enviarTemplateNaConversa(supabase, {
    orgId,
    waNumberId: numero.id,
    phoneNumberId: numero.phone_number_id,
    telefone,
    nome: contato?.nome || consulta.paciente_nome,
    contatoId: consulta.contact_id,
    template: { nome: template, valores },
    textoNaConversa,
  });
  return resultado.enviado ? { enviado: true } : { enviado: false, motivo: resultado.erro ?? 'falha no envio' };
}

export interface ResumoDaVarredura {
  empresas: number;
  enviados: number;
  falhas: number;
}

/** A varredura inteira: todas as empresas com lembrete ligado. */
export async function enviarLembretesPendentes(supabase: Client, agora = new Date()): Promise<ResumoDaVarredura> {
  const resumo: ResumoDaVarredura = { empresas: 0, enviados: 0, falhas: 0 };
  const { data: empresas } = await supabase
    .from('organizations').select('id, lembrete_horas_antes').eq('lembrete_ativo', true);

  const hoje = diaEmSP(agora);
  // A janela vai até 72 h; 4 dias de folga cobrem qualquer configuração.
  const ate = diaEmSP(new Date(agora.getTime() + 4 * 24 * 60 * 60 * 1000));

  for (const empresa of empresas ?? []) {
    resumo.empresas++;
    const { data: consultas } = await supabase
      .from('appointments')
      .select('id, organization_id, contact_id, paciente_nome, servico, data, hora, lembrete_tentativas, created_at')
      .eq('organization_id', empresa.id)
      .eq('status', 'agendado')
      .is('lembrete_enviado_em', null)
      .lt('lembrete_tentativas', MAX_TENTATIVAS_DO_LEMBRETE)
      .not('contact_id', 'is', null)
      .gte('data', hoje)
      .lte('data', ate);

    for (const consulta of consultas ?? []) {
      if (!estaNaJanelaDoLembrete(consulta, agora, empresa.lembrete_horas_antes)) continue;
      const envio = await enviarAvisoDaConsulta(supabase, consulta, 'lembrete_agendamento');
      if (envio.enviado) {
        resumo.enviados++;
        await supabase.from('appointments')
          .update({ lembrete_enviado_em: agora.toISOString() })
          .eq('id', consulta.id);
      } else {
        resumo.falhas++;
        await supabase.from('appointments')
          .update({ lembrete_tentativas: consulta.lembrete_tentativas + 1 })
          .eq('id', consulta.id);
      }
    }
  }
  return resumo;
}

// ── Resposta ──

export interface LembretePendente {
  id: string;
  servico: string;
  data: string;
  hora: string;
}

/** O lembrete que este contato recebeu e ainda não respondeu, se houver. */
export async function buscarLembretePendente(
  supabase: Client, orgId: string, contactId: string, agora = new Date(),
): Promise<LembretePendente | null> {
  const { data } = await supabase
    .from('appointments')
    .select('id, servico, data, hora')
    .eq('organization_id', orgId)
    .eq('contact_id', contactId)
    .eq('status', 'agendado')
    .not('lembrete_enviado_em', 'is', null)
    .is('lembrete_resposta', null)
    .gte('data', diaEmSP(agora))
    .order('data')
    .order('hora')
    .limit(5);
  const futura = (data ?? []).find(c => {
    const inicio = instanteDaConsulta(c.data, c.hora);
    return inicio !== null && inicio.getTime() > agora.getTime();
  });
  return futura ?? null;
}

/** A seção que entra no prompt quando há lembrete pendente. Curta e sem
 *  adjetivo: o Haiku copia o estilo e obedece número. */
export function instrucaoDoLembrete(l: LembretePendente): string {
  return `\n## Lembrete de consulta pendente
Este cliente recebeu um lembrete da consulta de ${l.servico} em ${dataFalada(l.data)} às ${horaFalada(l.hora)} e ainda não respondeu.
Se ele confirmar que vai, preencha "confirmacao_agendamento" com "sim" e agradeça em 1 frase.
Se ele disser que não vai, preencha "nao" e pergunte se quer remarcar.
Se a mensagem não for sobre o lembrete, preencha "nenhuma".`;
}

export const LINHA_DO_FORMATO_DO_LEMBRETE = `
- "confirmacao_agendamento": "sim", "nao" ou "nenhuma", conforme a seção "Lembrete de consulta pendente".`;

export type ConfirmacaoDoLembrete = 'sim' | 'nao' | 'nenhuma';

/** Grava o que o paciente respondeu ao lembrete. */
export async function registrarRespostaDoLembrete(
  supabase: Client,
  dados: { orgId: string; lembrete: LembretePendente; resposta: ConfirmacaoDoLembrete; contatoNome: string },
): Promise<void> {
  const { orgId, lembrete, resposta, contatoNome } = dados;
  if (resposta === 'nenhuma') return;
  try {
    if (resposta === 'sim') {
      await supabase.from('appointments')
        .update({ lembrete_resposta: 'sim', confirmado_em: new Date().toISOString(), status: 'confirmado' })
        .eq('id', lembrete.id).eq('organization_id', orgId);
      return;
    }
    // "Não" não cancela a consulta: quem decide liberar o horário é a
    // clínica. Se o paciente remarcar com a IA, a remarcação já cancela o
    // horário antigo (registrar-agendamento.ts).
    await supabase.from('appointments')
      .update({ lembrete_resposta: 'nao' })
      .eq('id', lembrete.id).eq('organization_id', orgId);
    const { error } = await supabase.from('notificacoes').insert({
      organization_id: orgId,
      tipo: 'consulta_desmarcada',
      titulo: `${contatoNome || 'Paciente'} não vai à consulta`,
      corpo: `${lembrete.servico} em ${dataFalada(lembrete.data)} às ${horaFalada(lembrete.hora)}. A IA ofereceu remarcar.`,
      status: 'pendente',
    });
    if (error) console.error('Lembrete: falha ao criar notificação', error.message);
  } catch (err) {
    console.error('Lembrete: falha ao registrar resposta', err instanceof Error ? err.message : err);
  }
}

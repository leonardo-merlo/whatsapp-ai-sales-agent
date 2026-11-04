// Grava na agenda o agendamento que a IA fechou na conversa.
//
// O caso delicado é a REMARCAÇÃO. Antes, a IA inseria o horário novo e o antigo
// continuava de pé: o cliente terminava com dois horários reservados e a
// capacidade da janela era consumida duas vezes pela mesma pessoa.
//
// Como sabemos que é remarcação: o modelo devolve `agendamento_remarcacao` no
// structured output (mesmo padrão de `transferir_para_atendente`). Mas QUAL
// agendamento cancelar é decidido aqui, no código — buscando o próximo horário
// futuro em aberto do mesmo contato. Pedir o id ao modelo repetiria o erro que
// já custou caro em registrar-venda.ts: LLM erra identificador.
//
// Ordem das operações, de propósito: insere o novo PRIMEIRO e só cancela o
// antigo depois que o insert deu certo. Invertido, um insert que falhasse
// deixaria o cliente sem horário nenhum — pior que o bug original.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { analisarHorario } from '../agenda/capacidade';
import { hojeEmSP } from '../fuso';

type Client = SupabaseClient<Database>;

const DURACAO_PADRAO = 60;

interface AgendamentoEmAberto {
  id: string;
  data: string;
  hora: string;
  duracao_min: number | null;
}

function minutos(hora: string): number {
  const [hh, mm] = hora.split(':').map(Number);
  return Number.isFinite(hh) ? hh * 60 + (Number.isFinite(mm) ? mm : 0) : Number.NaN;
}

/** Os dois horários se cruzam no mesmo dia? Usado só para devolver a vaga que o
 *  agendamento antigo ocupa quando ele é o que está sendo substituído. */
function seCruzam(anterior: AgendamentoEmAberto, hora: string, duracaoMin: number): boolean {
  const iniAntigo = minutos(anterior.hora);
  const iniNovo = minutos(hora);
  if (!Number.isFinite(iniAntigo) || !Number.isFinite(iniNovo)) return false;
  const fimAntigo = iniAntigo + (anterior.duracao_min ?? DURACAO_PADRAO);
  const fimNovo = iniNovo + duracaoMin;
  return iniAntigo < fimNovo && fimAntigo > iniNovo;
}

/** Hoje no fuso de Brasília — o servidor roda em UTC e "amanhã" não pode virar
 *  meia-noite antes da hora para quem está no Brasil. */
function hojeEmBrasilia(): string {
  return hojeEmSP();
}

/** O agendamento que a remarcação substitui: o próximo horário futuro do
 *  contato que ainda está de pé. Se ele tiver vários marcados (aulas
 *  recorrentes, por exemplo), o mais próximo é o palpite certo — é dele que o
 *  cliente está falando quando pede para mudar. */
async function buscarAgendamentoParaRemarcar(
  supabase: Client, orgId: string, contactId: string,
): Promise<AgendamentoEmAberto | null> {
  const { data } = await supabase
    .from('appointments')
    .select('id, data, hora, duracao_min')
    .eq('organization_id', orgId)
    .eq('contact_id', contactId)
    .in('status', ['agendado', 'confirmado'])
    .gte('data', hojeEmBrasilia())
    .order('data', { ascending: true })
    .order('hora', { ascending: true })
    .limit(1);
  return data?.[0] ?? null;
}

export interface AgendamentoDaIA {
  orgId: string;
  conversationId: string;
  contactId: string;
  contatoNome: string;
  data: string;
  hora: string;
  servico: string;
  remarcacao: boolean;
}

/** Best-effort: qualquer falha aqui não pode derrubar a resposta que o cliente
 *  está esperando no WhatsApp. */
export async function registrarAgendamentoIA(supabase: Client, params: AgendamentoDaIA): Promise<void> {
  try {
    // A IA reconfirma "combinado, quinta às 10h" nas mensagens seguintes; sem
    // esta checagem cada repetição viraria um agendamento novo.
    const { data: jaExiste } = await supabase
      .from('appointments')
      .select('id')
      .eq('organization_id', params.orgId)
      .eq('contact_id', params.contactId)
      .eq('data', params.data)
      .eq('hora', params.hora)
      .neq('status', 'cancelado')
      .limit(1)
      .maybeSingle();
    if (jaExiste) return;

    const anterior = params.remarcacao
      ? await buscarAgendamentoParaRemarcar(supabase, params.orgId, params.contactId)
      : null;

    const { dentroDeJanela, vagas, duracaoMin } = await analisarHorario(
      supabase, params.orgId, params.data, params.hora, null,
    );
    // A IA só grava dentro de uma janela de disponibilidade.
    if (!dentroDeJanela) return;

    // Numa remarcação o horário antigo ainda conta na capacidade. Quando ele
    // cruza com o horário novo, devolvemos essa vaga — senão uma janela de
    // capacidade 1 recusaria o próprio cliente mudando de 09:00 para 09:30.
    const devolveVaga = anterior !== null && anterior.data === params.data && seCruzam(anterior, params.hora, duracaoMin);
    const vagasEfetivas = vagas === null ? null : vagas + (devolveVaga ? 1 : 0);
    if (vagasEfetivas !== null && vagasEfetivas <= 0) return;

    const { error: erroInsert } = await supabase.from('appointments').insert({
      organization_id: params.orgId,
      contact_id: params.contactId,
      data: params.data,
      hora: params.hora,
      servico: params.servico || 'Agendamento',
      paciente_nome: params.contatoNome || 'Cliente',
      duracao_min: duracaoMin,
      status: 'agendado',
    });
    if (erroInsert) {
      // O horário antigo continua de pé de propósito: cliente com o horário
      // velho é melhor do que cliente sem horário nenhum.
      console.error('Erro ao gravar agendamento da IA:', erroInsert.message);
      return;
    }

    if (anterior) {
      const { error: erroCancel } = await supabase
        .from('appointments')
        .update({ status: 'cancelado' })
        .eq('id', anterior.id);
      if (erroCancel) {
        console.error(
          `Remarcação: novo agendamento criado, mas o antigo (${anterior.id}) não foi cancelado ` +
          `na conversa ${params.conversationId} — o contato ficou com dois horários: ${erroCancel.message}`,
        );
      }
    }
  } catch (err) {
    console.error('Erro ao registrar agendamento da IA:', err instanceof Error ? err.message : err);
  }
}

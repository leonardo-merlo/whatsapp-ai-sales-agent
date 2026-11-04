// Analisa um horário da agenda: quantas vagas sobram e qual a duração de sessão
// da janela que o cobre. O conflito é por SOBREPOSIÇÃO de intervalos (não por hora
// exata): uma sessão de 60 min às 09:00 ocupa até 10:00, então 09:30 conflita.
// Usado pela agenda (manual) e pela IA (automático) para não estourar a capacidade.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

const DURACAO_PADRAO = 60;

function minutos(h: string): number {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + (mm || 0);
}

export interface AnaliseHorario {
  // Existe uma janela de disponibilidade cobrindo este horário?
  dentroDeJanela: boolean;
  // Vagas restantes para um novo agendamento neste horário. null = sem limite.
  vagas: number | null;
  // Duração (min) a gravar no agendamento, herdada da janela que cobre o horário
  // — a menos que quem chamou tenha pedido uma duração específica.
  duracaoMin: number;
}

export async function analisarHorario(
  supabase: Client, orgId: string, data: string, hora: string, atendenteId: string | null,
  // Duração escolhida na mão (arrastar na agenda). Vence a da janela, e entra
  // no cálculo de sobreposição: uma sessão mais longa ocupa mais vagas.
  duracaoDesejada?: number | null,
): Promise<AnaliseHorario> {
  const diaSemana = new Date(`${data}T12:00:00`).getDay();

  const { data: janelas } = await supabase
    .from('availability')
    .select('tipo, dia_semana, data, hora_inicio, hora_fim, capacidade, duracao_min, atendente_id')
    .eq('organization_id', orgId)
    .eq('cancelado', false);

  const cobre = (j: { hora_inicio: string; hora_fim: string }) => minutos(hora) >= minutos(j.hora_inicio) && minutos(hora) < minutos(j.hora_fim);
  const candidatas = (janelas ?? []).filter(j =>
    cobre(j) && ((j.tipo === 'data' && j.data === data) || (j.tipo === 'semanal' && j.dia_semana === diaSemana)),
  );
  // Prioridade: janela específica do dia > recorrência semanal; dentro de cada,
  // a do próprio atendente > a de "Todos" (atendente nulo).
  const escolher = (arr: typeof candidatas) => arr.find(j => j.atendente_id === atendenteId) ?? arr.find(j => j.atendente_id === null) ?? arr[0];
  const janela = escolher(candidatas.filter(j => j.tipo === 'data')) ?? escolher(candidatas.filter(j => j.tipo === 'semanal'));
  const duracaoMin = duracaoDesejada ?? janela?.duracao_min ?? DURACAO_PADRAO;

  if (!janela) return { dentroDeJanela: false, vagas: null, duracaoMin };
  if (janela.capacidade == null) return { dentroDeJanela: true, vagas: null, duracaoMin };

  const inicioNovo = minutos(hora);
  const fimNovo = inicioNovo + duracaoMin;

  let query = supabase
    .from('appointments')
    .select('hora, duracao_min, atendente_id')
    .eq('organization_id', orgId)
    .eq('data', data)
    .in('status', ['agendado', 'confirmado']);
  // Conflito é por atendente: quando o agendamento tem atendente, só contam os dele.
  if (atendenteId) query = query.eq('atendente_id', atendenteId);
  const { data: doDiaMarcados } = await query;

  const sobrepostos = (doDiaMarcados ?? []).filter(a => {
    const ini = minutos(a.hora);
    const fim = ini + (a.duracao_min ?? DURACAO_PADRAO);
    return ini < fimNovo && fim > inicioNovo; // intervalos se cruzam
  }).length;

  return { dentroDeJanela: true, vagas: janela.capacidade - sobrepostos, duracaoMin };
}

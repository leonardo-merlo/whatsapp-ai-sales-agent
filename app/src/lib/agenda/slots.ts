// Calcula os horários realmente livres para agendar nos próximos dias, para a IA
// oferecer apenas estes (em vez de fazer conta de intervalo, que o modelo erra).
// Considera as janelas de disponibilidade (recorrentes + específicas + exceções),
// a duração da sessão e os agendamentos já existentes.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;
const DURACAO_PADRAO = 60;

function min(h: string): number { const [a, b] = h.split(':').map(Number); return a * 60 + (b || 0); }
function hhmm(m: number): string { return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; }
function toISO(d: Date): string { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export interface JanelaLivre { inicio: string; fim: string; grupo: boolean; horasLivres: string[] }
export interface DiaLivre { data: string; janelas: JanelaLivre[] }

export async function horariosLivres(
  supabase: Client, orgId: string, deISO: string, dias = 14, maxDiasComVaga = 7,
): Promise<DiaLivre[]> {
  const [avail, apps] = await Promise.all([
    supabase.from('availability').select('*').eq('organization_id', orgId),
    supabase.from('appointments').select('data, hora, duracao_min').eq('organization_id', orgId).gte('data', deISO).in('status', ['agendado', 'confirmado']),
  ]);
  const todos = avail.data ?? [];
  const marcados = apps.data ?? [];
  const base = new Date(`${deISO}T12:00:00`);
  const out: DiaLivre[] = [];

  for (let d = 0; d < dias && out.length < maxDiasComVaga; d++) {
    const dt = new Date(base.getTime() + d * 86400000);
    const iso = toISO(dt);
    const dow = dt.getDay();

    // Janelas efetivas do dia (mesma lógica da grade da agenda).
    const janelas: Database['public']['Tables']['availability']['Row'][] = [];
    for (const o of todos) if (o.tipo === 'data' && !o.parent_id && o.data === iso && !o.cancelado) janelas.push(o);
    for (const r of todos) {
      if (r.tipo !== 'semanal' || r.parent_id || r.dia_semana !== dow) continue;
      const ov = todos.find(x => x.parent_id === r.id && x.data === iso);
      if (ov) { if (!ov.cancelado) janelas.push(ov); }
      else janelas.push(r);
    }

    const appsDia = marcados.filter(a => a.data === iso);
    const janelasLivres: JanelaLivre[] = [];
    for (const j of janelas) {
      if (j.capacidade == null) { janelasLivres.push({ inicio: j.hora_inicio, fim: j.hora_fim, grupo: true, horasLivres: [] }); continue; }
      const dur = j.duracao_min ?? DURACAO_PADRAO;
      const fimJanela = min(j.hora_fim);
      const horas: string[] = [];
      for (let t = min(j.hora_inicio); t + dur <= fimJanela; t += dur) {
        const overlap = appsDia.filter(a => {
          const ai = min(a.hora); const af = ai + (a.duracao_min ?? DURACAO_PADRAO);
          return ai < t + dur && af > t;
        }).length;
        if (j.capacidade - overlap > 0) horas.push(hhmm(t));
      }
      if (horas.length) janelasLivres.push({ inicio: j.hora_inicio, fim: j.hora_fim, grupo: false, horasLivres: horas });
    }
    if (janelasLivres.length) out.push({ data: iso, janelas: janelasLivres });
  }
  return out;
}

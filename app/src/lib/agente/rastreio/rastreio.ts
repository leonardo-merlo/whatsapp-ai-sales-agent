// A ficha de cada execução do motor: a caixa-preta.
//
// Spec: `docs/superpowers/specs/2026-09-27-rastreio-por-turno-e-sombra-design.md`.
//
// **Três regras que moldam este arquivo:**
//
// 1. **Nunca derruba a resposta.** Toda gravação é best-effort, no padrão de
//    `logAiUsage`: falhou, vira `console.error` e segue. Nenhuma função daqui
//    lança.
// 2. **Abre no começo, fecha no fim.** Gravar só no fim esconderia exatamente
//    as execuções que morrem no meio (o 4º defeito de 21/09). Uma linha que
//    fica em `em_andamento` é uma execução que não terminou.
// 3. **O motor só escreve no objeto.** `gerar-resposta.ts` marca o caminho, as
//    ferramentas e o prompt num objeto em memória; quem fala com o banco é
//    `responder-conversa.ts`, antes e depois. Assim o rastreio não acrescenta
//    nenhuma decisão ao motor.
//
// O id do turno é gerado AQUI, e não pelo banco: as chamadas ao ERP e ao
// Claude apontam para ele mesmo se o insert da ficha falhar ou atrasar.

import { createHash, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../supabase/database.types';

type Client = SupabaseClient<Database>;

export type OrigemDoTurno = 'webhook' | 'fila' | 'varredura' | 'simulador';

export type StatusDoTurno = 'em_andamento' | 'respondeu' | 'silencio' | 'transferiu' | 'descartado' | 'erro';

/** O que o código fez fora do caminho feliz. Texto no banco: marca nova entra
 *  sem migration (as duas fases, por exemplo, quando forem ligadas). */
export type MarcaDoCaminho =
  | 'resgate_500'
  | 'repetiu_texto_picado'
  | 'max_tokens'
  | 'ferramenta_obrigatoria'
  | 'trocou_documento'
  | 'limite_de_voltas'
  | 'formulario_cru_recusado'
  | 'texto_puro'
  | 'silencio_decidido_pelo_codigo'
  | 'pediu_texto_de_novo'
  | 'resposta_velha_descartada'
  // As duas fases (`interruptor-duas-fases.ts`): a resposta saiu em duas
  // chamadas, e o que aconteceu na segunda.
  | 'duas_fases'
  | 'serializador_divergiu'
  | 'serializador_ilegivel'
  | 'serializador_falhou'
  // A máquina de estados conduziu este turno (`agente/maquina/`). As
  // transições ficam em `estado_depois`.
  | 'maquina'
  | 'maquina_versao_mudou'
  | 'maquina_limite_de_transicoes'
  // Válvula de escape (22/10): a mensagem não fez a pergunta andar (detalhe em
  // `estado_depois.nao_entendeu`), e na 3ª vez a conversa passou para uma pessoa.
  | 'maquina_nao_entendeu'
  | 'maquina_passou_ao_atendente'
  // Item 3 (22/10): a execução conduziu também as falas que chegaram enquanto ela pensava.
  | 'maquina_juntou_falas_novas'
  // Vários orçamentos (27/10): a mensagem trocou o orçamento em foco, pediu a lista ou respondeu "qual orçamento?".
  | 'maquina_varios_orcamentos';

export interface FerramentaNoTurno {
  nome: string;
  entrada: unknown;
  ok: boolean;
  duracao_ms: number;
  /** Os ids das linhas de `erp_chamadas` feitas enquanto esta ferramenta rodava. */
  erp_chamadas: string[];
}

export interface ChamadaErpNoTurno {
  id: string;
  operacao: string;
  ok: boolean;
  motivo: string | null;
  codigo: string | null;
  resposta: unknown;
}

export interface Rastreio {
  /** Gerado na criação. `aberto` diz se a ficha chegou a ser gravada. */
  turnoId: string;
  aberto: boolean;
  origem: OrigemDoTurno;
  caminho: MarcaDoCaminho[];
  ferramentas: FerramentaNoTurno[];
  chamadasErp: ChamadaErpNoTurno[];
  entrada: {
    mensagemId: string | null;
    roteiro: string | null;
    system: string;
    mensagens: unknown;
    falaDoCliente: string;
    contactId?: string | null;
  } | null;
  estadoAntes: Record<string, unknown> | null;
  estadoDepois: Record<string, unknown> | null;
  comecouEm: number;
}

export function novoRastreio(origem: OrigemDoTurno): Rastreio {
  return {
    turnoId: randomUUID(),
    aberto: false,
    origem,
    caminho: [],
    ferramentas: [],
    chamadasErp: [],
    entrada: null,
    estadoAntes: null,
    estadoDepois: null,
    comecouEm: Date.now(),
  };
}

/** Marca uma vez só: a mesma marca repetida não diz nada a mais. */
export function marcar(r: Rastreio | undefined, marca: MarcaDoCaminho): void {
  if (r && !r.caminho.includes(marca)) r.caminho.push(marca);
}

/** O id do turno para as linhas de `ai_usage` e `erp_chamadas`, ou nulo quando
 *  a ficha não existe no banco (a chave estrangeira recusaria o insert). */
export function turnoIdGravado(r: Rastreio | undefined): string | null {
  return r?.aberto ? r.turnoId : null;
}

export async function abrirTurno(
  supabase: Client,
  r: Rastreio,
  onde: { orgId: string; conversationId: string | null; waNumberId?: string | null; modelo?: string | null },
): Promise<void> {
  try {
    const { error } = await supabase.from('agente_turnos').insert({
      id: r.turnoId,
      organization_id: onde.orgId,
      conversation_id: onde.conversationId,
      wa_number_id: onde.waNumberId ?? null,
      origem: r.origem,
      modelo: onde.modelo ?? null,
      status: 'em_andamento',
    });
    if (error) {
      console.error('Rastreio: falha ao abrir o turno:', error.message);
      return;
    }
    r.aberto = true;
  } catch (err) {
    console.error('Rastreio: falha ao abrir o turno:', err instanceof Error ? err.message : err);
  }
}

/** Grava o que entrou, assim que o motor sabe: a mensagem respondida e o
 *  prompt. Vem antes da primeira chamada ao modelo, para que uma execução que
 *  morra ali já diga a qual mensagem pertencia. */
export async function gravarEntrada(supabase: Client, r: Rastreio): Promise<void> {
  if (!r.aberto || !r.entrada) return;
  try {
    const { error } = await supabase.from('agente_turnos').update({
      mensagem_id: r.entrada.mensagemId,
      roteiro: r.entrada.roteiro,
      prompt_system: r.entrada.system,
      prompt_mensagens: r.entrada.mensagens as Json,
      prompt_hash: createHash('sha256').update(r.entrada.system).digest('hex'),
      estado_antes: r.estadoAntes as Json,
    }).eq('id', r.turnoId);
    if (error) console.error('Rastreio: falha ao gravar a entrada:', error.message);
  } catch (err) {
    console.error('Rastreio: falha ao gravar a entrada:', err instanceof Error ? err.message : err);
  }
}

export interface FimDoTurno {
  status: Exclude<StatusDoTurno, 'em_andamento'>;
  resposta?: string | null;
  erro?: string | null;
  sombra?: { antes: string | null; depois: string | null; divergencias: string[] } | null;
}

export async function fecharTurno(supabase: Client, r: Rastreio, fim: FimDoTurno): Promise<void> {
  if (!r.aberto) return;
  try {
    const { error } = await supabase.from('agente_turnos').update({
      status: fim.status,
      caminho: r.caminho,
      ferramentas: r.ferramentas as unknown as Json,
      estado_depois: r.estadoDepois as Json,
      resposta: fim.resposta ?? null,
      erro: fim.erro ?? null,
      sombra_etapa_antes: fim.sombra?.antes ?? null,
      sombra_etapa_depois: fim.sombra?.depois ?? null,
      divergencias: fim.sombra?.divergencias ?? [],
      duracao_ms: Date.now() - r.comecouEm,
      terminou_em: new Date().toISOString(),
    }).eq('id', r.turnoId);
    if (error) console.error('Rastreio: falha ao fechar o turno:', error.message);
  } catch (err) {
    console.error('Rastreio: falha ao fechar o turno:', err instanceof Error ? err.message : err);
  }
}

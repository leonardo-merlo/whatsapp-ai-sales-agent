// Qual configuração do agente vale para esta conversa.
//
// `ai_agent_config` deixou de ser uma linha por empresa: agora pode haver uma
// linha por número, e a linha com `wa_number_id` nulo é **o padrão de todos os
// números**. Sem número (o simulador, por exemplo) vale sempre o padrão, que é
// exatamente o comportamento de antes desta separação existir.
//
// **A regra mudou em 14/09, e a mudança é a razão de este arquivo ter ficado
// maior: o número não substitui o padrão, ele o COMPLETA.**
//
// Antes, ter linha própria significava ignorar o padrão inteiro — e os campos
// que a tela do número não perguntava (tom de voz, boas-vindas, transferência)
// iam para o padrão em branco. Com sete vendedores isso significaria preencher
// sete vezes a mesma coisa, e esquecer uma vez é um número com tom de voz
// diferente dos outros sem ninguém saber por quê.
//
// Agora o número guarda **só o que foi mudado**, e campo em branco segue o
// padrão. É a mesma ideia do CSS: a regra mais específica vence, mas só nas
// propriedades que ela declara.
//
// O que NÃO se herda, e é de propósito:
//
//   `roteiro`  — é a identidade do número (atendimento, vendas, copiloto), e
//                herdá-lo faria um número de vendedor se comportar como
//                atendimento sem nada na tela explicando.
//   `ativo`    — desligar a IA num número é uma decisão sobre AQUELE número.
//
// Os dois já vêm com valor em toda linha (NOT NULL com default), então não há
// como distinguir "não respondi" de "respondi isto" — mais um motivo para não
// tentar herdá-los.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;
export type ConfigDoAgente = Database['public']['Tables']['ai_agent_config']['Row'];

/** Os campos que um número pode sobrescrever. Fora desta lista, tudo vem do
 *  padrão — inclusive o questionário, os desfechos e as regras de
 *  transferência, que são estruturas da empresa e não do número. */
const HERDAVEIS = ['prompt', 'limitacoes', 'info_adicional', 'welcome_msg', 'tom'] as const;

/** Um campo está "respondido" no número quando tem conteúdo. Texto vazio e
 *  NULL significam a mesma coisa: **não mexi nisto, use o padrão**. É a regra
 *  que o Leonardo pediu com estas palavras — "campo em branco segue o padrão" —
 *  e é a que a tela mostra, com o valor do padrão em cinza ao lado de
 *  "herdado". */
function respondido(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  return true;
}

/** Junta a configuração do número com a do padrão, campo a campo. */
export function combinarComOPadrao(
  doNumero: ConfigDoAgente | null,
  padrao: ConfigDoAgente | null,
): ConfigDoAgente | null {
  if (!doNumero) return padrao;
  if (!padrao) return doNumero;

  const combinada = { ...padrao } as ConfigDoAgente;

  // Do número vêm: tudo que ele respondeu, mais os campos que são dele por
  // natureza (o roteiro, o liga/desliga e a própria identidade da linha).
  for (const campo of HERDAVEIS) {
    if (respondido(doNumero[campo])) {
      (combinada as Record<string, unknown>)[campo] = doNumero[campo];
    }
  }
  combinada.id = doNumero.id;
  combinada.wa_number_id = doNumero.wa_number_id;
  combinada.roteiro = doNumero.roteiro;
  combinada.ativo = doNumero.ativo;

  return combinada;
}

/** As duas linhas, ainda separadas. O simulador precisa delas assim para trocar
 *  cada uma pelo que está na tela antes de juntar. */
export async function buscarConfigsSeparadas(
  supabase: Client,
  orgId: string,
  waNumberId?: string | null,
): Promise<{ padrao: ConfigDoAgente | null; doNumero: ConfigDoAgente | null }> {
  const { data: padrao } = await supabase
    .from('ai_agent_config')
    .select('*')
    .eq('organization_id', orgId)
    .is('wa_number_id', null)
    .maybeSingle();

  if (!waNumberId) return { padrao: padrao ?? null, doNumero: null };

  const { data: doNumero } = await supabase
    .from('ai_agent_config')
    .select('*')
    .eq('organization_id', orgId)
    .eq('wa_number_id', waNumberId)
    .maybeSingle();

  return { padrao: padrao ?? null, doNumero: doNumero ?? null };
}

export async function buscarConfigDoAgente(
  supabase: Client,
  orgId: string,
  waNumberId?: string | null,
): Promise<ConfigDoAgente | null> {
  const { padrao, doNumero } = await buscarConfigsSeparadas(supabase, orgId, waNumberId);
  if (!waNumberId) return padrao;
  return combinarComOPadrao(doNumero, padrao);
}

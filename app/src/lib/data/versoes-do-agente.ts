// Leitura e gravação do histórico do agente (`agente_versoes`). O formato e a
// volta para a tela estão em `lib/agente/versoes.ts`.

import { createClient } from '../supabase/client';
import type { Json } from '../supabase/database.types';
import type { ConteudoDaVersao, VersaoDoAgente } from '../agente/versoes';

/** Quantas cópias a tela mostra. As mais antigas continuam no banco. */
const LIMITE_DA_LISTA = 30;

export async function listarVersoes(orgId: string): Promise<VersaoDoAgente[]> {
  const { data, error } = await createClient().from('agente_versoes')
    .select('id, conteudo, autor, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(LIMITE_DA_LISTA);
  if (error) throw error;
  return (data ?? []).map(v => ({
    id: v.id,
    conteudo: v.conteudo as unknown as ConteudoDaVersao,
    autor: v.autor,
    criadaEm: v.created_at,
  }));
}

/**
 * Guarda a cópia do que acabou de ser salvo.
 *
 * `anterior` é o que a tela tinha ao abrir. Entra antes, e só quando a empresa
 * ainda não tem cópia nenhuma: sem ela, o primeiro salvamento depois desta
 * mudança não teria para onde voltar.
 */
export async function guardarVersao(
  orgId: string, conteudo: ConteudoDaVersao, autor: string, anterior: ConteudoDaVersao | null,
): Promise<void> {
  const supabase = createClient();
  const agora = Date.now();
  // Toda linha leva `created_at`: o PostgREST exige as mesmas colunas no lote.
  const linhas: { organization_id: string; conteudo: Json; autor: string; created_at: string }[] = [];
  if (anterior) {
    const { count, error } = await supabase.from('agente_versoes')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId);
    if (error) throw error;
    if (!count) {
      // Um milissegundo antes, para a ordem da lista não depender do banco.
      linhas.push({
        organization_id: orgId, conteudo: anterior as unknown as Json, autor: 'Antes do histórico',
        created_at: new Date(agora - 1).toISOString(),
      });
    }
  }
  linhas.push({ organization_id: orgId, conteudo: conteudo as unknown as Json, autor, created_at: new Date(agora).toISOString() });
  const { error } = await supabase.from('agente_versoes').insert(linhas);
  if (error) throw error;
}

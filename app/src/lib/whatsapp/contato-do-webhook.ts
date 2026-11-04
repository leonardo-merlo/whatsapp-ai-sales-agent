// Quem é o cliente que acabou de escrever: acha o contato da organização pelo
// telefone ou pelo BSUID, e cria quando não existe.
//
// Com os nomes de usuário do WhatsApp, a Meta pode mandar a mensagem SEM
// telefone, só com o BSUID (`from_user_id` / `contacts[].user_id`) — quando o
// cliente ativou nome de usuário e não falou com aquele número da empresa nos
// últimos 30 dias. Antes daqui, o webhook descartava essa mensagem sem aviso.
//
// O telefone continua mandando: é o que o atendente vê, o que o cadastro manual
// usa e o que a empresa conhece. O BSUID é guardado sempre que vem, para a
// próxima mensagem sem telefone cair no mesmo contato.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, TablesUpdate } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export interface IdentidadeDoRemetente {
  telefone: string | null;
  bsuid: string | null;
  nomeDoPerfil: string | null;
  usuario: string | null;
}

export interface ContatoDoWebhook {
  id: string;
  nome: string;
  telefone: string | null;
  bsuid: string | null;
}

const COLUNAS = 'id, nome, telefone, wa_user_id, wa_username';

export async function resolverContatoDoWebhook(
  supabase: Client, orgId: string, quem: IdentidadeDoRemetente,
): Promise<ContatoDoWebhook | null> {
  const { telefone, bsuid, nomeDoPerfil, usuario } = quem;

  let { data: contato } = telefone
    ? await supabase.from('contacts').select(COLUNAS).eq('organization_id', orgId).eq('telefone', telefone).maybeSingle()
    : { data: null };
  // Sem contato pelo telefone, o BSUID: é o cliente que já escreveu antes sem
  // telefone e agora apareceu com ele (ou continua sem).
  if (!contato && bsuid) {
    ({ data: contato } = await supabase.from('contacts').select(COLUNAS)
      .eq('organization_id', orgId).eq('wa_user_id', bsuid).limit(1).maybeSingle());
  }

  if (contato) {
    // Completa o que faltava. Nunca apaga: um webhook sem telefone não tira o
    // telefone de um contato que já tem.
    const mudancas: TablesUpdate<'contacts'> = {};
    if (bsuid && contato.wa_user_id !== bsuid) mudancas.wa_user_id = bsuid;
    if (telefone && !contato.telefone) mudancas.telefone = telefone;
    if (usuario && contato.wa_username !== usuario) mudancas.wa_username = usuario;
    if (Object.keys(mudancas).length) {
      const { error } = await supabase.from('contacts').update(mudancas).eq('id', contato.id);
      if (error) console.error('Erro ao atualizar a identidade do contato:', error.message);
    }
    return {
      id: contato.id, nome: contato.nome,
      telefone: mudancas.telefone ?? contato.telefone, bsuid: mudancas.wa_user_id ?? contato.wa_user_id,
    };
  }

  const nome = nomeDoPerfil || usuario || telefone || 'Cliente do WhatsApp';
  const { data: novo, error } = await supabase.from('contacts')
    .insert({ organization_id: orgId, nome, telefone, wa_user_id: bsuid, wa_username: usuario, origem: 'whatsapp' })
    .select('id')
    .single();
  if (error) {
    console.error('Erro ao criar contato do webhook:', error.message);
    return null;
  }
  return { id: novo.id, nome, telefone, bsuid };
}

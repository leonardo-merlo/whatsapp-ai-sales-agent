// Os números de WhatsApp da organização, para a tela que diz de quem é cada um.
//
// Por que isso precisa de tela: no Wappia Vendas o papel do número é o que
// separa os dois produtos, e o dono dele é o que vai permitir, no bloco C,
// o vendedor ver só a carteira dele e o copiloto avisar a pessoa certa. Até
// aqui esses campos só eram escritos pela rota de conexão, no chute do que dava
// para deduzir — quem sabe de quem é cada número é o administrador.
//
// RLS (migration `20260908000002`): todo membro LÊ (a tela de Conversas precisa
// saber por qual número a conversa entrou) e só admin ESCREVE. Este módulo usa
// o client do usuário de propósito: é o banco que decide quem pode gravar, a
// tela só evita mostrar botão que falharia.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';

type Client = SupabaseClient<Database>;

export type PapelDoNumero = Database['public']['Enums']['wa_number_papel'];

export interface NumeroWhatsApp {
  id: string;
  phoneNumberId: string;
  telefone: string | null;
  papel: PapelDoNumero;
  /** `organization_members.id` do dono. Só faz sentido em número de vendedor. */
  memberId: string | null;
  ativo: boolean;
  /** O aplicativo continua no celular de quem atende por este número. */
  coexistencia: boolean;
  /** Já tem o business token do cliente guardado no Vault (ver C2). */
  temCredencialPropria: boolean;
}

export const ROTULO_PAPEL: Record<PapelDoNumero, string> = {
  atendimento: 'Atendimento',
  vendedor: 'Vendedor',
  copiloto: 'Copiloto',
};

/**
 * A diferença real entre os papéis — não é só nome, é o que a IA PODE fazer.
 *
 * **Atendimento**: fala em nome da empresa, e não tem nenhuma ferramenta de
 * sistema — não consulta cliente, não cota, não cria orçamento. Se o
 * catálogo for grande ela ganha a busca de produto, e só ela.
 *
 * **Vendas**: fala como assistente identificado de UM vendedor (nunca se
 * apresenta como ele), e ganha as cinco ferramentas do fluxo comercial —
 * buscar produto, consultar/cadastrar cliente no sistema, consultar preço,
 * criar orçamento. Sem essas ferramentas o roteiro de vendas não tem como
 * cumprir o que promete: seria só um atendimento com um texto diferente.
 *
 * O que o papel NÃO decide: se o WhatsApp Business continua aberto no celular
 * de alguém (isso é a "coexistência", escolhida na hora de conectar o número,
 * pelo botão "Conectar número de vendedor") — dá para testar o roteiro de
 * vendas num número comum, sem coexistência nenhuma.
 */
export const EXPLICACAO_PAPEL: Record<PapelDoNumero, string> = {
  atendimento: 'Fala com o cliente final em nome da empresa. Sem ferramenta de sistema (cliente, cotação, orçamento).',
  vendedor: 'A IA atende como assistente identificado deste vendedor, e ganha as ferramentas de cliente, preço e orçamento no sistema.',
  copiloto: 'Só fala com a equipe: avisos automáticos para vendedores e gestores.',
};

export async function listarNumerosWhatsApp(supabase: Client, orgId: string): Promise<NumeroWhatsApp[]> {
  const { data, error } = await supabase
    .from('wa_numbers')
    .select('id, phone_number_id, telefone, papel, member_id, ativo, coexistencia, token_secret_id')
    .eq('organization_id', orgId)
    .order('created_at');
  if (error) throw error;

  return (data ?? []).map(n => ({
    id: n.id,
    phoneNumberId: n.phone_number_id,
    telefone: n.telefone,
    papel: n.papel,
    memberId: n.member_id,
    ativo: n.ativo,
    coexistencia: n.coexistencia,
    // Só o fato de existir, nunca o segredo: o token mora no Vault e não sai de
    // lá para o navegador.
    temCredencialPropria: n.token_secret_id !== null,
  }));
}

/**
 * Grava papel, dono e situação de um número.
 *
 * O dono é apagado quando o papel deixa de ser vendedor: número de atendimento
 * ou copiloto é da empresa, e deixar um dono pendurado ali faria a visibilidade
 * por vendedor (bloco C) esconder conversa de quem deveria ver.
 */
export async function salvarNumeroWhatsApp(
  supabase: Client,
  id: string,
  campos: { papel: PapelDoNumero; memberId: string | null; ativo: boolean },
): Promise<void> {
  const { error } = await supabase
    .from('wa_numbers')
    .update({
      papel: campos.papel,
      member_id: campos.papel === 'vendedor' ? campos.memberId : null,
      ativo: campos.ativo,
    })
    .eq('id', id);
  if (error) throw error;
}

// Qual token autoriza o envio por um número.
//
// O Embedded Signup entrega o **business token do cliente** uma única vez, na
// conexão. É com ele que a Meta autoriza mandar mensagem pelo número do
// cliente: a doc do Solution Partner diz que o system token serve para
// compartilhar a linha de crédito e "business tokens for everything else".
// Até aqui o token era descartado e todo envio saía com o `WHATSAPP_ACCESS_TOKEN`,
// que é o token da Wappia — funciona no número da própria Wappia e não há
// garantia nenhuma de que funcione no número da Distribuidora Exemplo.
//
// O token não fica em coluna: mora no Vault, e só a `service_role` consegue
// chamar as funções que o gravam e o leem (migration
// `20260913000001_token_do_cliente_no_vault.sql`).
//
// **Número sem token guardado continua com o token da Wappia.** É o que faz a
// demo e as orgs de hoje não mudarem de comportamento por causa deste item.

import { createServiceClient } from '../supabase/service';

/**
 * Token para enviar pelo número informado: o do cliente quando existe, o da
 * Wappia quando não. Sem nenhum dos dois, erro — não há como enviar.
 */
export async function tokenDeEnvio(phoneNumberId: string): Promise<string> {
  const tokenDoCliente = await buscarTokenDoCliente(phoneNumberId);
  if (tokenDoCliente) return tokenDoCliente;

  const tokenDaWappia = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!tokenDaWappia) {
    throw new Error('WhatsApp não configurado: número sem token do cliente e WHATSAPP_ACCESS_TOKEN ausente.');
  }
  return tokenDaWappia;
}

/**
 * O token do cliente, ou `null`. Falha de leitura **não** derruba o envio: cai
 * no token da Wappia e loga. Um erro de banco aqui não pode virar cliente sem
 * resposta — no pior caso a Meta recusa o envio e o erro dela diz o motivo.
 *
 * Sem cache de propósito: a consulta é uma ida ao banco ao lado de uma chamada
 * ao modelo que custa segundos, e token guardado em memória fica velho na
 * reconexão, que é justamente quando ele muda.
 */
async function buscarTokenDoCliente(phoneNumberId: string): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc('token_do_numero', { p_phone_number_id: phoneNumberId });
    if (error) {
      console.error('Token do cliente: falha ao ler do Vault', error.message);
      return null;
    }
    return data ?? null;
  } catch (e) {
    console.error('Token do cliente: erro inesperado ao ler do Vault', e);
    return null;
  }
}

/**
 * Guarda o business token que a Meta entregou na conexão. Chamado só pelo fim
 * do Embedded Signup, depois de o número existir em `wa_numbers`.
 */
export async function guardarTokenDoCliente(phoneNumberId: string, token: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc('guardar_token_do_numero', {
    p_phone_number_id: phoneNumberId,
    p_token: token,
  });
  if (error) throw new Error(error.message);
}

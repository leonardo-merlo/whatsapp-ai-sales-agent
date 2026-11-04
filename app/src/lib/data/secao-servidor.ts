// A seção que esta organização não usa também não abre pela URL.
//
// Esconder o item no menu não basta — o endereço continua digitável, e uma
// tela que existe mas não está em lugar nenhum é pior do que não existir: é
// exatamente o tipo de canto escondido que faz o sistema parecer maior e mais
// confuso do que é.
//
// `null` quando não deu para saber (sem sessão): a página abre e quem decide é
// a RLS, que é o mesmo caminho de `papel-servidor.ts`.

import { createClient } from '../supabase/server';
import { membroAtivo } from './org-ativa';
import { secoesOcultasDoProduto } from '../produtos';

export async function secoesOcultasDaOrg(): Promise<string[] | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const ativo = await membroAtivo(supabase, user.id);
  // O produto na tela também esconde seções: Agenda só existe no Atendimento,
  // Desenvolvimento só no Vendas.
  return ativo ? secoesOcultasDoProduto(ativo.produtoAtivo, ativo.secoesOcultas) : null;
}

/** Esta seção está desligada para a organização ativa? */
export async function secaoEstaOculta(secao: string): Promise<boolean> {
  const ocultas = await secoesOcultasDaOrg();
  return ocultas ? ocultas.includes(secao) : false;
}

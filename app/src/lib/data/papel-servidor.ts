// Papel do usuário logado, para as rotas que precisam decidir no servidor se
// alguém pode entrar. Esconder o item no menu não basta: a URL continua
// digitável.

import { createClient } from '../supabase/server';
import { membroAtivo } from './org-ativa';
import type { PapelMembro } from '../permissoes';

export async function papelDoUsuario(): Promise<PapelMembro | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // O papel é por organização: a mesma pessoa pode ser dona da empresa dela e
  // atendente na de um cliente. Vale o papel na organização ativa.
  const ativo = await membroAtivo(supabase, user.id);
  return ativo?.role ?? null;
}

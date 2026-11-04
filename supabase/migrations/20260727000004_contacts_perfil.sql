-- Perfil estruturado do contato, atualizado pela IA e editável pela equipe.
-- Formato: { preferencias: string[], dadosChave: {rotulo,valor}[],
--            ultimoInteresse: string, observacoes: string, atualizadoEm: string|null }
ALTER TABLE public.contacts
  ADD COLUMN perfil jsonb NOT NULL DEFAULT '{}'::jsonb;

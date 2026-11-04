-- =============================================================
-- Seções que uma organização não usa somem do menu dela
-- =============================================================
-- O painel nasceu para negócio local: Agenda, Campanhas, Conhecimento. Uma
-- distribuidora de aço com vendedores em campo não marca horário com ninguém —
-- e a Agenda no menu é a primeira coisa que faz o sistema parecer que não é
-- para ela.
--
-- **Não é papel nem permissão.** É o que aquele negócio usa. Quem decide é o
-- Leonardo, na mão, por enquanto: o cliente não sabe responder isso, e perguntar
-- em tela de onboarding seria mais uma regra para ele entender. Lista vazia — que
-- é o padrão e o que toda organização existente tem — se comporta exatamente
-- como hoje.
--
-- `text[]` e não enum: a lista de seções muda com o produto, e um enum obrigaria
-- migration a cada seção nova.
--
-- Migration ADITIVA: uma coluna com default.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS secoes_ocultas text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.organizations.secoes_ocultas IS
  'Rotas de secao que esta organizacao nao usa e que somem do menu e da URL (ex: {agenda}). Lista vazia = mostra tudo, que e o comportamento padrao.';

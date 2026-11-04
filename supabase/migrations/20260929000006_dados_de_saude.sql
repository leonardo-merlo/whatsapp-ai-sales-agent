-- =============================================================
-- Convênios e valor da consulta da clínica (S8)
-- =============================================================
-- O que a clínica preenche uma vez na aba Empresa: convênios aceitos, se
-- atende particular e o valor da consulta particular. Vai ao prompt numa seção
-- própria, só nas empresas de saúde (lib/saude.ts).
--
-- jsonb e não três colunas: é um cartão que só existe num segmento, e o
-- formato é lido por `lerDadosDeSaude`, que tolera campo faltando.
--
-- Migration ADITIVA: uma coluna com default.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS dados_saude jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organizations.dados_saude IS
  'Clinicas: {convenios: text, atendeParticular: bool, valorConsultaCentavos: int}. Vazio fora da saude.';

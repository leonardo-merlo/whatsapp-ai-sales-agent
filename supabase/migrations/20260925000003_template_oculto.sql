-- =============================================================
-- Esconder um template no Wappia sem apagar na Meta
-- =============================================================
-- A Meta não tem "desativar": só apagar, e apagar não tem volta. O cliente
-- quer tirar um template da escolha sem perder o aprovado. `oculto` tira o
-- template das listas de Campanhas e de Nova conversa; na Meta ele continua
-- existindo e aprovado, e voltar a mostrar é só desmarcar.
--
-- Vale também para os avisos automáticos (lembrete de agenda, aviso ao
-- vendedor): escondido não sai por caminho nenhum, e quem barra é
-- prepararTemplate em lib/whatsapp/catalogo-de-templates.ts.
--
-- Migration ADITIVA.

ALTER TABLE public.wa_templates
  ADD COLUMN IF NOT EXISTS oculto boolean NOT NULL DEFAULT false;

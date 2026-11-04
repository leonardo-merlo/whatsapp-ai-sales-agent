-- =============================================================
-- Tipos novos no sino para o Wappia Atendimento (S3, S5, S6)
-- =============================================================
-- limite_do_plano:      a empresa passou do teto de mensagens e a conversa foi
--                       para uma pessoa (S3).
-- consulta_desmarcada:  o paciente respondeu "não" ao lembrete (S5).
-- aviso_nao_enviado:    lembrete ou aviso de remarcação não saiu porque a conta
--                       não tem o template aprovado (S5, S6).
--
-- Migration ADITIVA: valores novos num enum.

ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'limite_do_plano';
ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'consulta_desmarcada';
ALTER TYPE public.notificacao_tipo ADD VALUE IF NOT EXISTS 'aviso_nao_enviado';

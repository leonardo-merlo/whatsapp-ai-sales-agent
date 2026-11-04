-- =============================================================
-- Campanha passa a ser disparo de template aprovado
-- =============================================================
-- Até aqui a campanha apontava para `message_templates`, textos locais sem
-- relação com a Meta, e o botão de disparar só gravava a linha: nada saía.
-- Mesmo que saísse, seria texto livre, que a Meta recusa fora da janela de
-- 24 horas, ou seja, justamente para quem uma campanha existe.
--
-- A campanha agora aponta para o template do catálogo (`wa_templates`) e para
-- o número por onde saiu. `disparos_count` passa a ser o que a Meta aceitou
-- de verdade, não uma estimativa, e as recusas ficam contadas ao lado.
--
-- Migration ADITIVA. `template_id` fica onde está: remover coluna é outra
-- conversa.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS wa_template_id uuid REFERENCES public.wa_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS falhas_count integer NOT NULL DEFAULT 0;

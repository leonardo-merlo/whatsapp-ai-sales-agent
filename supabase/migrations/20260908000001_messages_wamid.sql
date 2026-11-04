-- Guarda o identificador que a Meta dá a cada mensagem (o `wamid`) e impede
-- que a mesma mensagem seja gravada duas vezes.
--
-- Por que: a Meta REENVIA o webhook quando demora a receber o 200. Hoje nada
-- guarda o wamid e nada impede a duplicata — o reenvio vira mensagem repetida
-- e, pior, uma segunda resposta da IA para o mesmo texto do cliente. Com volume
-- baixo passa despercebido; com chamada a ERP no caminho vira rotina, e no
-- Wappia Vendas significa orçamento duplicado.
--
-- Aditiva e sem efeito no que já existe: a coluna nasce nula, e o índice é
-- PARCIAL (`WHERE wamid IS NOT NULL`), então mensagem da IA, do atendente, de
-- sistema e de campanha — que não têm wamid — não disputam nada entre si.
--
-- Escopo por organização, e não global: o wamid é único no WhatsApp inteiro,
-- mas se duas orgs acabarem com o mesmo número (hoje é possível, o índice único
-- em phone_number_id só chega na fase 3), um índice global faria a mensagem da
-- segunda org sumir em silêncio. Por org, o que se garante é o que importa:
-- a MESMA org não responde duas vezes à mesma mensagem.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS wamid text;

COMMENT ON COLUMN public.messages.wamid IS
  'Identificador da mensagem na Meta (wamid). Nulo em mensagens que não vieram do WhatsApp (IA, atendente, sys, campanha).';

CREATE UNIQUE INDEX IF NOT EXISTS messages_wamid_unico_por_org
  ON public.messages (organization_id, wamid)
  WHERE wamid IS NOT NULL;

-- =============================================================
-- A WABA passa a ser do número, não da organização
-- =============================================================
-- `organizations.waba_id` é UMA coluna, e a conexão sobrescreve ela a cada
-- número novo: com dois números, o segundo apaga a WABA do primeiro.
--
-- Isso não era problema enquanto cada empresa tinha uma WABA só. Deixou de
-- ser verdade com a coexistência: uma WABA criada pelo fluxo de coexistência
-- é 1:1 com o número (o modelo do WhatsApp Business App pressupõe um número
-- por negócio), então **cada vendedor entra com a WABA dele**. Sete
-- vendedores são sete WABAs, mais a do número de atendimento.
--
-- Hoje nada no código *lê* `organizations.waba_id` — só escreve. Por isso
-- nada está quebrado, e por isso mesmo a hora de guardar isso direito é
-- agora, antes de existirem sete números e nenhum jeito de saber de qual
-- WABA cada um veio.
--
-- Migration ADITIVA. A coluna antiga continua onde está: remover coluna é
-- outra conversa, e ela ainda serve de reserva para quem conectou antes.

ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS waba_id text;

COMMENT ON COLUMN public.wa_numbers.waba_id IS
  'WABA a que este número pertence. Na coexistência é uma por número; no fluxo normal vários números podem dividir a mesma.';

-- Backfill honesto: só dá para atribuir com certeza o número que está na
-- coluna antiga da organização, que é o último conectado. Os demais ficam
-- nulos — nulo é "não sabemos", e é melhor do que um palpite que ninguém vai
-- conferir depois.
UPDATE public.wa_numbers n
SET waba_id = o.waba_id
FROM public.organizations o
WHERE n.organization_id = o.id
  AND n.waba_id IS NULL
  AND o.waba_id IS NOT NULL
  AND n.phone_number_id = o.wa_phone_number_id;

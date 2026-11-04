-- =============================================================
-- Coexistência: o número fica na Cloud API e continua no celular
-- =============================================================
-- No Wappia Vendas o número é do vendedor, e o vendedor não vai entregar o
-- aplicativo dele. A coexistência é o modo da Meta em que os dois convivem: o
-- app segue no telefone e o mesmo número também responde pela API.
--
-- A coluna existe porque três comportamentos dependem de saber disso:
--   1. na conexão, o registro do número (`/register`) tem que ser **pulado** —
--      o número já está registrado, e chamar dá erro;
--   2. a vazão é fixa em 20 mensagens por segundo, menor que a normal;
--   3. o aplicativo precisa ser aberto pelo menos uma vez a cada 13 dias em
--      cada celular, senão a conexão cai — saber quais números correm esse
--      risco é o que permite avisar depois.
--
-- Migration ADITIVA e com o comportamento antigo por padrão: `false` é o número
-- comum, que continua sendo registrado na conexão como sempre foi.

ALTER TABLE public.wa_numbers
  ADD COLUMN IF NOT EXISTS coexistencia boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wa_numbers.coexistencia IS
  'true = número conectado mantendo o WhatsApp Business no celular (o /register é pulado, vazão fixa de 20 mps, app precisa ser aberto a cada 13 dias).';

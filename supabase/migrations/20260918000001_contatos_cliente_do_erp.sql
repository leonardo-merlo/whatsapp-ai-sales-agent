-- =============================================================
-- contacts aprende quem o contato é no sistema do cliente (ERP)
-- =============================================================
-- Hoje o vínculo com o cliente do ERP existe só em `conversations.erp_cliente_id`,
-- ou seja: por CONVERSA. "Todos os orçamentos e pedidos deste cliente" não é
-- consultável — seria preciso varrer todas as conversas do contato.
--
-- **O índice NÃO é único, e isso é decisão.** O mesmo CNPJ falando com dois
-- vendedores são dois contatos legítimos (números diferentes, carteiras
-- diferentes). Um índice único barraria o segundo cadastro sem erro visível na
-- tela — o cliente simplesmente não conseguiria ser atendido pelo segundo vendedor.
--
-- **`documento` é coluna nova apesar de já existir `cpf`.** `cpf` tem dado real
-- (12 linhas em 18/09) e é da ficha do Wappia Atendimento. Guardar um CNPJ numa
-- coluna chamada `cpf` seria pior que a duplicação. Fica registrada aqui.
--
-- Migration ADITIVA: coluna nula significa "como era antes".

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS erp_cliente_id text,
  ADD COLUMN IF NOT EXISTS documento      text;

COMMENT ON COLUMN public.contacts.erp_cliente_id IS
  'Id do contato no sistema de gestao do cliente (ERP), no formato codigo/loja. Nulo = ainda nao identificado.';
COMMENT ON COLUMN public.contacts.documento IS
  'CPF ou CNPJ, so digitos. Coluna separada de cpf, que e da ficha do Wappia Atendimento.';

CREATE INDEX IF NOT EXISTS contacts_erp_cliente_idx
  ON public.contacts (organization_id, erp_cliente_id)
  WHERE erp_cliente_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_documento_idx
  ON public.contacts (organization_id, documento)
  WHERE documento IS NOT NULL;

-- =============================================================
-- A ficha guarda TODOS os cadastros do contato no sistema de gestão
-- =============================================================
-- `contacts.erp_cadastro` (singular, de hoje mais cedo) guarda um só, e o
-- primeiro teste real derrubou isso em duas horas: o mesmo comprador consultou
-- um CNPJ e cadastrou outro na mesma conversa. Uma pessoa que compra por duas
-- empresas é o caso comum numa distribuidora, não a exceção.
--
-- Pior que a falta: o cadastro novo aparecia com campos do anterior. A regra de
-- "nulo não apaga" vale DENTRO de um cadastro; entre dois, ela vaza — e a
-- Distribuidora Exemplo não devolve `tipo_cliente` nem `contribuinte_icms` ao criar, então
-- o cliente novo herdava a classificação fiscal do outro. Errar classificação
-- fiscal é errar ICMS.
--
-- **A coluna nova é uma LISTA, mais recente primeiro, um item por `cliente_id`.**
-- `erp_cadastro` continua existindo e continua sendo escrita com o cadastro
-- ATUAL: quem já lê aquela coluna não muda de comportamento, e `erp_cliente_id`
-- segue sendo o cliente em uso. Migration aditiva: nada é renomeado nem
-- removido.
--
-- O backfill copia o que existe hoje para dentro da lista, para a ficha que já
-- tem cadastro não aparecer vazia.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS erp_cadastros jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contacts.erp_cadastros IS
  'Todos os cadastros deste contato no sistema de gestao, mais recente primeiro, um por cliente_id. erp_cadastro guarda o atual; esta guarda a lista. Lista vazia = nunca identificado.';

UPDATE public.contacts
   SET erp_cadastros = jsonb_build_array(erp_cadastro)
 WHERE erp_cadastro IS NOT NULL
   AND erp_cadastros = '[]'::jsonb;

-- =============================================================
-- O que a conversa já descobriu no sistema do cliente
-- =============================================================
-- **O problema, achado no primeiro teste real do fluxo de vendas (14/09):** o
-- que as ferramentas descobrem vive só DENTRO de uma resposta. O laço monta a
-- conversa com o pedido e o `tool_result`, o modelo responde, e aquilo é
-- jogado fora. Da mensagem seguinte em diante o histórico é só o texto das
-- falas — então o `cliente_id: CLI-4471` que a consulta devolveu na primeira
-- mensagem não existe mais quando o cliente confirma o pedido três mensagens
-- depois. O modelo chamou `criar_orcamento` sem ele e levou `422
-- cliente_nao_encontrado`. **É isso que trava o fluxo de vendas hoje.**
--
-- **Por que na conversa e não na ficha do contato.** `contacts.perfil` já
-- entra no prompt e seria de graça, mas a ficha é UMA por contato e não sabe
-- de qual número veio cada fato — e a decisão de 10/09 (uma memória por
-- vendedor) tira a ficha do prompt justamente nos números de vendedor. Usá-la
-- aqui exigiria abrir uma exceção no meio da regra que protege a carteira de
-- cada vendedor. A conversa já é por vendedor: guardar aqui não vaza nada.
--
-- Migration ADITIVA e com o comportamento antigo por padrão: conversa sem
-- `erp_cliente_id` funciona exatamente como funcionava (o modelo continua
-- podendo mandar o id na chamada da ferramenta).

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS erp_cliente_id   text,
  ADD COLUMN IF NOT EXISTS erp_cliente_nome text;

COMMENT ON COLUMN public.conversations.erp_cliente_id IS
  'Id do cliente no sistema de gestão do cliente (ERP), descoberto por consultar_cliente ou cadastrar_cliente. Nulo = ainda não foi identificado nesta conversa.';
COMMENT ON COLUMN public.conversations.erp_cliente_nome IS
  'Nome do cliente como o sistema de gestão o conhece. Serve para a IA confirmar com quem está falando sem consultar de novo.';

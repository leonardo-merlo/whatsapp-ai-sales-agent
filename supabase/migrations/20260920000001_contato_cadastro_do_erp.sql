-- =============================================================
-- A ficha do contato guarda o cadastro que o sistema de gestão devolveu
-- =============================================================
-- Em 18/09 a ficha aprendeu `erp_cliente_id` e `documento` — o suficiente para
-- ligar o contato ao cadastro, e nada além disso. O que a consulta e o cadastro
-- devolvem (razão social, inscrição estadual, contribuinte de ICMS, endereço,
-- vendedor da carteira, situação, empresas do grupo, e-mail, telefone e a praça
-- de entrega) era lido, usado dentro de uma resposta e jogado fora.
--
-- Quem sente a falta é o desenvolvedor do cliente, na homologação: ele precisa
-- abrir o contato e conferir se o cadastro que a IA criou gravou com os dados
-- certos. Sem isso, a conferência passa toda por log de servidor.
--
-- **Uma coluna jsonb, e não catorze colunas.** É a regra que `erp_pedidos` já
-- segue neste repositório: vira coluna o que a tela filtra ou ordena, ou o que
-- a IA lê sem contexto; o resto fica no jsonb. Nada hoje filtra por segmento,
-- inscrição estadual ou lista de empresas. No dia em que existir "meus clientes
-- bloqueados" ou "minha carteira", promover `situacao` e `vendedor_id` a coluna
-- é aditivo — nada aqui impede.
--
-- **Sem DEFAULT `'{}'`.** Nulo quer dizer "este contato nunca foi identificado
-- no sistema de gestão", que é diferente de "foi consultado e voltou vazio". Com
-- default, as duas coisas ficariam indistinguíveis na tela.
--
-- **Sem índice.** Nada consulta por dentro deste jsonb; a busca é por
-- `erp_cliente_id` e `documento`, que já têm índice desde 18/09.
--
-- Migration ADITIVA: uma coluna nula. Toda organização de Atendimento continua
-- exatamente como está — a coluna nunca é escrita fora do roteiro de vendas.

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS erp_cadastro jsonb;

COMMENT ON COLUMN public.contacts.erp_cadastro IS
  'O cadastro devolvido pelo sistema de gestao: tipo_cliente, segmento, nome (razao social), inscricao_estadual, contribuinte_icms, endereco, vendedor_id, situacao, empresas, email, telefone, cidade_entrega, uf_entrega, mais atualizado_em e origem (consulta|cadastro). Nulo = contato nunca identificado. O telefone e o email daqui sao do CADASTRO e nunca sobrescrevem contacts.telefone/contacts.email.';

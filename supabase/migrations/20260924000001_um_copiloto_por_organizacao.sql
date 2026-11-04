-- =============================================================
-- Um número copiloto por organização
-- =============================================================
-- `avisarVendedorDoOrcamento` busca o copiloto da empresa e pega o primeiro
-- que encontra (`limit(1)`). Com dois cadastrados, o segundo nunca é usado e
-- quem o cadastrou fica procurando por que aquele número não avisa ninguém.
--
-- Índice PARCIAL, como `notificacoes_um_alerta_estoque_por_produto`: a regra
-- vale só para o papel copiloto. Atendimento e vendedor continuam podendo
-- repetir à vontade na mesma empresa, que é o caso normal do Wappia Vendas.
--
-- A trava amigável, que explica qual número já é o copiloto, está em
-- `definirPapelDoNumero`. Este índice é a garantia de último caso: a tela
-- pode mudar, a regra do banco não.
--
-- Migration ADITIVA. Nenhuma organização tem dois copilotos hoje (conferido
-- em produção em 2026-09-24), então nada precisa ser corrigido antes.

CREATE UNIQUE INDEX IF NOT EXISTS wa_numbers_um_copiloto_por_org
  ON public.wa_numbers (organization_id)
  WHERE papel = 'copiloto';

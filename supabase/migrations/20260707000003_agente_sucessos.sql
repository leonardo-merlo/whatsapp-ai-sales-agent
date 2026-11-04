-- =============================================================
-- Tipos de sucesso do agente (Questionário)
-- Quando o questionário obrigatório é preenchido, o agente pode concluir
-- de até 3 formas: venda, agendamento ou contato. Cada uma tem ativo +
-- mensagem de fechamento. Guardado como jsonb em ai_agent_config.
-- =============================================================

ALTER TABLE public.ai_agent_config
  ADD COLUMN sucessos jsonb NOT NULL DEFAULT '{
    "venda": {"ativo": false, "mensagem": "Perfeito! 🎉 Seu pedido está confirmado. Nossa equipe já vai dar sequência. Muito obrigado pela preferência!"},
    "agendamento": {"ativo": false, "mensagem": "Prontinho! ✅ Seu agendamento está confirmado. Você vai receber um lembrete antes do horário. Até lá!"},
    "contato": {"ativo": false, "mensagem": "Obrigado! 😊 Recebi seus dados e nossa equipe entra em contato em breve."}
  }'::jsonb;

-- Unifica "Gatilhos de intervenção" e "Regras automáticas" numa coisa só: "Regras".
-- Cada gatilho passa a ter uma ação própria (transferir para atendente ou responder
-- com uma mensagem). As regras automáticas (business_rules) são movidas para dentro
-- dos gatilhos e a tabela separada é removida.

ALTER TABLE public.business_triggers
  ADD COLUMN acao     text NOT NULL DEFAULT 'transferir',
  ADD COLUMN mensagem text NOT NULL DEFAULT '';

ALTER TABLE public.business_triggers
  ADD CONSTRAINT business_triggers_acao_check CHECK (acao IN ('transferir', 'responder'));

-- Move o conteúdo de business_rules para business_triggers (condicao vira o texto do gatilho).
INSERT INTO public.business_triggers (organization_id, gatilho, ativo, ordem, acao, mensagem)
SELECT organization_id, condicao, ativo, ordem + 100, acao, mensagem
FROM public.business_rules;

DROP TABLE public.business_rules;

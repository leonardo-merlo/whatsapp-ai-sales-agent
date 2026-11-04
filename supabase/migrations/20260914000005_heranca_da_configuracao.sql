-- =============================================================
-- Herança: o número guarda só o que foi mudado
-- =============================================================
-- **O problema (Leonardo, 14/09):** quando um número ganha configuração
-- própria, ele não herda nada. Tom de voz, mensagem de boas-vindas e
-- transferência vão para o padrão em branco, e com sete vendedores seria
-- preciso preencher sete vezes a mesma coisa.
--
-- A regra nova: **campo vazio segue o padrão da empresa.** Para os quatro
-- campos de texto (`prompt`, `limitacoes`, `info_adicional`, `welcome_msg`)
-- isso já funciona sem tocar no schema — eles nascem `''`, e string vazia
-- passa a significar "herdado".
--
-- Sobra `tom`, que é enum NOT NULL: não existe valor que signifique "não
-- respondi". Esta migration deixa a coluna aceitar NULL, e **NULL passa a
-- significar herdado**. Nenhuma linha existente muda: todas têm valor.
--
-- É a única mudança de schema do redesenho da tela. Relaxar um NOT NULL não
-- apaga nem renomeia nada, e o caminho de volta é uma linha (`SET NOT NULL`,
-- depois de preencher quem estiver nulo).

ALTER TABLE public.ai_agent_config
  ALTER COLUMN tom DROP NOT NULL;

COMMENT ON COLUMN public.ai_agent_config.tom IS
  'Tom de voz. Na linha de um numero, NULL significa "herda o tom do padrao da empresa". Na linha da empresa (wa_number_id nulo), NULL cai no padrao simpatico.';

COMMENT ON COLUMN public.ai_agent_config.prompt IS
  'Instrucao principal. Na linha de um numero, string vazia significa "herda a do padrao da empresa".';
COMMENT ON COLUMN public.ai_agent_config.limitacoes IS
  'O que a IA nao pode fazer. Na linha de um numero, string vazia significa "herda a do padrao da empresa".';
COMMENT ON COLUMN public.ai_agent_config.info_adicional IS
  'Informacoes adicionais. Na linha de um numero, string vazia significa "herda a do padrao da empresa".';
COMMENT ON COLUMN public.ai_agent_config.welcome_msg IS
  'Mensagem de boas-vindas. Na linha de um numero, string vazia significa "herda a do padrao da empresa".';

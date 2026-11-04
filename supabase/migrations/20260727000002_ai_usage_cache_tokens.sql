-- Tokens de cache do prompt caching da Anthropic. Hoje sempre 0 (o projeto não
-- usa cache_control), mas sem estas colunas o relatório de custo passaria a
-- subnotificar em silêncio no dia em que o caching for ligado: com cache ativo,
-- parte dos tokens de entrada deixa de ser contada em input_tokens.
ALTER TABLE public.ai_usage
  ADD COLUMN cache_creation_input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN cache_read_input_tokens     integer NOT NULL DEFAULT 0;

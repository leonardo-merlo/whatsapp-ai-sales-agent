-- =============================================================
-- Sem trava de vagas por enquanto (29/09, decisão do Leonardo)
-- =============================================================
-- Com um plano só, o limite de pessoas com acesso ao painel vai ser decidido
-- depois, testando com os clientes. O gatilho continua existindo; a função
-- passa a deixar tudo passar. Para voltar a travar, restaure o corpo que está
-- em 20260914000002_cadastro_sem_login.sql (a última versão com a trava).
--
-- Nada de coluna ou tabela muda.

CREATE OR REPLACE FUNCTION public.check_limite_atendentes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN NEW;
END;
$function$;

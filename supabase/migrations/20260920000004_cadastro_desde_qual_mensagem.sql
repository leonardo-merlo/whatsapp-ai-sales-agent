-- Desde QUAL mensagem do cliente o cadastro do ERP está identificado.
--
-- A trava "identificou agora não cota agora" existia desde 20/09, mas vivia num
-- booleano em memória: valia dentro de UMA execução do motor. No teste real de
-- 20/09 às 21:06 ela falhou por isso — a Anthropic devolveu 500, a execução
-- morreu depois de consultar o cadastro, e a varredura refez o turno. Para a
-- execução nova o cliente "já estava identificado desde antes", então a trava
-- não valeu e a cotação saiu sem o cliente final ter confirmado nada.
--
-- Guardando a MENSAGEM, a pergunta deixa de ser "descobri nesta execução?" e
-- passa a ser "descobri respondendo a esta mesma mensagem do cliente?" — que é
-- o que a regra sempre quis dizer, e que sobrevive a uma tentativa perdida.
--
-- Aditiva e anulável: conversa antiga fica com NULL e se comporta exatamente
-- como antes desta coluna existir.

alter table conversations add column if not exists erp_cliente_desde_mensagem uuid;

comment on column conversations.erp_cliente_desde_mensagem is
  'Qual mensagem do cliente estava sendo respondida quando o cadastro foi identificado no ERP. '
  'Serve para a trava de "identificou agora não cota agora" sobreviver a uma tentativa que morreu '
  'no meio e foi refeita pela varredura. NULL = comportamento anterior.';

-- =============================================================
-- O que acontece quando a organização estoura o limite do plano
-- =============================================================
-- **Hoje é um só comportamento para todo mundo:** ao passar do
-- `max_msgs_mes` do plano, a conversa vai para `humano` e a IA para de
-- responder. Isso é certo no autoatendimento — uma clínica que não pagou não
-- deve ganhar IA de graça, e quem atende está do outro lado do balcão.
--
-- **Num piloto B2B isso é desastre.** Na Distribuidora Exemplo quem está do outro lado é
-- um cliente pedindo orçamento a um vendedor que está na rua; não há ninguém
-- olhando o painel para assumir a conversa. O efeito de "mandar para um
-- humano" seria o cliente falando sozinho, e o problema só apareceria no dia
-- em que o volume passasse — provavelmente no melhor dia de vendas.
--
-- A saída não é tirar o limite (sem teto nenhum, o custo de IA de um cliente
-- corre solto): é separar **cortar** de **avisar**.
--
--   'transferir'  o de hoje: a IA para e a conversa vai para uma pessoa.
--   'avisar'      a IA continua respondendo e o dono é avisado de que passou
--                 do plano. Para contrato B2B, em que o excedente se cobra.
--
-- Migration ADITIVA com o comportamento antigo por padrão: toda organização
-- nasce (e continua) em 'transferir'. Nenhum cliente do Wappia Atendimento
-- muda de comportamento por causa desta coluna.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ao_estourar_limite text NOT NULL DEFAULT 'transferir';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_ao_estourar_limite_check;
ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_ao_estourar_limite_check
  CHECK (ao_estourar_limite IN ('transferir', 'avisar'));

COMMENT ON COLUMN public.organizations.ao_estourar_limite IS
  'Ao passar do limite de mensagens do plano: transferir = a IA para e a conversa vai para uma pessoa (padrão, autoatendimento); avisar = a IA continua e o dono é avisado (contrato B2B com excedente).';

-- =============================================================
-- orcamento_eventos — a operação 5 do contrato da Distribuidora Exemplo
-- =============================================================
-- É o único sentido em que o sistema do cliente fala com o nosso: ele avisa o
-- desfecho de um orçamento que a IA criou como rascunho. Todas as outras quatro
-- operações somos nós chamando eles.
--
-- **O corpo inteiro é guardado em `payload`**, e isso é decisão, não preguiça:
-- o contrato de campos ainda não chegou (a Distribuidora Exemplo está construindo a API).
-- Guardando o JSON cru, um campo que a gente não previu não se perde — quando o
-- contrato fechar, dá para promover o que interessa a coluna com um UPDATE,
-- sem ter perdido nada dos eventos que já chegaram.
--
-- As três colunas promovidas desde já são as que existem em qualquer forma do
-- contrato: quem é o evento, de qual orçamento, e o que aconteceu.

CREATE TABLE IF NOT EXISTS public.orcamento_eventos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  evento_id        text        NOT NULL,
  orcamento_id     text        NOT NULL,
  status           text,
  ocorrido_em      timestamptz,
  payload          jsonb       NOT NULL,
  recebido_em      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.orcamento_eventos IS
  'Desfechos de orçamento enviados pelo sistema do cliente (operação 5 do contrato).';
COMMENT ON COLUMN public.orcamento_eventos.evento_id IS
  'Identificador do evento no sistema do cliente. É por ele que a repetição é ignorada.';
COMMENT ON COLUMN public.orcamento_eventos.payload IS
  'Corpo cru da requisição. O contrato de campos ainda não fechou — nada se perde aqui.';

-- Idempotência: o mesmo evento reenviado não conta duas vezes. Por organização
-- porque o `evento_id` é gerado do lado do cliente e nada garante que dois
-- clientes diferentes não usem a mesma sequência.
CREATE UNIQUE INDEX IF NOT EXISTS orcamento_eventos_evento_unico
  ON public.orcamento_eventos (organization_id, evento_id);

CREATE INDEX IF NOT EXISTS orcamento_eventos_orcamento_idx
  ON public.orcamento_eventos (organization_id, orcamento_id);

ALTER TABLE public.orcamento_eventos ENABLE ROW LEVEL SECURITY;
-- Leitura para membro da org (o vendedor precisa ver o desfecho do orçamento
-- dele). Escrita **nenhuma** por sessão de usuário: quem grava é a rota, com
-- service_role, autenticada pelo token do contrato. Nenhuma tela escreve aqui.
DROP POLICY IF EXISTS "members can select" ON public.orcamento_eventos;
CREATE POLICY "members can select" ON public.orcamento_eventos
  FOR SELECT USING (public.is_member_of(organization_id));

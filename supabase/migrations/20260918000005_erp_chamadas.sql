-- =============================================================
-- erp_chamadas — o que saiu daqui para o sistema do cliente, e o que voltou
-- =============================================================
-- **O problema que isto resolve.** O desenvolvedor do cliente (na Distribuidora Exemplo, o
-- Felipe) precisa conferir se o cadastro que a IA criou gravou com os dados
-- certos. Hoje ele não tem como: o que a gente enviou vive dentro de uma
-- requisição HTTP e some quando ela termina. A conferência depende de alguém
-- abrir o log do servidor — ou seja, depende do Leonardo, que vira gargalo de
-- toda homologação.
--
-- `erp_idempotencia` não serve: ela guarda a **resposta**, mas não o que foi
-- enviado nem o status HTTP, e só cobre as operações que CRIAM. Consulta que
-- falhou — o caso mais comum de dúvida — não aparece em lugar nenhum.
--
-- **A chave da API nunca entra aqui.** Só método, caminho e corpo são gravados;
-- os cabeçalhos ficam de fora inteiros, e é lá que a credencial viaja.
--
-- **RLS de ADMIN, não de membro.** Diferente de `erp_pedidos`, que é
-- operacional, esta tabela guarda o corpo cru das requisições — e lá dentro vão
-- CPF e CNPJ de cliente. Um vendedor não precisa ver o documento dos clientes
-- dos outros vendedores para trabalhar. Mesmo critério de
-- `organization_integrations`.
--
-- Migration ADITIVA: só cria tabela. Organização sem ERP fica com ela vazia.

CREATE TABLE IF NOT EXISTS public.erp_chamadas (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Nome de negócio da operação, derivado do caminho no código. Texto e não
  -- enum: o segundo cliente de Vendas terá outros caminhos.
  operacao           text        NOT NULL,
  metodo             text        NOT NULL,
  caminho            text        NOT NULL,

  -- O corpo que saiu daqui. NUNCA os cabeçalhos.
  requisicao         jsonb,
  -- Nulo quando a requisição nem chegou (timeout, DNS, conexão recusada).
  status_http        integer,
  resposta           jsonb,

  ok                 boolean     NOT NULL,
  -- 'recusado' | 'nao_encontrado' | 'credencial' | 'indisponivel'
  motivo             text,
  codigo             text,
  mensagem           text,

  -- Quantas idas até o desfecho. Maior que 1 significa que houve retentativa.
  tentativas         integer     NOT NULL DEFAULT 1,
  duracao_ms         integer,
  chave_idempotencia text,

  conversation_id    uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  contact_id         uuid        REFERENCES public.contacts(id)      ON DELETE SET NULL,
  wa_number_id       uuid        REFERENCES public.wa_numbers(id)    ON DELETE SET NULL,

  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_chamadas IS
  'Toda chamada ao sistema de gestao do cliente: o que foi enviado, o que voltou e quanto demorou. E a tela Integracao do painel.';
COMMENT ON COLUMN public.erp_chamadas.requisicao IS
  'Corpo enviado. Os cabecalhos ficam DE FORA de proposito: e neles que a chave da API viaja.';
COMMENT ON COLUMN public.erp_chamadas.status_http IS
  'Nulo quando a requisicao nem chegou (timeout, DNS, conexao recusada).';
COMMENT ON COLUMN public.erp_chamadas.tentativas IS
  'Quantas idas ate o desfecho. Maior que 1 significa que houve retentativa (5xx, 429 ou rede).';

CREATE INDEX IF NOT EXISTS erp_chamadas_recentes_idx
  ON public.erp_chamadas (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_chamadas_operacao_idx
  ON public.erp_chamadas (organization_id, operacao, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_chamadas_falhas_idx
  ON public.erp_chamadas (organization_id, created_at DESC)
  WHERE ok = false;
CREATE INDEX IF NOT EXISTS erp_chamadas_conversa_idx
  ON public.erp_chamadas (conversation_id);

-- ── RLS ──
-- Leitura de ADMIN. Escrita nenhuma por sessão de usuário: quem grava é o motor,
-- com service_role, que não passa por RLS.
ALTER TABLE public.erp_chamadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins can select" ON public.erp_chamadas;
CREATE POLICY "admins can select" ON public.erp_chamadas
  FOR SELECT USING (public.is_admin_of(organization_id));

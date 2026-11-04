-- =============================================================
-- Integração com o sistema do cliente (ERP) — credencial e idempotência
-- =============================================================
-- Duas coisas que não existiam e sem as quais o Wappia Vendas não sai do papel.
--
-- **1. Onde mora a credencial do sistema do cliente.** Não existe tabela de
-- integrações por organização, então a chave do ERP só caberia em variável de
-- ambiente — o que significa **um deploy por cliente** e um segredo
-- compartilhado entre todos. Aqui ela vira linha de tabela, e o segredo vai
-- para o Vault no mesmo padrão que o C2 construiu para o business token da
-- Meta: `SECURITY DEFINER` com `search_path` fixo, EXECUTE só para
-- `service_role`, e a tabela guardando apenas o id do segredo. O schema `vault`
-- não é exposto pelo PostgREST, então não há caminho por onde uma sessão de
-- usuário leia a chave.
--
-- **2. Como um pedido não vira dois.** A Meta reenvia a mesma mensagem quando
-- demoramos a confirmar, e com o ERP no caminho isso deixa de ser raro. Sem
-- trava, um cliente vira dois orçamentos no sistema deles. A chave de
-- idempotência é mandada ao ERP no cabeçalho `Idempotency-Key`, mas o contrato
-- deles ainda não existe — e mesmo que exista, depender só do lado de fora
-- seria confiar a integridade do nosso dado à implementação de outro time. Esta
-- tabela é a trava do NOSSO lado: a assinatura do pedido tem índice único, e
-- quem perde a corrida lê a resposta que o primeiro guardou.
--
-- Migration ADITIVA: só cria tabelas e funções. Organização sem linha em
-- `organization_integrations` se comporta exatamente como hoje — sem ERP.

-- ── a integração por organização ──
CREATE TABLE IF NOT EXISTS public.organization_integrations (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Texto e não enum: o segundo cliente de Vendas vai ter outro sistema, e um
  -- enum forçaria migration para cada nome novo.
  tipo                 text        NOT NULL DEFAULT 'erp',
  endereco_base        text        NOT NULL,
  token_secret_id      uuid,
  token_atualizado_em  timestamptz,
  ativo                boolean     NOT NULL DEFAULT true,
  -- O que varia de cliente para cliente sem virar coluna (caminhos, versão da
  -- API, nomes de campo que eles usarem diferente do contrato).
  config               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organization_integrations IS
  'Endereco e credencial do sistema de cada cliente. Sem linha aqui, a organizacao nao tem ERP e o roteiro de vendas nao consulta nada.';
COMMENT ON COLUMN public.organization_integrations.token_secret_id IS
  'Id do segredo no Vault com a chave da API do cliente. A chave em si nunca fica em coluna.';

CREATE UNIQUE INDEX IF NOT EXISTS organization_integrations_org_tipo_unico
  ON public.organization_integrations (organization_id, tipo);

-- ── a trava contra pedido duplicado ──
CREATE TABLE IF NOT EXISTS public.erp_idempotencia (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'criar_cliente' | 'criar_orcamento' — só as operações que CRIAM precisam
  -- de trava; consultar duas vezes não faz mal a ninguém.
  operacao         text        NOT NULL,
  -- O que faz dois pedidos serem o mesmo pedido: a mensagem do cliente que os
  -- originou mais o conteúdo. Mesma mensagem reprocessada (reenvio da Meta,
  -- retentativa nossa) = mesma assinatura.
  assinatura       text        NOT NULL,
  -- A chave que foi mandada ao ERP no cabeçalho `Idempotency-Key`.
  chave            text        NOT NULL,
  conversation_id  uuid        REFERENCES public.conversations(id) ON DELETE SET NULL,
  -- A resposta do ERP, guardada para quem chegar depois receber a MESMA coisa
  -- em vez de criar de novo.
  resposta         jsonb,
  concluida_em     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.erp_idempotencia IS
  'Um pedido de criacao por assinatura. E esta tabela que impede o reenvio da Meta virar dois orcamentos.';

CREATE UNIQUE INDEX IF NOT EXISTS erp_idempotencia_assinatura_unica
  ON public.erp_idempotencia (organization_id, operacao, assinatura);
CREATE INDEX IF NOT EXISTS erp_idempotencia_conversa_idx
  ON public.erp_idempotencia (conversation_id);

-- ── updated_at ──
DROP TRIGGER IF EXISTS organization_integrations_updated_at ON public.organization_integrations;
CREATE TRIGGER organization_integrations_updated_at
  BEFORE UPDATE ON public.organization_integrations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS erp_idempotencia_updated_at ON public.erp_idempotencia;
CREATE TRIGGER erp_idempotencia_updated_at
  BEFORE UPDATE ON public.erp_idempotencia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──
-- `organization_integrations`: admin lê e escreve (é configuração de conta, e o
-- endereço da API do cliente não é assunto de atendente). A credencial não está
-- aqui de qualquer forma — só o id do segredo.
-- `erp_idempotencia`: ninguém lê pela API. É estado interno do motor, que roda
-- com `service_role` e não passa por RLS. Tabela com RLS ligada e nenhuma
-- policy = nada é lido nem escrito por sessão de usuário, que é exatamente o
-- que se quer.
ALTER TABLE public.organization_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.erp_idempotencia          ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins full access" ON public.organization_integrations;
CREATE POLICY "admins full access" ON public.organization_integrations
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ── Guardar a credencial ──
CREATE OR REPLACE FUNCTION public.guardar_credencial_da_integracao(
  p_integration_id uuid,
  p_token          text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_nome      text := 'erp_token_' || p_integration_id::text;
  v_secret_id uuid;
BEGIN
  IF p_integration_id IS NULL THEN
    RAISE EXCEPTION 'integração obrigatória';
  END IF;
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RAISE EXCEPTION 'token vazio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organization_integrations WHERE id = p_integration_id) THEN
    RAISE EXCEPTION 'integração % não existe', p_integration_id;
  END IF;

  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_nome;

  IF v_secret_id IS NULL THEN
    v_secret_id := vault.create_secret(
      p_token, v_nome,
      'Chave da API do sistema do cliente (integração ' || p_integration_id::text || ')'
    );
  ELSE
    PERFORM vault.update_secret(v_secret_id, p_token);
  END IF;

  UPDATE public.organization_integrations
     SET token_secret_id = v_secret_id, token_atualizado_em = now()
   WHERE id = p_integration_id;

  RETURN v_secret_id;
END;
$$;

-- ── Ler a credencial ──
-- NULL (e não erro) quando não há credencial: quem chama entende como
-- "integração incompleta" e avisa o vendedor, sem derrubar a conversa.
CREATE OR REPLACE FUNCTION public.credencial_da_integracao(
  p_integration_id uuid
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_id uuid;
  v_token     text;
BEGIN
  SELECT token_secret_id INTO v_secret_id
    FROM public.organization_integrations
   WHERE id = p_integration_id;

  IF v_secret_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
   WHERE id = v_secret_id;

  RETURN v_token;
END;
$$;

COMMENT ON FUNCTION public.guardar_credencial_da_integracao(uuid, text) IS
  'Guarda no Vault a chave da API do cliente e liga o segredo a integracao. So service_role.';
COMMENT ON FUNCTION public.credencial_da_integracao(uuid) IS
  'Chave da API do cliente, ou NULL quando nao ha. So service_role.';

REVOKE ALL ON FUNCTION public.guardar_credencial_da_integracao(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credencial_da_integracao(uuid)               FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guardar_credencial_da_integracao(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.credencial_da_integracao(uuid)               TO service_role;

-- =============================================================
-- wa_numbers — um número de WhatsApp deixa de ser coluna da organização
-- =============================================================
-- `organizations.wa_phone_number_id` guarda UM número. O Wappia Vendas precisa
-- de vários por empresa (um por vendedor, mais o copiloto), e o papel de cada
-- número é o que separa os dois produtos sem fork.
--
-- Migration ADITIVA: cria a tabela, faz backfill do que já existe e NÃO remove
-- a coluna antiga — o código continua lendo ela como reserva. A remoção fica
-- para semanas depois, quando estiver claro que ninguém depende dela.
--
-- `member_id`, `organization_members.codigo_erp` e `telefone_whatsapp` entram
-- desde já, mesmo com a regra de visibilidade só chegando no bloco C: coluna é
-- barata agora e cara de acrescentar com dado em uso.
--
-- **Índice único em `phone_number_id`**: hoje não existe nem na coluna antiga.
-- Duas orgs com o mesmo número fazem o `maybeSingle()` do webhook devolver erro
-- e a mensagem do cliente sumir sem aviso nenhum.

-- ── papel do número ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wa_number_papel') THEN
    CREATE TYPE public.wa_number_papel AS ENUM ('atendimento', 'vendedor', 'copiloto');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.wa_numbers (
  id               uuid                   PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid                   NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  phone_number_id  text                   NOT NULL,
  telefone         text,                  -- número como o cliente vê (ex.: +55 11 92579-1156)
  papel            public.wa_number_papel NOT NULL DEFAULT 'atendimento',
  member_id        uuid                   REFERENCES public.organization_members(id) ON DELETE SET NULL,
  ativo            boolean                NOT NULL DEFAULT true,
  created_at       timestamptz            NOT NULL DEFAULT now(),
  updated_at       timestamptz            NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wa_numbers IS
  'Números da Cloud API por organização. O papel do número é o que distingue Wappia Atendimento de Wappia Vendas.';
COMMENT ON COLUMN public.wa_numbers.phone_number_id IS
  'phone_number_id da Meta — é por ele que o webhook resolve a organização.';
COMMENT ON COLUMN public.wa_numbers.member_id IS
  'Dono do número quando papel = vendedor. Nulo em número de atendimento da empresa.';

-- Único no projeto inteiro, não por org: o phone_number_id é único na Meta, e
-- duas orgs apontando para o mesmo número é a falha que faz a mensagem sumir.
CREATE UNIQUE INDEX IF NOT EXISTS wa_numbers_phone_number_id_unico
  ON public.wa_numbers (phone_number_id);
CREATE INDEX IF NOT EXISTS wa_numbers_organization_id_idx ON public.wa_numbers (organization_id);
CREATE INDEX IF NOT EXISTS wa_numbers_member_id_idx ON public.wa_numbers (member_id);

DROP TRIGGER IF EXISTS wa_numbers_updated_at ON public.wa_numbers;
CREATE TRIGGER wa_numbers_updated_at
  BEFORE UPDATE ON public.wa_numbers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.wa_numbers ENABLE ROW LEVEL SECURITY;
-- Leitura para todo membro (a tela de Conversas precisa saber por qual número a
-- conversa entrou); escrita só para admin, como toda configuração da conta.
DROP POLICY IF EXISTS "members can select" ON public.wa_numbers;
CREATE POLICY "members can select" ON public.wa_numbers
  FOR SELECT USING (public.is_member_of(organization_id));
DROP POLICY IF EXISTS "admins full write" ON public.wa_numbers;
CREATE POLICY "admins full write" ON public.wa_numbers
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ── dados do vendedor no membro ──
-- `codigo_erp` porque o contrato da Distribuidora Exemplo pede `vendedor_id` em toda criação
-- de orçamento; `telefone_whatsapp` porque o copiloto precisa saber para onde
-- avisar o vendedor.
ALTER TABLE public.organization_members
  ADD COLUMN IF NOT EXISTS codigo_erp        text,
  ADD COLUMN IF NOT EXISTS telefone_whatsapp text;

-- ── por qual número a conversa entrou ──
-- Nulo significa "como era antes": conversa antiga, ou org com um número só.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS wa_number_id uuid REFERENCES public.wa_numbers(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.conversations.wa_number_id IS
  'Número por onde a conversa entrou. Nulo em conversa anterior a esta migration — nesse caso vale o comportamento antigo (deduzir pela organização).';

CREATE INDEX IF NOT EXISTS conversations_wa_number_id_idx ON public.conversations (wa_number_id);

-- ── backfill ──
-- Toda org com número na coluna antiga passa a ter exatamente 1 linha aqui,
-- com papel 'atendimento', que é o que o Wappia Atendimento sempre foi.
INSERT INTO public.wa_numbers (organization_id, phone_number_id, telefone, papel, ativo)
SELECT o.id, o.wa_phone_number_id, o.wa_number, 'atendimento', true
FROM public.organizations o
WHERE o.wa_phone_number_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.wa_numbers n WHERE n.phone_number_id = o.wa_phone_number_id
  );

-- Conversas que já existem passam a apontar para o número da própria org, para
-- a resposta do atendente sair pelo mesmo número de sempre. Só quando a org tem
-- exatamente UM número: com dois, não há como saber por qual a conversa entrou,
-- e chutar seria pior do que deixar nulo (nulo = comportamento antigo).
UPDATE public.conversations c
SET wa_number_id = n.id
FROM public.wa_numbers n
WHERE n.organization_id = c.organization_id
  AND c.wa_number_id IS NULL
  AND (SELECT count(*) FROM public.wa_numbers x WHERE x.organization_id = c.organization_id) = 1;

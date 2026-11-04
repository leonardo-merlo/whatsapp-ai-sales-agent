-- =============================================================
-- ia-for-whatsapp — Schema inicial
-- Postgres 15 / Supabase · gerado em 2026-06-30
-- =============================================================
-- Domínios: organizations · plans/subscriptions · members ·
--           ai_agent_config · clinic knowledge · agent knowledge ·
--           contacts · conversations/messages ·
--           campaigns/templates · appointments
-- 24 tabelas · RLS em todas · member_role: owner/admin/atendente
-- =============================================================


-- ─────────────────────────────────────────────
-- PART 1: ENUMs
-- ─────────────────────────────────────────────

CREATE TYPE public.contact_status AS ENUM ('ativo', 'inativo');

CREATE TYPE public.contact_origem AS ENUM (
  'whatsapp', 'instagram', 'google', 'indicacao', 'presencial'
);

CREATE TYPE public.convenio_type AS ENUM (
  'particular', 'unimed', 'amil', 'bradesco_dental'
);

CREATE TYPE public.conversation_status AS ENUM ('aberta', 'encerrada');

CREATE TYPE public.conversation_modo AS ENUM ('ia', 'humano');

CREATE TYPE public.message_autor AS ENUM (
  'ia', 'municipe', 'humano', 'nota', 'sys'
);

CREATE TYPE public.campaign_status AS ENUM ('ativa', 'agendada', 'encerrada');

CREATE TYPE public.campaign_tipo AS ENUM ('imediato', 'agendado');

CREATE TYPE public.appointment_status AS ENUM (
  'agendado', 'confirmado', 'cancelado', 'realizado'
);

CREATE TYPE public.fallback_mode AS ENUM ('encerrar', 'transferir', 'aguardar');

-- Perfis de acesso: owner = dono da conta, admin = gestão plena,
-- atendente = operação (conversas, agenda, contatos)
CREATE TYPE public.member_role AS ENUM ('owner', 'admin', 'atendente');

CREATE TYPE public.plan_key AS ENUM ('basico', 'profissional', 'avancado');


-- ─────────────────────────────────────────────
-- PART 2: FUNÇÕES UTILITÁRIAS
-- ─────────────────────────────────────────────

-- Atualiza updated_at automaticamente
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────
-- PART 3: TABELAS
-- Ordem: sem FKs → com FKs (dependências primeiro)
-- ─────────────────────────────────────────────

-- ── 1. organizations ──────────────────────────
CREATE TABLE public.organizations (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        text        NOT NULL,
  cnpj        text,
  endereco    text,
  telefone    text,
  wa_number   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 2. plans (catálogo global, não multi-tenant) ──
CREATE TABLE public.plans (
  id               uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  key              plan_key UNIQUE NOT NULL,
  nome             text     NOT NULL,
  preco_centavos   int      NOT NULL,
  max_atendentes   int      NOT NULL,
  max_msgs_mes     int      NOT NULL
);


-- ── 3. subscriptions ──────────────────────────
CREATE TABLE public.subscriptions (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id            uuid        NOT NULL REFERENCES public.plans(id),
  status             text        NOT NULL DEFAULT 'ativa',  -- ativa | cancelada | inadimplente
  periodo_inicio     date        NOT NULL,
  periodo_fim        date,
  metodo_pagamento   text,       -- ex.: 'Visa ····4242'
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.subscriptions(organization_id);


-- ── 4. invoices ───────────────────────────────
CREATE TABLE public.invoices (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  subscription_id  uuid        REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  valor_centavos   int         NOT NULL,
  status           text        NOT NULL DEFAULT 'pendente',  -- pago | pendente | vencido
  vencimento       date        NOT NULL,
  pago_em          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.invoices(organization_id);


-- ── 5. organization_members ───────────────────
-- Cada linha é um usuário dentro de uma organização.
-- user_id é NULL até o membro criar a conta no Auth.
-- Papéis: owner (dono), admin (gestão), atendente (operação).
CREATE TABLE public.organization_members (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  role             member_role NOT NULL DEFAULT 'atendente',
  nome             text        NOT NULL,
  cargo            text        NOT NULL DEFAULT '',
  online           boolean     NOT NULL DEFAULT false,
  ativo            boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.organization_members(organization_id);
CREATE INDEX ON public.organization_members(user_id);

CREATE TRIGGER organization_members_updated_at
  BEFORE UPDATE ON public.organization_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 6. ai_agent_config ────────────────────────
-- Uma linha por organização (UNIQUE organization_id).
-- Configurações globais do agente: prompt, fallback, notificações.
CREATE TABLE public.ai_agent_config (
  id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid         NOT NULL UNIQUE REFERENCES public.organizations(id) ON DELETE CASCADE,
  ativo                   boolean      NOT NULL DEFAULT true,
  welcome_msg             text         NOT NULL DEFAULT '',
  prompt                  text         NOT NULL DEFAULT '',
  limitacoes              text         NOT NULL DEFAULT '',
  fallback_mode           fallback_mode NOT NULL DEFAULT 'encerrar',
  fallback_msg            text         NOT NULL DEFAULT '',
  fallback_atendente_id   uuid         REFERENCES public.organization_members(id) ON DELETE SET NULL,
  horario_vincula_agenda  boolean      NOT NULL DEFAULT false,
  notif_nova_conversa     boolean      NOT NULL DEFAULT true,
  notif_excedido          boolean      NOT NULL DEFAULT true,
  notif_resumo            boolean      NOT NULL DEFAULT true,
  created_at              timestamptz  NOT NULL DEFAULT now(),
  updated_at              timestamptz  NOT NULL DEFAULT now()
);

CREATE TRIGGER ai_agent_config_updated_at
  BEFORE UPDATE ON public.ai_agent_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 7. clinic_prices ──────────────────────────
-- Tabela de preços padrão da clínica (usada pela IA globalmente).
CREATE TABLE public.clinic_prices (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  procedimento     text        NOT NULL,
  valor            text        NOT NULL,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.clinic_prices(organization_id);


-- ── 8. clinic_business_hours ──────────────────
CREATE TABLE public.clinic_business_hours (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  dia              text        NOT NULL,
  hora             text        NOT NULL,
  cor              text,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.clinic_business_hours(organization_id);


-- ── 9. clinic_faqs ────────────────────────────
CREATE TABLE public.clinic_faqs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pergunta         text        NOT NULL,
  resposta         text        NOT NULL,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.clinic_faqs(organization_id);


-- ── 10. clinic_qualification_questions ─────────
CREATE TABLE public.clinic_qualification_questions (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pergunta         text        NOT NULL,
  campo            text        NOT NULL,
  obrigatoria      boolean     NOT NULL DEFAULT false,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.clinic_qualification_questions(organization_id);


-- ── 11. clinic_triggers ───────────────────────
CREATE TABLE public.clinic_triggers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  gatilho          text        NOT NULL,
  ativo            boolean     NOT NULL DEFAULT true,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.clinic_triggers(organization_id);


-- ── 12. agent_prices ──────────────────────────
-- Preços específicos por atendente (sobrescreve/complementa clinic_prices).
CREATE TABLE public.agent_prices (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id         uuid        NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  procedimento     text        NOT NULL,
  valor            text        NOT NULL,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.agent_prices(organization_id);
CREATE INDEX ON public.agent_prices(agent_id);


-- ── 13. agent_business_hours ──────────────────
CREATE TABLE public.agent_business_hours (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id         uuid        NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  dia              text        NOT NULL,
  hora             text        NOT NULL,
  cor              text,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.agent_business_hours(organization_id);
CREATE INDEX ON public.agent_business_hours(agent_id);


-- ── 14. agent_faqs ────────────────────────────
CREATE TABLE public.agent_faqs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id         uuid        NOT NULL REFERENCES public.organization_members(id) ON DELETE CASCADE,
  pergunta         text        NOT NULL,
  resposta         text        NOT NULL,
  ordem            int         NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.agent_faqs(organization_id);
CREATE INDEX ON public.agent_faqs(agent_id);


-- ── 15. agent_knowledge ───────────────────────
-- Campo de texto livre de conhecimento por atendente (1 linha por membro).
CREATE TABLE public.agent_knowledge (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id         uuid        NOT NULL UNIQUE REFERENCES public.organization_members(id) ON DELETE CASCADE,
  conhecimento     text        NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.agent_knowledge(organization_id);

CREATE TRIGGER agent_knowledge_updated_at
  BEFORE UPDATE ON public.agent_knowledge
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 16. contacts ──────────────────────────────
-- OBS: ultimoContato é derivado (MAX created_at de contact_history ou messages),
-- não armazenado. Painel/Contatos derivam isso via query.
CREATE TABLE public.contacts (
  id               uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid            NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome             text            NOT NULL,
  telefone         text            NOT NULL,
  bairro           text            NOT NULL DEFAULT '',
  status           contact_status  NOT NULL DEFAULT 'ativo',
  responsavel_id   uuid            REFERENCES public.organization_members(id) ON DELETE SET NULL,
  convenio         convenio_type   NOT NULL DEFAULT 'particular',
  tratamento       text            NOT NULL DEFAULT '',
  proximo_retorno  date,
  cpf              text,
  nascimento       date,
  email            text,
  origem           contact_origem  NOT NULL DEFAULT 'whatsapp',
  created_at       timestamptz     NOT NULL DEFAULT now(),
  updated_at       timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX ON public.contacts(organization_id);
CREATE INDEX ON public.contacts(responsavel_id);
CREATE INDEX ON public.contacts(status);

CREATE TRIGGER contacts_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 17. contact_history ───────────────────────
CREATE TABLE public.contact_history (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id       uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  data             timestamptz NOT NULL DEFAULT now(),
  canal            text        NOT NULL,  -- 'WhatsApp' | 'Campanha' | 'Presencial' etc.
  resumo           text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.contact_history(organization_id);
CREATE INDEX ON public.contact_history(contact_id);


-- ── 18. conversations ─────────────────────────
-- OBS: unread e excedida são derivados (COUNT + timestamp diff), não colunas.
-- unread  = COUNT(*) WHERE autor='municipe' AND read=false
-- excedida = now() - MAX(created_at WHERE autor='municipe') > interval '30 minutes'
CREATE TABLE public.conversations (
  id               uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid                NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id       uuid                NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  assunto          text                NOT NULL DEFAULT '',
  status           conversation_status NOT NULL DEFAULT 'aberta',
  modo             conversation_modo   NOT NULL DEFAULT 'ia',
  atendente_id     uuid                REFERENCES public.organization_members(id) ON DELETE SET NULL,
  created_at       timestamptz         NOT NULL DEFAULT now(),
  updated_at       timestamptz         NOT NULL DEFAULT now()
);

CREATE INDEX ON public.conversations(organization_id);
CREATE INDEX ON public.conversations(contact_id);
CREATE INDEX ON public.conversations(atendente_id);
CREATE INDEX ON public.conversations(status);

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 19. conversation_tags ─────────────────────
CREATE TABLE public.conversation_tags (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id  uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  tag              text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, tag)
);

CREATE INDEX ON public.conversation_tags(organization_id);
CREATE INDEX ON public.conversation_tags(conversation_id);


-- ── 20. messages ──────────────────────────────
-- `read` = o operador leu esta mensagem
-- `camp` = mensagem originada de uma campanha
CREATE TABLE public.messages (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id  uuid          NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  autor            message_autor NOT NULL,
  texto            text          NOT NULL,
  read             boolean       NOT NULL DEFAULT false,
  camp             boolean       NOT NULL DEFAULT false,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX ON public.messages(organization_id);
CREATE INDEX ON public.messages(conversation_id);
CREATE INDEX ON public.messages(created_at);


-- ── 21. message_templates ─────────────────────
CREATE TABLE public.message_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug             text        NOT NULL,  -- ex.: 'lembrete_retorno'
  categoria        text        NOT NULL,
  descricao        text        NOT NULL,
  variaveis        text        NOT NULL DEFAULT '',
  texto            text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX ON public.message_templates(organization_id);


-- ── 22. campaign_categories ───────────────────
CREATE TABLE public.campaign_categories (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome             text        NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, nome)
);

CREATE INDEX ON public.campaign_categories(organization_id);


-- ── 23. campaigns ─────────────────────────────
-- disparos_count e taxa_abertura são atualizados pelo worker de envio,
-- não calculados em tempo real.
-- Filtros de audiência (filtro_*) são snapshots do momento de criação;
-- a contagem de audiência estimada é feita via COUNT na tabela contacts.
CREATE TABLE public.campaigns (
  id                uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid            NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome              text            NOT NULL,
  tipo              campaign_tipo   NOT NULL DEFAULT 'imediato',
  status            campaign_status NOT NULL DEFAULT 'agendada',
  data_agendamento  timestamptz,
  remetente         text            NOT NULL DEFAULT '',
  template_id       uuid            REFERENCES public.message_templates(id) ON DELETE SET NULL,
  categoria_id      uuid            REFERENCES public.campaign_categories(id) ON DELETE SET NULL,
  filtro_bairro     text,
  filtro_convenio   text,
  filtro_status     text,
  disparos_count    int             NOT NULL DEFAULT 0,
  taxa_abertura     numeric(5, 2),
  created_at        timestamptz     NOT NULL DEFAULT now(),
  updated_at        timestamptz     NOT NULL DEFAULT now()
);

CREATE INDEX ON public.campaigns(organization_id);
CREATE INDEX ON public.campaigns(status);

CREATE TRIGGER campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ── 24. appointments ──────────────────────────
-- contact_id é nullable: permite agendamento antes de cadastrar o contato.
-- paciente_nome é sempre preenchido (cache do nome ou entrada manual).
CREATE TABLE public.appointments (
  id               uuid               PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid               NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id       uuid               REFERENCES public.contacts(id) ON DELETE SET NULL,
  paciente_nome    text               NOT NULL,
  servico          text               NOT NULL,
  data             date               NOT NULL,
  hora             text               NOT NULL,  -- ex.: '09h00'
  atendente_id     uuid               REFERENCES public.organization_members(id) ON DELETE SET NULL,
  status           appointment_status NOT NULL DEFAULT 'agendado',
  created_at       timestamptz        NOT NULL DEFAULT now(),
  updated_at       timestamptz        NOT NULL DEFAULT now()
);

CREATE INDEX ON public.appointments(organization_id);
CREATE INDEX ON public.appointments(contact_id);
CREATE INDEX ON public.appointments(atendente_id);
CREATE INDEX ON public.appointments(data);

CREATE TRIGGER appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- RLS helper: o usuário atual pertence à organização?
-- SECURITY DEFINER: roda com privilégios do criador, bypassa RLS
-- em organization_members para evitar recursão circular.
CREATE OR REPLACE FUNCTION public.is_member_of(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
  );
$$;

-- RLS helper: o usuário atual é admin ou owner da organização?
CREATE OR REPLACE FUNCTION public.is_admin_of(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE user_id = auth.uid()
      AND organization_id = org_id
      AND role IN ('owner', 'admin')
  );
$$;


-- ─────────────────────────────────────────────
-- PART 4: ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
-- Padrões usados:
--   members_select  → is_member_of(organization_id)
--   members_write   → is_member_of(organization_id)  [contatos, conversas, agenda]
--   admins_write    → is_admin_of(organization_id)   [config, campanhas, templates]
--   admins_delete   → is_admin_of(organization_id)   [dados operacionais]
-- ─────────────────────────────────────────────

-- organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.organizations
  FOR SELECT USING (public.is_member_of(id));
CREATE POLICY "admins can update" ON public.organizations
  FOR UPDATE USING (public.is_admin_of(id))
  WITH CHECK (public.is_admin_of(id));

-- plans (leitura pública — catálogo do SaaS)
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read" ON public.plans
  FOR SELECT USING (true);

-- subscriptions
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.subscriptions
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.subscriptions
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.invoices
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.invoices
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- organization_members
-- atendente pode ver todos os membros da org (para dropdowns etc.)
-- só admin/owner cria, edita ou remove membros
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.organization_members
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "self can select own row" ON public.organization_members
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "admins full write" ON public.organization_members
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- ai_agent_config
ALTER TABLE public.ai_agent_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.ai_agent_config
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.ai_agent_config
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- clinic knowledge tables (select: members; write: admins)
ALTER TABLE public.clinic_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.clinic_prices
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.clinic_prices
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.clinic_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.clinic_business_hours
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.clinic_business_hours
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.clinic_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.clinic_faqs
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.clinic_faqs
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.clinic_qualification_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.clinic_qualification_questions
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.clinic_qualification_questions
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.clinic_triggers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.clinic_triggers
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.clinic_triggers
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- agent knowledge tables (select: members; write: admins)
ALTER TABLE public.agent_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.agent_prices
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.agent_prices
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.agent_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.agent_business_hours
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.agent_business_hours
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.agent_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.agent_faqs
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.agent_faqs
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

ALTER TABLE public.agent_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.agent_knowledge
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.agent_knowledge
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- contacts: todos os membros podem ler e editar; só admin deleta
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.contacts
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.contacts
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "members can update" ON public.contacts
  FOR UPDATE USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "admins can delete" ON public.contacts
  FOR DELETE USING (public.is_admin_of(organization_id));

-- contact_history
ALTER TABLE public.contact_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.contact_history
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.contact_history
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "admins can delete" ON public.contact_history
  FOR DELETE USING (public.is_admin_of(organization_id));

-- conversations
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.conversations
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.conversations
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "members can update" ON public.conversations
  FOR UPDATE USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "admins can delete" ON public.conversations
  FOR DELETE USING (public.is_admin_of(organization_id));

-- conversation_tags
ALTER TABLE public.conversation_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.conversation_tags
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.conversation_tags
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "members can delete" ON public.conversation_tags
  FOR DELETE USING (public.is_member_of(organization_id));

-- messages: membros leem e inserem; sem update/delete (imutabilidade de chat)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.messages
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.messages
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));

-- message_templates
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.message_templates
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.message_templates
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- campaign_categories
ALTER TABLE public.campaign_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.campaign_categories
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.campaign_categories
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.campaigns
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "admins full write" ON public.campaigns
  FOR ALL USING (public.is_admin_of(organization_id))
  WITH CHECK (public.is_admin_of(organization_id));

-- appointments: todos os membros podem ler e editar; só admin deleta
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members can select" ON public.appointments
  FOR SELECT USING (public.is_member_of(organization_id));
CREATE POLICY "members can insert" ON public.appointments
  FOR INSERT WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "members can update" ON public.appointments
  FOR UPDATE USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));
CREATE POLICY "admins can delete" ON public.appointments
  FOR DELETE USING (public.is_admin_of(organization_id));


-- ─────────────────────────────────────────────
-- PART 5: SEED DO CATÁLOGO GLOBAL (plans)
-- Inserido na migration pois é dado fixo da plataforma,
-- não de uma organização específica.
-- ─────────────────────────────────────────────

INSERT INTO public.plans (id, key, nome, preco_centavos, max_atendentes, max_msgs_mes) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'basico',       'Básico',       14900,  2,  2000),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'profissional', 'Profissional', 34900,  5,  5000),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'avancado',     'Avançado',     89900, 15, 20000);

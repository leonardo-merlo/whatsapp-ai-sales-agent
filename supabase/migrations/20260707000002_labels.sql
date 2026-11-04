-- =============================================================
-- Etiquetas (labels) coloridas por organização
-- - labels: etiquetas salvas da org (nome + cor)
-- - contact_labels / conversation_labels: vínculo N-para-N
-- RLS: qualquer membro da org cria/aplica/remove (uso operacional diário)
-- =============================================================

-- ── 1. Etiquetas da organização ──
CREATE TABLE public.labels (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  nome             text        NOT NULL,
  cor              text        NOT NULL DEFAULT '#6366f1',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, nome)
);

CREATE INDEX ON public.labels(organization_id);

-- ── 2. Vínculo etiqueta ↔ contato ──
CREATE TABLE public.contact_labels (
  contact_id  uuid        NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  label_id    uuid        NOT NULL REFERENCES public.labels(id)  ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contact_id, label_id)
);

CREATE INDEX ON public.contact_labels(label_id);

-- ── 3. Vínculo etiqueta ↔ conversa ──
CREATE TABLE public.conversation_labels (
  conversation_id uuid        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  label_id        uuid        NOT NULL REFERENCES public.labels(id)        ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, label_id)
);

CREATE INDEX ON public.conversation_labels(label_id);

-- ── 4. RLS ──
-- labels: membros da org podem tudo dentro da própria org.
ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members full" ON public.labels
  FOR ALL USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));

-- contact_labels: membership derivada da org do contato (contato e etiqueta
-- vivem na mesma org — checar uma das pontas basta).
ALTER TABLE public.contact_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members full" ON public.contact_labels
  FOR ALL USING (public.is_member_of((SELECT organization_id FROM public.contacts WHERE id = contact_id)))
  WITH CHECK (public.is_member_of((SELECT organization_id FROM public.contacts WHERE id = contact_id)));

-- conversation_labels: membership derivada da org da conversa.
ALTER TABLE public.conversation_labels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members full" ON public.conversation_labels
  FOR ALL USING (public.is_member_of((SELECT organization_id FROM public.conversations WHERE id = conversation_id)))
  WITH CHECK (public.is_member_of((SELECT organization_id FROM public.conversations WHERE id = conversation_id)));

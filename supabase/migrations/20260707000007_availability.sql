-- =============================================================
-- Disponibilidade da agenda (estilo Google Agenda)
-- Blocos de horário livre, recorrentes por dia da semana OU em data específica.
-- Exceções: uma ocorrência da recorrência pode ser editada/cancelada só naquele
-- dia via uma linha "override" (parent_id aponta para a recorrência + data do dia).
-- =============================================================

CREATE TABLE public.availability (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  atendente_id     uuid        REFERENCES public.organization_members(id) ON DELETE CASCADE,
  tipo             text        NOT NULL CHECK (tipo IN ('semanal', 'data')),
  dia_semana       int,        -- 0=Dom .. 6=Sáb (tipo='semanal')
  data             date,       -- data específica (tipo='data' base OU override de recorrência)
  hora_inicio      text        NOT NULL,
  hora_fim         text        NOT NULL,
  parent_id        uuid        REFERENCES public.availability(id) ON DELETE CASCADE, -- override de uma recorrência
  cancelado        boolean     NOT NULL DEFAULT false,                               -- override que remove a ocorrência
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.availability(organization_id);
CREATE INDEX ON public.availability(parent_id);

ALTER TABLE public.availability ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members full" ON public.availability
  FOR ALL USING (public.is_member_of(organization_id))
  WITH CHECK (public.is_member_of(organization_id));

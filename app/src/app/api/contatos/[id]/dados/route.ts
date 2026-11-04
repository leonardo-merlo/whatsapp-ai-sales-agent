// Dados do paciente: exportar (GET) e apagar (DELETE). LGPD, S9.
//
// Só dono e admin. A organização é a ativa do usuário, conferida no banco; o
// id do contato vem da URL e só vale se for dessa organização.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { apagarPaciente, exportarPaciente, PALAVRA_DE_CONFIRMACAO } from '@/lib/lgpd/dados-do-paciente';

export const runtime = 'nodejs';

async function adminDaOrg() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erro: Response.json({ error: 'Não autenticado' }, { status: 401 }) } as const;
  const ativa = await orgDaRequisicao(supabase, user.id);
  if (!ativa || (ativa.role !== 'owner' && ativa.role !== 'admin')) {
    return { erro: Response.json({ error: 'Só o dono ou um administrador.' }, { status: 403 }) } as const;
  }
  return { supabase, orgId: ativa.organizationId } as const;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await adminDaOrg();
  if ('erro' in acesso) return acesso.erro;
  const { id } = await params;

  const dados = await exportarPaciente(acesso.supabase, acesso.orgId, id);
  if (!dados) return Response.json({ error: 'Contato não encontrado.' }, { status: 404 });

  const nome = String(dados.contato.nome ?? 'paciente').normalize('NFD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'paciente';
  return new Response(JSON.stringify(dados, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="dados-${nome}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await adminDaOrg();
  if ('erro' in acesso) return acesso.erro;
  const { id } = await params;

  let corpo: { confirmacao?: string };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (corpo.confirmacao?.trim().toUpperCase() !== PALAVRA_DE_CONFIRMACAO) {
    return Response.json({ error: `Digite ${PALAVRA_DE_CONFIRMACAO} para confirmar.` }, { status: 400 });
  }

  const resultado = await apagarPaciente(createServiceClient(), acesso.orgId, id);
  if (!resultado.apagado) {
    return Response.json({ error: resultado.motivo === 'nao-encontrado' ? 'Contato não encontrado.' : 'Não foi possível apagar.' },
      { status: resultado.motivo === 'nao-encontrado' ? 404 : 500 });
  }
  return Response.json({ ok: true });
}

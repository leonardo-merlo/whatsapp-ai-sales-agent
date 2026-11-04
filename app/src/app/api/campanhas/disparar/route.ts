// Disparar uma campanha: template aprovado para o público escolhido.
// A lógica mora em lib/campanhas/disparar.ts; aqui só a porta.
//
// Service client depois de conferir que quem pede é admin: o envio lê o token
// do cliente no Vault, e a escrita de campanha já era só de admin pela RLS.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { dispararCampanha, type PedidoDeDisparo, type ValorDaVariavel } from '@/lib/campanhas/disparar';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface Corpo {
  nome?: string;
  categoriaNome?: string | null;
  waNumberId?: string;
  templateId?: string;
  variaveis?: ValorDaVariavel[];
  filtros?: { bairro?: string | null; status?: string | null };
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode disparar campanhas.' }, { status: 403 });
  }

  let corpo: Corpo;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!corpo.nome?.trim() || !corpo.waNumberId || !corpo.templateId) {
    return Response.json({ error: 'Nome, número e template são obrigatórios.' }, { status: 400 });
  }

  const status = corpo.filtros?.status;
  const pedido: PedidoDeDisparo = {
    orgId: membro.organizationId,
    nome: corpo.nome.trim(),
    categoriaNome: corpo.categoriaNome ?? null,
    waNumberId: corpo.waNumberId,
    templateId: corpo.templateId,
    variaveis: corpo.variaveis ?? [],
    filtros: {
      bairro: corpo.filtros?.bairro || null,
      status: status === 'ativo' || status === 'inativo' ? status : null,
    },
  };

  const resultado = await dispararCampanha(createServiceClient(), pedido);
  if (!resultado.ok) return Response.json({ error: resultado.erro }, { status: 400 });
  return Response.json(resultado);
}

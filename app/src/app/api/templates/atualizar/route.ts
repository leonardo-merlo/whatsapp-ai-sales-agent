// Botão "Atualizar status" da tela de templates: traz da Meta o status e a
// categoria de cada template das contas da organização. Só lê, nunca cria.
//
// É a rede de segurança do webhook. Se um evento de status se perder, o
// catálogo continuaria dizendo "em análise" para sempre e nada sairia.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { tokenDeEnvio } from '@/lib/whatsapp/token-do-cliente';
import { sincronizarDaMeta } from '@/lib/whatsapp/catalogo-de-templates';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode atualizar os templates.' }, { status: 403 });
  }

  const service = createServiceClient();
  const { data: numeros } = await service
    .from('wa_numbers')
    .select('phone_number_id, waba_id')
    .eq('organization_id', membro.organizationId)
    .eq('ativo', true)
    .not('waba_id', 'is', null);

  // Um número por WABA basta para ter o token dela.
  const porWaba = new Map<string, string>();
  for (const n of numeros ?? []) if (n.waba_id && !porWaba.has(n.waba_id)) porWaba.set(n.waba_id, n.phone_number_id);
  if (!porWaba.size) return Response.json({ error: 'Nenhum número conectado.' }, { status: 400 });

  const falhas: string[] = [];
  for (const [wabaId, phoneNumberId] of porWaba) {
    try {
      await sincronizarDaMeta(service, { orgId: membro.organizationId, wabaId, token: await tokenDeEnvio(phoneNumberId) });
    } catch (e) {
      console.error(`Templates: falha ao atualizar a WABA ${wabaId}`, e);
      falhas.push(e instanceof Error ? e.message : String(e));
    }
  }
  return Response.json({ ok: true, falhas });
}

// Mandar para a Meta um template guardado como rascunho.
//
// Rascunho é texto que já está no catálogo mas nunca foi à Meta (status
// RASCUNHO, que é nosso, não dela). Existe para o cliente ter o texto pronto
// sem criar nada na conta dele até decidir.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { tokenDeEnvio } from '@/lib/whatsapp/token-do-cliente';
import {
  criarNaMeta, problemaNoTemplate, sincronizarDaMeta,
  type CategoriaDoTemplate, type VariavelDoTemplate,
} from '@/lib/whatsapp/catalogo-de-templates';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode criar templates.' }, { status: 403 });
  }

  let corpo: { id?: string };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const service = createServiceClient();
  const { data: linha } = await service
    .from('wa_templates').select('*')
    .eq('id', corpo.id ?? '').eq('organization_id', membro.organizationId).eq('status', 'RASCUNHO')
    .maybeSingle();
  if (!linha) return Response.json({ error: 'Rascunho não encontrado.' }, { status: 404 });

  const novo = {
    nome: linha.nome,
    categoria: linha.categoria as CategoriaDoTemplate,
    corpo: linha.corpo,
    variaveis: linha.variaveis as unknown as VariavelDoTemplate[],
    idioma: linha.idioma,
  };
  const problema = problemaNoTemplate(novo);
  if (problema) return Response.json({ error: problema }, { status: 400 });

  const { data: numero } = await service
    .from('wa_numbers').select('phone_number_id')
    .eq('organization_id', membro.organizationId).eq('waba_id', linha.waba_id).eq('ativo', true)
    .limit(1).maybeSingle();
  if (!numero) return Response.json({ error: 'Nenhum número conectado nesta conta do WhatsApp.' }, { status: 400 });

  try {
    const token = await tokenDeEnvio(numero.phone_number_id);
    const criado = await criarNaMeta(linha.waba_id, token, novo);
    if (criado.jaExistia) {
      // Alguém criou com o mesmo nome direto na Meta: a sincronização acha a
      // linha pelo nome e troca o status do rascunho pelo que está lá.
      await sincronizarDaMeta(service, { orgId: membro.organizationId, wabaId: linha.waba_id, token });
    } else {
      await service.from('wa_templates').update({
        status: criado.status,
        meta_template_id: criado.id,
        categoria: criado.categoria ?? linha.categoria,
        updated_at: new Date().toISOString(),
      }).eq('id', linha.id);
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: `A Meta recusou: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

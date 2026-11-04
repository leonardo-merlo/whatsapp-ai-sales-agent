// Mandar um modelo pronto da Wappia para aprovação na conta do cliente.
//
// Só acontece quando o cliente aperta o botão: ninguém recebe template na
// conta sem pedir. Os avisos ao vendedor só são aceitos na conta que tem
// número copiloto — numa clínica eles seriam um template que nunca sai.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { tokenDeEnvio } from '@/lib/whatsapp/token-do-cliente';
import { TEMPLATES_PADRAO } from '@/lib/whatsapp/templates';
import { criarTemplatePadrao, wabaTemCopiloto } from '@/lib/whatsapp/catalogo-de-templates';

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

  let corpo: { nome?: string; waNumberId?: string };
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const padrao = TEMPLATES_PADRAO.find(t => t.nome === corpo.nome);
  if (!padrao) return Response.json({ error: 'Modelo pronto não encontrado.' }, { status: 400 });

  const service = createServiceClient();
  const { data: numero } = await service
    .from('wa_numbers')
    .select('phone_number_id, waba_id')
    .eq('id', corpo.waNumberId ?? '')
    .eq('organization_id', membro.organizationId)
    .maybeSingle();
  if (!numero?.waba_id) {
    return Response.json({ error: 'Número sem conta do WhatsApp registrada. Refaça a conexão do número.' }, { status: 400 });
  }
  // Modelo de outro produto não entra: a Distribuidora Exemplo nunca recebe modelo de
  // clínica, e a clínica nunca recebe aviso ao vendedor.
  if (!membro.produtos.includes(padrao.produto)) {
    return Response.json({ error: 'Este modelo é de outro produto.' }, { status: 400 });
  }
  if (padrao.produto === 'vendas' &&!(await wabaTemCopiloto(service, membro.organizationId, numero.waba_id))) {
    return Response.json({ error: 'Este modelo é para número copiloto.' }, { status: 400 });
  }

  try {
    const template = await criarTemplatePadrao(service, {
      orgId: membro.organizationId, wabaId: numero.waba_id, token: await tokenDeEnvio(numero.phone_number_id), nome: padrao.nome,
    });
    return Response.json({ ok: true, template });
  } catch (e) {
    return Response.json({ error: `A Meta recusou: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}

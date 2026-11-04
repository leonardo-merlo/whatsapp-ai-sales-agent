// Criar um template do cliente na WABA dele.
//
// Rota, e não escrita direta da tela, porque criar na Meta exige o business
// token do cliente, que mora no Vault e só a service_role lê. O servidor
// confere que quem pede é admin da organização ativa e que o número escolhido
// é dela; só então fala com a Meta.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { tokenDeEnvio } from '@/lib/whatsapp/token-do-cliente';
import type { Json } from '@/lib/supabase/database.types';
import {
  criarNaMeta, problemaNoTemplate, slugDoNome,
  type CategoriaDoTemplate, type NovoTemplate, type VariavelDoTemplate,
} from '@/lib/whatsapp/catalogo-de-templates';

export const runtime = 'nodejs';

interface Corpo {
  nomeAmigavel?: string;
  categoria?: string;
  corpo?: string;
  exemplos?: string[];
  /** Número cuja WABA recebe o template. Na coexistência cada vendedor tem a
   *  sua, então "a WABA da empresa" não existe. */
  waNumberId?: string;
}

const CATEGORIAS: CategoriaDoTemplate[] = ['UTILITY', 'MARKETING'];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode criar templates.' }, { status: 403 });
  }

  let corpo: Corpo;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const categoria = corpo.categoria as CategoriaDoTemplate;
  if (!CATEGORIAS.includes(categoria)) return Response.json({ error: 'Escolha a categoria.' }, { status: 400 });

  const variaveis: VariavelDoTemplate[] = (corpo.exemplos ?? []).map((exemplo, i) => ({
    nome: `variavel_${i + 1}`, exemplo: String(exemplo ?? ''),
  }));
  const novo: NovoTemplate = {
    nome: slugDoNome(corpo.nomeAmigavel ?? ''),
    categoria,
    corpo: (corpo.corpo ?? '').trim(),
    variaveis,
  };
  const problema = problemaNoTemplate(novo);
  if (problema) return Response.json({ error: problema }, { status: 400 });

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

  const { data: repetido } = await service
    .from('wa_templates')
    .select('id')
    .eq('organization_id', membro.organizationId)
    .eq('waba_id', numero.waba_id)
    .eq('nome', novo.nome)
    .maybeSingle();
  if (repetido) return Response.json({ error: 'Já existe um template com esse nome.' }, { status: 409 });

  let criado: Awaited<ReturnType<typeof criarNaMeta>>;
  try {
    criado = await criarNaMeta(numero.waba_id, await tokenDeEnvio(numero.phone_number_id), novo);
  } catch (e) {
    // A Meta explica o que recusou (formato, palavra proibida). O texto dela
    // vai para a tela como veio.
    return Response.json({ error: `A Meta recusou: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
  if (criado.jaExistia) {
    return Response.json({ error: 'Já existe um template com esse nome na Meta. Use Atualizar para trazê-lo.' }, { status: 409 });
  }

  const { data: linha, error } = await service.from('wa_templates').insert({
    organization_id: membro.organizationId,
    waba_id: numero.waba_id,
    nome: novo.nome,
    categoria: criado.categoria ?? novo.categoria,
    corpo: novo.corpo,
    variaveis: novo.variaveis as unknown as Json,
    meta_template_id: criado.id,
    status: criado.status,
    origem: 'cliente',
  }).select('*').single();
  if (error) {
    console.error('Templates: criado na Meta mas não gravado no catálogo', error.message);
    return Response.json({ error: 'Criado na Meta, mas não salvou aqui. Use Atualizar.' }, { status: 500 });
  }
  return Response.json({ ok: true, template: linha });
}

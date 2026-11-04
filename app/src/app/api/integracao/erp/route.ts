// Cadastrar o sistema de gestão do cliente: endereço e chave.
//
// **Por que isto é uma rota, e não uma escrita direta da tela.** A chave vai
// para o Vault, e a função que guarda lá é `SECURITY DEFINER` com EXECUTE só
// para `service_role` — de propósito, porque com EXECUTE para `authenticated`
// qualquer usuário logado leria a chave do ERP pela API pública. Então a tela
// manda a chave para cá, o servidor confere que quem pede é **admin da
// organização ativa**, e só então usa o client de serviço.
//
// A chave nunca volta para o navegador. A tela mostra "configurada" ou "não
// configurada", e para trocar é preciso digitar de novo — que é o mesmo
// comportamento de todo campo de senha decente.

import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { membroAtivo } from '@/lib/data/org-ativa';
import { caminhoValido, caminhosParaGravar, OPERACOES, type OperacaoDoErp } from '@/lib/erp/caminhos';

export const runtime = 'nodejs';

interface Corpo {
  enderecoBase?: string;
  /** Opcional: mandar vazio mantém a chave que já está guardada. */
  token?: string;
  ativo?: boolean;
  /** Aceitar `http://` neste endereço. Escolha explícita do administrador, para
   *  o ambiente de teste de um cliente que ainda não subiu HTTPS. */
  permiteHttp?: boolean;
  /** Onde mora cada operação no sistema deste cliente. Campo em branco, ou
   *  ausente, quer dizer "o padrão" — e é o que todo mundo tem hoje. */
  caminhos?: Partial<Record<OperacaoDoErp, string>>;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode configurar a integração.' }, { status: 403 });
  }

  let corpo: Corpo;
  try {
    corpo = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const enderecoBase = (corpo.enderecoBase ?? '').trim().replace(/\/+$/, '');
  if (!enderecoBase) {
    return Response.json({ error: 'Informe o endereço da API.' }, { status: 400 });
  }
  // Endereço sem https é erro de digitação na maioria das vezes, e com chave de
  // API no cabeçalho não é um erro barato de deixar passar: a chave e os
  // CPF/CNPJ dos clientes viajariam em texto puro.
  //
  // A exceção é combinada, nunca adivinhada. O administrador marca "ambiente de
  // homologação" na tela, e aí sabe o que está aceitando — que é diferente de a
  // regra simplesmente não existir. Homologação de cliente que ainda não subiu
  // HTTPS é o caso real que existe hoje (Distribuidora Exemplo, 09/2026).
  const ehHttps = /^https:\/\//i.test(enderecoBase);
  const ehLocal = /^http:\/\/localhost/i.test(enderecoBase);
  const permiteHttp = corpo.permiteHttp === true;
  if (!ehHttps && !ehLocal && !permiteHttp) {
    return Response.json({
      error: 'O endereço precisa começar com https://. Se for um ambiente de teste sem HTTPS, '
        + 'marque "ambiente de homologação" abaixo.',
    }, { status: 400 });
  }

  // Um caminho que não começa com `/`, ou que carrega host, mandaria a chave de
  // API do cliente para um servidor que não é o dele. Recusar aqui é o que
  // impede um erro de digitação virar vazamento.
  const caminhosPedidos = corpo.caminhos ?? {};
  for (const operacao of OPERACOES) {
    const valor = (caminhosPedidos[operacao] ?? '').trim();
    if (valor && !caminhoValido(valor)) {
      return Response.json({
        error: `O caminho de "${operacao}" precisa começar com uma barra e ser só o caminho, `
          + 'sem endereço de servidor e sem espaços. Exemplo: /clientes/novo',
      }, { status: 400 });
    }
  }

  const service = createServiceClient();

  // A config é **mesclada**, nunca substituída: ela guarda coisas escritas em
  // momentos diferentes (o `permite_http` vem da caixinha, os caminhos vêm dos
  // quatro campos), e gravar o objeto inteiro faria salvar o endereço apagar os
  // caminhos sem ninguém perceber.
  const { data: atual } = await service
    .from('organization_integrations')
    .select('config')
    .eq('organization_id', membro.organizationId).eq('tipo', 'erp')
    .maybeSingle();

  const configAnterior = (atual?.config ?? {}) as Record<string, unknown>;
  const caminhos = caminhosParaGravar(caminhosPedidos);

  const { data: integracao, error: erroUpsert } = await service
    .from('organization_integrations')
    .upsert({
      organization_id: membro.organizationId,
      tipo: 'erp',
      endereco_base: enderecoBase,
      ativo: corpo.ativo ?? true,
      config: {
        ...configAnterior,
        // Sempre falso quando o endereço já é seguro: assim a caixinha não fica
        // marcada e esquecida no dia em que o cliente subir o HTTPS.
        permite_http: !ehHttps && !ehLocal && permiteHttp,
        // Só o que foge do padrão é gravado — config vazia continua querendo
        // dizer "como sempre foi".
        caminhos,
      },
    }, { onConflict: 'organization_id,tipo' })
    .select('id, token_secret_id')
    .maybeSingle();

  if (erroUpsert || !integracao) {
    console.error('Erro ao gravar a integração do ERP:', erroUpsert?.message);
    return Response.json({ error: 'Não foi possível salvar a integração.' }, { status: 500 });
  }

  const token = (corpo.token ?? '').trim();
  if (token) {
    const { error: erroToken } = await service.rpc('guardar_credencial_da_integracao', {
      p_integration_id: integracao.id,
      p_token: token,
    });
    if (erroToken) {
      console.error('Erro ao guardar a chave do ERP no Vault:', erroToken.message);
      // O endereço ficou salvo; a chave não. Dizer isso é o que evita a tela
      // mostrar "configurado" com a integração pela metade.
      return Response.json(
        { error: 'O endereço foi salvo, mas a chave não. Tente informar a chave de novo.' },
        { status: 500 },
      );
    }
  }

  return Response.json({
    ok: true,
    temCredencial: Boolean(token) || Boolean(integracao.token_secret_id),
  });
}

/**
 * Remove a integração — e o segredo dela no Vault, junto.
 *
 * **Por que DELETE é rota, e não um `delete()` da tela.** Apagar a linha de
 * `organization_integrations` direto deixa o segredo **órfão no Vault**: uma
 * chave de API guardada sem dono, que ninguém encontra e ninguém apaga. Foi o
 * que o primeiro teste real do fluxo deixou para trás em 14/09, e teve que ser
 * limpo à mão. O schema `vault` não é alcançável nem de uma policy nem do
 * PostgREST, então quem apaga os dois na ordem certa é a função
 * `apagar_integracao` (migration `20260914000004`), que só o `service_role`
 * executa.
 */
export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (membro.role !== 'owner' && membro.role !== 'admin') {
    return Response.json({ error: 'Só o dono ou um administrador pode remover a integração.' }, { status: 403 });
  }

  const service = createServiceClient();
  const { data: integracao } = await service
    .from('organization_integrations')
    .select('id')
    .eq('organization_id', membro.organizationId).eq('tipo', 'erp')
    .maybeSingle();

  if (!integracao) return Response.json({ ok: true, removida: false });

  const { data: removida, error } = await service.rpc('apagar_integracao', {
    p_integration_id: integracao.id,
  });
  if (error) {
    console.error('Erro ao remover a integração do ERP:', error.message);
    return Response.json({ error: 'Não foi possível remover a integração.' }, { status: 500 });
  }

  return Response.json({ ok: true, removida: Boolean(removida) });
}

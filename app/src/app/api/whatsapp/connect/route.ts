// Conclui o Embedded Signup (Tech Provider): recebe o code + IDs que o cadastro
// incorporado do cliente devolve, troca o code por um token de negócio, assina este
// app na WABA do cliente, registra o número na Cloud API (best-effort), grava
// waba_id + wa_phone_number_id na organização e guarda o business token do
// cliente no Vault.
// O envio passa a usar o token do próprio cliente quando ele existe, e o
// WHATSAPP_ACCESS_TOKEN (Usuário do Sistema da Wappia) quando não — ver
// lib/whatsapp/token-do-cliente.ts.
// Autenticado pela sessão; a escrita na org usa o service client após confirmar o vínculo.

import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { createServiceClient } from '@/lib/supabase/service';
import { guardarTokenDoCliente } from '@/lib/whatsapp/token-do-cliente';

export const runtime = 'nodejs';

const GRAPH = 'https://graph.facebook.com/v22.0';

/**
 * O que dizer quando o registro na Cloud API falha. A mensagem é para o dono
 * da conta, não para quem programa: cada uma tem uma saída que ele mesmo
 * executa. Códigos conferidos na documentação de erros da Meta em 2026-09-24.
 *
 * O 133005 não é caso raro: todo número que já rodava no WhatsApp Business com
 * verificação em duas etapas ligada cai aqui, e sem esta mensagem o dono não
 * tem como adivinhar que o problema está no celular dele.
 */
function recadoDoRegistro(codigo: number | undefined): string | null {
  switch (codigo) {
    case 133005:
      return 'Este número já tem verificação em duas etapas ligada com outro PIN. '
        + 'No celular, abra o WhatsApp Business e vá em Configurações, Conta, Verificação em duas etapas, '
        + 'desligue, e refaça a conexão aqui. '
        + 'Ela volta a ficar ligada sozinha quando a conexão terminar.';
    case 133008:
    case 133009:
      return 'A Meta bloqueou as tentativas de PIN deste número por um tempo. Espere alguns minutos e refaça a conexão.';
    case 133015:
      return 'Este número foi apagado da Meta há pouco e a exclusão ainda não terminou. Espere 5 minutos e refaça a conexão.';
    case 133016:
      return 'Este número passou de 10 tentativas de registro em 72 horas. A Meta só libera depois desse prazo.';
    case 133006:
      return 'A Meta ainda não confirmou a posse deste número. Refaça o cadastro e conclua a verificação por SMS.';
    default:
      return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return Response.json({ error: 'Organização não encontrada' }, { status: 403 });

  let body: { code?: string; wabaId?: string; phoneNumberId?: string; coexistencia?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  const { code, wabaId, coexistencia = false } = body;
  // Na coexistência o evento de conclusão da Meta traz só o `waba_id` — o
  // número é descoberto abaixo, com o token do cliente em mãos.
  if (!code || !wabaId || (!body.phoneNumberId && !coexistencia)) {
    return Response.json({ error: 'Dados de conexão incompletos' }, { status: 400 });
  }

  // Escreve na org e na tabela de números depois de confirmado o vínculo do
  // usuário; também é por ele que a busca do número da WABA sai, mais abaixo.
  const service = createServiceClient();
  /** Telefone como a Meta mostra, quando é ela quem nos diz qual é o número. */
  let telefoneDaMeta: string | null = null;

  const appId = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appId || !appSecret) {
    console.error('Embedded Signup: NEXT_PUBLIC_WHATSAPP_APP_ID ou WHATSAPP_APP_SECRET ausente.');
    return Response.json({ error: 'Integração não configurada no servidor.' }, { status: 500 });
  }

  // 1) Troca o code do cadastro por um token de acesso de negócio.
  const tokenResp = await fetch(
    `${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`,
  );
  const tokenJson: { access_token?: string; error?: { message?: string } } = await tokenResp
    .json()
    .catch(() => ({}));
  const businessToken = tokenJson.access_token;
  if (!tokenResp.ok || !businessToken) {
    console.error('Embedded Signup: falha ao trocar code por token', tokenJson.error?.message);
    return Response.json({ error: 'Não foi possível concluir a conexão com a Meta.' }, { status: 502 });
  }

  // 2) Assina este app na WABA do cliente (para receber os webhooks das mensagens).
  const subResp = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${businessToken}` },
  });
  if (!subResp.ok) {
    const err: { error?: { message?: string } } = await subResp.json().catch(() => ({}));
    console.error('Embedded Signup: falha ao assinar app na WABA', err.error?.message);
    return Response.json({ error: 'Não foi possível assinar o webhook na conta do cliente.' }, { status: 502 });
  }

  // 2b) Coexistência sem número no payload: pergunta à WABA do cliente quais
  // números ela tem. Com mais de um, fica o que ainda não está cadastrado aqui
  // — dois candidatos é ambiguidade, e escolher no chute cadastraria o número
  // errado do vendedor errado.
  let phoneNumberId = body.phoneNumberId ?? null;
  if (!phoneNumberId) {
    const numerosResp = await fetch(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number`, {
      headers: { Authorization: `Bearer ${businessToken}` },
    });
    const numerosJson: { data?: { id?: string; display_phone_number?: string }[] } = await numerosResp
      .json()
      .catch(() => ({}));
    const daWaba = (numerosJson.data ?? []).filter(n => n.id);
    const { data: jaCadastrados } = await service
      .from('wa_numbers')
      .select('phone_number_id')
      .in('phone_number_id', daWaba.map(n => n.id as string));
    const conhecidos = new Set((jaCadastrados ?? []).map(n => n.phone_number_id));
    const novos = daWaba.filter(n => !conhecidos.has(n.id as string));
    const escolhido = daWaba.length === 1 ? daWaba[0] : novos.length === 1 ? novos[0] : null;
    if (!escolhido?.id) {
      console.error('Embedded Signup: não deu para decidir o número da WABA', {
        naWaba: daWaba.length, novos: novos.length,
      });
      return Response.json(
        { error: 'Conexão feita na Meta, mas não identificamos o número. Recarregue e refaça a conexão.' },
        { status: 502 },
      );
    }
    phoneNumberId = escolhido.id;
    telefoneDaMeta = escolhido.display_phone_number ?? null;
  }

  // 3) Registra o número na Cloud API. Sem isto o número fica **verificado mas
  // inexistente no WhatsApp**: quem tenta falar com ele vê "convidar para o
  // WhatsApp". Foi o que aconteceu em 24/09 — o PIN não estava configurado, o
  // passo foi pulado em silêncio e o número ficou em `PENDING`.
  // **Na coexistência isso é pulado**: o número já está registrado, e é o
  // registro que tiraria o WhatsApp do celular do vendedor.
  const pin = process.env.WHATSAPP_REG_PIN;
  /** Explicação do que travou o registro, quando dá para saber. */
  let avisoRegistro: string | null = null;
  if (!coexistencia) {
    if (!pin) {
      // Configuração do servidor: quem lê a tela não tem o que fazer com o
      // nome da variável, então o recado dela fica no log.
      console.error('Embedded Signup: WHATSAPP_REG_PIN ausente — o número não foi registrado na Cloud API.');
      avisoRegistro = 'Não conseguimos registrar este número na Cloud API. Fale com o suporte da Wappia.';
    } else {
      const regResp = await fetch(`${GRAPH}/${phoneNumberId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${businessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      });
      if (!regResp.ok) {
        const err: { error?: { code?: number; message?: string } } = await regResp.json().catch(() => ({}));
        // Não é fatal aqui: pode ser número já registrado. Quem decide é o
        // status lido logo abaixo, não o resultado desta chamada.
        console.warn('Embedded Signup: registro do número não concluído', err.error?.code, err.error?.message);
        avisoRegistro = recadoDoRegistro(err.error?.code);
      }
    }
  }

  // 3b) Como o número ficou na Meta, em uma consulta só: o telefone de
  // exibição (o texto digitado à mão no cadastro não muda numa reconexão e
  // ficava mostrando o número antigo) e o status, que é o que diz se ele
  // recebe mensagem de verdade.
  let statusDaMeta: string | null = null;
  {
    const numResp = await fetch(`${GRAPH}/${phoneNumberId}?fields=display_phone_number,status`, {
      headers: { Authorization: `Bearer ${businessToken}` },
    });
    const numJson: { display_phone_number?: string; status?: string } = await numResp.json().catch(() => ({}));
    telefoneDaMeta ??= numJson.display_phone_number ?? null;
    statusDaMeta = numJson.status ?? null;
  }
  const registrado = coexistencia || statusDaMeta === 'CONNECTED';

  // 4) Grava os IDs na organização — a partir daqui o envio já funciona.
  const { data: org, error: updErr } = await service
    .from('organizations')
    .update({ waba_id: wabaId, wa_phone_number_id: phoneNumberId })
    .eq('id', member.organizationId)
    .select('wa_number')
    .single();
  if (updErr) {
    console.error('Embedded Signup: falha ao gravar IDs na org', updErr.message);
    return Response.json(
      { error: 'Conexão feita na Meta, mas não salvou no sistema. Tente novamente.' },
      { status: 500 },
    );
  }

  // A coluna acima continua sendo escrita (é a reserva do webhook), mas a tabela
  // de números é a fonte a partir de agora. Sem este upsert, um cliente que
  // conectasse hoje não apareceria nela e a conversa dele nasceria sem número.
  const { error: numeroErr } = await service
    .from('wa_numbers')
    .upsert(
      {
        organization_id: member.organizationId,
        phone_number_id: phoneNumberId,
        // A WABA é do número, não da empresa: na coexistência cada vendedor
        // entra com a dele (a WABA criada por esse fluxo é 1:1 com o número).
        // A coluna da organização guarda só a última conectada, que com dois
        // números já é a resposta errada para o primeiro.
        waba_id: wabaId,
        telefone: telefoneDaMeta ?? org?.wa_number ?? null,
        // No Wappia Vendas, coexistência é o número do vendedor (de qual
        // vendedor se diz na tela do item C4). No Atendimento é a recepção
        // que mantém o app no celular: continua sendo atendimento (29/09).
        papel: coexistencia && member.produtoAtivo === 'vendas' ? 'vendedor' : 'atendimento',
        coexistencia,
        ativo: true,
      },
      { onConflict: 'phone_number_id' },
    );
  if (numeroErr) {
    console.error('Embedded Signup: falha ao gravar o número em wa_numbers', numeroErr.message);
  }

  // 5) Guarda o business token do cliente no Vault. **Este token só vem agora**:
  // se for descartado, a única forma de tê-lo de novo é o cliente refazer a
  // conexão. Depois do upsert acima, porque a função exige o número cadastrado.
  let tokenGuardado = false;
  try {
    await guardarTokenDoCliente(phoneNumberId, businessToken);
    tokenGuardado = true;
  } catch (e) {
    // Não derruba a conexão, que está feita do lado da Meta: o envio continua
    // saindo pelo token da Wappia, como antes deste item. O aviso diz que é
    // preciso refazer a conexão para o número passar a enviar pelo token dele.
    console.error('Embedded Signup: falha ao guardar o token do cliente no Vault', e);
  }

  return Response.json({
    ok: true, wabaId, phoneNumberId, tokenGuardado,
    // `avisoRegistro` só vale quando o número de fato não ficou registrado: a
    // chamada pode ter falhado por já estar registrado antes.
    registrado, status: statusDaMeta, avisoRegistro: registrado ? null : avisoRegistro,
  });
}

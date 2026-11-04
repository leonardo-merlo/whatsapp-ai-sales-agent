// Intercepta `globalThis.fetch` para as duas APIs externas que o motor toca:
// a Messages API da Anthropic e a Graph API da Meta. Substituir no limite HTTP,
// e não trocar o SDK por um dublê, é o que garante que o teste exercita o
// código de verdade — inclusive a montagem do corpo da requisição, que é
// justamente o que o teste do formato do structured output precisa inspecionar.

export interface ChamadaHttp {
  url: string;
  metodo: string;
  corpo: unknown;
}

export interface RespostaAnthropic {
  /** O objeto que a IA devolve dentro do bloco de texto (o structured output). */
  json?: unknown;
  /** Texto cru no bloco de texto, para as chamadas que não usam structured
   *  output (a descrição de imagem). Quando presente, `json` é ignorado. */
  texto?: string;
  /** O modelo pedindo ferramenta. Quando presente, a resposta sai com blocos
   *  `tool_use` e `stop_reason: 'tool_use'` — e nenhum texto, que é como a API
   *  de verdade responde (conferido em 2026-09-13). */
  ferramentas?: { nome: string; entrada: Record<string, unknown> }[];
  stopReason?: string;
  /**
   * Esta chamada FALHA com este status HTTP, em vez de responder.
   *
   * Existe por causa dos 500 da Anthropic medidos em 20/09: com formulário e
   * ferramentas no mesmo pedido, um terço das requisições estoura. O motor
   * passou a ter um caminho de resgate para isso, e caminho de resgate que
   * nunca foi exercitado é caminho que não existe.
   *
   * O corpo é o mesmo que a API de verdade devolve, conferido no log de
   * produção: `{"type":"error","error":{"type":"api_error",...}}`.
   */
  status?: number;
}

/** A chamada é a fase 2 das duas fases (o serializador), e não uma volta da
 *  conversa? Os testes que leem "a última requisição" querem a da conversa. */
export function ehDoSerializador(chamada: ChamadaHttp | undefined): boolean {
  const system = (chamada?.corpo as { system?: unknown } | null)?.system;
  return typeof system === 'string' && system.startsWith('Você transforma uma conversa já encerrada');
}

/** O que a Graph API devolve para uma mídia recebida. `falhar` simula a mídia
 *  que não baixa (expirada, apagada). */
export interface MidiaFalsa {
  mimeType: string;
  bytes?: number;
  falhar?: boolean;
}

export interface HttpFalso {
  chamadas: ChamadaHttp[];
  /** Só as chamadas à Messages API, na ordem. */
  chamadasAnthropic: ChamadaHttp[];
  /** Só as chamadas de envio da Graph API (mensagem de WhatsApp), na ordem. */
  chamadasWhatsApp: ChamadaHttp[];
  /** Consultas e downloads de mídia recebida. */
  chamadasMidia: ChamadaHttp[];
  /** Chamadas ao Whisper. O corpo são os campos do formulário, com o arquivo
   *  trocado por `{ nome, tipo, bytes }`. */
  chamadasTranscricao: ChamadaHttp[];
  /** Chamadas do Embedded Signup (troca do code, assinatura da WABA, registro). */
  chamadasOnboarding: ChamadaHttp[];
  /** Criação e listagem de templates na WABA. */
  chamadasTemplates: ChamadaHttp[];
  /** O que o GET de templates da WABA devolve; o teste enche. */
  templatesNaMeta: unknown[];
  /** Business token que a troca do code devolve, para o teste conferir o que foi guardado. */
  tokenDoEmbeddedSignup: string;
  restaurar: () => void;
}

/** O que a Meta devolve na troca do code do Embedded Signup. */
const TOKEN_DO_EMBEDDED_SIGNUP = 'BUSINESS-TOKEN-DO-CLIENTE';

const RESPOSTA_PADRAO = {
  resposta: 'Oi! Claro, posso ajudar com isso.',
  transferir_para_atendente: false,
  questionario_completo: false,
  respostas: [],
  resultado: 'nenhum',
  itens_vendidos: [],
  agendamento_data: '',
  agendamento_hora: '',
  agendamento_servico: '',
  agendamento_remarcacao: false,
  atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
};

/** Instala o interceptador. `respostas` é a fila de respostas da Anthropic: a
 *  primeira chamada consome a primeira, e assim por diante; esgotada a fila,
 *  vale a resposta padrão (uma resposta neutra, sem desfecho). `midias` são as
 *  mídias recebidas que a Graph API conhece, pelo id. `transcricoes` é a fila
 *  do que o Whisper "ouve"; `null` simula a transcrição falhando. */
export function instalarHttpFalso(
  respostas: RespostaAnthropic[] = [],
  midias: Record<string, MidiaFalsa> = {},
  transcricoes: (string | null)[] = [],
): HttpFalso {
  const original = globalThis.fetch;
  const chamadas: ChamadaHttp[] = [];
  const chamadasAnthropic: ChamadaHttp[] = [];
  const chamadasWhatsApp: ChamadaHttp[] = [];
  const chamadasMidia: ChamadaHttp[] = [];
  const chamadasTranscricao: ChamadaHttp[] = [];
  const chamadasOnboarding: ChamadaHttp[] = [];
  const chamadasTemplates: ChamadaHttp[] = [];
  const templatesNaMeta: unknown[] = [];
  const fila = [...respostas];
  const filaTranscricao = [...transcricoes];

  const jsonResponse = (corpo: unknown, status = 200) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const metodo = init?.method ?? 'GET';
    let corpo: unknown = null;
    if (typeof init?.body === 'string') {
      try { corpo = JSON.parse(init.body); } catch { corpo = init.body; }
    }
    const chamada: ChamadaHttp = { url, metodo, corpo };
    chamadas.push(chamada);

    if (url.includes('api.anthropic.com')) {
      chamadasAnthropic.push(chamada);

      // **A fase 2 das duas fases (o serializador) responde sozinha, sem gastar
      // a fila.** A fila é o roteiro da CONVERSA — o que o modelo pede e
      // escreve a cada volta. O serializador não conversa: só copia a mensagem
      // que a fase 1 escreveu e extrai a ficha. Se ele consumisse a fila, cada
      // resposta de vendas deslocaria o roteiro inteiro dos testes de conversa
      // longa em uma posição. Aqui ele faz o que o modelo de verdade faz na
      // bancada (0 divergências em 30, 27/09): copia a mensagem ao pé da letra,
      // com a ficha vazia. Quem quiser testar a divergência ou a falha dele usa
      // `serializar-resposta.test.ts`, que exercita a conferência direto.
      const pedido = corpo as { messages?: { content?: unknown }[] } | null;
      if (ehDoSerializador(chamada)) {
        const conteudo = String(pedido?.messages?.[0]?.content ?? '');
        const marca = 'MENSAGEM DO ATENDENTE (copie exatamente em mensagem_cliente_verbatim):\n';
        const copia = conteudo.includes(marca) ? conteudo.slice(conteudo.indexOf(marca) + marca.length) : '';
        return jsonResponse({
          id: `msg_${chamadasAnthropic.length}`, type: 'message', role: 'assistant', model: 'claude-haiku-4-5',
          content: [{ type: 'text', text: JSON.stringify({
            mensagem_cliente_verbatim: copia,
            atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
          }) }],
          stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 100, output_tokens: 50 },
        });
      }

      const proxima = fila.shift();
      // Com `tool_choice: none` a API de verdade NÃO devolve `tool_use`. O
      // dublê respeita isso: senão o teto de voltas passaria no teste sem
      // nunca ter parado o laço de verdade.
      // A chamada que o roteiro do teste mandou falhar. Sai antes de qualquer
      // outra decisão: a API que estoura não chega a olhar tools nem formato.
      if (proxima?.status && proxima.status >= 400) {
        return jsonResponse(
          { type: 'error', error: { type: proxima.status >= 500 ? 'api_error' : 'invalid_request_error', message: 'Internal server error' } },
          proxima.status,
        );
      }

      const proibidoUsarFerramenta =
        (corpo as { tool_choice?: { type?: string } } | null)?.tool_choice?.type === 'none';

      // E com `tool_choice: {type:'tool'}` ela é OBRIGADA a devolver aquela
      // ferramenta — nunca texto. Sem espelhar isso aqui, um teste da chamada
      // forçada passaria só porque o roteiro do dublê mandava a ferramenta de
      // qualquer jeito, e não porque o motor obrigou.
      const escolha = (corpo as { tool_choice?: { type?: string; name?: string } } | null)?.tool_choice;
      if (escolha?.type === 'tool') {
        const pedida = proxima?.ferramentas?.[0]?.nome;
        if (pedida !== escolha.name) {
          throw new Error(
            `tool_choice obrigou "${escolha.name}", mas o roteiro do teste respondeu `
            + `"${pedida ?? 'texto'}". A API de verdade não faria isso.`,
          );
        }
      }

      const pedeFerramenta = !proibidoUsarFerramenta && (proxima?.ferramentas?.length ?? 0) > 0;
      const conteudo = pedeFerramenta
        ? proxima!.ferramentas!.map((f, i) => ({
            type: 'tool_use', id: `toolu_${chamadasAnthropic.length}_${i}`, name: f.nome, input: f.entrada,
          }))
        : [{ type: 'text', text: proxima?.texto ?? JSON.stringify(proxima?.json ?? RESPOSTA_PADRAO) }];
      return jsonResponse({
        id: `msg_${chamadasAnthropic.length}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: conteudo,
        stop_reason: proxima?.stopReason ?? (pedeFerramenta ? 'tool_use' : 'end_turn'),
        stop_sequence: null,
        usage: { input_tokens: 100, output_tokens: 50 },
      });
    }

    if (url.endsWith('/audio/transcriptions')) {
      const campos: Record<string, unknown> = {};
      if (init?.body instanceof FormData) {
        for (const [chave, valor] of init.body.entries()) {
          campos[chave] = typeof valor === 'string' ? valor : { nome: valor.name, tipo: valor.type, bytes: valor.size };
        }
      }
      chamadasTranscricao.push({ url, metodo, corpo: campos });
      const proxima = filaTranscricao.length ? filaTranscricao.shift() : 'texto transcrito';
      if (proxima === null || proxima === undefined) return jsonResponse({ error: { message: 'falha simulada' } }, 500);
      return jsonResponse({ text: proxima });
    }

    // Mídia recebida: primeiro o GET no id (devolve a URL temporária), depois o
    // GET na URL (devolve o arquivo).
    const idDaMidia = /graph\.facebook\.com\/v[\d.]+\/([^/?]+)$/.exec(url)?.[1];
    if (metodo === 'GET' && idDaMidia) {
      chamadasMidia.push(chamada);
      const midia = midias[idDaMidia];
      if (!midia) return jsonResponse({ error: { message: 'mídia não existe' } }, 404);
      return jsonResponse({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${idDaMidia}`, mime_type: midia.mimeType });
    }
    if (url.startsWith('https://lookaside.fbsbx.com/')) {
      chamadasMidia.push(chamada);
      const midia = midias[new URL(url).searchParams.get('mid') ?? ''];
      if (!midia || midia.falhar) return new Response('expirada', { status: 404 });
      return new Response(new Uint8Array(midia.bytes ?? 1024), { status: 200, headers: { 'content-type': midia.mimeType } });
    }

    // Embedded Signup: troca do code por business token, assinatura do app na
    // WABA do cliente e registro do número. Nenhuma das três é envio de
    // mensagem, e separá-las é o que deixa o teste do envio contar só envio.
    if (url.includes('/oauth/access_token')) {
      chamadasOnboarding.push(chamada);
      return jsonResponse({ access_token: TOKEN_DO_EMBEDDED_SIGNUP });
    }
    if (url.includes('/subscribed_apps') || url.endsWith('/register')) {
      chamadasOnboarding.push(chamada);
      return jsonResponse({ success: true });
    }

    // Catálogo de templates: criar e listar não são envio de mensagem.
    if (url.includes('/message_templates')) {
      chamadasTemplates.push(chamada);
      if (metodo === 'POST') {
        const pedido = corpo as { name?: string; category?: string } | null;
        return jsonResponse({ id: `TPL-${pedido?.name ?? 'sem_nome'}`, status: 'PENDING', category: pedido?.category });
      }
      return jsonResponse({ data: templatesNaMeta });
    }

    if (url.includes('graph.facebook.com')) {
      chamadasWhatsApp.push(chamada);
      return jsonResponse({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.enviado' }] });
    }

    throw new Error(`Teste tentou falar com a rede de verdade: ${metodo} ${url}`);
  }) as typeof fetch;

  return {
    chamadas,
    chamadasAnthropic,
    chamadasWhatsApp,
    chamadasMidia,
    chamadasTranscricao,
    chamadasOnboarding,
    chamadasTemplates,
    templatesNaMeta,
    tokenDoEmbeddedSignup: TOKEN_DO_EMBEDDED_SIGNUP,
    restaurar: () => { globalThis.fetch = original; },
  };
}

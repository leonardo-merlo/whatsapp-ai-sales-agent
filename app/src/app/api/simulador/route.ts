// Rota do simulador do agente: recebe o histórico da conversa de teste e o que
// está na tela, monta o system prompt a partir disso e transmite
// a resposta do Claude em streaming. A ANTHROPIC_API_KEY nunca sai do servidor.

import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { orgDaRequisicao } from '@/lib/data/org-ativa';
import { buildSystemPrompt } from '@/lib/simulador/build-prompt';
import { lerNumeroNaTela, lerRascunho } from '@/lib/simulador/rascunho';
import { rateLimit } from '@/lib/rate-limit';
import { logAiUsage, MODELO_IA } from '@/lib/agente/log-uso';
import { createServiceClient } from '@/lib/supabase/service';
import { abrirTurno, fecharTurno, gravarEntrada, novoRastreio, turnoIdGravado } from '@/lib/agente/rastreio/rastreio';

export const runtime = 'nodejs';

interface SimuladorMsg { role: 'user' | 'assistant'; content: string }

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response('Não autenticado', { status: 401 });

  // Controle de custo: no máximo 20 mensagens de teste por minuto por usuário.
  const rl = rateLimit(`sim:${user.id}`, 20, 60_000);
  if (!rl.ok) {
    return new Response('Muitas requisições — tente novamente em instantes.', {
      status: 429, headers: { 'Retry-After': String(rl.retryAfter) },
    });
  }

  // A organização ativa (o usuário pode estar em mais de uma) — ver
  // lib/data/org-ativa.ts.
  const member = await orgDaRequisicao(supabase, user.id);
  if (!member) return new Response('Organização não encontrada', { status: 403 });

  let body: { messages?: SimuladorMsg[]; rascunho?: unknown; numero?: unknown };
  try {
    body = await request.json();
  } catch {
    return new Response('JSON inválido', { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) return new Response('Nenhuma mensagem enviada', { status: 400 });

  // O que está na tela, salvo ou não, e o número escolhido no seletor. Sem
  // eles, vale o que está gravado no padrão da empresa. Um número de outra
  // empresa não acha linha nenhuma: a busca filtra pela organização.
  const numero = lerNumeroNaTela(body.numero);
  const { systemPrompt } = await buildSystemPrompt(supabase, member.organizationId, numero?.id ?? null, lerRascunho(body.rascunho), numero);

  const client = new Anthropic();

  const stream = client.messages.stream({
    model: MODELO_IA,
    max_tokens: 1024,
    system: systemPrompt,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  });

  const encoder = new TextEncoder();
  const body_ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
      } catch (err) {
        // Diagnóstico primeiro: se o cliente já saiu, o enqueue abaixo lança e
        // esconderia o erro real da Anthropic.
        console.error('Erro no streaming do simulador:', err);
        try { controller.enqueue(encoder.encode('\n[erro ao gerar resposta]')); } catch { /* cliente já saiu */ }
      } finally {
        try { controller.close(); } catch { /* já fechado pelo cancel do cliente */ }
      }
    },
  });

  after(async () => {
    // A ficha do teste (`agente_turnos`, origem `simulador`, decisão do
    // Leonardo em 27/09). A tabela não tem policy de escrita para sessão de
    // usuário — quem grava a ficha é sempre o servidor —, por isso o client
    // service_role, e SÓ para ela: a organização já veio da sessão autenticada
    // acima. Falhar aqui nunca afeta o teste do usuário.
    const rastreio = novoRastreio('simulador');
    let servico: ReturnType<typeof createServiceClient> | null = null;
    try {
      servico = createServiceClient();
      await abrirTurno(servico, rastreio, { orgId: member.organizationId, conversationId: null, modelo: MODELO_IA });
      rastreio.entrada = {
        mensagemId: null, roteiro: null, system: systemPrompt, mensagens: messages,
        falaDoCliente: [...messages].reverse().find(m => m.role === 'user')?.content ?? '',
      };
      await gravarEntrada(servico, rastreio);
    } catch (err) {
      console.error('Rastreio do simulador: não abriu a ficha:', err instanceof Error ? err.message : err);
    }
    try {
      const final = await stream.finalMessage();
      await logAiUsage(supabase, {
        orgId: member.organizationId,
        origem: 'simulador',
        model: MODELO_IA,
        usage: final.usage,
        turnoId: turnoIdGravado(rastreio),
      });
      if (servico) {
        const texto = final.content.map(b => (b.type === 'text' ? b.text : '')).join('');
        await fecharTurno(servico, rastreio, { status: 'respondeu', resposta: texto });
      }
    } catch (err) {
      /* uso do simulador é secundário */
      if (servico) await fecharTurno(servico, rastreio, { status: 'erro', erro: err instanceof Error ? err.message : String(err) });
    }
  });

  return new Response(body_, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

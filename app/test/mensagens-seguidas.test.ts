// Agrupamento de mensagens seguidas (dúvida 16 do progresso do bloco A).
//
// A IA não espera nada antes de responder. O que muda é só o caso em que o
// cliente escreve de novo ENQUANTO o modelo ainda está pensando: a resposta que
// estava sendo gerada já nasceu velha, então é descartada, e a tarefa da
// mensagem nova responde tudo de uma vez.
//
// Para simular "o cliente escreveu enquanto o modelo pensava", o teste embrulha
// o `fetch` falso: na hora em que a chamada à Anthropic sai, ele manda a
// mensagem seguinte pelo webhook.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, WA_NUMBER_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';

let banco: Banco;
let http: HttpFalso;
let tarefasPendentes: (() => Promise<void> | void)[] = [];
/** Roda uma vez, no instante em que a próxima chamada à Anthropic sai. */
let enquantoOModeloPensa: (() => Promise<void>) | null = null;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  process.env.WEBHOOK_FILA_ORGS = ORG_A;

  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
});

/** Rede falsa nova, com a fila de respostas do modelo que o teste quiser, e o
 *  gancho `enquantoOModeloPensa` por cima dela. */
function instalarRede(respostas: RespostaAnthropic[] = []) {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
  const fetchDoFalso = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.includes('api.anthropic.com') && enquantoOModeloPensa) {
      const acao = enquantoOModeloPensa;
      enquantoOModeloPensa = null;
      await acao();
    }
    return fetchDoFalso(entrada, init);
  }) as typeof fetch;
}

depois(() => {
  http.restaurar();
  delete process.env.WEBHOOK_FILA_ORGS;
});

beforeEach(() => { tarefasPendentes = []; enquantoOModeloPensa = null; instalarRede(); });

async function enviar(telefone: string, texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone, texto });
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

/** Roda a fila até esvaziar, inclusive o que for agendado no meio. */
async function rodarFila() {
  while (tarefasPendentes.length) {
    const tarefa = tarefasPendentes.shift()!;
    await tarefa();
  }
}

const contatoDe = (telefone: string) => banco.contacts.find(c => c.telefone === telefone);
const mensagensDe = (telefone: string) => {
  const conversa = banco.conversations.find(c => c.contact_id === contatoDe(telefone)?.id);
  return banco.messages.filter(m => m.conversation_id === conversa?.id);
};
const enviosPara = (telefone: string) =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { to?: string } | null)?.to === telefone);

describe('cliente que escreve enquanto a IA pensa', () => {
  test('a resposta velha é descartada, e sai uma resposta só para as duas mensagens', async () => {
    await enviar('5511900000081', 'Vocês fazem ensaio de família?');
    enquantoOModeloPensa = async () => { await enviar('5511900000081', 'E quanto custa?'); };

    await rodarFila();

    assert.deepEqual(mensagensDe('5511900000081').map(m => m.autor), ['cliente', 'cliente', 'ia']);
    assert.equal(enviosPara('5511900000081').length, 1, 'o cliente recebeu mais de uma resposta');
  });

  test('a resposta que responde as duas enxerga as duas', async () => {
    await enviar('5511900000082', 'Oi');
    enquantoOModeloPensa = async () => { await enviar('5511900000082', 'tem horário sábado?'); };
    await rodarFila();

    const ultimaChamada = http.chamadasAnthropic.at(-1)!.corpo as { messages: { role: string; content: string }[] };
    assert.deepEqual(ultimaChamada.messages.map(m => m.content), ['Oi', 'tem horário sábado?']);
  });

  test('a resposta descartada não grava nada na ficha do cliente', async () => {
    // A primeira resposta do modelo tenta gravar um interesse na ficha, e é ela
    // a descartada. A segunda (a padrão do http falso) não grava nada.
    instalarRede([{ json: {
      resposta: 'Temos sim, o ensaio custa R$ 790.', transferir_para_atendente: false, questionario_completo: false,
      respostas: [], resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
      agendamento_servico: '', agendamento_remarcacao: false,
      atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: 'ensaio de família', observacoes: '' },
    } }]);
    await enviar('5511900000083', 'Quero um ensaio');
    enquantoOModeloPensa = async () => { await enviar('5511900000083', 'na verdade, de casamento'); };
    await rodarFila();

    assert.equal(contatoDe('5511900000083')?.perfil ?? null, null, 'a resposta jogada fora deixou rastro na ficha');
  });
});

describe('sem mensagem nova, nada muda', () => {
  test('uma mensagem sozinha é respondida com uma chamada ao modelo, como antes', async () => {
    const chamadasAntes = http.chamadasAnthropic.length;
    await enviar('5511900000084', 'Bom dia');
    await rodarFila();

    assert.equal(http.chamadasAnthropic.length, chamadasAntes + 1);
    assert.deepEqual(mensagensDe('5511900000084').map(m => m.autor), ['cliente', 'ia']);
  });

  test('conversa que já foi respondida não chama o modelo de novo (e não toma o erro 400)', async () => {
    await enviar('5511900000085', 'primeira');
    await enviar('5511900000085', 'segunda');
    const chamadasAntes = http.chamadasAnthropic.length;

    await rodarFila();

    assert.equal(http.chamadasAnthropic.length, chamadasAntes + 1, 'a segunda tarefa chamou o modelo com a conversa terminando na IA');
  });
});

test('com mais de 40 mensagens no dia, a IA vê as mais recentes, não as primeiras', async () => {
  await enviar('5511900000086', 'mensagem 0');
  await rodarFila();
  const conversaId = mensagensDe('5511900000086')[0].conversation_id;
  // Antes da mensagem 0 e ainda "hoje": o histórico só pega o dia corrente.
  const base = Date.now() - 60 * 1000;
  for (let i = 1; i <= 50; i++) {
    banco.messages.push({
      id: randomUUID(), organization_id: ORG_A, conversation_id: conversaId, autor: i % 2 ? 'cliente' : 'ia',
      texto: `mensagem ${i}`, read: true, wamid: null, created_at: new Date(base + i * 1000).toISOString(),
    });
  }
  assert.ok(banco.conversations.find(c => c.id === conversaId)?.wa_number_id === WA_NUMBER_A);

  await enviar('5511900000086', 'a mais nova de todas');
  await rodarFila();

  const ultimaChamada = http.chamadasAnthropic.at(-1)!.corpo as { messages: { content: string }[] };
  assert.equal(ultimaChamada.messages.at(-1)?.content, 'a mais nova de todas');
});

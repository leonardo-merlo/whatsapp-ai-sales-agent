// A5: a foto e o áudio que o cliente manda viram texto antes de a IA responder,
// e o tipo da mensagem fica gravado.
//
// O caso que motivou o desenho é o mais comum no WhatsApp: a foto (ou o áudio)
// e, logo depois, "quanto custa isso?". A resposta tem que sair uma só, e já
// sabendo o que tinha na mídia — por isso o motor espera a leitura terminar.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A,
  payloadDeMensagem, requisicaoDoWebhook, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type MidiaFalsa, type RespostaAnthropic } from './apoio/http-falso.mts';

const DESCRICAO = 'Etiqueta de vergalhão CA-50 de 10 mm, com o preço R$ 45,90.';

let banco: Banco;
let http: HttpFalso | undefined;
let tarefasPendentes: (() => Promise<void> | void)[] = [];

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

depois(() => {
  http?.restaurar();
  delete process.env.WEBHOOK_FILA_ORGS;
});

beforeEach(() => {
  tarefasPendentes = [];
  process.env.TRANSCRICAO_API_KEY = 'chave-de-teste-da-transcricao';
  delete process.env.TRANSCRICAO_PROVEDOR;
});

function instalarRede(
  midias: Record<string, MidiaFalsa>,
  respostas: RespostaAnthropic[] = [{ texto: DESCRICAO }],
  transcricoes: (string | null)[] = [],
) {
  http?.restaurar();
  http = instalarHttpFalso(respostas, midias, transcricoes);
  return http;
}

/** Mensagem de qualquer tipo, no formato da Cloud API. */
function payloadDoTipo(telefone: string, tipo: string, conteudo: Record<string, unknown>, wamid = `wamid.${randomUUID()}`): string {
  return JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA-ID', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '5511999999999', phone_number_id: NUMERO_A },
      contacts: [{ profile: { name: 'Cliente de Teste' }, wa_id: telefone }],
      messages: [{ from: telefone, id: wamid, timestamp: String(Math.floor(Date.now() / 1000)), type: tipo, [tipo]: conteudo }],
    } }] }],
  });
}

const payloadDeImagem = (telefone: string, mediaId: string, legenda?: string, wamid?: string) =>
  payloadDoTipo(telefone, 'image', { id: mediaId, mime_type: 'image/jpeg', sha256: 'abc', ...(legenda ? { caption: legenda } : {}) }, wamid);

const payloadDeAudio = (telefone: string, mediaId: string) =>
  payloadDoTipo(telefone, 'audio', { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true });

async function postar(corpo: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  return POST(requisicaoDoWebhook(corpo, assinar(corpo)));
}

async function rodarFila(ordem: 'normal' | 'invertida' = 'normal') {
  const tarefas = ordem === 'normal' ? tarefasPendentes : [...tarefasPendentes].reverse();
  tarefasPendentes = [];
  for (const tarefa of tarefas) await tarefa();
}

const mensagensDe = (telefone: string) => {
  const contato = banco.contacts.find(c => c.telefone === telefone);
  const conversa = banco.conversations.find(c => c.contact_id === contato?.id);
  return banco.messages.filter(m => m.conversation_id === conversa?.id);
};

const chamadasDoMotor = (rede: HttpFalso) =>
  rede.chamadasAnthropic.filter(c => (c.corpo as { output_config?: unknown }).output_config);

/** O que a IA recebeu como conversa na última chamada do motor. */
function conversaQueAIaViu(rede: HttpFalso): string[] {
  return (chamadasDoMotor(rede).at(-1)?.corpo as { messages: { content: string }[] }).messages.map(m => m.content);
}

describe('foto', () => {
  test('a mensagem guarda a descrição da foto no lugar do texto provisório', async () => {
    instalarRede({ 'MIDIA-1': { mimeType: 'image/jpeg' } });
    await postar(payloadDeImagem('5511900000091', 'MIDIA-1'));
    await rodarFila();
    assert.equal(mensagensDe('5511900000091')[0].texto, `[Imagem: ${DESCRICAO}]`);
  });

  test('a legenda que o cliente escreveu junto continua na mensagem', async () => {
    instalarRede({ 'MIDIA-2': { mimeType: 'image/jpeg' } });
    await postar(payloadDeImagem('5511900000092', 'MIDIA-2', 'tem esse?'));
    await rodarFila();
    assert.equal(mensagensDe('5511900000092')[0].texto, `[Imagem: ${DESCRICAO}]\ntem esse?`);
  });

  test('a IA responde já sabendo o que tem na foto', async () => {
    const rede = instalarRede({ 'MIDIA-3': { mimeType: 'image/jpeg' } });
    await postar(payloadDeImagem('5511900000093', 'MIDIA-3'));
    await rodarFila();
    assert.deepEqual(conversaQueAIaViu(rede), [`[Imagem: ${DESCRICAO}]`]);
    assert.deepEqual(mensagensDe('5511900000093').map(m => m.autor), ['cliente', 'ia']);
  });

  test('a foto vai para o modelo como imagem de verdade, com o formato que a Meta informou', async () => {
    const rede = instalarRede({ 'MIDIA-9': { mimeType: 'image/png', bytes: 2048 } });
    await postar(payloadDeImagem('5511900000099', 'MIDIA-9'));
    await rodarFila();
    const leitura = rede.chamadasAnthropic[0].corpo as { messages: { content: { type: string; source?: { media_type: string; data: string } }[] }[] };
    const bloco = leitura.messages[0].content.find(c => c.type === 'image');
    assert.equal(bloco?.source?.media_type, 'image/png');
    assert.equal(Buffer.from(bloco?.source?.data ?? '', 'base64').length, 2048);
  });

  test('o custo da leitura aparece no uso da IA separado do atendimento', async () => {
    instalarRede({ 'MIDIA-4': { mimeType: 'image/jpeg' } });
    await postar(payloadDeImagem('5511900000094', 'MIDIA-4'));
    await rodarFila();
    const conversaId = mensagensDe('5511900000094')[0].conversation_id;
    assert.equal(banco.ai_usage.filter(u => u.conversation_id === conversaId && u.origem === 'midia').length, 1);
  });

  test('"quanto custa isso?" enquanto a foto é lida: uma resposta só, que já viu a foto', async () => {
    const rede = instalarRede({ 'MIDIA-5': { mimeType: 'image/jpeg' } });
    await postar(payloadDeImagem('5511900000095', 'MIDIA-5'));
    await postar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: '5511900000095', texto: 'quanto custa isso?' }));

    // A tarefa do texto roda primeiro, enquanto a foto ainda nem foi lida — é
    // o que acontece de verdade, porque ler a foto leva alguns segundos.
    await rodarFila('invertida');

    assert.deepEqual(mensagensDe('5511900000095').map(m => m.autor), ['cliente', 'cliente', 'ia']);
    assert.deepEqual(conversaQueAIaViu(rede), [`[Imagem: ${DESCRICAO}]`, 'quanto custa isso?']);
  });

  test('imagem que não baixa fica marcada, e a IA responde mesmo assim', async () => {
    instalarRede({ 'MIDIA-6': { mimeType: 'image/jpeg', falhar: true } }, []);
    await postar(payloadDeImagem('5511900000096', 'MIDIA-6', 'olha isso'));
    await rodarFila();
    assert.deepEqual(mensagensDe('5511900000096').map(m => m.texto), [
      '[Imagem que não foi possível abrir]\nolha isso',
      'Oi! Claro, posso ajudar com isso.',
    ]);
  });

  test('formato que a IA não lê não gasta chamada ao modelo para descrever', async () => {
    const rede = instalarRede({ 'MIDIA-7': { mimeType: 'image/heic' } }, []);
    await postar(payloadDeImagem('5511900000097', 'MIDIA-7'));
    await rodarFila();
    assert.equal(rede.chamadasAnthropic.length - chamadasDoMotor(rede).length, 0);
  });

  test('o reenvio da Meta não baixa nem descreve a foto de novo', async () => {
    const rede = instalarRede({ 'MIDIA-8': { mimeType: 'image/jpeg' } });
    const corpo = payloadDeImagem('5511900000098', 'MIDIA-8', undefined, 'wamid.foto-repetida');
    await postar(corpo);
    await postar(corpo);
    await rodarFila();
    assert.equal(rede.chamadasMidia.length, 2, 'esperava uma consulta e um download, uma vez só');
  });
});

describe('áudio', () => {
  const FALA = 'Oi, quanto custa o ensaio de família no sábado?';

  test('a nota de voz vira o que o cliente falou, e a IA responde a isso', async () => {
    const rede = instalarRede({ 'AUDIO-1': { mimeType: 'audio/ogg' } }, [], [FALA]);
    await postar(payloadDeAudio('5511900000101', 'AUDIO-1'));
    await rodarFila();
    assert.equal(mensagensDe('5511900000101')[0].texto, FALA);
    assert.deepEqual(conversaQueAIaViu(rede), [FALA]);
  });

  test('por padrão vai para o Whisper da Groq, em português, como arquivo ogg', async () => {
    const rede = instalarRede({ 'AUDIO-2': { mimeType: 'audio/ogg' } }, [], [FALA]);
    await postar(payloadDeAudio('5511900000102', 'AUDIO-2'));
    await rodarFila();
    const chamada = rede.chamadasTranscricao[0];
    assert.equal(chamada.url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.deepEqual(chamada.corpo, {
      file: { nome: 'audio.ogg', tipo: 'audio/ogg', bytes: 1024 },
      model: 'whisper-large-v3', language: 'pt', response_format: 'json',
    });
  });

  test('com TRANSCRICAO_PROVEDOR=openai, vai para a OpenAI com o whisper-1', async () => {
    process.env.TRANSCRICAO_PROVEDOR = 'openai';
    const rede = instalarRede({ 'AUDIO-3': { mimeType: 'audio/ogg' } }, [], [FALA]);
    await postar(payloadDeAudio('5511900000103', 'AUDIO-3'));
    await rodarFila();
    assert.equal(rede.chamadasTranscricao[0].url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal((rede.chamadasTranscricao[0].corpo as { model: string }).model, 'whisper-1');
  });

  test('sem chave de transcrição, nem baixa o áudio, e a IA responde mesmo assim', async () => {
    delete process.env.TRANSCRICAO_API_KEY;
    const rede = instalarRede({ 'AUDIO-4': { mimeType: 'audio/ogg' } }, []);
    await postar(payloadDeAudio('5511900000104', 'AUDIO-4'));
    await rodarFila();
    assert.equal(rede.chamadasMidia.length, 0, 'baixou um áudio que ninguém ia transcrever');
    assert.deepEqual(mensagensDe('5511900000104').map(m => m.texto), [
      '[Áudio que não foi possível ouvir]', 'Oi! Claro, posso ajudar com isso.',
    ]);
  });

  test('transcrição que falha marca o áudio e o atendimento segue', async () => {
    instalarRede({ 'AUDIO-5': { mimeType: 'audio/ogg' } }, [], [null]);
    await postar(payloadDeAudio('5511900000105', 'AUDIO-5'));
    await rodarFila();
    assert.deepEqual(mensagensDe('5511900000105').map(m => m.autor), ['cliente', 'ia']);
    assert.equal(mensagensDe('5511900000105')[0].texto, '[Áudio que não foi possível ouvir]');
  });

  test('áudio e logo depois texto: uma resposta só, que já ouviu o áudio', async () => {
    const rede = instalarRede({ 'AUDIO-6': { mimeType: 'audio/ogg' } }, [], [FALA]);
    await postar(payloadDeAudio('5511900000106', 'AUDIO-6'));
    await postar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: '5511900000106', texto: 'e dá pra parcelar?' }));
    await rodarFila('invertida');
    assert.deepEqual(mensagensDe('5511900000106').map(m => m.autor), ['cliente', 'cliente', 'ia']);
    assert.deepEqual(conversaQueAIaViu(rede), [FALA, 'e dá pra parcelar?']);
  });
});

describe('tipo da mensagem', () => {
  test('texto, foto e áudio ficam gravados com o tipo certo', async () => {
    instalarRede({ 'TIPO-FOTO': { mimeType: 'image/jpeg' }, 'TIPO-AUDIO': { mimeType: 'audio/ogg' } }, [], ['tudo bem?']);
    await postar(payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: '5511900000111', texto: 'oi' }));
    await postar(payloadDeImagem('5511900000112', 'TIPO-FOTO'));
    await postar(payloadDeAudio('5511900000113', 'TIPO-AUDIO'));
    await rodarFila();
    const tipos = ['5511900000111', '5511900000112', '5511900000113'].map(t => mensagensDe(t)[0].tipo);
    assert.deepEqual(tipos, ['texto', 'imagem', 'audio']);
  });

  test('tipo que o sistema ainda não trata fica gravado, em português quando é conhecido', async () => {
    instalarRede({}, []);
    await postar(payloadDoTipo('5511900000114', 'sticker', { id: 'FIGURINHA', mime_type: 'image/webp' }));
    await postar(payloadDoTipo('5511900000115', 'order', { catalog_id: '1' }));
    await rodarFila();
    assert.deepEqual([mensagensDe('5511900000114')[0].tipo, mensagensDe('5511900000115')[0].tipo], ['figurinha', 'order']);
  });

  test('leitura que não terminou em 90 s deixa de segurar a conversa', async () => {
    const { midiaAindaSendoLida, textoProvisorioDaMidia } = await import('@/lib/agente/midia-do-cliente');
    const agora = Date.now();
    assert.equal(midiaAindaSendoLida(textoProvisorioDaMidia('audio', null), new Date(agora - 10_000).toISOString(), agora), true);
    assert.equal(midiaAindaSendoLida(textoProvisorioDaMidia('audio', null), new Date(agora - 120_000).toISOString(), agora), false);
  });
});


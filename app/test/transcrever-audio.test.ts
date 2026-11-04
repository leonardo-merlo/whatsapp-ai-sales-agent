import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { transcreverAudio } from '@/lib/agente/transcrever-audio';

// Em 21/10 a OpenAI passou a recomendar o gpt-transcribe; whisper-1 e gpt-4o-transcribe saem em 26/02/2027.
// O gpt-transcribe recebe o idioma em `languages[]` (não aceita junto com `language`) e aceita `keywords[]`.

const ORIGINAL = { ...process.env };
const fetchOriginal = globalThis.fetch;

async function enviado(env: Record<string, string>): Promise<FormData> {
  Object.assign(process.env, { TRANSCRICAO_API_KEY: 'chave-de-teste', TRANSCRICAO_PROVEDOR: 'openai' }, env);
  let corpo: FormData | null = null;
  globalThis.fetch = (async (_url: string, init: { body: FormData }) => {
    corpo = init.body;
    return new Response(JSON.stringify({ text: 'Jundiaí' }), { status: 200 });
  }) as unknown as typeof fetch;
  await transcreverAudio(Buffer.from('ogg'), 'audio/ogg');
  return corpo!;
}

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of ['TRANSCRICAO_API_KEY', 'TRANSCRICAO_PROVEDOR', 'TRANSCRICAO_MODELO', 'TRANSCRICAO_PALAVRAS']) delete process.env[k];
  Object.assign(process.env, ORIGINAL);
});

describe('transcrição com o gpt-transcribe', () => {
  test('sends the language as languages[] and leaves out language and response_format', async () => {
    const f = await enviado({ TRANSCRICAO_MODELO: 'gpt-transcribe' });
    assert.deepEqual([f.getAll('languages[]'), f.has('language'), f.has('response_format')], [['pt'], false, false]);
  });
  test('sends the words from TRANSCRICAO_PALAVRAS as keywords[]', async () => {
    const f = await enviado({ TRANSCRICAO_MODELO: 'gpt-transcribe', TRANSCRICAO_PALAVRAS: 'Jundiaí, Juniaí ,vergalhão' });
    assert.deepEqual(f.getAll('keywords[]'), ['Jundiaí', 'Juniaí', 'vergalhão']);
  });
  test('keeps the old fields for whisper-1', async () => {
    const f = await enviado({});
    assert.deepEqual([f.get('model'), f.get('language'), f.has('languages[]')], ['whisper-1', 'pt', false]);
  });
});

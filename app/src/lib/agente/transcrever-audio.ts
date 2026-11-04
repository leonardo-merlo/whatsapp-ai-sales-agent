// Transcrição de áudio pelo Whisper. O Claude não recebe áudio, então esta é a
// única chamada do motor que sai para outro fornecedor.
//
// Groq e OpenAI falam o mesmo formato (a Groq imita a API da OpenAI), então o
// código é um só e o fornecedor é escolhido por variável de ambiente. Sem
// `TRANSCRICAO_API_KEY`, a transcrição fica desligada e o áudio é marcado como
// não ouvido — a IA pede para o cliente escrever.

const PROVEDORES = {
  groq: { url: 'https://api.groq.com/openai/v1/audio/transcriptions', modelo: 'whisper-large-v3' },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', modelo: 'whisper-1' },
} as const;
type Provedor = keyof typeof PROVEDORES;

// A extensão do arquivo é o que o Whisper usa para saber o formato. O WhatsApp
// grava nota de voz em OGG/Opus.
const EXTENSOES: Record<string, string> = {
  'audio/ogg': 'ogg', 'audio/opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3',
  'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav', 'audio/webm': 'webm',
};

function configuracao(): { url: string; modelo: string; chave: string } | null {
  const chave = process.env.TRANSCRICAO_API_KEY?.trim();
  if (!chave) return null;
  const nome = (process.env.TRANSCRICAO_PROVEDOR?.trim() || 'groq') as Provedor;
  const provedor = PROVEDORES[nome];
  if (!provedor) throw new Error(`TRANSCRICAO_PROVEDOR desconhecido: ${nome} (use groq ou openai)`);
  return { url: provedor.url, modelo: process.env.TRANSCRICAO_MODELO?.trim() || provedor.modelo, chave };
}

export function transcricaoLigada(): boolean {
  return !!process.env.TRANSCRICAO_API_KEY?.trim();
}

/** Devolve o que foi falado, ou string vazia quando o áudio não tem fala. */
export async function transcreverAudio(dados: Buffer, mimeType: string): Promise<string> {
  const cfg = configuracao();
  if (!cfg) throw new Error('Transcrição desligada: TRANSCRICAO_API_KEY ausente.');
  const extensao = EXTENSOES[mimeType];
  if (!extensao) throw new Error(`formato de áudio ${mimeType} não aceito pelo Whisper`);

  const formulario = new FormData();
  formulario.append('file', new Blob([new Uint8Array(dados)], { type: mimeType }), `audio.${extensao}`);
  formulario.append('model', cfg.modelo);
  // Dizer o idioma evita que o Whisper confunda português com espanhol em
  // áudio curto ou com ruído, que é o caso típico de nota de voz.
  // O gpt-transcribe (o recomendado pela OpenAI desde out/2026) recebe o idioma em `languages[]`, recusa
  // `language` junto, e aceita `keywords[]`: nomes que ele erraria, como "Jundiaí" (teste de voz de 21/10).
  if (cfg.modelo.startsWith('gpt-transcribe')) {
    formulario.append('languages[]', 'pt');
    const palavras = (process.env.TRANSCRICAO_PALAVRAS ?? '').split(',').map(p => p.trim()).filter(Boolean);
    for (const palavra of palavras) formulario.append('keywords[]', palavra);
  } else {
    formulario.append('language', 'pt');
    formulario.append('response_format', 'json');
  }

  const resp = await fetch(cfg.url, { method: 'POST', headers: { Authorization: `Bearer ${cfg.chave}` }, body: formulario });
  if (!resp.ok) {
    const corpo = await resp.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(corpo?.error?.message ?? `Falha na transcrição (HTTP ${resp.status})`);
  }
  const { text } = await resp.json() as { text?: string };
  return (text ?? '').trim();
}

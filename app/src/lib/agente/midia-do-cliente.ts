// Foto e áudio que o cliente manda pelo WhatsApp viram texto antes de a IA
// responder: a foto o Claude descreve, o áudio o Whisper transcreve. O texto
// substitui o da mensagem, e daí em diante tudo segue como se o cliente tivesse
// escrito — o motor lê, o atendente vê na tela Conversas, o resumo inclui. O
// arquivo não é guardado; o que fica é o texto e o tipo (`messages.tipo`).
//
// A mensagem é gravada ANTES da leitura, com um texto provisório. É o que mantém
// a proteção contra reenvio da Meta (o `wamid` entra na hora) e a ordem das
// mensagens na conversa. Enquanto o texto é o provisório, o motor não responde
// a conversa (ver `midiaAindaSendoLida`): quem manda foto ou áudio e logo depois
// "quanto custa isso?" precisa de uma resposta que já viu (ou ouviu) a mídia.

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { baixarMidiaDoWhatsApp } from '../whatsapp/baixar-midia';
import { logAiUsage, MODELO_IA } from './log-uso';
import { transcreverAudio, transcricaoLigada } from './transcrever-audio';
import { buscarConfigDoAgente } from './config-do-numero';
import { usaPipelineV2 } from '../v2/pipeline';
import {
  lerTranscricao, MODELO_DA_TRANSCRICAO, pedidoDeLeituraDoPdf, pedidoDeTranscricao, TAMANHO_MAXIMO_DO_PDF, textoDaTranscricao, textoDoPdf,
} from '../v2/transcricao';

type Client = SupabaseClient<Database>;
export type TipoMidia = 'imagem' | 'audio' | 'documento';

const MARCA_PENDENTE: Record<TipoMidia, string> = {
  imagem: '[Imagem recebida, lendo o conteúdo…]',
  audio: '[Áudio recebido, transcrevendo…]',
  documento: '[PDF recebido, lendo o conteúdo…]',
};
const TEXTO_FALHA: Record<TipoMidia, string> = {
  imagem: '[Imagem que não foi possível abrir]',
  audio: '[Áudio que não foi possível ouvir]',
  documento: '[PDF que não foi possível abrir]',
};

// Se a leitura não terminar nesse tempo, alguma coisa morreu no caminho. A
// conversa não pode ficar travada esperando para sempre: passado o prazo, a
// mídia conta como ilegível e o motor volta a responder.
const PRAZO_DA_LEITURA_MS = 90 * 1000;

// Os formatos que a API do Claude aceita como imagem. O WhatsApp manda JPEG e PNG.
const FORMATOS_DE_IMAGEM = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
type FormatoDeImagem = typeof FORMATOS_DE_IMAGEM[number];
const TAMANHO_MAXIMO_IMAGEM = 5 * 1024 * 1024;

const juntarLegenda = (primeiraLinha: string, legenda: string | null) =>
  legenda?.trim() ? `${primeiraLinha}\n${legenda.trim()}` : primeiraLinha;

const AUDIO_SEM_FALA = '[Áudio sem fala que desse para entender]';

/**
 * A mensagem é só mídia que não deu para ler? `audio` (não ouviu ou sem fala) ou
 * `outra` (imagem que não abriu, figurinha, reação, PDF, localização). Com
 * qualquer linha escrita pelo cliente, null: o texto vale.
 */
export function midiaQueNaoAbriu(texto: string): 'audio' | 'outra' | null {
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return null;
  const audio = (l: string): boolean => l === TEXTO_FALHA.audio || l === AUDIO_SEM_FALA;
  const outra = (l: string): boolean => l === TEXTO_FALHA.imagem || l === TEXTO_FALHA.documento || /^\[tipo não suportado: [^\]]*\]$/.test(l);
  if (!linhas.every(l => audio(l) || outra(l))) return null;
  return linhas.some(audio) ? 'audio' : 'outra';
}

export const textoProvisorioDaMidia = (tipo: TipoMidia, legenda: string | null) =>
  juntarLegenda(MARCA_PENDENTE[tipo], legenda);

export function midiaAindaSendoLida(texto: string, criadaEm: string, agora = Date.now()): boolean {
  const pendente = Object.values(MARCA_PENDENTE).some(m => texto.startsWith(m));
  return pendente && agora - new Date(criadaEm).getTime() < PRAZO_DA_LEITURA_MS;
}

const INSTRUCAO_IMAGEM = `Você descreve imagens que clientes mandam para uma empresa pelo WhatsApp. Escreva em
português, de forma objetiva, o que aparece e pode importar para o atendimento: produto, modelo,
medidas, quantidade, estado. Transcreva textos e números visíveis (preços, códigos, documentos,
etiquetas). Não invente o que não dá para ver. Responda só com a descrição, em até 3 frases, sem
introdução.`;

async function descreverImagem(
  supabase: Client, orgId: string, conversationId: string, mediaId: string, legenda: string | null,
): Promise<string> {
  const { dados, mimeType } = await baixarMidiaDoWhatsApp(mediaId);
  if (!FORMATOS_DE_IMAGEM.includes(mimeType as FormatoDeImagem)) throw new Error(`formato ${mimeType} não aceito`);
  if (dados.length > TAMANHO_MAXIMO_IMAGEM) throw new Error(`imagem de ${dados.length} bytes passa do limite`);

  const resposta = await new Anthropic().messages.create({
    model: MODELO_IA,
    max_tokens: 300,
    system: INSTRUCAO_IMAGEM,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType as FormatoDeImagem, data: dados.toString('base64') } },
        { type: 'text', text: legenda?.trim() ? `O cliente escreveu junto: "${legenda.trim()}"` : 'Descreva a imagem.' },
      ],
    }],
  });
  await logAiUsage(supabase, { orgId, origem: 'midia', model: MODELO_IA, usage: resposta.usage, conversationId });

  const bloco = resposta.content.find(b => b.type === 'text');
  const descricao = bloco?.type === 'text' ? bloco.text.trim() : '';
  if (!descricao) throw new Error('descrição vazia');
  return juntarLegenda(`[Imagem: ${descricao}]`, legenda);
}

/**
 * Com a v2 ligada no número de vendas, a foto vira a lista COPIADA linha por
 * linha (é o que a v2 precisa para identificar cada item), e não um resumo de
 * três frases. Continua salvando só o texto; a imagem não fica guardada.
 */
async function transcreverListaDaFoto(
  supabase: Client, orgId: string, conversationId: string, mediaId: string, legenda: string | null,
): Promise<string> {
  const { dados, mimeType } = await baixarMidiaDoWhatsApp(mediaId);
  if (!FORMATOS_DE_IMAGEM.includes(mimeType as FormatoDeImagem)) throw new Error(`formato ${mimeType} não aceito`);
  if (dados.length > TAMANHO_MAXIMO_IMAGEM) throw new Error(`imagem de ${dados.length} bytes passa do limite`);
  const pedido = pedidoDeTranscricao({ base64: dados.toString('base64'), tipo: mimeType as FormatoDeImagem });
  const resposta = await new Anthropic().messages.create(pedido as unknown as Parameters<Anthropic['messages']['create']>[0]) as Anthropic.Message;
  await logAiUsage(supabase, { orgId, origem: 'midia', model: MODELO_DA_TRANSCRICAO, usage: resposta.usage, conversationId });
  const bloco = resposta.content.find(b => b.type === 'text');
  const linhas = lerTranscricao(bloco?.type === 'text' ? bloco.text : '{}');
  if (!linhas.length) throw new Error('foto sem linhas legíveis');
  return juntarLegenda(`[Foto da lista]\n${textoDaTranscricao(linhas)}`, legenda);
}

/** PDF só é lido no número de vendas da v2 (lista ou cadastro); nos outros fica como mídia que não abriu. */
async function lerPdf(
  supabase: Client, orgId: string, conversationId: string, mediaId: string, legenda: string | null,
): Promise<string> {
  if (!await fotoViraListaNaV2(supabase, orgId, conversationId)) throw new Error('PDF fora do roteiro de vendas da v2');
  const { dados, mimeType } = await baixarMidiaDoWhatsApp(mediaId);
  if (mimeType !== 'application/pdf') throw new Error(`formato ${mimeType} não aceito`);
  if (dados.length > TAMANHO_MAXIMO_DO_PDF) throw new Error(`PDF de ${dados.length} bytes passa do limite`);
  const pedido = pedidoDeLeituraDoPdf(dados.toString('base64'));
  const resposta = await new Anthropic().messages.create(pedido as unknown as Parameters<Anthropic['messages']['create']>[0]) as Anthropic.Message;
  await logAiUsage(supabase, { orgId, origem: 'midia', model: MODELO_DA_TRANSCRICAO, usage: resposta.usage, conversationId });
  const bloco = resposta.content.find(b => b.type === 'text');
  const texto = textoDoPdf(bloco?.type === 'text' ? bloco.text : '{}');
  if (!texto) throw new Error('PDF sem produto nem documento');
  return juntarLegenda(texto, legenda);
}

async function fotoViraListaNaV2(supabase: Client, orgId: string, conversationId: string): Promise<boolean> {
  if (process.env.PIPELINE_VERSION?.trim() !== 'v2') return false;
  const { data } = await supabase.from('conversations').select('wa_number_id').eq('id', conversationId).maybeSingle();
  const cfg = await buscarConfigDoAgente(supabase, orgId, data?.wa_number_id ?? null);
  return usaPipelineV2(cfg?.roteiro);
}

async function ouvirAudio(mediaId: string): Promise<string> {
  // Transcrição desligada: nem baixa o áudio.
  if (!transcricaoLigada()) throw new Error('transcrição desligada (sem TRANSCRICAO_API_KEY)');
  const { dados, mimeType } = await baixarMidiaDoWhatsApp(mediaId);
  const fala = await transcreverAudio(dados, mimeType);
  // A transcrição é o que o cliente disse, então vira o texto da mensagem sem
  // moldura: para a IA e para o resumo, é como se ele tivesse escrito. Que foi
  // áudio fica em `messages.tipo`.
  return fala || AUDIO_SEM_FALA;
}

/** Lê a mídia e troca o texto provisório da mensagem pelo resultado. Nunca
 *  lança: se algo falhar, a mensagem fica marcada como mídia que não deu para
 *  abrir, e o atendimento segue. */
export async function lerMidiaDoCliente(
  supabase: Client,
  params: { tipo: TipoMidia; orgId: string; conversationId: string; wamid: string; mediaId: string; legenda: string | null },
): Promise<void> {
  const { tipo, orgId, conversationId, wamid, mediaId, legenda } = params;
  let texto: string;
  try {
    texto = tipo === 'imagem'
      ? (await fotoViraListaNaV2(supabase, orgId, conversationId)
        ? await transcreverListaDaFoto(supabase, orgId, conversationId, mediaId, legenda)
        : await descreverImagem(supabase, orgId, conversationId, mediaId, legenda))
      : tipo === 'documento' ? await lerPdf(supabase, orgId, conversationId, mediaId, legenda)
      : await ouvirAudio(mediaId);
  } catch (err) {
    console.error(`Erro ao ler ${tipo} do cliente:`, err instanceof Error ? err.message : err);
    texto = juntarLegenda(TEXTO_FALHA[tipo], legenda);
  }

  const { error } = await supabase.from('messages').update({ texto })
    .eq('organization_id', orgId).eq('wamid', wamid);
  if (error) console.error(`Erro ao gravar o texto da ${tipo}:`, error.message);
}

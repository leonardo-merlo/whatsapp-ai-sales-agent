// Baixa da Graph API a mídia que o cliente mandou (imagem hoje, áudio depois).
//
// São dois passos, e o segundo tem prazo: o webhook traz só o id da mídia; o
// GET nesse id devolve uma URL temporária (vale poucos minutos), e o GET nessa
// URL, com o mesmo token, devolve o arquivo. Por isso a mídia é baixada logo que
// a mensagem chega, e o que se guarda é o texto extraído dela, não o arquivo.

import { GRAPH_API_VERSION } from './send-message';

export interface MidiaBaixada {
  dados: Buffer;
  mimeType: string;
}

export async function baixarMidiaDoWhatsApp(mediaId: string): Promise<MidiaBaixada> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!accessToken) throw new Error('WhatsApp não configurado: WHATSAPP_ACCESS_TOKEN ausente.');
  const autorizacao = { Authorization: `Bearer ${accessToken}` };

  const respInfo = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`, { headers: autorizacao });
  if (!respInfo.ok) throw new Error(`Falha ao consultar a mídia ${mediaId} (HTTP ${respInfo.status})`);
  const info = await respInfo.json() as { url?: string; mime_type?: string };
  if (!info.url) throw new Error(`A Graph API não devolveu URL para a mídia ${mediaId}`);

  const respArquivo = await fetch(info.url, { headers: autorizacao });
  if (!respArquivo.ok) throw new Error(`Falha ao baixar a mídia ${mediaId} (HTTP ${respArquivo.status})`);

  return {
    dados: Buffer.from(await respArquivo.arrayBuffer()),
    mimeType: (info.mime_type ?? respArquivo.headers.get('content-type') ?? '').split(';')[0].trim(),
  };
}

// Coexistência: o que o vendedor escreve pelo celular dele.
//
// Com o número em coexistência o aplicativo continua no telefone, e toda
// mensagem que o vendedor manda por lá chega no nosso webhook pelo campo
// `smb_message_echoes`. Sem tratar isso, o painel mostraria só metade da
// conversa — e, pior, a IA responderia por cima do que o vendedor acabou de
// digitar, com o cliente recebendo duas respostas diferentes do mesmo número
// com segundos de diferença.
//
// **Decisão do Leonardo (2026-09-13): o eco não desliga a IA.** Ela continua
// atendendo. Desligar exigiria uma forma de religar, e religar manualmente é
// complexidade que o piloto não precisa. O que evita o atropelo já existe no
// motor desde antes: ele não responde quando a conversa termina numa fala da
// casa (`ja-respondida`). Gravar o eco como `humano` é o que faz essa regra
// antiga valer também para o celular do vendedor — e é o que põe a fala dele
// no histórico que a IA lê, para ela não repetir o que ele já disse.
//
// O eco **nunca** chama o motor. Quem faz a IA falar é mensagem de cliente.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { resolverContatoDoWebhook } from './contato-do-webhook';
import { resolverConversaDoNumero } from './conversa-do-numero';

type Client = SupabaseClient<Database>;

/** Uma linha de `message_echoes` do webhook `smb_message_echoes`. */
export interface EcoRecebido {
  /** Telefone do cliente do outro lado. É por ele que se acha o contato. */
  to?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

export interface ResultadoDoEco {
  /** Quantos ecos viraram mensagem. O resto foi repetição ou eco sem destino. */
  gravados: number;
}

// Postgres: violação de índice único — aqui só pode ser o `wamid` repetido.
const CODIGO_DUPLICATA = '23505';

export async function registrarEcosDoVendedor(
  supabase: Client,
  {
    orgId,
    waNumberId,
    ecos,
    textoDoTipo,
  }: {
    orgId: string;
    waNumberId: string | null;
    ecos: EcoRecebido[];
    /** Mesma tradução de tipo usada para a mensagem do cliente. */
    textoDoTipo: (tipo: string | undefined) => { tipo: string; texto: string };
  },
): Promise<ResultadoDoEco> {
  let gravados = 0;

  for (const eco of ecos) {
    const telefoneDoCliente = eco.to ?? null;
    if (!telefoneDoCliente) {
      // O eco identifica o cliente só pelo telefone. Sem ele não há em qual
      // conversa pendurar a mensagem, e inventar uma seria pior do que perder.
      console.warn(`Eco do vendedor ${eco.id ?? '?'} sem destinatário, ignorado`);
      continue;
    }

    const contato = await resolverContatoDoWebhook(supabase, orgId, {
      telefone: telefoneDoCliente,
      bsuid: null,
      nomeDoPerfil: null,
      usuario: null,
    });
    if (!contato) continue;

    const conversaId = await resolverConversaDoNumero(supabase, {
      orgId, contatoId: contato.id, waNumberId,
    });
    if (!conversaId) continue;

    const { tipo, texto } = textoDoTipo(eco.type);
    const { error } = await supabase.from('messages').insert({
      organization_id: orgId,
      conversation_id: conversaId,
      // `humano` e não `ia`: quem escreveu foi o vendedor, e é assim que a tela
      // e o motor já sabem tratar uma fala da casa que não veio da IA.
      autor: 'humano',
      texto: eco.type === 'text' ? (eco.text?.body ?? '') : texto,
      read: true,
      tipo,
      // Mesmo índice único que segura o reenvio da Meta na mensagem do cliente.
      wamid: eco.id ?? null,
    });
    if (error) {
      if (error.code === CODIGO_DUPLICATA) continue; // a Meta reenviou
      console.error('Erro ao gravar eco do vendedor:', error.message);
      continue;
    }
    gravados += 1;
  }

  return { gravados };
}

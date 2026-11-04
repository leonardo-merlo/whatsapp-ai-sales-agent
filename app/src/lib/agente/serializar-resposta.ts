// Fase 2 do roteiro de vendas: transformar o que a fase 1 escreveu em formulário.
//
// Ver `interruptor-duas-fases.ts` para o porquê. Três exigências moldam tudo
// aqui:
//
// 1. **Não reenvia o system prompt de 12 mil tokens nem o histórico.** O
//    serializador recebe um prompt curto, a última fala do cliente, a mensagem
//    que a fase 1 escreveu e a ficha atual (para não repetir o que ela já tem).
//    Reenviar tudo dobraria o custo sem dar ao modelo nada que ele use aqui.
// 2. **A conversa não tem nenhum bloco de ferramenta, e o pedido não leva o
//    campo `tools`.** É a forma medida em 0/60 na bancada (variante C).
// 3. **Ele não pode reescrever a mensagem do cliente.** O campo pede cópia
//    literal, e o código confere: divergiu além do limiar, vale o texto da
//    fase 1. Os metadados são aproveitados de qualquer jeito.
//
// **Por que o formulário da fase 2 é menor que o de sempre.** Os campos de
// questionário, agendamento, transferência e desfecho dependem de blocos que o
// prompt de VENDAS nem contém (`build-prompt.ts` os guarda atrás de
// `soAtendimento`): no roteiro de vendas eles sempre saíram neutros. O que
// sobra de conteúdo real é a ficha do contato — e o serializador extrai fato,
// não decide nada.

import type Anthropic from '@anthropic-ai/sdk';
import { pareceTextoFragmentado } from './texto-fragmentado';

export const SISTEMA_DO_SERIALIZADOR = `Você transforma uma conversa já encerrada em um formulário JSON. Você não conversa com ninguém.

Regras:
1. Você NÃO decide nada, NÃO reescreve nada e NÃO recalcula nada. Só copia e extrai.
2. "mensagem_cliente_verbatim": copie a MENSAGEM DO ATENDENTE exatamente como está, caractere por caractere. Não corrija, não resuma, não traduza, não mude pontuação nem espaços.
3. "atualizacao_perfil": só fatos NOVOS sobre o cliente que aparecem na fala do cliente ou na mensagem do atendente (preferências, dados importantes, o que ele busca agora, observações úteis). Não repita o que já está na ficha atual. Sem novidade: listas vazias e textos vazios.
4. Nunca invente dado. Na dúvida, deixe vazio.`;

export const FORMULARIO_DO_SERIALIZADOR = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    properties: {
      mensagem_cliente_verbatim: {
        type: 'string',
        description: 'A MENSAGEM DO ATENDENTE copiada exatamente como está, sem nenhuma alteração.',
      },
      atualizacao_perfil: {
        type: 'object',
        properties: {
          preferencias: { type: 'array', items: { type: 'string' } },
          dados_chave: {
            type: 'array',
            items: {
              type: 'object',
              properties: { rotulo: { type: 'string' }, valor: { type: 'string' } },
              required: ['rotulo', 'valor'],
              additionalProperties: false,
            },
          },
          ultimo_interesse: { type: 'string' },
          observacoes: { type: 'string' },
        },
        required: ['preferencias', 'dados_chave', 'ultimo_interesse', 'observacoes'],
        additionalProperties: false,
      },
    },
    required: ['mensagem_cliente_verbatim', 'atualizacao_perfil'],
    additionalProperties: false,
  },
};

export const MAX_TOKENS_DO_SERIALIZADOR = 1024;

export interface EntradaDoSerializador {
  /** O que o cliente escreveu por último (as mensagens seguidas, juntas). */
  falaDoCliente: string;
  /** O texto que a fase 1 escreveu para o cliente. */
  mensagemDaFase1: string;
  /** A ficha atual, em linhas — para o serializador não repetir o que já existe. */
  fichaAtual: string[];
}

/** A única mensagem da fase 2. Texto puro, nenhum bloco de ferramenta. */
export function mensagemDoSerializador(entrada: EntradaDoSerializador): Anthropic.MessageParam[] {
  const ficha = entrada.fichaAtual.length ? entrada.fichaAtual.join('\n') : '(vazia)';
  return [{
    role: 'user',
    content: `FICHA ATUAL DO CLIENTE:\n${ficha}\n\nFALA DO CLIENTE:\n${entrada.falaDoCliente}\n\n`
      + `MENSAGEM DO ATENDENTE (copie exatamente em mensagem_cliente_verbatim):\n${entrada.mensagemDaFase1}`,
  }];
}

/** O pedido inteiro da fase 2. Sem `tools`, sem `tool_choice`. */
export function pedidoDoSerializador(modelo: string, entrada: EntradaDoSerializador): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model: modelo,
    max_tokens: MAX_TOKENS_DO_SERIALIZADOR,
    system: SISTEMA_DO_SERIALIZADOR,
    messages: mensagemDoSerializador(entrada),
    output_config: { format: FORMULARIO_DO_SERIALIZADOR },
  } as Anthropic.MessageCreateParamsNonStreaming;
}

/**
 * Quanto a cópia pode divergir do original e ainda valer: 2% dos caracteres.
 *
 * Folga para o modelo trocar um espaço duplo ou uma quebra de linha, e nada
 * além. Uma palavra trocada numa mensagem de WhatsApp já passa disso.
 */
export const LIMIAR_DE_DIVERGENCIA = 0.02;

/** Distância de edição, em caracteres. As mensagens são curtas (4 frases). */
function distancia(a: string, b: string): number {
  if (a === b) return 0;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Qual texto vai ao cliente: a cópia do serializador, se ela for de fato uma
 * cópia; senão, o original da fase 1.
 *
 * O caso que esta conferência pega de verdade é o texto picado ("O cad as tro
 * foi fe i to"), que é artefato justamente da saída estruturada — a fase 1
 * escreve em texto puro e não pica, mas a cópia dentro do JSON pode picar. Por
 * isso a cópia picada também é recusada, mesmo que caiba no limiar.
 */
export function textoParaOCliente(original: string, copia: string | null | undefined): { texto: string; usouACopia: boolean } {
  if (typeof copia !== 'string' || !copia.trim()) return { texto: original, usouACopia: false };
  const a = original.trim();
  const b = copia.trim();
  const tamanho = Math.max(a.length, b.length, 1);
  if (distancia(a, b) / tamanho > LIMIAR_DE_DIVERGENCIA) return { texto: original, usouACopia: false };
  if (pareceTextoFragmentado(b) && !pareceTextoFragmentado(a)) return { texto: original, usouACopia: false };
  return { texto: copia, usouACopia: true };
}

export interface PerfilDoSerializador {
  preferencias: string[];
  dados_chave: { rotulo: string; valor: string }[];
  ultimo_interesse: string;
  observacoes: string;
}

/** Lê a saída da fase 2 sem lançar. `null` = não serviu, e aí valem os
 *  metadados neutros — a mensagem da fase 1 sai de qualquer jeito. */
export function lerSaidaDoSerializador(
  resposta: Anthropic.Message,
): { copia: string; perfil: PerfilDoSerializador } | null {
  const bloco = resposta.content.find(b => b.type === 'text');
  if (!bloco || bloco.type !== 'text') return null;
  try {
    const j = JSON.parse(bloco.text) as { mensagem_cliente_verbatim?: unknown; atualizacao_perfil?: Partial<PerfilDoSerializador> };
    const p = j.atualizacao_perfil;
    if (typeof j.mensagem_cliente_verbatim !== 'string' || !p || typeof p !== 'object') return null;
    return {
      copia: j.mensagem_cliente_verbatim,
      perfil: {
        preferencias: Array.isArray(p.preferencias) ? p.preferencias.filter(s => typeof s === 'string') : [],
        dados_chave: Array.isArray(p.dados_chave)
          ? p.dados_chave.filter(d => d && typeof d.rotulo === 'string' && typeof d.valor === 'string')
          : [],
        ultimo_interesse: typeof p.ultimo_interesse === 'string' ? p.ultimo_interesse : '',
        observacoes: typeof p.observacoes === 'string' ? p.observacoes : '',
      },
    };
  } catch {
    return null;
  }
}

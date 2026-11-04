// Transcrição de foto (Fase D, item 1): etapa separada, só para imagens. A IA
// devolve as linhas exatamente como estão, numeradas, sem interpretar. Linha
// que não dá para ler vem marcada `ilegivel`, e o sistema pergunta por ela em
// vez de adivinhar.

import { createHash } from 'node:crypto';

export const PROMPT_VERSION_TRANSCRICAO = 'transcricao-2026-10-21.1';
export const SCHEMA_VERSION_TRANSCRICAO = 'transcricao-schema-2026-10-05.1';

// Modelo próprio da foto, separado do da extração. Medido em 21/10 nas 4 fotos
// do teste de campo (scripts/medir-transcricao-de-foto.mts), mesmo prompt:
// Haiku 4.5 acertou 10-11 de 26 linhas (0 nas fotos deitadas); Haiku 5.5 com
// esforço baixo, 25 de 26 nas duas rodadas, por US$ 0,0006 a foto; Sonnet 5.5
// também 25 de 26, por US$ 0,0066. Esforço baixo empatou ou ganhou do médio.
export const MODELO_DA_TRANSCRICAO = 'claude-haiku-5-5';
const ESFORCO_DA_TRANSCRICAO = 'low';

// Teste de 20/10: a foto chegou DEITADA (papel girado 90°) e o Haiku leu de
// lado, inventando "1/2 DIA DE / FERRO / 7E FERRO" sem marcar nada ilegível.
// Por isso o prompt fala de orientação e manda marcar a dúvida em vez de chutar.
export const SYSTEM_DA_TRANSCRICAO = `Você transcreve fotos de listas de pedido (papel, caderno, nota, tela) para uma distribuidora de ferro e aço.

Antes de ler, descubra a orientação do texto. A foto pode estar girada (90° para qualquer lado ou 180°) ou inclinada: leia na orientação em que o texto fica de pé, nunca de lado.

Copie cada item EXATAMENTE como está escrito: números, frações, aspas, abreviações e erros de grafia do jeito que aparecem. Não corrija, não interprete, não acrescente unidade. Uma entrada por item, na ordem da lista. Se um item continua na linha de baixo (por exemplo, a medida escrita embaixo do nome, sem quantidade própria), junte as duas numa entrada só. Em tabela, cada linha da tabela é uma entrada com as colunas juntas, começando pela quantidade (ex.: "38 metalon 30x50x1,6mm"); nunca deixe a quantidade de fora.

Ignore o que não é item da lista: desenhos, carimbos, assinaturas, cabeçalho de tabela (QNT, Quant., Discriminação, Unitário, título da tabela) e colunas vazias.

Se não tiver certeza de uma letra ou número de um item, copie o que conseguir e marque ilegivel=true. É melhor marcar ilegível do que adivinhar: o vendedor confirma com o cliente.`;

export const ESQUEMA_DA_TRANSCRICAO = {
  type: 'object',
  properties: {
    linhas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { numero: { type: 'integer' }, texto: { type: 'string' }, ilegivel: { type: 'boolean' } },
        required: ['numero', 'texto', 'ilegivel'], additionalProperties: false,
      },
    },
  },
  required: ['linhas'],
  additionalProperties: false,
} as const;

export interface Imagem { base64: string; tipo: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }

export interface LinhaTranscrita { numero: number; texto: string; ilegivel: boolean }

/** O que entra na chave do cache: o hash da própria imagem. */
export function entradaDaImagem(imagem: Imagem): string {
  return `imagem:${createHash('sha256').update(imagem.base64).digest('hex')}`;
}

export function pedidoDeTranscricao(imagem: Imagem): Record<string, unknown> {
  return {
    model: MODELO_DA_TRANSCRICAO,
    // O raciocínio do Haiku 5.5 conta aqui: na medição a foto deitada gastou
    // até 2.500 tokens, e JSON cortado é foto perdida.
    max_tokens: 8000,
    system: SYSTEM_DA_TRANSCRICAO,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: imagem.tipo, data: imagem.base64 } },
        { type: 'text', text: 'Transcreva as linhas desta lista.' },
      ],
    }],
    output_config: { effort: ESFORCO_DA_TRANSCRICAO, format: { type: 'json_schema', schema: ESQUEMA_DA_TRANSCRICAO } },
  };
}

export function lerTranscricao(json: string): LinhaTranscrita[] {
  const bruto = JSON.parse(json) as { linhas?: { numero?: unknown; texto?: unknown; ilegivel?: unknown }[] };
  return (bruto.linhas ?? []).map((l, i) => ({ numero: Number(l.numero) || i + 1, texto: String(l.texto ?? ''), ilegivel: l.ilegivel === true }));
}

/** O texto que segue para a extração: uma linha por linha transcrita; as ilegíveis vão marcadas. */
export function textoDaTranscricao(linhas: LinhaTranscrita[]): string {
  return linhas.map(l => (l.ilegivel ? `[ilegível] ${l.texto}` : l.texto)).join('\n');
}

// PDF (Vendedor 1, 27/10): cliente manda o orçamento feito em outro lugar, ou o cartão CNPJ. Mesma cópia linha a linha
// da foto, mais o CPF/CNPJ de quem compra quando o PDF é de cadastro: é ele que a máquina usa para achar o cliente.
export const SYSTEM_DO_PDF = `Você lê PDFs que clientes mandam pelo WhatsApp para uma distribuidora de ferro e aço. O PDF pode ser uma lista de pedido, um orçamento de outra loja, uma nota, ou um documento de cadastro (cartão CNPJ, ficha da empresa).

Em "linhas", copie cada item de produto EXATAMENTE como está escrito, começando pela quantidade (ex.: "38 metalon 30x50x1,6mm"). Não corrija, não interprete, não acrescente unidade. Ignore preços, totais, cabeçalhos, endereços, dados da loja que fez o orçamento e tudo o que não é produto. Sem produto, "linhas" vem vazia.

Em "documento", escreva o CNPJ ou CPF do cliente quando o PDF é de cadastro dele (cartão CNPJ, ficha da empresa), só com os números. Em orçamento ou nota de outra loja, o CNPJ impresso é o da loja: deixe null.

Se não tiver certeza de uma letra ou número de um item, copie o que conseguir e marque ilegivel=true.`;

export const ESQUEMA_DO_PDF = {
  type: 'object',
  properties: {
    documento: { type: ['string', 'null'] },
    linhas: ESQUEMA_DA_TRANSCRICAO.properties.linhas,
  },
  required: ['documento', 'linhas'],
  additionalProperties: false,
} as const;

export const TAMANHO_MAXIMO_DO_PDF = 10 * 1024 * 1024;

export function pedidoDeLeituraDoPdf(base64: string): Record<string, unknown> {
  return {
    model: MODELO_DA_TRANSCRICAO,
    max_tokens: 8000,
    system: SYSTEM_DO_PDF,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Leia este PDF.' },
      ],
    }],
    output_config: { effort: ESFORCO_DA_TRANSCRICAO, format: { type: 'json_schema', schema: ESQUEMA_DO_PDF } },
  };
}

/** O texto que fica na mensagem: o documento numa linha própria (a máquina o acha ali), a lista depois da marca. */
export function textoDoPdf(json: string): string | null {
  const bruto = JSON.parse(json) as { documento?: unknown };
  const documento = typeof bruto.documento === 'string' ? bruto.documento.replace(/\D/g, '') : '';
  const linhas = lerTranscricao(json).filter(l => l.texto.trim());
  const partes = [
    ...(documento.length === 11 || documento.length === 14 ? [`${documento.length === 14 ? 'CNPJ' : 'CPF'} ${documento}`] : []),
    ...(linhas.length ? ['[PDF da lista]', textoDaTranscricao(linhas)] : []),
  ];
  return partes.length ? partes.join('\n') : null;
}

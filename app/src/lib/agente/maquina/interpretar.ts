// A IA lê a mensagem e devolve o que ela diz. Não responde ao cliente, não
// escolhe etapa, não chama nada (ajuste A1: `intencao` de uma lista curta da
// etapa, e os `campos`). Uma chamada pequena, sem ferramenta: o formulário
// sozinho não tem o erro 500 (ver a memória "erro-500-formato-mais-ferramentas").
//
// O que volta é conferido aqui antes de virar `Leitura`: intenção fora da
// lista da etapa vira `responde`, e os campos passam por `validarCampo` em
// `transicoes.ts`.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import { logAiUsage, MODELO_IA } from '../log-uso';
import type { ClienteIA } from '../../v2/cache-ia';
import { CAMPOS_DO_CADASTRO, LEITURA_VAZIA, type CamposDoCadastro, type EstadoDoOrcamento, type Leitura } from './tipos';

type Client = SupabaseClient<Database>;

/** As intenções que fazem sentido em cada momento. */
export function intencoesPossiveis(estado: EstadoDoOrcamento | null): Leitura['intencao'][] {
  if (!estado || estado.etapa === 'aguardando_vendedor' || estado.etapa === 'encerrado' || estado.etapa === 'expirado') {
    return ['pedir_orcamento', 'outro_assunto'];
  }
  // Válvula de escape (22/10): em toda etapa da coleta o cliente pode cancelar ou recomeçar (o código confirma antes).
  // E pedir orçamento de novo com um aberto: o código segue o que já começou (teste de 22/10, 15h).
  return [...intencoesDaColeta(estado), 'cancelar', 'recomecar', 'pedir_orcamento'];
}

function intencoesDaColeta(estado: EstadoDoOrcamento): Leitura['intencao'][] {
  if (estado.etapa === 'confirmando_regiao' || estado.pergunta === 'mesmo_cadastro') return ['confirma', 'nega', 'responde', 'outro_assunto'];
  if (estado.etapa === 'levantando_itens') {
    return estado.dados.v2_pedido_id ? ['produtos', 'responde', 'outro_assunto'] : ['produtos', 'outro_assunto'];
  }
  // Na forma de pagamento o cliente pode mudar a lista (limite da condição).
  if (estado.etapa === 'definindo_pagamento') return ['produtos', 'responde', 'outro_assunto'];
  return ['responde', 'outro_assunto'];
}

const SIGNIFICADO: Record<Leitura['intencao'], string> = {
  pedir_orcamento: 'quer orçamento, preço, cotação ou fazer um pedido',
  responde: 'responde à pergunta que foi feita (mesmo que parcialmente)',
  confirma: 'diz que sim, que está certo',
  nega: 'diz que não, que não é isso',
  produtos: 'manda produtos ou quantidades que quer comprar',
  outro_assunto: 'fala de outra coisa (dúvida, cumprimento, horário, conversa) sem responder à pergunta',
  cancelar: 'quer cancelar ou desistir do orçamento inteiro (não só tirar um produto)',
  recomecar: 'quer recomeçar o orçamento do zero',
};

function esquema(intencoes: Leitura['intencao'][], comCampos: boolean): Record<string, unknown> {
  const texto = { type: 'string' };
  return {
    type: 'object',
    properties: {
      intencao: { type: 'string', enum: intencoes },
      produtos_citados: { type: 'boolean' },
      trecho_dos_produtos: texto,
      cidade_de_entrega: texto,
      uf_de_entrega: texto,
      ...(comCampos ? { cadastro: { type: 'object', properties: Object.fromEntries(CAMPOS_DO_CADASTRO.map(c => [c, texto])), required: [...CAMPOS_DO_CADASTRO], additionalProperties: false } } : {}),
    },
    required: ['intencao', 'produtos_citados', 'trecho_dos_produtos', 'cidade_de_entrega', 'uf_de_entrega', ...(comCampos ? ['cadastro'] : [])],
    additionalProperties: false,
  };
}

/** O pedido à API. Separado para o teste conferir o que vai, sem chamar nada. */
export function pedidoDaLeitura(estado: EstadoDoOrcamento | null, perguntaFeita: string | null, falaDoCliente: string): Record<string, unknown> {
  const intencoes = intencoesPossiveis(estado);
  const comCampos = estado?.etapa === 'coletando_cadastro';
  const system = [
    'Você lê a mensagem de um cliente de uma distribuidora de aço no WhatsApp e devolve só o que ela diz, em JSON. Você NÃO responde ao cliente.',
    '',
    'intencao, uma destas:',
    ...intencoes.map(i => `- ${i}: ${SIGNIFICADO[i]}`),
    '',
    'produtos_citados: true se a mensagem cita produto ou quantidade de material (ex.: "10 vergalhões", "barra 3/8").',
    'trecho_dos_produtos: só as linhas ou o pedaço da mensagem com os produtos e as quantidades, copiados exatamente como o cliente escreveu, sem documento, cidade nem cumprimento. Vazio se não houver produto.',
    'cidade_de_entrega e uf_de_entrega: a cidade (e a sigla do estado) que o CLIENTE escreveu na mensagem dele como lugar da entrega. Nunca copie cidade da pergunta. Vazio se ele não escreveu cidade.',
    ...(comCampos ? ['cadastro: copie exatamente o que o cliente escreveu em cada campo (nome ou razão social, rua sem o número, número, bairro, cidade, sigla do estado, CEP, inscrição estadual). Vazio no que ele não disse. Não invente.'] : []),
  ].join('\n');
  const contexto = perguntaFeita ? `Última pergunta feita ao cliente: "${perguntaFeita}"\n\n` : '';
  return {
    model: MODELO_IA,
    max_tokens: 400,
    system,
    messages: [{ role: 'user', content: `${contexto}Mensagem do cliente:\n"""\n${falaDoCliente}\n"""` }],
    output_config: { format: { type: 'json_schema', schema: esquema(intencoes, comCampos) } },
  };
}

/** A resposta crua da IA, conferida. Qualquer coisa fora do esperado cai no neutro. */
export function lerLeitura(textoJson: string, estado: EstadoDoOrcamento | null): Leitura {
  let bruto: Record<string, unknown>;
  try {
    bruto = JSON.parse(textoJson) as Record<string, unknown>;
  } catch {
    return LEITURA_VAZIA;
  }
  const intencoes = intencoesPossiveis(estado);
  const intencao = intencoes.includes(bruto.intencao as Leitura['intencao']) ? bruto.intencao as Leitura['intencao'] : 'responde';
  const cidade = typeof bruto.cidade_de_entrega === 'string' ? bruto.cidade_de_entrega.trim() : '';
  const uf = typeof bruto.uf_de_entrega === 'string' ? bruto.uf_de_entrega.trim().toUpperCase() : '';
  const campos: CamposDoCadastro = {};
  const cadastro = (bruto.cadastro ?? {}) as Record<string, unknown>;
  for (const c of CAMPOS_DO_CADASTRO) {
    if (typeof cadastro[c] === 'string' && (cadastro[c] as string).trim()) campos[c] = (cadastro[c] as string).trim();
  }
  return {
    intencao,
    campos,
    cidade: cidade ? { cidade, uf: /^[A-Z]{2}$/.test(uf) ? uf : null } : null,
    produtosCitados: bruto.produtos_citados === true,
    produtosTexto: typeof bruto.trecho_dos_produtos === 'string' && bruto.trecho_dos_produtos.trim() ? bruto.trecho_dos_produtos.trim() : null,
  };
}

/** Chama a IA e devolve a leitura. Falha da API vira leitura neutra: a etapa repete a pergunta. */
export async function interpretarMensagem(
  supabase: Client,
  cliente: ClienteIA,
  onde: { orgId: string; conversationId: string; turnoId: string | null },
  estado: EstadoDoOrcamento | null,
  perguntaFeita: string | null,
  falaDoCliente: string,
): Promise<Leitura> {
  try {
    const r = await cliente.chamar(pedidoDaLeitura(estado, perguntaFeita, falaDoCliente));
    await logAiUsage(supabase, { orgId: onde.orgId, origem: 'motor', model: MODELO_IA, usage: r.uso, conversationId: onde.conversationId, turnoId: onde.turnoId });
    return lerLeitura(r.texto, estado);
  } catch (err) {
    console.error('Máquina: a leitura da mensagem falhou:', err instanceof Error ? err.message : err);
    return LEITURA_VAZIA;
  }
}

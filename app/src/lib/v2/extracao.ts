// A extração (Fase D): a IA lê a mensagem do cliente e ETIQUETA. Não conhece
// o catálogo, não vê código de produto, não converte medida, não aplica
// padrão. Devolve, por linha, os itens com família (lista fechada), medidas
// copiadas como o cliente escreveu (com a etiqueta do molde), quantidade,
// números auxiliares e qualificadores. Quem decide é o resolvedor.
//
// PROMPT_VERSION e SCHEMA_VERSION entram na chave do cache: só mudar um dos
// dois gera chamadas novas. Mudança em regra, tabela ou resolvedor reavalia
// com custo zero.

import { vocabularioDoPrompt } from './dicionario';
import { familiasDaExtracao, todasAsEtiquetas } from './familias';
import type { Extracao, ItemExtraido, LinhaExtraida, OperacaoNaLista } from './tipos';

export const MODELO_DA_EXTRACAO = 'claude-haiku-4-5';
export const PROMPT_VERSION = 'extracao-2026-10-05.1';
export const SCHEMA_VERSION = 'schema-2026-10-05.1';
// Com a lista atual e as mudanças nela (V2_OPERACOES, 25/10): outra chave de cache, a leitura de antes não serve.
export const PROMPT_VERSION_OPERACOES = 'extracao-operacoes-2026-10-25.2';
export const SCHEMA_VERSION_OPERACOES = 'schema-operacoes-2026-10-25.2';
export const MAX_TOKENS_DA_EXTRACAO = 8000;

const UNIDADE_LEGIVEL: Record<string, string> = { mm: 'mm', pol: 'polegada', chapa: 'chapa', m: 'metro', cm: 'cm', l: 'litro', kg_m: 'kg/m', numero: 'número' };

function listaDeFamilias(): string {
  return familiasDaExtracao().map(f => {
    const medidas = f.medidas_da_descricao ? 'numero (qualquer número do produto)' : (f.medidas ?? []).map(m => `${m.etiqueta} (${UNIDADE_LEGIVEL[m.unidade]})`).join(', ');
    const atributos = (f.atributos ?? []).map(a => `${a.nome}: ${Object.keys(a.valores).join('/')}`).join('; ');
    return `- ${f.id}: ${f.nome}. Medidas: ${medidas || 'nenhuma'}.${atributos ? ` Qualificadores possíveis: ${atributos}.` : ''}`;
  }).join('\n');
}

// Exemplos só da parte de treino do gabarito (testes 1, 3 e 4) ou escritos à mão.
const EXEMPLOS = `Exemplo 1. Mensagem:
1: 6 cantoneira 3/4
2: 1 kg de eletrodo 2,5
3: 1 lata de zarcão 3,600
Saída (resumida): linha 1 → cantoneira, quantidade {"valor":"6","trecho":"6"}, medidas [{"valor":"3/4","etiqueta":"aba","unidade_escrita":null,"trecho":"3/4"}]. Linha 2 → eletrodo, quantidade {"valor":"1","trecho":"1 kg"}, medidas [{"valor":"2,5","etiqueta":"diametro",...}]. Linha 3 → tinta, quantidade {"valor":"1","trecho":"1 lata"}, medidas [{"valor":"3,600","etiqueta":"volume",...}], qualificadores ["zarcão"].

Exemplo 2. Mensagem:
1: Bom dia, segue o pedido
2: 10 Metalon 50/30/18.
3: 8 ferro U 75 SIMPLES
4: 12 " U 50 SIMPLES
5: Pagamento boleto 28 dias
Saída: linha 1 descartada ("saudação"). Linha 2 → metalon, quantidade 10, medidas lado "50", lado "30", chapa "18" (a barra só separa). Linha 3 → perfil_u_simples, quantidade 8, alma "75", qualificadores ["simples"]. Linha 4 → as aspas repetem a palavra "ferro" da linha 3: perfil_u_simples, quantidade 12, alma "50", qualificadores ["simples"], idem_resolvido_de_linha 3. Linha 5 descartada ("condição de pagamento").

Exemplo 3. Mensagem (lista de vergalhão):
1: Vergalhão
2: 5.0 400
3: 3/8 - 120 barras
Saída: linha 1 descartada ("título da lista"). Linha 2 → vergalhao, medidas [{"valor":"5.0","etiqueta":"bitola"}], quantidade {"valor":"400","trecho":"400"}. Linha 3 → vergalhao, bitola "3/8", quantidade {"valor":"120","trecho":"120 barras"}.

Exemplo 4. Mensagem (foto de lista):
1: 15 BARRA CHATA 3/4" X 1/8" (19X3MM) A-36
2: 6 MT 25x25x18 3
Saída: linha 1 → barra_chata, quantidade 15, medidas largura "3/4" (unidade_escrita "\\""), espessura "1/8"; numeros_auxiliares [{"valor":"19","papel":"mesma_medida_em_outra_unidade","trecho":"(19X3MM)"},{"valor":"3","papel":"mesma_medida_em_outra_unidade","trecho":"(19X3MM)"},{"valor":"36","papel":"especificacao_aco","trecho":"A-36"}]. Linha 2 → metalon ("MT" antes da medida é metalon), medidas lado "25", lado "25", chapa "18"; "6 MT" é o comprimento de 6 metros (vai em numeros_auxiliares com papel "outro", trecho "6 MT"); a quantidade é o número do fim: {"valor":"3","trecho":"3"}.

Exemplo 5. Mensagem:
1: 4 discos inox 7 Norton, 5 kg de solda 2 e meio e 30k arrame torcido cozido
Saída: uma linha com três itens: disco (quantidade 4, diametro "7", qualificadores ["inox","Norton"]); eletrodo (quantidade 5, trecho "5 kg", diametro "2 e meio"); arame (quantidade 30, trecho "30k", sem medidas, qualificadores ["torcido","cozido"]).

Exemplo 6. Mensagem:
1: 3 perfil 68
2: Barra chata 1" 1/4
3: 2 radier de 0,80
Saída: linha 1 → perfil_u_simples (perfil 68 sem dizer o tipo é o simples), alma "68". Linha 2 → barra_chata com DUAS medidas: largura "1" (unidade_escrita "\\"") e espessura "1/4" (as aspas fecham a primeira medida). Linha 3 → corte_e_dobra (radier é feito sob medida), sem medidas obrigatórias.`;

// Escritos à mão, com produtos e frases que não estão nas conversas usadas para medir (22 e 25/10).
const REGRA_DAS_OPERACOES = `6. Lista atual (quando vier no pedido): o que já está anotado, numerado. Quando o cliente pede para MUDAR um item que já está na lista, devolva a mudança em "edicoes", uma entrada por mudança, com item = o número dele na lista e trecho = as palavras do cliente que apontam esse item, copiadas exatamente. Os tipos:
   - tirar: o cliente não quer mais o item.
   - trocar_produto: no lugar do item vai outro produto. por = o produto novo: família (da lista de famílias), medidas (valor e etiqueta) e qualificadores; trecho_novo = as palavras do produto novo, copiadas.
   - mudar_quantidade: quantidade = a nova, como ele escreveu ({"valor","trecho"}); soma = true quando é a mais ("mais 2", "acrescenta 2"), false quando é o total ("são 4", "na verdade 4", "é só 4").
   - mudar_medida: o mesmo produto com uma medida diferente. medida = a medida nova, com a etiqueta das medidas da família do item.
   Os campos que não são do tipo vão null (soma: false). A linha que só pede mudança vai com descartada=true e motivo_descarte "edição da lista". Produto que não está na lista é item novo em "linhas", não edição. Resposta a uma pergunta pendente continua em respostas_a_perguntas. Se não dá para saber qual item, não invente: deixe a mudança de fora.`;

const EXEMPLO_DAS_OPERACOES = `Exemplo 7. Lista atual:
1) 10 × CANTONEIRA 3/4 X 1/8 (família cantoneira)
2) 5 kg de PREGO 17 X 21 (família prego)
3) 2 × DISCO DE CORTE NORTON 7 (família disco)
Mensagem:
1: a cantoneira passa pra 1/4 de espessura e o disco vc troca pelo de desbaste
2: na verdade sao 8 kg de prego
3: acrescenta 3 metalon 50x30
Saída: linhas 1 e 2 descartadas ("edição da lista"). Linha 3 → item novo, metalon, quantidade 3, lado "50", lado "30" (o metalon não está na lista). edicoes: mudar_medida item 1, trecho "a cantoneira", medida {"valor":"1/4","etiqueta":"espessura"}; trocar_produto item 3, trecho "o disco", trecho_novo "de desbaste", por {familia "disco", qualificadores ["desbaste"], medidas []}; mudar_quantidade item 2, trecho "prego", quantidade {"valor":"8","trecho":"8 kg"}, soma false.

Exemplo 8. Lista atual: 1) 4 × PERFIL U SIMPLES 75X40 CH14 (família perfil_u_simples). Mensagem: 1: tira o perfil. Saída: linha 1 descartada ("edição da lista"); edicoes: tirar item 1, trecho "o perfil".`;

export function systemDaExtracao(operacoes = false): string {
  return `Você lê pedidos de orçamento que clientes mandam pelo WhatsApp para a Distribuidora Exemplo, uma distribuidora de ferro e aço, e ETIQUETA o texto. Você NÃO identifica produto, NÃO conhece o catálogo e NUNCA converte medida: quem decide é o sistema, com o que você devolver.

Regras de saída:
1. A mensagem vem com as linhas numeradas. Devolva uma entrada em "linhas" para CADA linha numerada, com o mesmo linha_id e o texto_original copiado exatamente. Nenhuma linha pode faltar.
2. Linha que não é pedido (saudação, nome do vendedor, pagamento, entrega, endereço, nome da obra, título de seção, observação) vai com descartada=true e motivo_descarte curto. Linha de pedido vai com descartada=false e um ou mais itens.
3. Para cada item:
   - familia: escolha da lista de famílias abaixo. Material que não é de ferro nem de serralheria (areia, brita, tijolo, madeira, cal) é fora_do_ramo. Se não souber, nao_identificado.
   - quantidade: {"valor": o número como está escrito, "trecho": o pedaço do texto com a quantidade e a unidade, ex. "5 kg", "30k", "120 barras"}. Sem quantidade: null.
   - medidas: cada medida do produto, uma por entrada, com o valor COPIADO como está ("3/8", "3,8", "1.1/4", "1 e 1/4", "2 e meio", "0,90", "ch18"), a etiqueta escolhida entre as medidas da família, unidade_escrita quando a unidade vem escrita ("mm", "\\"", "cm", "m", "ch") e o trecho de onde saiu. Nunca troque 3/8 por 10 mm, nunca complete medida que o cliente não escreveu.
   - numeros_auxiliares: todo outro número da linha que não é quantidade nem medida: a mesma medida repetida em outra unidade, entre parênteses ("(19X3MM)", papel mesma_medida_em_outra_unidade), a especificação do aço ("A-36", papel especificacao_aco), código fiscal, preço, comprimento da peça e qualquer outro (papel outro).
   - qualificadores: as palavras que distinguem o produto, copiadas: tipo (galvanizado, simples, enrijecido, trançado, sem cabeça, serralheiro, em V, para tubo), marca (Denver, Norton), cor, uso. Sem nenhum: [].
   - termos_nao_reconhecidos: palavra do item que você não entendeu e que pode mudar o produto. Sem nenhuma: [].
   - idem_resolvido_de_linha: quando a linha usa aspas ou "idem" para repetir a linha de cima, o linha_id de onde veio a palavra; senão null.
4. TODO número da linha tem de aparecer em quantidade, medidas ou numeros_auxiliares. Não descarte número.
5. tipo_mensagem: "novos_itens" (pedido), "resposta_pergunta" (o cliente responde às perguntas pendentes), "confirmacao" (o cliente confirma a lista), "outro". Quando houver perguntas pendentes e o cliente responder, preencha respostas_a_perguntas com o id da pergunta e a opção escolhida (o número ou o texto da opção, como o cliente disse). Itens novos na mesma mensagem continuam em "linhas".
${operacoes ? `${REGRA_DAS_OPERACOES}\n` : ''}
Famílias (id: nome. Medidas e qualificadores):
${listaDeFamilias()}

Como o cliente chama cada família (vocabulário):
${vocabularioDoPrompt()}

Jeitos de escrever:
- "50/30/18", "50x30x18", "50 por 30" separam medidas. "1.1/4", "1 1/4", "1 e 1/4" e "1/1/4" são um número só (um e um quarto).
- "ø 12.5" é bitola de vergalhão em mm. "MT" antes da medida é metalon; "6 MT" com número antes é 6 metros.
- Quantidade pode vir no começo ou no fim da linha; numa lista de vergalhão, "5.0 400" é bitola 5.0 e quantidade 400.
- Aspas sozinhas no lugar da palavra (12 " U 50) repetem a palavra da linha de cima.

${EXEMPLOS}${operacoes ? `\n\n${EXEMPLO_DAS_OPERACOES}` : ''}`;
}

// ── schema (saída estruturada obrigatória) ──

export function esquemaDaExtracao(operacoes = false): Record<string, unknown> {
  const familias = familiasDaExtracao().map(f => f.id);
  const etiquetas = todasAsEtiquetas();
  const nulo = { type: 'null' };
  const trecho = { type: 'object', properties: { valor: { type: 'string' }, trecho: { type: 'string' } }, required: ['valor', 'trecho'], additionalProperties: false };
  const item = {
    type: 'object',
    properties: {
      familia: { type: 'string', enum: familias },
      quantidade: { anyOf: [trecho, nulo] },
      medidas: {
        type: 'array',
        items: {
          type: 'object',
          properties: { valor: { type: 'string' }, etiqueta: { type: 'string', enum: etiquetas }, unidade_escrita: { type: ['string', 'null'] }, trecho: { type: 'string' } },
          required: ['valor', 'etiqueta', 'unidade_escrita', 'trecho'], additionalProperties: false,
        },
      },
      numeros_auxiliares: {
        type: 'array',
        items: {
          type: 'object',
          properties: { valor: { type: 'string' }, papel: { type: 'string', enum: ['mesma_medida_em_outra_unidade', 'especificacao_aco', 'outro'] }, trecho: { type: 'string' } },
          required: ['valor', 'papel', 'trecho'], additionalProperties: false,
        },
      },
      qualificadores: { type: 'array', items: { type: 'string' } },
      termos_nao_reconhecidos: { type: 'array', items: { type: 'string' } },
      idem_resolvido_de_linha: { type: ['integer', 'null'] },
    },
    required: ['familia', 'quantidade', 'medidas', 'numeros_auxiliares', 'qualificadores', 'termos_nao_reconhecidos', 'idem_resolvido_de_linha'],
    additionalProperties: false,
  };
  // Sem repetir o item inteiro (com as listas fechadas de família e etiqueta): a API recusou a gramática grande demais
  // (25/10). A família e a etiqueta vão como texto; o código confere as duas.
  const medida = { type: 'object', properties: { valor: { type: 'string' }, etiqueta: { type: 'string' } }, required: ['valor', 'etiqueta'], additionalProperties: false };
  const por = {
    type: 'object',
    properties: { familia: { type: 'string' }, medidas: { type: 'array', items: medida }, qualificadores: { type: 'array', items: { type: 'string' } } },
    required: ['familia', 'medidas', 'qualificadores'], additionalProperties: false,
  };
  const edicao = {
    type: 'object',
    properties: {
      tipo: { type: 'string', enum: ['tirar', 'trocar_produto', 'mudar_quantidade', 'mudar_medida'] },
      item: { type: 'integer' }, trecho: { type: 'string' },
      por: { anyOf: [por, nulo] }, trecho_novo: { type: ['string', 'null'] },
      quantidade: { anyOf: [trecho, nulo] }, soma: { type: 'boolean' },
      medida: { anyOf: [medida, nulo] },
    },
    required: ['tipo', 'item', 'trecho', 'por', 'trecho_novo', 'quantidade', 'soma', 'medida'],
    additionalProperties: false,
  };
  const comEdicoes = operacoes ? { edicoes: { type: 'array', items: edicao } } : {};
  return {
    type: 'object',
    properties: {
      ...comEdicoes,
      tipo_mensagem: { type: 'string', enum: ['novos_itens', 'resposta_pergunta', 'confirmacao', 'outro'] },
      linhas: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            linha_id: { type: 'integer' }, texto_original: { type: 'string' }, descartada: { type: 'boolean' },
            motivo_descarte: { type: ['string', 'null'] }, itens: { type: 'array', items: item },
          },
          required: ['linha_id', 'texto_original', 'descartada', 'motivo_descarte', 'itens'], additionalProperties: false,
        },
      },
      respostas_a_perguntas: {
        type: 'array',
        items: { type: 'object', properties: { pergunta_id: { type: 'string' }, opcao_escolhida: { type: 'string' } }, required: ['pergunta_id', 'opcao_escolhida'], additionalProperties: false },
      },
    },
    required: ['tipo_mensagem', 'linhas', 'respostas_a_perguntas', ...(operacoes ? ['edicoes'] : [])],
    additionalProperties: false,
  };
}

/** Um item da lista atual, como vai para a IA (V2_OPERACOES): o número é o que ela devolve em `edicoes`. */
export interface ItemNaLista { numero: number; descricao: string; familia: string }

// ── o pedido à API ──

/** Uma pergunta que o sistema fez e o cliente ainda não respondeu (contexto da extração). */
export interface PerguntaPendente { id: string; texto: string; opcoes: string[] }

/** As linhas da mensagem, numeradas como a IA vai devolver. */
export function linhasDaMensagem(texto: string): { id: number; texto: string }[] {
  return texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map((l, i) => ({ id: i + 1, texto: l }));
}

/** O conteúdo do usuário: perguntas pendentes (se houver) e a mensagem numerada. Fica fora do system para o cache valer. */
export function conteudoDaExtracao(texto: string, pendentes: PerguntaPendente[] = [], lista: ItemNaLista[] | null = null): string {
  const daLista = lista?.length
    ? `Lista atual do cliente:\n${lista.map(i => `${i.numero}) ${i.descricao} (família ${i.familia})`).join('\n')}\n\n`
    : '';
  const contexto = pendentes.length
    ? `Perguntas pendentes que o sistema fez ao cliente:\n${pendentes.map(p => `- ${p.id}: ${p.texto}${p.opcoes.length ? ` Opções: ${p.opcoes.map((o, i) => `${i + 1}) ${o}`).join(' ')}` : ''}`).join('\n')}\n\n`
    : '';
  return `${daLista}${contexto}Mensagem do cliente, linha por linha:\n${linhasDaMensagem(texto).map(l => `${l.id}: ${l.texto}`).join('\n')}`;
}

/** `lista` não nula liga as operações (V2_OPERACOES): a IA vê o que já está anotado e devolve as mudanças em `edicoes`. */
export function pedidoDeExtracao(texto: string, pendentes: PerguntaPendente[] = [], lista: ItemNaLista[] | null = null): Record<string, unknown> {
  const operacoes = lista !== null;
  return {
    model: MODELO_DA_EXTRACAO,
    max_tokens: MAX_TOKENS_DA_EXTRACAO,
    system: [{ type: 'text', text: systemDaExtracao(operacoes), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: conteudoDaExtracao(texto, pendentes, lista) }],
    output_config: { format: { type: 'json_schema', schema: esquemaDaExtracao(operacoes) } },
  };
}

// ── leitura da resposta ──

const texto = (x: unknown): string => (typeof x === 'string' ? x : x === null || x === undefined ? '' : String(x));
const lista = <T>(x: unknown, f: (v: unknown) => T): T[] => (Array.isArray(x) ? x.map(f) : []);

function lerItem(bruto: unknown): ItemExtraido {
  const i = (bruto ?? {}) as Record<string, unknown>;
  const q = i.quantidade as Record<string, unknown> | null | undefined;
  return {
    familia: texto(i.familia) || 'nao_identificado',
    quantidade: q && texto(q.valor) ? { valor: texto(q.valor), trecho: texto(q.trecho) } : null,
    medidas: lista(i.medidas, m => {
      const x = (m ?? {}) as Record<string, unknown>;
      return { valor: texto(x.valor), etiqueta: texto(x.etiqueta), unidade_escrita: x.unidade_escrita ? texto(x.unidade_escrita) : null, trecho: texto(x.trecho) };
    }),
    numeros_auxiliares: lista(i.numeros_auxiliares, m => {
      const x = (m ?? {}) as Record<string, unknown>;
      const papel = texto(x.papel);
      return { valor: texto(x.valor), papel: (['mesma_medida_em_outra_unidade', 'especificacao_aco'].includes(papel) ? papel : 'outro') as ItemExtraido['numeros_auxiliares'][number]['papel'], trecho: texto(x.trecho) };
    }),
    qualificadores: lista(i.qualificadores, texto).filter(Boolean),
    termos_nao_reconhecidos: lista(i.termos_nao_reconhecidos, texto).filter(Boolean),
    idem_resolvido_de_linha: typeof i.idem_resolvido_de_linha === 'number' ? i.idem_resolvido_de_linha : null,
  };
}

export function lerExtracao(json: string): Extracao {
  const bruto = JSON.parse(json) as Record<string, unknown>;
  const tipo = texto(bruto.tipo_mensagem);
  return {
    tipo_mensagem: (['novos_itens', 'resposta_pergunta', 'confirmacao', 'outro'].includes(tipo) ? tipo : 'outro') as Extracao['tipo_mensagem'],
    linhas: lista(bruto.linhas, l => {
      const x = (l ?? {}) as Record<string, unknown>;
      return {
        linha_id: Number(x.linha_id) || 0, texto_original: texto(x.texto_original), descartada: x.descartada === true,
        motivo_descarte: x.motivo_descarte ? texto(x.motivo_descarte) : null, itens: lista(x.itens, lerItem),
      } satisfies LinhaExtraida;
    }),
    respostas_a_perguntas: lista(bruto.respostas_a_perguntas, r => {
      const x = (r ?? {}) as Record<string, unknown>;
      return { pergunta_id: texto(x.pergunta_id), opcao_escolhida: texto(x.opcao_escolhida) };
    }),
    ...(Array.isArray(bruto.edicoes) ? { edicoes: bruto.edicoes.map(lerEdicaoDaIA).filter((e): e is OperacaoNaLista => !!e) } : {}),
  };
}

/** Uma entrada de `edicoes`; a que não tem o que o tipo exige sai (null). */
function lerEdicaoDaIA(bruto: unknown): OperacaoNaLista | null {
  const x = (bruto ?? {}) as Record<string, unknown>;
  const item = Number(x.item);
  const trecho = texto(x.trecho).trim();
  if (!Number.isInteger(item) || item < 1 || !trecho) return null;
  const q = x.quantidade as Record<string, unknown> | null | undefined;
  const m = x.medida as Record<string, unknown> | null | undefined;
  switch (texto(x.tipo)) {
    case 'tirar': return { tipo: 'tirar', item, trecho };
    case 'trocar_produto':
      return x.por ? { tipo: 'trocar_produto', item, trecho, por: lerItem(x.por), trecho_novo: texto(x.trecho_novo).trim() } : null;
    case 'mudar_quantidade':
      return q && texto(q.valor) ? { tipo: 'mudar_quantidade', item, trecho, quantidade: { valor: texto(q.valor), trecho: texto(q.trecho) }, soma: x.soma === true } : null;
    case 'mudar_medida':
      return m && texto(m.valor) && texto(m.etiqueta)
        ? { tipo: 'mudar_medida', item, trecho, medida: { valor: texto(m.valor), etiqueta: texto(m.etiqueta), unidade_escrita: m.unidade_escrita ? texto(m.unidade_escrita) : null, trecho: texto(m.trecho) } }
        : null;
    default: return null;
  }
}

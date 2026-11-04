// `confirmar_itens`: o fiscal (ver `../fiscal.ts`).
//
// A IA manda TODOS os itens que o cliente pediu: o texto dele, a quantidade, o
// código que ela escolheu (vazio quando não achou) e, separados sem traduzir, o
// item e a medida. O código confere cada um e só então escreve a lista que vai
// ao cliente, com código e descrição do catálogo. A IA nunca escreve a lista.
//
// **O que o código confere (versão 1, decidida em 02/10):**
// - família: as palavras do cliente apontam um tipo de produto ("barra chata")
//   e o código escolhido é de outro;
// - medida: algum número que o cliente escreveu não está no produto
//   (`numerosQueNaoBatem`, parte B). Quem decide é o texto do cliente; a medida
//   que a IA separou passa pela mesma conta só para registro;
// - produto sem medida (fechadura, tinta) passa como "não conferido";
// - item esquecido: a IA mandou menos itens do que as linhas do pedido que
//   parecem item. Avisa uma vez; se ela insistir, a lista sai com as linhas
//   que ficaram de fora, para o cliente dizer se faltou algo.
// Quando algo não bate, a lista NÃO sai: a IA recebe o problema e os produtos
// da mesma família que batem, e chama de novo (ou pergunta ao cliente).
//
// **"Não temos" nunca seco (parte D):** o que a loja não vende (lista fixa do
// dicionário) sai como "não trabalhamos com esse produto"; item sem código que
// existe na família com a medida pedida volta à IA com o código; medida que não
// existe vai na lista com os mais próximos; o resto, "vou confirmar com o
// vendedor".
//
// Fica para depois do Passo 5: gêmeos (vários produtos batem), palavras que
// diferenciam (preta/galvanizada) e a tabela de padrões do dicionário.

import type { FerramentaDoAgente } from './tipos';
import { DICIONARIO_POR_ORG } from '../../catalogo/moldes';
import { limparTexto, lojaNaoTrabalha, maisProximos, normalizarPedido, numerosQueNaoBatem } from '../../catalogo/normalizar';
import { gravarListaEnviada, type ItemDaLista } from '../fiscal';

/** Cabeçalho da lista. `gerar-resposta.ts` usa para saber onde o pedido começa. */
export const CABECALHO_DA_LISTA = 'Confere o pedido:';

const MAX_CANDIDATOS = 8;
/** Quantas opções um item em dúvida mostra na lista ao cliente. */
const MAX_OPCOES_NA_LISTA = 3;

interface ItemDaEntrada {
  clienteEscreveu: string;
  item: string;
  medida: string;
  quantidade: number;
  codigo: string;
}

interface Produto {
  codigo: string;
  descricao: string;
  unidade: string | null;
  molde: string | null;
  medidas: Record<string, string> | null;
}

function lerItens(bruto: unknown): ItemDaEntrada[] {
  if (!Array.isArray(bruto)) return [];
  return bruto.map(i => {
    const x = (i ?? {}) as Record<string, unknown>;
    return {
      clienteEscreveu: String(x.cliente_escreveu ?? '').trim(),
      item: String(x.item ?? '').trim(),
      medida: String(x.medida ?? '').trim(),
      quantidade: Number(x.quantidade),
      codigo: String(x.produto_codigo ?? '').trim(),
    };
  }).filter(i => i.clienteEscreveu && Number.isFinite(i.quantidade) && i.quantidade > 0);
}

/**
 * As linhas do pedido que parecem item: têm palavra, começam pela quantidade
 * ou trazem uma medida (50x30, 3/8, 10mm, ch18, 7"), e não são documento,
 * telefone ou endereço. "Entrega em Jundiaí dia 10" não conta.
 */
export function linhasQueParecemItem(texto: string): string[] {
  return texto.split(/\n/).map(l => l.trim()).filter(linha => {
    // "1º) FERRAGEM AÇO CA-50" é título de seção: o número da frente é a
    // ordem, não a quantidade, e não conta como "começa pela quantidade".
    const l = linha.replace(/^\d+\s*[ºª]\s*\)?\s*|^\d+\s*\)\s*/, '');
    return /[a-zà-ú]{3,}/i.test(l)
    && (/^\(?\s*\d/.test(l) || /\d\s*[x×*]\s*\d|\d\/\d|\d\s*mm\b|\bch\.?\s*\d|\d\s*"/i.test(l))
    && !/cnpj|cpf|\d{2}\.\d{3}\.\d{3}|whats|telefone|\brua\b|\bcep\b/i.test(l);
  });
}

const palavras = (texto: string): string[] => limparTexto(texto).split(/[^a-z0-9/.,]+/).filter(p => p.length >= 2);

/** A linha está coberta quando a maior parte das palavras dela aparece no texto de algum item. */
function linhaCoberta(linha: string, itens: ItemDaEntrada[]): boolean {
  const daLinha = palavras(linha);
  if (!daLinha.length) return true;
  return itens.some(i => {
    const doItem = new Set(palavras(i.clienteEscreveu));
    return daLinha.filter(p => doItem.has(p)).length / daLinha.length >= 0.6;
  });
}

const quantidadeBR = (n: number): string => String(n).replace('.', ',');

/** Como cada item aparece na lista ao cliente. Nunca um "não temos" seco (parte D). */
function linhaDoItem(i: ItemDaLista): string {
  if (i.produto_id) return `${quantidadeBR(i.quantidade)}${i.unidade ? ` ${i.unidade}` : ''} · ${i.produto_id} ${i.descricao}`;
  if (i.conferencia === 'nao_trabalhamos') return `"${i.descricao_livre}": não trabalhamos com esse produto`;
  if (i.conferencia === 'sem_a_medida') return `"${i.descricao_livre}": não temos essa medida. As mais próximas: ${(i.proximos ?? []).join(' ou ')}. Serve alguma?`;
  if (i.conferencia === 'em_duvida') {
    const opcoes = i.proximos ?? [];
    return opcoes.length > MAX_OPCOES_NA_LISTA
      ? `"${i.descricao_livre}": temos mais de uma opção. Qual a medida ou a marca?`
      : `"${i.descricao_livre}": temos estas opções: ${opcoes.join(' ou ')}. Qual delas?`;
  }
  return `"${i.descricao_livre}": não encontrei no catálogo, vou confirmar com o vendedor`;
}

async function lerProdutos(ctx: Parameters<FerramentaDoAgente['executar']>[1], filtro: { codigos?: string[]; moldes?: string[] }): Promise<Produto[]> {
  let consulta = ctx.supabase.from('catalogo_produtos')
    .select('codigo, descricao, unidade, molde, medidas')
    .eq('organization_id', ctx.orgId).eq('ativo', true);
  if (filtro.codigos) consulta = consulta.in('codigo', filtro.codigos);
  if (filtro.moldes) consulta = consulta.in('molde', filtro.moldes);
  const { data, error } = await consulta;
  if (error) throw new Error(error.message);
  return (data ?? []) as Produto[];
}

export const confirmarItensComOCliente: FerramentaDoAgente = {
  definicao: {
    name: 'confirmar_itens',
    description:
      'Confere os itens do pedido e manda ao cliente a lista para ele confirmar, com código e descrição do '
      + 'catálogo. Use depois de achar os produtos com buscar_produtos e ANTES de consultar_preco ou '
      + 'criar_orcamento: sem a lista confirmada pelo cliente, essas duas não funcionam. '
      + 'Mande TODOS os itens que o cliente pediu, um por um, inclusive os que você não achou no catálogo '
      + '(com produto_codigo vazio). Não escreva a lista na sua resposta: o sistema envia. '
      + 'Se a ferramenta disser que algo não bate, corrija o código (ou pergunte ao cliente) e chame de novo. '
      + 'Nunca diga ao cliente que não temos um produto: mande o item sem código, e o sistema responde '
      + 'com as opções mais próximas ou diz que a loja não trabalha com ele.',
    input_schema: {
      type: 'object',
      properties: {
        itens: {
          type: 'array',
          description: 'Todos os itens que o cliente pediu, na ordem em que ele escreveu.',
          items: {
            type: 'object',
            properties: {
              cliente_escreveu: { type: 'string', description: 'O trecho da mensagem do cliente sobre este item, copiado como ele escreveu, com a quantidade e a medida. Ex.: "50 varas de ferro 3.8".' },
              item: { type: 'string', description: 'Só o nome do produto, como o cliente escreveu, sem quantidade e sem medida. Ex.: "varas de ferro".' },
              medida: { type: 'string', description: 'Só a medida, copiada como o cliente escreveu, SEM traduzir nem corrigir. Ex.: "3.8". Vazio se ele não deu medida.' },
              quantidade: { type: 'number', description: 'Quanto o cliente pediu, na unidade do produto.' },
              produto_codigo: { type: 'string', description: 'O código exato que veio de buscar_produtos. Vazio se você não achou o produto ou se não sabe qual entre opções parecidas: o sistema oferece as opções ao cliente.' },
            },
            required: ['cliente_escreveu', 'item', 'medida', 'quantidade', 'produto_codigo'],
            additionalProperties: false,
          },
        },
      },
      required: ['itens'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    const itens = lerItens(entrada.itens);
    if (!itens.length) {
      return 'Nenhum item válido. Mande cada item com o que o cliente escreveu e a quantidade.';
    }
    const dicionario = DICIONARIO_POR_ORG[ctx.orgId] ?? null;

    let produtos: Produto[];
    try {
      produtos = await lerProdutos(ctx, { codigos: [...new Set(itens.map(i => i.codigo).filter(Boolean))] });
    } catch (err) {
      console.error('confirmar_itens: não consegui ler o catálogo:', err instanceof Error ? err.message : err);
      return 'Não consegui conferir os itens agora. Diga ao cliente que vai confirmar o pedido e já retorna.';
    }
    const porCodigo = new Map(produtos.map(p => [p.codigo, p]));

    const problemas: string[] = [];
    const lista: ItemDaLista[] = [];
    const familiaDoTexto = async (familias: string[]): Promise<Produto[]> => {
      try {
        return familias.length ? await lerProdutos(ctx, { moldes: familias }) : [];
      } catch (err) {
        console.error('confirmar_itens: não consegui buscar candidatos:', err instanceof Error ? err.message : err);
        return [];
      }
    };
    const nomes = (ps: Produto[]): string => ps.map(p => `${p.codigo} ${p.descricao}`).join(' | ');

    for (const [n, i] of itens.entries()) {
      const rotulo = `Item ${n + 1} ("${i.clienteEscreveu}")`;
      const base = { descricao_livre: i.clienteEscreveu, item: i.item, medida: i.medida, quantidade: i.quantidade };
      const semProduto = { ...base, produto_id: null, descricao: null, unidade: null, conferencia_pelo_campo_medida: 'sem_medida' as const };

      // Parte D: o que a loja não vende sai como tal, mesmo que exista um
      // código no catálogo (a veda calha 701987 existe e não se trabalha com ela).
      if (lojaNaoTrabalha(i.clienteEscreveu, dicionario)) {
        lista.push({ ...semProduto, conferencia: 'nao_trabalhamos' });
        continue;
      }

      const pedido = normalizarPedido(i.clienteEscreveu, i.quantidade, dicionario);

      if (!i.codigo) {
        // A IA não achou. Antes de dizer qualquer coisa ao cliente, o código
        // procura na família que o texto aponta: se existe com a medida pedida,
        // é a IA que precisa mandar o código ("não temos" para o que tem é o
        // erro médio da lista); se só existe parecido, a lista oferece os mais
        // próximos; sem família, fica para o vendedor confirmar.
        const daFamilia = (await familiaDoTexto(pedido.familias)).filter(p => p.medidas);
        // Sem número no texto ("discos de cortar ferro"), toda a família serve.
        const exatos = pedido.numeros.length ? daFamilia.filter(p => numerosQueNaoBatem(pedido, p.medidas!).length === 0) : daFamilia;
        if (exatos.length === 1) {
          problemas.push(`${rotulo}: você mandou sem código, mas existe: ${nomes(exatos)}. Mande com esse código.`);
          continue;
        }
        // Item em dúvida (mais de um produto serve): a pergunta vai JUNTO com a
        // lista, com as opções escritas pelo código (decisão de 02/10). Até 3
        // opções; com mais, a lista pede a medida ou a marca que falta.
        if (exatos.length > 1) {
          lista.push({ ...semProduto, conferencia: 'em_duvida', proximos: exatos.slice(0, MAX_OPCOES_NA_LISTA + 1).map(p => `${p.codigo} ${p.descricao}`) });
          continue;
        }
        const proximos = maisProximos(pedido, daFamilia);
        if (proximos.length) {
          lista.push({ ...semProduto, conferencia: 'sem_a_medida', proximos: proximos.map(p => `${p.codigo} ${p.descricao}`) });
          continue;
        }
        lista.push({ ...semProduto, conferencia: 'nao_encontrado' });
        continue;
      }

      const produto = porCodigo.get(i.codigo);
      if (!produto) {
        problemas.push(`${rotulo}: o código ${i.codigo} não existe no catálogo. Use buscar_produtos e mande o código exato.`);
        continue;
      }
      const daLista = { ...base, produto_id: produto.codigo, descricao: produto.descricao, unidade: produto.unidade };
      if (!produto.molde || !produto.medidas) {
        lista.push({ ...daLista, conferencia: 'nao_conferido', conferencia_pelo_campo_medida: 'sem_medida' });
        continue;
      }

      const outraFamilia = pedido.familias.length > 0 && !pedido.familias.includes(produto.molde);
      const sobra = numerosQueNaoBatem(pedido, produto.medidas);
      const pelaMedida = i.medida
        ? (numerosQueNaoBatem(normalizarPedido(`${i.item} ${i.medida}`, null, dicionario), produto.medidas).length ? 'nao_bate' : 'bate')
        : 'sem_campo';

      if (!outraFamilia && !sobra.length) {
        lista.push({ ...daLista, conferencia: 'conferido', conferencia_pelo_campo_medida: pelaMedida });
        continue;
      }

      const daFamilia = (await familiaDoTexto(pedido.familias.length ? pedido.familias : [produto.molde])).filter(p => p.medidas);
      const candidatos = daFamilia.filter(p => numerosQueNaoBatem(pedido, p.medidas!).length === 0);
      const motivo = outraFamilia
        ? `o cliente pediu ${pedido.familias.join(' ou ')} e o ${produto.codigo} é ${produto.descricao}`
        : `o ${produto.codigo} é ${produto.descricao} e não tem ${sobra.map(s => s.texto).join(', ')}, que o cliente escreveu`;
      let saida: string;
      if (candidatos.length) {
        saida = ` Batem com o que ele escreveu: ${nomes(candidatos.slice(0, MAX_CANDIDATOS))}`
          + `${candidatos.length > MAX_CANDIDATOS ? ` (e mais ${candidatos.length - MAX_CANDIDATOS})` : ''}.`
          + (candidatos.length > 1 ? ' Se não souber qual, pergunte ao cliente.' : '');
      } else {
        const proximos = maisProximos(pedido, daFamilia);
        saida = ' Nenhum produto desse tipo tem essa medida.'
          + (proximos.length ? ` Os mais próximos: ${nomes(proximos)}.` : '')
          + ' Mande o item com produto_codigo vazio: o sistema oferece os mais próximos ao cliente. Ou pergunte a ele.';
      }
      problemas.push(`${rotulo}: ${motivo}.${saida}`);
    }

    if (problemas.length) {
      return 'A lista NÃO foi enviada ao cliente. Corrija e chame confirmar_itens de novo, com TODOS os itens:\n'
        + problemas.map(p => `- ${p}`).join('\n');
    }

    // Item esquecido: dois pares de olhos. Avisa uma vez por resposta; se a IA
    // insistir, a lista sai com as linhas de fora, e quem decide é o cliente.
    const linhas = linhasQueParecemItem(ctx.falasDoPedido ?? '');
    const deFora = itens.length < linhas.length ? linhas.filter(l => !linhaCoberta(l, itens)) : [];
    if (deFora.length && ctx.fiscal && !ctx.fiscal.avisouEsquecidos) {
      ctx.fiscal.avisouEsquecidos = true;
      return `A lista NÃO foi enviada. O pedido do cliente parece ter ${linhas.length} itens e você mandou ${itens.length}. `
        + `Estas linhas não estão em nenhum item: ${deFora.map(l => `"${l}"`).join(', ')}. `
        + 'Se forem itens, busque e inclua (sem código, se não achar). Se não forem, chame confirmar_itens de novo com os mesmos itens.';
    }

    const linhasDaLista = lista.map((i, n) => `${n + 1}. ${linhaDoItem(i)}`);
    const partes = [CABECALHO_DA_LISTA, linhasDaLista.join('\n')];
    if (deFora.length) partes.push(`Não entendi como item: ${deFora.map(l => `"${l}"`).join(', ')}. Faltou algo?`);
    partes.push('Está certo? Se quiser mudar algo, é só falar.');

    try {
      await gravarListaEnviada(ctx, lista);
    } catch (err) {
      console.error('confirmar_itens: não consegui gravar a lista:', err instanceof Error ? err.message : err);
      return 'Não consegui registrar a lista agora. Diga ao cliente que vai confirmar o pedido e já retorna.';
    }
    ctx.mensagensDoSistema?.push(partes.join('\n\n'));

    const comCodigo = lista.filter(i => i.produto_id).map(i => `${i.produto_id} x ${quantidadeBR(i.quantidade)}`).join(', ');
    return 'A lista JÁ FOI ENVIADA ao cliente pelo sistema, logo depois da sua resposta. NÃO repita os itens: '
      + 'escreva só uma frase curta antes dela (ex.: "Antes de fechar, confere comigo:"). Quando o cliente '
      + `confirmar, use exatamente estes itens: ${comCodigo || 'nenhum com código'}. Se ele mudar algo, chame confirmar_itens de novo.`;
  },
};

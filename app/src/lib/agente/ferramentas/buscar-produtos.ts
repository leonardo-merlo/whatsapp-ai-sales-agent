// A ferramenta que abre o catálogo por assunto.
//
// O desenho, na frase mais curta: **a IA identifica o assunto, o código busca
// as linhas.** Ela nunca vê o catálogo inteiro, e por isso não tem como
// inventar um produto — só pode escolher entre linhas que este arquivo leu do
// banco e mostrou a ela.
//
// A ferramenta aceita até quatro assuntos de uma vez, e isso é economia de
// verdade: uma mensagem de cliente da Distribuidora Exemplo costuma misturar famílias
// ("12 vara de 5/16 e 3 rolo de arame recozido 18"). Um assunto por volta
// gastaria uma chamada ao modelo por família.

import type { FerramentaDoAgente } from './tipos';
import { buscarProdutosDigitados, buscarProdutosPorGrupo } from '../../catalogo/consultar';
import { usaFiscal } from '../fiscal';

const MAX_ASSUNTOS = 4;

function precoBR(valor: number | null): string {
  if (valor === null || valor === undefined) return 'preço não informado';
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

export const buscarProdutosDoCatalogo: FerramentaDoAgente = {
  definicao: {
    name: 'buscar_produtos',
    description:
      'Abre o catálogo da empresa num ou mais assuntos e devolve os produtos daquele assunto, com '
      + 'código, descrição e preço. Use SEMPRE antes de falar de qualquer produto: você não tem o '
      + 'catálogo de cor, e só pode citar produto que apareça no resultado desta ferramenta. '
      + 'Informe o código do assunto como ele aparece na lista do catálogo; o nome do assunto, ou um '
      + 'pedaço do nome do produto, também são aceitos. '
      + 'Se o cliente pediu coisas de assuntos diferentes, peça todos de uma vez.',
    input_schema: {
      type: 'object',
      properties: {
        assuntos: {
          type: 'array',
          items: { type: 'string' },
          description: `Códigos ou nomes dos assuntos do catálogo, ou um pedaço do nome do produto. No máximo ${MAX_ASSUNTOS}.`,
        },
      },
      required: ['assuntos'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    const pedidos = Array.isArray(entrada.assuntos) ? entrada.assuntos : [];
    const assuntos = pedidos.map(a => String(a).trim()).filter(Boolean).slice(0, MAX_ASSUNTOS);
    if (!assuntos.length) {
      return 'Nenhum assunto informado. Escolha um dos assuntos da lista do catálogo e peça de novo.';
    }

    // Duas fontes, uma ferramenta. O catálogo importado tem assuntos e código;
    // a lista digitada da aba Empresa não tem nem um nem outro, e casa pelo
    // texto. Para o modelo isso é invisível — e é o que faz "uma seção
    // Produtos só" ser verdade também do lado de dentro.
    // Quem decide se a lista digitada conta é o prompt, e ela chega aqui
    // pronta: os dois têm que enxergar a MESMA lista, senão o modelo pede um
    // produto que o índice mostrou e a busca jura que não existe.
    const usaDigitados = ctx.usaListaDigitada ?? true;
    const [porGrupo, digitados] = await Promise.all([
      buscarProdutosPorGrupo(ctx.supabase, ctx.orgId, assuntos),
      usaDigitados ? buscarProdutosDigitados(ctx.supabase, ctx.orgId, assuntos) : Promise.resolve([]),
    ]);
    const { produtos, gruposEncontrados, naoEncontrados, cortado } = porGrupo;

    const partes: string[] = [];

    if (naoEncontrados.length && !digitados.length) {
      partes.push(`Não existe assunto no catálogo com: ${naoEncontrados.join(', ')}. `
        + 'Escolha um dos assuntos da lista do catálogo.');
    }

    if (digitados.length) {
      const linhas = digitados.map(p => [
        p.proc,
        p.valor,
        p.descricao,
        p.observacoes,
      ].filter(Boolean).join(' | '));
      partes.push(`PRODUTOS E SERVIÇOS (${digitados.length})\n${linhas.join('\n')}`);
    }

    if (!produtos.length) {
      if (gruposEncontrados.length) {
        partes.push(`O assunto existe, mas não há produto cadastrado nele: ${gruposEncontrados.map(g => g.nome).join(', ')}.`);
      }
      if (!partes.length) return 'Nenhum produto encontrado nesses assuntos.';
      partes.push(
        'Use o nome e o valor EXATAMENTE como estão acima. Se o que o cliente pediu não está nesta '
        + 'lista, diga que não encontrou — NUNCA troque por outro parecido.',
      );
      return partes.join('\n\n');
    }

    for (const grupo of gruposEncontrados) {
      const doGrupo = produtos.filter(p => p.grupoCodigo === grupo.codigo);
      if (!doGrupo.length) continue;
      const linhas = doGrupo.map(p => {
        const extras = Object.entries(p.dados).map(([k, v]) => `${k}: ${v}`).join(', ');
        return [
          p.codigo,
          p.descricao,
          precoBR(p.preco) + (p.unidade ? ` / ${p.unidade}` : ''),
          extras,
        ].filter(Boolean).join(' | ');
      });
      partes.push(`ASSUNTO ${grupo.codigo} — ${grupo.nome} (${doGrupo.length} produto(s))\n${linhas.join('\n')}`);
    }

    if (cortado) {
      partes.push('A lista foi cortada por ser longa demais. Se não achou o que o cliente pediu, '
        + 'peça um assunto mais específico em vez de concluir que não existe.');
    }

    // O fecho é instrução, e é o ponto todo da ferramenta. Sem ele o modelo
    // tende a "aproximar" a medida pedida — e um item errado dentro de um
    // orçamento é pior que um item faltando, porque o vendedor lança sem
    // conferir.
    partes.push(usaFiscal(ctx.orgId)
      // Com o fiscal (`fiscal.ts`), o "não encontrei" também passa pelo
      // código: ele confere se existe, e oferece os mais próximos ao cliente
      // em vez de um "não temos" seco (parte D).
      ? 'Use o código EXATAMENTE como está acima. Confira número por número que o produto bate com o '
        + 'que o cliente pediu: bitola, espessura, medida. Se o que ele pediu não está nesta lista, NÃO '
        + 'diga que não temos: mande o item em confirmar_itens com produto_codigo vazio, e o sistema '
        + 'confere e oferece ao cliente os mais próximos. NUNCA troque a medida pedida por outra parecida. '
        + 'Se houver mais de um candidato possível, pergunte ao cliente em vez de escolher.'
      : 'Use o código e a descrição EXATAMENTE como estão acima. Confira número por número que o '
        + 'produto bate com o que o cliente pediu: bitola, espessura, medida. Se o que ele pediu não '
        + 'está nesta lista, diga que não encontrou — NUNCA troque a medida pedida por outra parecida. '
        + 'Se houver mais de um candidato possível, pergunte ao cliente em vez de escolher.',
    );

    return partes.join('\n\n');
  },
};

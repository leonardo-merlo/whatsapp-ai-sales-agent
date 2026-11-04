// As duas ferramentas de preço: consultar quanto custa, e criar o orçamento.
//
// **O que estas duas têm de diferente de todas as outras:** elas colocam uma
// mensagem em `ctx.mensagensDoSistema`, e é essa mensagem — montada pelo
// código, copiando número por número a resposta do sistema do cliente — que o
// cliente final vai ler. O modelo nunca escreve valor. Ele fica sabendo disso
// pelo próprio resultado da ferramenta, e escreve só a moldura.
//
// Se um dia alguém precisar mudar o texto dos valores, o lugar é
// `src/lib/erp/mensagem-do-orcamento.ts` — não o prompt.

import type { FerramentaDoAgente } from './tipos';
import { condicaoPadraoDaIntegracao, cotarProdutos } from '../../erp/operacoes/cotar';
import { criarOrcamento } from '../../erp/operacoes/criar-orcamento';
import { umaVezSo } from '../../erp/idempotencia';
import { mensagemDaCotacao, mensagemDoOrcamento, reais } from '../../erp/mensagem-do-orcamento';
import { conexaoDaFerramenta, ESQUEMA_DOS_ITENS, itensDaEntrada, recadoDaFalha } from './erp-apoio';
import { clienteIdDaChamada } from './memoria-do-erp';
import { avisarVendedorDoOrcamento } from '../avisar-vendedor';
import { marcarOrcamentoCriado, travaDaListaConfirmada } from '../fiscal';

const SEM_ITENS =
  'Nenhum item válido. Confirme com o cliente o que ele quer e use buscar_produtos para achar o '
  + 'código exato antes de tentar de novo.';

export const consultarPrecoNoSistema: FerramentaDoAgente = {
  definicao: {
    name: 'consultar_preco',
    description:
      'Consulta no sistema da empresa quanto custam os itens, SEM criar orçamento. Use quando o '
      + 'cliente perguntar preço e ainda não quiser fechar. ATENÇÃO: a tabela com os valores é enviada '
      + 'ao cliente automaticamente pelo sistema — você não deve repetir nem reescrever nenhum valor.',
    input_schema: {
      type: 'object',
      properties: {
        cliente_id: { type: 'string', description: 'O cliente_id, quando já souber. O preço pode depender dele.' },
        itens: ESQUEMA_DOS_ITENS as unknown as Record<string, unknown>,
      },
      required: ['itens'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    const itens = itensDaEntrada(entrada.itens);
    if (!itens.length) return SEM_ITENS;

    // **Sem cliente não se cota**, pela mesma razão que não se cria orçamento:
    // o preço da Distribuidora Exemplo depende do cadastro (a condição de pagamento muda a
    // tabela). Cotar com cliente nulo gasta uma ida ao sistema deles para
    // receber um preço que não vale para ninguém — foi o que apareceu no
    // primeiro teste real, em 20/09: duas chamadas a `/cotacoes` disparadas
    // antes de o cliente ter sido identificado, só porque a palavra "orçamento"
    // estava na mensagem.
    const clienteId = clienteIdDaChamada(entrada, ctx);
    if (!clienteId) {
      return 'Sem cliente_id não dá para consultar preço: o valor depende do cadastro. '
        + 'Peça o CPF ou CNPJ e use consultar_cliente primeiro.';
    }

    // **Identificou agora? Então não cota agora.**
    //
    // Nos testes de 20/09 o agente identificava o cliente e, na volta seguinte
    // do mesmo laço, cotava — sem o cliente final ter dito nada entre uma coisa
    // e outra. Duas instruções tentaram impedir isso ("só consulte preço com o
    // cadastro confirmado, o produto e a quantidade fechados") e as duas foram
    // ignoradas. A regra vale mais como fato do que como pedido: se a
    // identificação saiu nesta resposta, o cliente **não falou desde então**,
    // então não existe confirmação possível — o preço sairia sobre um pedido
    // que ninguém confirmou.
    //
    // Na volta seguinte da conversa, com o cliente já identificado antes, esta
    // trava não vale e a cotação sai normalmente.
    if (ctx.clienteIdentificadoAgora) {
      return 'Você acabou de identificar o cliente, e ele ainda não confirmou nada depois disso. '
        + 'NÃO consulte preço agora. Confirme com ele, numa mensagem: o cadastro que você achou, '
        + 'qual produto (a variação exata) e a quantidade. Quando ele responder, aí sim consulte.';
    }

    // Fiscal ligado: só com a lista que o cliente viu e confirmou (`fiscal.ts`).
    const travaDaLista = await travaDaListaConfirmada(ctx, itens);
    if (travaDaLista) return travaDaLista;

    const conexao = await conexaoDaFerramenta(ctx);
    if (!conexao.ok) return conexao.recado;

    const r = await cotarProdutos(conexao.conexao, {
      clienteId,
      vendedorId: ctx.vendedor?.codigoErp || null,
      condicaoPagamento: condicaoPadraoDaIntegracao(conexao.config),
      itens,
    });
    if (!r.ok) return recadoDaFalha(r);

    ctx.mensagensDoSistema?.push(mensagemDaCotacao(r.dados));

    return `Preço consultado: ${r.dados.itens.length} item(ns), total ${reais(r.dados.valor_total)}. `
      + 'A tabela com os valores JÁ FOI ENVIADA ao cliente pelo sistema, logo depois da sua resposta. '
      + 'NÃO repita valores nem totais: escreva só uma frase curta (por exemplo, perguntando se ele '
      + 'quer que você feche o orçamento).';
  },
};

export const criarOrcamentoNoSistema: FerramentaDoAgente = {
  definicao: {
    name: 'criar_orcamento',
    description:
      'Cria o orçamento no sistema da empresa. Use quando o cliente confirmar o que quer. ATENÇÃO: o '
      + 'orçamento com itens e valores é enviado ao cliente automaticamente pelo sistema — você não '
      + 'deve repetir nem reescrever nenhum valor.',
    input_schema: {
      type: 'object',
      properties: {
        // Deixou de ser obrigatório de propósito: obrigar o modelo a mandar um
        // id que ele não tem mais (o laço da resposta anterior sumiu) é o
        // convite para ele inventar um. Sem o campo, o sistema usa o que a
        // conversa já identificou.
        cliente_id: {
          type: 'string',
          description: 'O cliente_id no sistema da empresa. Só mande se souber; deixe de fora se não '
            + 'tiver certeza — o sistema usa o cliente que esta conversa já identificou. NUNCA invente.',
        },
        itens: ESQUEMA_DOS_ITENS as unknown as Record<string, unknown>,
      },
      required: ['itens'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    // O modelo esquece o cliente_id entre uma mensagem e outra — o laço de
    // ferramentas dura uma resposta só. Quando ele não manda, vale o que a
    // CONVERSA descobriu (`conversations.erp_cliente_id`). Foi a falta disso
    // que derrubou o primeiro teste real do fluxo, em 14/09.
    const clienteId = clienteIdDaChamada(entrada, ctx);
    if (!clienteId) {
      return 'Sem cliente_id não dá para criar orçamento. Peça o CPF ou CNPJ e use consultar_cliente antes.';
    }
    // **Aqui NÃO existe a trava de "identificou agora" que `consultar_preco`
    // tem, e a diferença é decisão de produto, não descuido.** O fluxo
    // combinado com a Distribuidora Exemplo em 13/09 é automático: o cliente diz o
    // documento e o que quer, e o orçamento sai pronto, na mesma resposta.
    // Dois testes do bloco C guardam isso, e foi o que barrou a tentativa de
    // travar também esta ferramenta, em 20/09. O que `consultar_preco` impede é
    // outra coisa: cotar sem ninguém ter pedido preço nenhum.
    const itens = itensDaEntrada(entrada.itens);
    if (!itens.length) return SEM_ITENS;

    // Fiscal ligado: com ele, o orçamento deixa de sair na mesma resposta do
    // pedido; passa sempre pela lista confirmada (decisão de 01/10).
    const travaDaLista = await travaDaListaConfirmada(ctx, itens);
    if (travaDaLista) return travaDaLista;

    const conexao = await conexaoDaFerramenta(ctx);
    if (!conexao.ok) return conexao.recado;

    const pedido = { clienteId, vendedorId: ctx.vendedor?.codigoErp || null, itens };

    const resultado = await umaVezSo(
      { supabase: ctx.supabase, orgId: ctx.orgId, conversationId: ctx.conversationId, mensagemId: ctx.mensagemId ?? null },
      'criar_orcamento',
      pedido,
      async (chave) => {
        const r = await criarOrcamento(conexao.conexao, pedido, chave);
        return { ok: r.ok, valor: r };
      },
    );

    if (resultado.estado === 'em-andamento') {
      // É este caminho que impede o reenvio da Meta virar dois orçamentos.
      return 'Este orçamento já está sendo criado neste instante. NÃO peça de novo — seria um segundo '
        + 'orçamento para o mesmo pedido. Diga ao cliente que já está saindo.';
    }
    if (resultado.estado === 'falhou') {
      return recadoDaFalha({ ok: false, motivo: 'indisponivel', codigo: 'falha', mensagem: '' });
    }

    const r = resultado.dados;
    if (!r.ok) return recadoDaFalha(r);

    // Repetição do mesmo pedido: o orçamento já existe e já foi mandado ao
    // cliente da primeira vez. Mandar de novo seria confundi-lo.
    if (resultado.estado === 'ja-feito') {
      return `O orçamento ${r.dados.numero ?? r.dados.id} já havia sido criado para este pedido e o `
        + 'cliente já recebeu. NÃO crie outro: apenas confirme que ele está com o orçamento.';
    }

    ctx.mensagensDoSistema?.push(mensagemDoOrcamento(r.dados));
    await marcarOrcamentoCriado(ctx);

    // O vendedor é INFORMADO, não convocado: o orçamento já foi ao cliente.
    // Falha aqui não desfaz nada e não interrompe a conversa — o aviso é
    // importante, o orçamento do cliente é mais.
    const aviso = await avisarVendedorDoOrcamento(ctx.supabase, {
      orgId: ctx.orgId, orcamento: r.dados, nomeDoCliente: ctx.contatoNome ?? '', vendedor: ctx.vendedor,
    });
    if (!aviso.avisado) console.warn(`Aviso do orçamento não enviado ao vendedor: ${aviso.motivo}`);

    return `Orçamento ${r.dados.numero ?? r.dados.id} criado, total ${reais(r.dados.valor_total)}. `
      + 'Os itens e valores JÁ FORAM ENVIADOS ao cliente pelo sistema, logo depois da sua resposta. '
      + 'NÃO repita valores, totais nem desconto: escreva só uma frase curta de abertura, como '
      + '"segue o seu orçamento" e "qualquer dúvida me chama".';
  },
};

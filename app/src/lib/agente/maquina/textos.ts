// As frases fixas de cada etapa. Decisão do Leonardo em 07/10 (decisão 2, B):
// a pergunta da etapa é escrita aqui, não pela IA. Assim a IA não pula etapa e
// não improvisa. Ela só escreve quando o cliente muda de assunto.
//
// Estilo: curto, de WhatsApp, sem travessão.

import { TEXTO_DA_LISTA_CONFIRMADA } from '../../v2/integracao-v1';
import { diaMesEmSP } from '../../fuso';
import { ROTULO_DO_CAMPO } from './cadastro';
import { bandeirasPossiveis, emTopicos, linhasDoMenu, opcoesDoOrcamento, reais, textoDoPagamento } from './pagamento';
import { perguntaAtual, type ChaveDoTexto } from './transicoes';
import type { EstadoDoOrcamento } from './tipos';

/** "a, b e c" */
function emLista(partes: string[]): string {
  return partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

const tituloDaCidade = (cidade: string): string =>
  cidade.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, espaco: string, letra: string) => espaco + letra.toUpperCase())
    .replace(/\b(De|Da|Do|Das|Dos|E)\b/g, p => p.toLowerCase());

export interface ContextoDosTextos {
  /** Os estados atendidos, por extenso (vêm de `erp_regioes`). */
  estados: string[];
  /** O número e a validade do orçamento, quando a lista já foi confirmada (T1). */
  orcamento?: { numero: number; expiraEm: string } | null;
}

/** "Orçamento nº 123, vale até 26/10. ", ou nada se ainda não tem número. */
function numeroEValidade(ctx: ContextoDosTextos): string {
  const o = ctx.orcamento;
  return o ? `Orçamento nº ${o.numero}, vale até ${diaMesEmSP(o.expiraEm)}. ` : '';
}

// Válvula de escape (22/10): o cliente saiu do roteiro. Frases fixas, nunca cortadas por `semPerguntas`.
export const PASSAR_AO_ATENDENTE = 'Vou passar para um atendente continuar com você.';
export const NAO_OUVI_O_AUDIO = 'Não consegui ouvir o áudio. Pode escrever?';
export const NAO_ABRE_ESSA_MENSAGEM = 'Não consigo abrir esse tipo de mensagem. Pode escrever?';

/**
 * A 2ª vez sem entender: como responder a pergunta da etapa, com as opções escritas.
 * `comNaoEntendi` falso quando outra frase já abre a resposta (a do áudio, a resposta da IA).
 * Null: a etapa não tem pergunta.
 */
export function textoDeNaoEntendi(estado: EstadoDoOrcamento, comNaoEntendi: boolean): string | null {
  const d = estado.dados;
  const opcoes = opcoesDoOrcamento(d);
  const partes = ((): [string, string] | null => {
    switch (estado.pergunta) {
      case 'documento': return ['Não entendi.', 'Me manda só os números do CPF ou do CNPJ.'];
      case 'mesmo_cadastro':
        return ['Não entendi.', `Responda SIM se o orçamento é para ${d.cadastro_anterior?.cliente.nome ?? 'o mesmo cadastro'}, ou me manda o CPF ou CNPJ de quem está comprando.`];
      case 'confirmar_cliente': return ['Não entendi.', `Responda SIM se o cadastro é ${d.cliente?.nome ?? 'esse'}, ou NÃO se não for.`];
      case 'dados_do_cadastro': {
        const falta = d.cadastro_novo?.faltando ?? [];
        return ['Não entendi.', falta.length ? `Me manda só o que falta: ${emLista(falta.map(c => ROTULO_DO_CAMPO[c]))}.` : 'Me manda o endereço completo do cadastro.'];
      }
      case 'cidade': return ['Não entendi.', 'Me diga só o nome da cidade de entrega, por exemplo: Jundiaí.'];
      case 'produtos':
        return d.v2_pedido_id
          ? ['Não entendi.', 'Responda SIM para seguir com a lista, ou me diga o que tirar ou trocar, por exemplo: tira o prego.']
          : ['Não entendi.', 'Me manda os produtos com as quantidades, por exemplo: 10 barras de vergalhão 3/8.'];
      case 'pagamento': return ['Não entendi a forma.', `Pode escolher uma destas:\n\n${emTopicos(linhasDoMenu(opcoes))}`];
      case 'parcelas': return ['Não entendi.', 'Me diga só o número de vezes, por exemplo: 3x.'];
      case 'bandeira': return ['Não entendi.', `Me diga só a bandeira do cartão: ${bandeirasPossiveis(opcoes, d.pagamento_parcial ?? { grupo: 'credito' })}.`];
      case 'opcao_de_pagamento': return ['Não entendi.', textoDoPagamento('opcao', d)];
      case null: return null;
    }
  })();
  if (!partes) return null;
  return comNaoEntendi ? partes.join(' ') : partes[1];
}

export function textoDaEtapa(chave: ChaveDoTexto, estado: EstadoDoOrcamento | null, ctx: ContextoDosTextos): string {
  const d = estado?.dados ?? {};
  switch (chave) {
    case 'pedir_documento':
      return 'Para montar o orçamento, me passa o CPF ou CNPJ de quem está comprando?';
    case 'documento_invalido':
      return 'Esse número não é um CPF ou CNPJ válido. Pode conferir? Se ainda não tem cadastro com a gente, me manda o CPF ou CNPJ certo que eu faço o cadastro agora.';
    case 'confirmar_mesmo_cadastro':
      {
      const entrega = d.cadastro_anterior?.entrega;
      return `Esse orçamento é para o mesmo cadastro, ${d.cadastro_anterior?.cliente.nome ?? 'o do orçamento anterior'}${entrega ? `, com entrega em ${tituloDaCidade(entrega.cidade)}` : ''}?`;
    }
    case 'pedir_outro_documento':
      return 'Sem problema. Me passa o CPF ou CNPJ certo?';
    case 'pedir_dados_do_cadastro':
      return 'Não achei cadastro com esse documento, vou fazer agora. Me manda numa mensagem só: '
        + 'nome ou razão social, rua, número, bairro, cidade, estado e CEP. Se for empresa, a inscrição estadual também.';
    case 'faltam_dados': {
      const falta = d.cadastro_novo?.faltando ?? [];
      if (!falta.length) return 'Me confirma os dados do cadastro, por favor?';
      return `Falta só ${emLista(falta.map(c => ROTULO_DO_CAMPO[c]))} para eu concluir o cadastro.`;
    }
    case 'cadastro_recusado':
      return 'Não consegui concluir o cadastro com esses dados. Pode conferir o endereço completo e mandar de novo?';
    case 'confirmar_cliente': {
      const c = d.cliente;
      const onde = c?.cidade ? `, de ${tituloDaCidade(c.cidade)}${c.uf ? `/${c.uf}` : ''}` : '';
      return `Achei aqui: ${c?.nome ?? 'o cadastro'}${onde}. É esse cadastro mesmo?`;
    }
    case 'pedir_cidade':
      return 'Qual a cidade de entrega?';
    case 'cadastro_feito_pedir_cidade': {
      const cidade = d.cliente?.cidade;
      return cidade
        ? `Cadastro feito! A entrega é em ${tituloDaCidade(cidade)} mesmo, ou em outra cidade?`
        : 'Cadastro feito! Qual a cidade de entrega?';
    }
    case 'cidade_nao_atendida': {
      const cidade = d.cidade_recusada ? tituloDaCidade(d.cidade_recusada) : 'essa cidade';
      // Teste de 08/10: "Jundiaé" (digitado errado) virou "Não entregamos em Jundiaé".
      const parecidas = (d.cidades_parecidas ?? []).map(tituloDaCidade);
      if (parecidas.length) {
        const opcoes = parecidas.length === 1 ? parecidas[0] : `${parecidas.slice(0, -1).join(', ')} ou ${parecidas[parecidas.length - 1]}`;
        return `Não achei ${cidade} na nossa lista de entregas. Você quis dizer ${opcoes}? Me manda o nome da cidade.`;
      }
      const area = ctx.estados.length ? ` Atendemos cidades de ${emLista(ctx.estados)} perto das nossas lojas.` : '';
      return `Não entregamos em ${cidade}.${area} A entrega pode ser em outra cidade?`;
    }
    case 'pedir_produtos':
      return `Certo!${d.entrega_repetida && d.entrega ? ` Entrega em ${tituloDaCidade(d.entrega.cidade)}.` : ''} O que você precisa? Pode mandar a lista com as quantidades.`;
    case 'lista_confirmada': {
      // Sem formas de pagamento esta é a última fala: é aqui que o cliente vê o número.
      const numero = numeroEValidade(ctx);
      return numero ? `Lista confirmada! ${numero}O vendedor vai te mandar o orçamento com os preços.` : TEXTO_DA_LISTA_CONFIRMADA;
    }
    case 'lista_confirmada_pedir_pagamento':
      return `Lista confirmada! ${textoDoPagamento('menu', d)}`;
    case 'pedir_pagamento':
      return textoDoPagamento('menu', d);
    case 'forma_fora_do_total': {
      const outras = linhasDoMenu(opcoesDoOrcamento(d));
      return `Essa forma não aceita o valor desta lista. Escolha outra forma de pagamento ou ajuste os produtos.${outras.length ? `\n\n${emTopicos(outras)}` : ''}`;
    }
    case 'pagamento_indisponivel':
      return `Essa forma não está disponível para este pedido. ${textoDoPagamento('menu', d)}`;
    case 'pedir_parcelas':
      return textoDoPagamento('parcelas', d);
    case 'parcelas_fora_do_limite':
      return textoDoPagamento('parcelas_fora', d);
    case 'pedir_bandeira':
      return textoDoPagamento('bandeira', d);
    case 'pedir_opcao_de_pagamento':
      return textoDoPagamento('opcao', d);
    case 'prazo_nao_liberado':
      return textoDoPagamento('opcao_fora', d);
    case 'pagamento_fora_do_limite': {
      const f = d.pagamento_fora;
      if (!f) return textoDoPagamento('menu', d);
      const outras = linhasDoMenu(opcoesDoOrcamento(d));
      // TI do cliente, 21/10: o teto do boleto a prazo vem do crédito do cliente. Nada de valor nem de limite: resposta genérica.
      if (f.tipo === 'maximo' && /^boleto/i.test(f.rotulo) && !/antecipad/i.test(f.rotulo)) {
        return outras.length
          ? `Esse boleto não está disponível para este pedido. Escolha outra forma de pagamento.

${emTopicos(outras)}`
          : 'Esse boleto não está disponível para este pedido, e nenhuma outra forma aceita o valor desta lista. O vendedor vai falar com você.';
      }
      const aviso = f.tipo === 'minimo'
        ? `O valor mínimo para ${f.rotulo} é de ${reais(f.limite)}. Escolha outra forma de pagamento ou adicione produtos para chegar a esse valor.`
        : `O valor máximo para ${f.rotulo} é de ${reais(f.limite)}. Escolha outra forma de pagamento ou reduza os produtos para ficar dentro desse valor.`;
      if (outras.length) return `${aviso}\n\n${emTopicos(outras)}`;
      return f.tipo === 'minimo'
        ? `O valor mínimo para ${f.rotulo} é de ${reais(f.limite)}, e nenhuma outra forma aceita o valor desta lista. Adicione produtos para chegar a esse valor.`
        : `O valor máximo para ${f.rotulo} é de ${reais(f.limite)}, e nenhuma outra forma aceita o valor desta lista. Reduza os produtos para ficar dentro desse valor.`;
    }
    case 'pagamento_escolhido':
      return `Anotado: ${d.pagamento?.rotulo ?? 'forma de pagamento'}. ${numeroEValidade(ctx)}O vendedor vai te mandar o orçamento com os preços.`;
    case 'vou_confirmar':
      return 'Vou consultar o vendedor para ele falar com você.';
    case 'confirmar_cancelamento':
      return 'Cancelo este orçamento? Responda sim.';
    case 'confirmar_recomeco':
      return 'Recomeço o orçamento do zero? Responda sim.';
    case 'orcamento_cancelado':
      return 'Orçamento cancelado. Se precisar de outro, é só chamar.';
    case 'continuar_ou_novo':
      return `Você tem o orçamento${ctx.orcamento ? ` nº ${ctx.orcamento.numero}` : ''} em aberto. Continuo esse ou faço um novo? Responda continuar ou novo.`;
    case 'lista_nao_entendi':
      return 'Não entendi o que mudar na lista. Diga o item e o que fazer, por exemplo: tira o prego, ou são 5 discos.';
    case 'continuar_orcamento': {
      const comLista = estado?.etapa === 'levantando_itens' && !!d.v2_pedido_id;
      const pergunta = estado && !comLista ? perguntaAtual(estado) : null;
      return ['Vamos seguir com o orçamento que já começamos.', pergunta ? textoDaEtapa(pergunta, estado, ctx) : ''].filter(Boolean).join(' ');
    }
    case 'cancelamento_desfeito': {
      // Com a lista em montagem, quem segue é a lista (fala `fixa_e_lista`), não o pedido dos produtos.
      const comLista = estado?.etapa === 'levantando_itens' && !!d.v2_pedido_id;
      const pergunta = estado && !comLista ? perguntaAtual(estado) : null;
      return ['Certo, o orçamento continua.', pergunta ? textoDaEtapa(pergunta, estado, ctx) : ''].filter(Boolean).join(' ');
    }
  }
}

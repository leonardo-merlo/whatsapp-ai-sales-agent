// Os modelos prontos da Wappia. Não são criados sozinhos: aparecem na tela de
// Templates e o cliente manda para aprovação na conta dele se quiser (decisão
// do Leonardo, 25/09 — quem não vai disparar nada não precisa de template).
//
// Deixou de ser a fonte da verdade em 25/09: quem diz se um template existe,
// em que ordem estão as variáveis e se ele pode ser enviado é o catálogo no
// banco (`wa_templates`, ver catalogo-de-templates.ts). Este arquivo é só a
// receita do que criar — o cliente cria os próprios pelo painel e eles nunca
// passam por aqui.
//
// Mudar a ordem das variáveis aqui não muda template já criado: a Meta guarda
// o texto, e a ordem que vale é a da linha do catálogo. Trocar a ordem de um
// padrão é criar um template com outro nome.
//
// `orcamento_rascunho_pronto` não entra: o texto mandava o vendedor aplicar
// desconto e enviar ao cliente, o que no fluxo automático de 13/09 vira um
// segundo orçamento. Ele continua aprovado nas WABAs onde já foi criado à mão.

import type { VariavelDoTemplate } from './regras-de-template';
import type { Produto } from '../produtos';

export interface TemplatePadrao {
  nome: string;
  categoria: 'UTILITY';
  corpo: string;
  variaveis: VariavelDoTemplate[];
  /** O produto em que o modelo aparece (S14, 29/09). Lembrete e remarcação são
   *  do Atendimento; os avisos ao vendedor são do Vendas e, além disso, só na
   *  WABA que tem número copiloto. */
  produto: Produto;
}

export const TEMPLATES_PADRAO: TemplatePadrao[] = [
  {
    nome: 'lembrete_agendamento',
    categoria: 'UTILITY',
    produto: 'atendimento',
    corpo: 'Olá, {{1}}! Passando para lembrar do seu agendamento em {{2}} no dia {{3}} às {{4}}. '
      + 'Você confirma? Se precisar remarcar, é só responder esta mensagem.',
    variaveis: [
      { nome: 'nome', exemplo: 'Ana' },
      { nome: 'empresa', exemplo: 'Clínica Bem Sorrir' },
      { nome: 'data', exemplo: '12/10' },
      { nome: 'hora', exemplo: '14h' },
    ],
  },
  {
    nome: 'aviso_remarcacao',
    categoria: 'UTILITY',
    produto: 'atendimento',
    corpo: 'Olá, {{1}}! Seu agendamento em {{2}} foi remarcado para {{3}} às {{4}}. Qualquer dúvida, responda por aqui.',
    variaveis: [
      { nome: 'nome', exemplo: 'Ana' },
      { nome: 'empresa', exemplo: 'Clínica Bem Sorrir' },
      { nome: 'data', exemplo: '15/10' },
      { nome: 'hora', exemplo: '10h' },
    ],
  },
  {
    nome: 'orcamento_enviado_ao_cliente',
    categoria: 'UTILITY',
    produto: 'vendas',
    corpo: 'Olá, {{1}}! O orçamento {{2}} para o cliente {{3}} saiu automaticamente pelo WhatsApp, '
      + 'no valor de {{4}}. O cliente já recebeu os itens e os valores.',
    variaveis: [
      { nome: 'vendedor', exemplo: 'João' },
      { nome: 'orcamento', exemplo: '4521' },
      { nome: 'cliente', exemplo: 'Construtora Silva' },
      { nome: 'valor', exemplo: 'R$ 1.250,00' },
    ],
  },
  {
    nome: 'cliente_aguardando_retorno',
    categoria: 'UTILITY',
    produto: 'vendas',
    corpo: 'Olá, {{1}}! O cliente {{2}} está aguardando seu retorno sobre {{3}}. Responda assim que puder.',
    variaveis: [
      { nome: 'vendedor', exemplo: 'João' },
      { nome: 'cliente', exemplo: 'Construtora Silva' },
      { nome: 'assunto', exemplo: 'prazo de entrega' },
    ],
  },
  {
    nome: 'cliente_novo_cadastrado',
    categoria: 'UTILITY',
    produto: 'vendas',
    corpo: 'Olá, {{1}}! Um cliente novo foi cadastrado no sistema pelo atendimento: {{2}}, documento {{3}}. '
      + 'A classificação fiscal ficou pendente para você completar.',
    variaveis: [
      { nome: 'vendedor', exemplo: 'João' },
      { nome: 'cliente', exemplo: 'Construtora Silva' },
      { nome: 'documento', exemplo: '12.345.678/0001-90' },
    ],
  },
  {
    nome: 'sistema_indisponivel',
    categoria: 'UTILITY',
    produto: 'vendas',
    corpo: 'Olá, {{1}}! O sistema não respondeu e não consegui registrar o pedido do cliente {{2}} ({{3}}). '
      + 'O cliente foi avisado de que você vai retornar.',
    variaveis: [
      { nome: 'vendedor', exemplo: 'João' },
      { nome: 'cliente', exemplo: 'Construtora Silva' },
      { nome: 'pedido', exemplo: '200 barras de 10 mm' },
    ],
  },
];

/**
 * Os modelos prontos que a tela oferece: só os do produto na tela, e os de
 * vendas só na WABA com copiloto.
 */
export function modelosDoProduto(produto: Produto, wabaTemCopiloto: boolean): TemplatePadrao[] {
  return TEMPLATES_PADRAO.filter(t => t.produto === produto && (t.produto !== 'vendas' || wabaTemCopiloto));
}

export const NOMES_PADRAO = new Set(TEMPLATES_PADRAO.map(t => t.nome));

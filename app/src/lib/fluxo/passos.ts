// A sequência que a aba Fluxo, da seção Desenvolvimento, mostra.
//
// **A tela documenta; ela não configura e não governa o motor** (decisão de
// 20/09, spec em `docs/superpowers/specs/2026-09-20-fluxo-do-agente-design.md`).
// O fluxo comercial da Distribuidora Exemplo mudou em 10/09, 13/09 e 17/09: uma tela que só
// lê acompanha isso sozinha, e uma que configura vira uma segunda cópia do
// fluxo para manter em dia.
//
// Este arquivo acrescenta ao código só duas coisas: a ORDEM e os passos que não
// têm ferramenta atrás. Para um passo de sistema ele declara apenas o nome da
// ferramenta — descrição, campos, caminho e exemplo são lidos do código e do
// banco na hora de mostrar, para não existir uma cópia que envelhece.
//
// Ele não importa as ferramentas de propósito: elas puxam código de servidor
// (`node:crypto`, Vault), e este arquivo é lido também pela tela. Quem junta as
// ferramentas aos passos é `cartoes.ts`, que roda no servidor.
//
// ⚠️ A guarda em `test/fluxo-do-agente.test.ts` falha se uma ferramenta de
// vendas não tiver passo aqui, se um passo apontar para ferramenta que não
// existe, ou se a ORDEM daqui divergir da de `ferramentasDoRoteiro('vendas')`.
// A ordem é a parte que mais importa: é o roteiro que o modelo lê.

import { CAMINHOS_PADRAO, caminhosDaIntegracao, type OperacaoDoErp } from '../erp/caminhos';

/** A IA decide ou pergunta; nada sai para fora. */
export interface PassoDeConversa {
  tipo: 'conversa';
  id: string;
  titulo: string;
  oQuePrecisaDescobrir: string;
}

/** Chama uma ferramenta. Todo o resto do card vem da ferramenta. */
export interface PassoDeSistema {
  tipo: 'sistema';
  id: string;
  ferramenta: string;
}

export type Passo = PassoDeConversa | PassoDeSistema;

export type RoteiroDoFluxo = 'vendas' | 'atendimento';

/**
 * O fluxo de Vendas como o motor de HOJE o executa — não um motor desejado.
 *
 * A etapa de pedido e os eventos de status por webhook (alinhamento de 17/09)
 * não estão aqui porque ainda não existem em código. Quando existirem, entram
 * como mais dois passos.
 */
export const PASSOS_DE_VENDAS: Passo[] = [
  {
    tipo: 'conversa',
    id: 'entender-o-pedido',
    titulo: 'Entender o pedido',
    oQuePrecisaDescobrir: 'Se é orçamento, dúvida ou outra coisa.',
  },
  {
    tipo: 'conversa',
    id: 'pedir-documento',
    titulo: 'Pedir CPF/CNPJ',
    oQuePrecisaDescobrir: 'Só depois que o cliente falar em orçamento, preço ou pedido.',
  },
  { tipo: 'sistema', id: 'consultar-cliente', ferramenta: 'consultar_cliente' },
  { tipo: 'sistema', id: 'cadastrar-cliente', ferramenta: 'cadastrar_cliente' },
  {
    tipo: 'conversa',
    id: 'confirmar-cidade',
    titulo: 'Confirmar a cidade de entrega',
    oQuePrecisaDescobrir: 'Para onde vai o material.',
  },
  { tipo: 'sistema', id: 'buscar-produtos', ferramenta: 'buscar_produtos' },
  { tipo: 'sistema', id: 'consultar-preco', ferramenta: 'consultar_preco' },
  { tipo: 'sistema', id: 'criar-orcamento', ferramenta: 'criar_orcamento' },
];

/**
 * O fluxo de Atendimento: só conversa. Um número de atendimento não tem ERP, e
 * a tela não mostra passo de sistema para ele (a busca no catálogo grande
 * existe, mas é consulta ao nosso banco, não integração — e este é o assunto
 * da seção).
 */
export const PASSOS_DE_ATENDIMENTO: Passo[] = [
  {
    tipo: 'conversa',
    id: 'entender-o-que-quer',
    titulo: 'Entender o que o cliente quer',
    oQuePrecisaDescobrir: 'A dúvida, o serviço ou o produto.',
  },
  {
    tipo: 'conversa',
    id: 'qualificar',
    titulo: 'Qualificar',
    oQuePrecisaDescobrir: 'As perguntas obrigatórias, uma de cada vez.',
  },
  {
    tipo: 'conversa',
    id: 'agendar',
    titulo: 'Agendar',
    oQuePrecisaDescobrir: 'Data, horário e serviço, só nos horários livres.',
  },
  {
    tipo: 'conversa',
    id: 'concluir',
    titulo: 'Concluir o atendimento',
    oQuePrecisaDescobrir: 'O desfecho, para mandar a mensagem de fechamento.',
  },
  {
    tipo: 'conversa',
    id: 'regras-automaticas',
    titulo: 'Regras automáticas',
    oQuePrecisaDescobrir: 'Se a mensagem bate com um gatilho, como passar para uma pessoa.',
  },
];

export const PASSOS_DO_ROTEIRO: Record<RoteiroDoFluxo, Passo[]> = {
  vendas: PASSOS_DE_VENDAS,
  atendimento: PASSOS_DE_ATENDIMENTO,
};

/**
 * Quais fluxos a tela mostra para uma organização, a partir dos roteiros que as
 * configurações dela usam. Vendas primeiro, porque é quem tem integração.
 * Organização sem configuração nenhuma vê o de atendimento — é o padrão de
 * todo número que nasce.
 */
export function fluxosDaOrganizacao(roteiros: (string | null | undefined)[]): RoteiroDoFluxo[] {
  const fluxos: RoteiroDoFluxo[] = [];
  if (roteiros.includes('vendas')) fluxos.push('vendas');
  if (!roteiros.length || roteiros.some(r => r !== 'vendas' && r !== 'copiloto')) fluxos.push('atendimento');
  return fluxos;
}

/** Para onde a operação vai nesta organização, e se é o endereço padrão. */
export function destinoDaOperacao(
  operacao: OperacaoDoErp,
  config: unknown,
): { caminho: string; padrao: boolean } {
  const caminho = caminhosDaIntegracao(config)[operacao];
  return { caminho, padrao: caminho === CAMINHOS_PADRAO[operacao] };
}

/** A última chamada bem sucedida de uma operação, como a aba a usa. */
export interface ExemploReal {
  metodo: string;
  caminho: string;
  requisicao: unknown;
  resposta: unknown;
  quando: string;
}

/**
 * O que o card mostra em "o que sai e o que volta": a chamada real, ou o aviso
 * de que ainda não houve nenhuma. **Nunca um exemplo inventado** — escrever o
 * corpo à mão criaria exatamente a cópia desatualizada que a tela existe para
 * eliminar.
 */
export function exemploDaOperacao(
  operacao: OperacaoDoErp,
  ultimas: Partial<Record<OperacaoDoErp, ExemploReal>>,
): { tipo: 'chamada'; chamada: ExemploReal } | { tipo: 'vazio' } {
  const chamada = ultimas[operacao];
  return chamada ? { tipo: 'chamada', chamada } : { tipo: 'vazio' };
}

/** O último passo que vale numa organização que vai só até o cadastro
 *  (`agente/so-ate-o-cadastro.ts`). */
export const ULTIMO_PASSO_DO_CADASTRO = 'cadastrar-cliente';

/** A lista cortada no cadastro. Genérica para servir aos passos e aos cards. */
export function ateOCadastro<T extends { id: string }>(lista: T[]): T[] {
  const fim = lista.findIndex(p => p.id === ULTIMO_PASSO_DO_CADASTRO);
  return fim === -1 ? lista : lista.slice(0, fim + 1);
}

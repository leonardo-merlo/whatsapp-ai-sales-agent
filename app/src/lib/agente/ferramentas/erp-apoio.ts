// O que as quatro ferramentas do sistema do cliente têm em comum.
//
// Duas coisas, e as duas são sobre **o que o cliente final ouve quando algo dá
// errado**. Decisão da Distribuidora Exemplo, registrada desde o começo do bloco C:
// **nunca informar ao cliente final que o sistema caiu.** Para ele é "vou
// confirmar e já retorno". Quem recebe o aviso é o vendedor, pelo copiloto.
//
// Por isso o texto que volta ao modelo é sempre uma instrução de conduta, e não
// um relato técnico: se o modelo lê "erro 503 no ERP", ele repassa isso ao
// cliente de alguma forma.

import type { ResultadoDoErp } from '../../erp/cliente-http';
import { conexaoComOErp, EXPLICACAO_DA_FALTA } from '../../erp/integracao';
import { observadorQueGrava, operacaoDoCaminho } from '../../erp/registro-de-chamadas';
import { turnoIdGravado } from '../rastreio/rastreio';
import type { ContextoDaFerramenta } from './tipos';
import type { ConexaoComOErp } from '../../erp/cliente-http';

/** O que dizer ao modelo quando não há como falar com o sistema do cliente. */
export const NAO_DEU_PARA_CONSULTAR =
  'Não consegui consultar o sistema agora. NÃO diga ao cliente que o sistema está fora do ar nem '
  + 'invente a resposta: diga que vai confirmar essa informação e retornar em seguida. O vendedor já foi avisado.';

/**
 * O que dizer ao modelo quando a recusa é assunto do VENDEDOR, não do cliente.
 *
 * **De onde veio esta separação (14/09).** No primeiro teste real do fluxo a
 * IA escreveu ao cliente: *"Opa, encontrei um problema no sistema aqui. Seu
 * cadastro não está trazendo o ID que preciso pra fechar o orçamento."* Isso
 * fere a regra da Distribuidora Exemplo de nunca informar ao cliente final que algo deu
 * errado do nosso lado.
 *
 * A causa foi o texto de baixo ser um só: para QUALQUER recusa, ele mandava
 * "explique ao cliente o que falta". Só que "o que falta" tem dois sentidos
 * bem diferentes. Falta um dado que o cliente pode dar (o documento está com
 * um dígito errado, a quantidade não faz sentido) — aí explicar é o certo. Ou
 * "falta" alguma coisa que só a empresa resolve: o cadastro está bloqueado,
 * não tem crédito, o id sumiu. Isso não é assunto do cliente, e o modelo não
 * pode nem saber o motivo — porque se souber, repassa de alguma forma.
 */
export const NAO_E_ASSUNTO_DO_CLIENTE =
  'Não dá para seguir com este pedido agora, e o motivo é interno da empresa. NÃO diga ao cliente que '
  + 'houve erro, que o sistema recusou, que falta algo no cadastro dele ou que existe um problema '
  + 'técnico. Diga, com naturalidade, que vai confirmar esse ponto e retornar em seguida, e não tente '
  + 'de novo. Quem resolve isso é o vendedor.';

/**
 * As recusas cuja resposta está com o CLIENTE — e só estas.
 *
 * Lista fechada, e é isto que faz a regra ser segura: um código novo que a
 * Distribuidora Exemplo invente amanhã cai no silêncio, não no vazamento. O contrato
 * (`docs/contrato-api-exemplo.md`) pede que eles mandem `codigo` justamente
 * para esta decisão existir no código, e não no juízo do modelo.
 */
const RECUSAS_QUE_O_CLIENTE_RESOLVE = new Set([
  'documento_invalido',
  'documento_ausente',
  'documento_obrigatorio',
  'nome_invalido',
  'nome_obrigatorio',
  'quantidade_invalida',
  'produto_nao_encontrado',
  'itens_vazios',
  'campo_obrigatorio',
]);

export async function conexaoDaFerramenta(
  ctx: ContextoDaFerramenta,
): Promise<{ ok: true; conexao: ConexaoComOErp; config: Record<string, unknown> } | { ok: false; recado: string }> {
  const r = await conexaoComOErp(ctx.supabase, ctx.orgId);
  if (r.ok) {
    // O observador é ligado AQUI, e não em `conexaoComOErp`, porque é neste
    // ponto que existe o contexto completo: de qual conversa, de qual contato e
    // por qual número a chamada saiu. Sem isso o registro na aba Chamadas, em
    // Desenvolvimento, seria uma lista de requisições sem dono.
    return {
      ok: true,
      config: r.integracao.config,
      conexao: {
        ...r.conexao,
        observador: observadorQueGrava(ctx.supabase, {
          orgId: ctx.orgId,
          conversationId: ctx.conversationId,
          contactId: ctx.contactId,
          waNumberId: ctx.waNumberId,
          turnoId: turnoIdGravado(ctx.rastreio),
        }, (registro, id) => {
          ctx.rastreio?.chamadasErp.push({
            id,
            operacao: registro.operacao ?? operacaoDoCaminho(registro.caminho),
            ok: registro.ok,
            motivo: registro.motivo,
            codigo: registro.codigo,
            resposta: registro.resposta,
          });
        }),
      },
    };
  }

  // Configuração faltando é problema do painel, não do cliente final — mas para
  // ele o efeito é o mesmo, e o recado ao modelo também.
  console.error(`ERP não conectado para a organização ${ctx.orgId}: ${EXPLICACAO_DA_FALTA[r.falta]}`);
  return { ok: false, recado: NAO_DEU_PARA_CONSULTAR };
}

/** Traduz a falha do ERP em instrução para o modelo.
 *
 *  A separação que importa: **recusa** é informação útil (o cliente está
 *  bloqueado, o produto não existe, falta crédito) e o modelo precisa saber o
 *  motivo para conduzir a conversa. **Indisponível** e **credencial** são
 *  problemas nossos, e o cliente final nunca fica sabendo. */
export function recadoDaFalha(falha: Extract<ResultadoDoErp<unknown>, { ok: false }>): string {
  if (falha.motivo === 'recusado') {
    if (RECUSAS_QUE_O_CLIENTE_RESOLVE.has(falha.codigo)) {
      return `O sistema recusou: ${falha.mensagem} (código ${falha.codigo}). Não tente de novo com os `
        + 'mesmos dados. Peça ao cliente exatamente o dado que falta ou que veio errado, com as suas '
        + 'palavras, sem citar códigos nem nomes de sistema, e siga a conversa.';
    }
    // Recusa que o cliente não resolve (cadastro bloqueado, sem crédito, id que
    // sumiu): o motivo fica no log, para o vendedor e para nós. O modelo NÃO o
    // recebe — ele não pode repassar o que não sabe.
    console.error(`ERP recusou por motivo interno (${falha.codigo}): ${falha.mensagem}`);
    return NAO_E_ASSUNTO_DO_CLIENTE;
  }
  return NAO_DEU_PARA_CONSULTAR;
}

/** Lista de itens vinda do modelo, saneada. Quantidade é número: um "dez" em
 *  letras vira item sem quantidade, e item sem quantidade não vai ao ERP. */
export function itensDaEntrada(bruto: unknown): { produto_codigo: string; quantidade: number }[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map(i => {
      const item = (i ?? {}) as Record<string, unknown>;
      const codigo = String(item.produto_codigo ?? '').trim();
      const quantidade = Number(item.quantidade);
      return { produto_codigo: codigo, quantidade };
    })
    .filter(i => i.produto_codigo && Number.isFinite(i.quantidade) && i.quantidade > 0);
}

/** O esquema de `itens`, igual nas duas ferramentas que o usam. */
export const ESQUEMA_DOS_ITENS = {
  type: 'array',
  description: 'Os itens do pedido. Use SEMPRE o código exato que veio da ferramenta buscar_produtos.',
  items: {
    type: 'object',
    properties: {
      produto_codigo: { type: 'string', description: 'O código do produto no catálogo.' },
      quantidade: { type: 'number', description: 'Quanto o cliente pediu, na unidade do produto.' },
    },
    required: ['produto_codigo', 'quantidade'],
    additionalProperties: false,
  },
} as const;

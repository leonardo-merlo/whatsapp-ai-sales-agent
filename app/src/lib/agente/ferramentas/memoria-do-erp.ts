// O que a conversa já descobriu no sistema do cliente.
//
// **Por que isto existe.** O laço de ferramentas vive dentro de UMA resposta:
// ele monta a conversa com o pedido do modelo e o resultado da ferramenta, o
// modelo responde, e aquilo é jogado fora. Da mensagem seguinte em diante o
// histórico é só o texto das falas. No primeiro teste real do fluxo de vendas
// (14/09) isso derrubou o orçamento: o `cliente_id` que a consulta devolveu na
// primeira mensagem não existia mais três mensagens depois, e o modelo chamou
// `criar_orcamento` sem ele.
//
// A saída não é pedir ao modelo que "lembre" — é o código guardar. Quem
// descobre grava na conversa; quem precisa lê de lá. O modelo continua podendo
// mandar o `cliente_id` na chamada, e quando ele manda é o dele que vale: se a
// conversa mudou de cliente ("é para o CNPJ da outra obra"), a consulta nova
// regrava e o guardado acompanha.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../../supabase/database.types';
import type { ClienteDoErp } from '../../erp/contrato';
import {
  cadastroDoCliente, cadastroGuardado, cadastrosGuardados, mesclarCadastroDoErp, mesclarNaLista,
  type OrigemDoCadastro,
} from '../../erp/cadastro-do-contato';
import type { ContextoDaFerramenta } from './tipos';

type Client = SupabaseClient<Database>;

/**
 * Guarda o cliente que acabou de ser identificado ou cadastrado, em **dois**
 * lugares, e os dois têm motivo próprio:
 *
 * - **na conversa**, que é o que faz o orçamento fechar três mensagens depois,
 *   quando o laço desta resposta já não existe;
 * - **na ficha do contato**, que é o que torna "todos os orçamentos e pedidos
 *   deste cliente" uma consulta simples. Sem isso o vínculo existe só por
 *   conversa, e a mesma empresa falando de dois números vira dois históricos
 *   que ninguém junta. Desde 20/09 a ficha guarda o **cadastro inteiro** que a
 *   operação devolveu, em `contacts.erp_cadastro` — é o que o desenvolvedor do
 *   cliente abre para conferir se o que a IA criou gravou com os dados certos.
 *
 * Best-effort nos dois: falhar aqui não pode derrubar um orçamento que já saiu.
 */
export async function lembrarClienteDoErp(
  supabase: Client,
  conversationId: string,
  cliente: Partial<ClienteDoErp> & { id: string },
  ctx?: ContextoDaFerramenta,
  origem: OrigemDoCadastro = 'consulta',
): Promise<void> {
  if (!cliente.id) return;
  // O contexto em memória é atualizado primeiro: as voltas seguintes do MESMO
  // laço leem daqui, sem ida ao banco.
  if (ctx) {
    ctx.erpClienteId = cliente.id;
    if (cliente.nome) ctx.erpClienteNome = cliente.nome;
    // Marca que a descoberta foi AGORA. É o que impede a volta seguinte do
    // mesmo laço cotar preço sem o cliente final ter confirmado nada — ele não
    // falou desde a identificação.
    ctx.clienteIdentificadoAgora = true;
  }
  try {
    await supabase
      .from('conversations')
      .update({
        erp_cliente_id: cliente.id,
        erp_cliente_nome: cliente.nome ?? null,
        // **E desde QUAL mensagem do cliente.** É isto que faz a trava de
        // "identificou agora não cota agora" sobreviver a uma execução que
        // morreu no meio: a varredura refaz o turno com um `ctx` novo, onde o
        // booleano em memória nasce falso, mas a mensagem continua sendo a
        // mesma. Ver `erp-orcamento.ts` e a migration
        // 20260920000004_cadastro_desde_qual_mensagem.
        erp_cliente_desde_mensagem: ctx?.mensagemId ?? null,
      })
      .eq('id', conversationId);
  } catch (err) {
    console.error('Não deu para guardar o cliente do ERP na conversa:', err instanceof Error ? err.message : err);
  }

  // A ficha do contato. Separada da gravação acima de propósito: se esta falhar,
  // a conversa já guardou o que o orçamento precisa para fechar.
  //
  // **O nome NÃO é sobrescrito.** O contato se chama como o WhatsApp o
  // apresentou ou como um humano o renomeou; trocar isso por "METALURGICA
  // EXEMPLO LTDA" no meio de uma conversa mudaria o nome na tela de Conversas
  // sem ninguém ter pedido. A razão social já vive em
  // `conversations.erp_cliente_nome`.
  //
  // `documento` só é gravado quando temos um: sobrescrever com nulo apagaria o
  // que a consulta anterior descobriu. A mesma regra vale campo a campo dentro
  // de `erp_cadastro`, e ela mora em `lib/erp/cadastro-do-contato.ts` — pura,
  // porque é regra com armadilha e precisa de teste sem banco no caminho.
  //
  // **O telefone e o e-mail do ERP NÃO vão para `contacts.telefone` e
  // `contacts.email`.** O telefone da ficha é o número de WhatsApp por onde a
  // pessoa escreveu, e é por ele que a resposta sai; trocá-lo pelo fixo do
  // cadastro deixaria o cliente sem resposta. O e-mail segue junto por decisão
  // do Leonardo (20/09): um campo, uma fonte.
  if (!ctx?.contactId) return;
  try {
    const { data: fichaAtual } = await supabase
      .from('contacts')
      .select('erp_cadastro, erp_cadastros')
      .eq('id', ctx.contactId)
      .maybeSingle();

    const descoberto = cadastroDoCliente(cliente, origem);
    // O atual, para quem lê `erp_cadastro`; e a lista, que é o que a ficha
    // mostra. O comprador que atende por duas empresas tem dois cadastros, e
    // os dois são verdade ao mesmo tempo.
    const cadastro = mesclarCadastroDoErp(cadastroGuardado(fichaAtual?.erp_cadastro), descoberto);
    const cadastros = mesclarNaLista(cadastrosGuardados(fichaAtual?.erp_cadastros), descoberto);

    const campos: { erp_cliente_id: string; documento?: string; erp_cadastro: Json; erp_cadastros: Json } = {
      erp_cliente_id: cliente.id,
      erp_cadastro: cadastro as Json,
      erp_cadastros: cadastros as Json,
    };
    const documento = (cliente.documento ?? '').replace(/\D/g, '');
    if (documento) campos.documento = documento;

    await supabase.from('contacts').update(campos).eq('id', ctx.contactId);
  } catch (err) {
    console.error('Não deu para guardar o cliente do ERP na ficha do contato:', err instanceof Error ? err.message : err);
  }
}

/**
 * Um `cliente_id` que o modelo mandou pode ser lixo?
 *
 * **Pode, e saiu pela rede.** Em 20/09 às 22:46 esta chamada foi gravada em
 * `erp_chamadas` e chegou à homologação da Distribuidora Exemplo:
 *
 *     {"itens": [...], "cliente_id": "</antml parameter>", "vendedor_id": null}
 *
 * O modelo emitiu um fragmento de delimitador interno como argumento de
 * ferramenta. É a mesma família do texto picado (`texto-fragmentado.ts`):
 * artefato de `output_config.format` junto com `tools`, não do nosso lado.
 *
 * O filtro é de forma, não de existência — quem sabe se o cadastro existe é o
 * ERP. Um id do sistema deles é curto e sem espaço (`Z00003/01`); qualquer
 * coisa fora disso é descartada, e a ferramenta cai na mensagem de "sem
 * cliente_id" que já existe, que manda consultar o cadastro.
 */
const ID_COM_FORMA_DE_ID = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,39}$/;

function idQueOModeloMandou(bruto: unknown): string {
  const texto = String(bruto ?? '').trim();
  if (!texto) return '';
  if (!ID_COM_FORMA_DE_ID.test(texto)) {
    console.error(`Modelo mandou um cliente_id impossível: ${JSON.stringify(texto).slice(0, 80)}`);
    return '';
  }
  return texto;
}

/** O `cliente_id` que vale nesta chamada: o que o modelo mandou, e na falta
 *  dele o que a conversa já descobriu. Nesta ordem de propósito — o modelo tem
 *  a mensagem do cliente na frente e pode estar trocando de cadastro.
 *
 *  **Menos quando o documento acabou de mudar.** Aí a ordem se inverte e o id
 *  do modelo não conta: o que ele tem em mãos é o do cadastro anterior, e foi
 *  exatamente isso que ele mandou nas duas cotações erradas de 20/09. Enquanto
 *  `consultar_cliente` não devolver o cadastro novo, esta chamada fica sem id
 *  — e sem id nenhuma das duas ferramentas de preço sai do lugar. */
export function clienteIdDaChamada(entrada: Record<string, unknown>, ctx: ContextoDaFerramenta): string {
  if (ctx.documentoTrocado) return ctx.erpClienteId ?? '';
  return idQueOModeloMandou(entrada.cliente_id) || (ctx.erpClienteId ?? '');
}

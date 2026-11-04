// Organizações em que o agente de VENDAS vai só até o cadastro do cliente.
//
// Decisão do Leonardo em 21/09, para a homologação com a Distribuidora Exemplo: por
// enquanto a IA identifica o cliente pelo CPF/CNPJ e cadastra quem é novo, e
// para aí. Cidade de entrega, catálogo, preço e orçamento ficam para depois
// (dependem de uma sincronização diária que ainda vai ser alinhada).
//
// O que a chave faz, só nas organizações listadas e só no roteiro de vendas:
// - o modelo recebe apenas `consultar_cliente` e `cadastrar_cliente`;
// - o prompt não leva o catálogo nem a frase que manda achar produto e cotar;
// - a aba Fluxo mostra os passos até o cadastro;
// - o código cala o que não é pedido nem resposta ("bom dia"), sem chamar o
//   modelo (`silencio.ts`);
// - e liga também os consertos do cadastro (abaixo).
//
// Nenhuma outra organização muda. As ferramentas de catálogo, preço e
// orçamento continuam inteiras no código.
//
// **A Distribuidora Exemplo saiu desta lista em 01/10** (decisão do Leonardo): o produto
// voltou, e ela responde cumprimento. Os consertos do cadastro continuam ligados
// para ela por `ORGS_COM_CONSERTOS_DO_CADASTRO`. A instrução do painel foi
// trocada junto (backup em `~/Projects/own/backup-exemplo-instrucao-2026-10-01.json`).
// Para voltar, ponha o id dela de volta aqui e restaure a instrução.

export const ORGS_SO_ATE_O_CADASTRO = new Set<string>([]);

/**
 * Organizações com os consertos de 21/09 do cadastro, sem a trava do produto.
 *
 * Os três consertos, cada um medido numa conversa real que deu errado:
 * - o resumo de um atendimento anterior não entra no prompt (com ele, a IA
 *   achava que o pedido novo já estava resolvido);
 * - o cadastro já consultado entra como fato, sem a ordem "não peça o CPF de
 *   novo": cada orçamento começa pelo documento, porque o mesmo WhatsApp compra
 *   por mais de uma empresa;
 * - a resposta sai em texto puro, sem o formulário.
 *
 * Fica de fora o silêncio do "bom dia": a Distribuidora Exemplo quer que a IA responda
 * cumprimento (decisão do Leonardo em 01/10).
 */
export const ORGS_COM_CONSERTOS_DO_CADASTRO = new Set<string>([
  'e8e00000-0000-4000-8000-0000000000e1', // Distribuidora Exemplo
]);

/** As ferramentas que ficam, na ordem em que o modelo as lê. */
export const FERRAMENTAS_ATE_O_CADASTRO = ['consultar_cliente', 'cadastrar_cliente'];

export function soAteOCadastro(orgId: string, roteiro: string): boolean {
  return roteiro === 'vendas' && ORGS_SO_ATE_O_CADASTRO.has(orgId);
}

/** Vale onde a IA vai só até o cadastro e onde só os consertos foram mantidos. */
export function consertosDoCadastro(orgId: string, roteiro: string): boolean {
  return soAteOCadastro(orgId, roteiro) || (roteiro === 'vendas' && ORGS_COM_CONSERTOS_DO_CADASTRO.has(orgId));
}

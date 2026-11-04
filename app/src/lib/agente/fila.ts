// Quando a resposta sai DEPOIS do request da Meta.
//
// Sem fila, a chamada ao Claude acontece dentro do request que a Meta enviou, e
// a Meta reenvia se demorarmos. Com a fila, o webhook grava a mensagem, responde
// 200 na hora, e a resposta é gerada em seguida.
//
// São duas regras, e elas respondem a perguntas diferentes.
//
// **1. Por organização, por variável de ambiente.** `WEBHOOK_FILA_ORGS` é uma
// lista de ids separados por vírgula; ausente ou vazia significa desligada para
// todos, que é o comportamento antigo. `*` liga para todas. É a chave que o
// Leonardo vira quando quiser, e ela existe porque ligar a fila para quem tem
// cliente pagando é mudança de caminho, não configuração.
//
// **2. Por roteiro, sem chave nenhuma: vendas e copiloto usam fila SEMPRE.**
// Isto não é preferência, é aritmética. Uma resposta do roteiro de vendas pode
// somar quatro chamadas ao sistema do cliente (consultar, cadastrar, cotar,
// criar) mais várias voltas do modelo. Isso não cabe no tempo que a Meta espera
// antes de reenviar o webhook — e o reenvio, com o ERP no caminho, vira
// **orçamento duplicado**. Número de atendimento continua exatamente como está:
// ligar a fila para todos é uma mudança separada.

export function orgUsaFila(orgId: string): boolean {
  const lista = process.env.WEBHOOK_FILA_ORGS?.trim();
  if (!lista) return false;
  const ids = lista.split(',').map(id => id.trim()).filter(Boolean);
  return ids.includes('*') || ids.includes(orgId);
}

/** Roteiros que nunca cabem dentro do request da Meta. */
const ROTEIROS_QUE_EXIGEM_FILA = new Set(['vendas', 'copiloto']);

export function roteiroExigeFila(roteiro: string | null | undefined): boolean {
  return !!roteiro && ROTEIROS_QUE_EXIGEM_FILA.has(roteiro);
}

/** A decisão completa: a chave da organização OU a exigência do roteiro. */
export function usarFila(orgId: string, roteiro: string | null | undefined): boolean {
  return roteiroExigeFila(roteiro) || orgUsaFila(orgId);
}

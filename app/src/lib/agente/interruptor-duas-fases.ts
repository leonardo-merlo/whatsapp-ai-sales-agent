// O interruptor do conserto do erro 500, no mesmo padrão de `botoes-escondidos.ts`.
//
// **O que ele governa.** Com `true`, o roteiro de VENDAS responde em duas
// chamadas em vez de uma:
//
//   Fase 1 — o laço de ferramentas, SEM o formulário (`output_config`). O
//            modelo consulta o que precisa e termina escrevendo a mensagem ao
//            cliente em texto puro.
//   Fase 2 — uma chamada curta COM o formulário e SEM ferramentas, sobre uma
//            conversa sem nenhum bloco de ferramenta. Ela só transforma o que a
//            fase 1 escreveu em metadados (ficha do contato). Não reescreve a
//            mensagem: o código compara e, se divergir, usa a da fase 1.
//
// Por que: formulário + ferramentas no mesmo pedido estoura em 500 em ~30% das
// chamadas; cada um sozinho, zero (`test/bancada/erro-500-formato-e-ferramentas.mts`).
//
// **O roteiro de atendimento não passa por aqui em nenhuma posição da chave**:
// ele não tem ferramentas, nunca viu um 500, e a requisição dele sai byte a byte
// igual à de sempre.
//
// **Para voltar atrás, troque `true` por `false`.** Nada mais precisa mudar: o
// caminho antigo (uma chamada com formulário e ferramentas juntos, mais o
// resgate sem formulário quando a Anthropic devolve 500) continua inteiro em
// `gerar-resposta.ts`.

// **Ligado em 28/09, a pedido do Leonardo.** A prova rodou em 27/09: variante
// J, 0 de 30 com erro 500 e 0 de 30 com JSON cru na fase 1. Os testes que
// contavam chamadas, liam a última requisição ou esperavam o formulário na
// chamada 0 foram atualizados com autorização, e o porquê está em cada um.
// Onde vale "até o cadastro" (Distribuidora Exemplo hoje) nada muda: lá a resposta já sai
// em texto puro numa chamada só. Cada resposta que passa por aqui ganha a
// marca `duas_fases` na ficha do rastreio (`agente_turnos.caminho`).
export const SEPARAR_FORMULARIO_DAS_FERRAMENTAS = true;

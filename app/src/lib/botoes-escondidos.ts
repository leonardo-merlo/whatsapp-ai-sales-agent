// Botões escondidos do painel, por decisão comercial — não por permissão.
//
// Mesma ideia do `ABAS_ESCONDIDAS` de `config-tabs.ts`, e pelo mesmo motivo:
// enquanto a Distribuidora Exemplo está em homologação, o desenvolvedor deles (o Felipe)
// recebe login de admin para conferir a integração. Tudo que estiver na tela e
// não for do trabalho dele é ruído que ele vai abrir, testar e perguntar.
//
// **Não é regra de papel.** Um admin de verdade poderia ver os dois; é que
// ninguém vê por enquanto. E os dois são temporários: o Leonardo quer os dois
// de volta quando o foco voltar ao Wappia Atendimento.
//
// **Para trazer de volta, troque `false` por `true`.** Nada mais precisa mudar:
// o modal dos modelos, o modal de confirmação de Publicar, as funções e a
// gravação continuam inteiros em `sections/agente.tsx` e em `mutations.ts` — o
// que a chave governa é só o botão que os abre.

/**
 * O botão "Modelos por nicho", na tela de Conhecimento.
 *
 * Escondido desde 21/09 a pedido do Leonardo. Ele aplica o preset de um
 * segmento (clínica, salão, academia…) por cima do rascunho inteiro —
 * personalidade, questionário, gatilhos e dúvidas. Na Distribuidora Exemplo isso não tem
 * uso nenhum: o comportamento dela foi escrito à mão, e um clique errado ali
 * apagaria justamente o que levou a semana para acertar.
 */
export const MOSTRAR_MODELOS_POR_NICHO = false;

// O botão "Publicar" morou aqui até 29/09. Saiu de vez (item 9 do backlog):
// salvar põe no ar, o Histórico desfaz e o simulador testa o que está na tela.
// As colunas `published_snapshot` e `published_at` ficaram no banco, sem uso.

// T12 (teste de campo de 20/10): o pedido da v2 aberto só leva a conversa para o
// caminho de antes quando ele é mesmo de ANTES da máquina. Na conversa
// 646d3948 a ficha de 16/10 venceu, e o pedido de 16/10 (que ela tinha usado)
// sequestrou o orçamento novo: somou os itens e pulou o CPF/CNPJ.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso } from './apoio/supabase-falso.mts';
import { pedidoV2DeAntesDaMaquina } from '@/lib/v2/integracao-v1';

const pedido = (id: string, referencia: string) => ({ id, organization_id: 'org-1', referencia, estado: 'aguardando_confirmacao', criado_em: '2026-10-16T14:21:14Z' });
const ficha = (conversation_id: string, modo: string, etapa: string, v2: string | null) => ({
  id: `f-${conversation_id}-${modo}`, organization_id: 'org-1', conversation_id, modo, etapa, dados: v2 ? { v2_pedido_id: v2 } : {},
});

describe('pedido da v2 de antes da máquina (T12)', () => {
  test('conversa de 20/10: o pedido aberto de 16/10 foi usado por uma ficha da máquina, então não é caminho antigo', async () => {
    const { client } = criarSupabaseFalso({
      v2_pedidos: [pedido('e858a44a', 'conv-646d')],
      orcamentos_em_andamento: [ficha('conv-646d', 'valendo', 'encerrado', 'e858a44a'), ficha('conv-646d', 'valendo', 'expirado', null)],
    });
    assert.equal(await pedidoV2DeAntesDaMaquina(client as never, 'org-1', 'conv-646d'), null);
  });

  test('conversa que estava na v2 quando a chave ligou (sem ficha da máquina): segue no caminho antigo', async () => {
    const { client } = criarSupabaseFalso({ v2_pedidos: [pedido('p-velho', 'conv-velha')] });
    assert.equal((await pedidoV2DeAntesDaMaquina(client as never, 'org-1', 'conv-velha'))?.id, 'p-velho');
  });

  test('ficha só da sombra não conta: a sombra não abre pedido', async () => {
    const { client } = criarSupabaseFalso({
      v2_pedidos: [pedido('p-velho', 'conv-sombra')],
      orcamentos_em_andamento: [ficha('conv-sombra', 'sombra', 'levantando_itens', null)],
    });
    assert.equal((await pedidoV2DeAntesDaMaquina(client as never, 'org-1', 'conv-sombra'))?.id, 'p-velho');
  });
});

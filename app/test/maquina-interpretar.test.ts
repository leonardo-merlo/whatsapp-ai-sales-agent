// A leitura da IA é conferida antes de virar decisão: intenção fora da lista
// da etapa não passa, e a chamada não leva ferramenta nenhuma.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { lerLeitura, pedidoDaLeitura } from '@/lib/agente/maquina/interpretar';
import type { EstadoDoOrcamento } from '@/lib/agente/maquina/tipos';

const regiao: EstadoDoOrcamento = { etapa: 'confirmando_regiao', pergunta: 'confirmar_cliente', dados: {}, desdeMensagem: null };

describe('leitura da mensagem', () => {
  test('intenção que a etapa não aceita vira "responde"', () => {
    assert.equal(lerLeitura('{"intencao":"produtos","produtos_citados":false,"cidade_de_entrega":"","uf_de_entrega":""}', regiao).intencao, 'responde');
  });

  test('JSON quebrado vira leitura neutra', () => {
    assert.equal(lerLeitura('{"intencao": ', regiao).intencao, 'responde');
  });

  test('cidade e UF saem limpas; UF inválida é descartada', () => {
    const l = lerLeitura('{"intencao":"confirma","produtos_citados":false,"cidade_de_entrega":" Jundiaí ","uf_de_entrega":"minas"}', regiao);
    assert.deepEqual(l.cidade, { cidade: 'Jundiaí', uf: null });
  });

  test('o pedido à IA não leva ferramenta (sem risco do erro 500)', () => {
    const pedido = pedidoDaLeitura(regiao, 'É esse cadastro mesmo?', 'sim');
    assert.deepEqual(['tools' in pedido, 'output_config' in pedido], [false, true]);
  });

  test('só a coleta do cadastro pede os campos do endereço', () => {
    const coleta = pedidoDaLeitura({ ...regiao, etapa: 'coletando_cadastro' }, null, 'Rua A 10');
    const props = (p: Record<string, unknown>) => Object.keys(((p.output_config as { format: { schema: { properties: object } } }).format.schema.properties));
    assert.deepEqual([props(coleta).includes('cadastro'), props(pedidoDaLeitura(regiao, null, 'sim')).includes('cadastro')], [true, false]);
  });
});

describe('cancelar e recomeçar (válvula de escape, 22/10)', () => {
  test('aceita cancelar e recomeçar nas etapas da coleta', () => {
    const l = lerLeitura('{"intencao":"cancelar","produtos_citados":false,"cidade_de_entrega":"","uf_de_entrega":""}', regiao);
    const r = lerLeitura('{"intencao":"recomecar","produtos_citados":false,"cidade_de_entrega":"","uf_de_entrega":""}', { ...regiao, etapa: 'levantando_itens', pergunta: 'produtos' });
    assert.deepEqual([l.intencao, r.intencao], ['cancelar', 'recomecar']);
  });

  test('não aceita cancelar depois da lista confirmada', () => {
    const vendedor: EstadoDoOrcamento = { ...regiao, etapa: 'aguardando_vendedor', pergunta: null };
    assert.equal(lerLeitura('{"intencao":"cancelar","produtos_citados":false,"cidade_de_entrega":"","uf_de_entrega":""}', vendedor).intencao, 'responde');
  });
});

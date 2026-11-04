import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcularMetricas, comoFoiOItem, etapasPuladas, funil, passoDoEstado, tempoDeResposta } from '../scripts/metricas-calculo.mjs';

const orcamento = (id: string, conversa: string, criado: string, etapa: string, dados: object = {}, pergunta: string | null = null) =>
  ({ id, conversation_id: conversa, created_at: criado, etapa, pergunta_pendente: pergunta, dados });
const turno = (conversa: string, criado: string, etapa: string | null, extra: object = {}) =>
  ({ conversation_id: conversa, created_at: criado, status: 'respondeu', estado_depois: etapa ? { etapa, pergunta: null } : null, duracao_ms: 1000, ...extra });

describe('passo do funil', () => {
  it('conta "É esse cadastro?" como documento e "Qual a cidade?" como cadastro confirmado', () => {
    assert.deepEqual(
      [passoDoEstado({ etapa: 'confirmando_regiao', pergunta: 'confirmar_cliente' }), passoDoEstado({ etapa: 'confirmando_regiao', pergunta: 'cidade' })],
      [2, 3],
    );
  });
});

describe('funil', () => {
  it('usa a etapa mais longe que o orçamento chegou, mesmo se ele voltou depois', () => {
    // Trocou de CNPJ no meio dos itens: a ficha voltou para o documento, mas chegou aos itens.
    const o = [orcamento('o1', 'c1', '2026-10-12T10:00:00Z', 'consultando_cadastro')];
    const t = [turno('c1', '2026-10-12T10:01:00Z', 'levantando_itens'), turno('c1', '2026-10-12T10:05:00Z', 'consultando_cadastro')];
    assert.deepEqual(funil(o, t).map(p => p.quantidade), [1, 1, 1, 1, 0]);
  });

  it('separa dois orçamentos da mesma conversa pela hora', () => {
    const o = [
      orcamento('o1', 'c1', '2026-10-12T10:00:00Z', 'aguardando_vendedor'),
      orcamento('o2', 'c1', '2026-10-12T12:00:00Z', 'aguardando_documento'),
    ];
    const t = [turno('c1', '2026-10-12T10:30:00Z', 'aguardando_vendedor'), turno('c1', '2026-10-12T12:01:00Z', 'aguardando_documento')];
    assert.deepEqual(funil(o, t).map(p => p.quantidade), [2, 1, 1, 1, 1]);
  });
});

describe('etapas puladas', () => {
  it('acusa orçamento nos itens sem cidade de entrega', () => {
    const o = [orcamento('o1', 'c1', '2026-10-12T10:00:00Z', 'levantando_itens', { cliente: { nome: 'X' } })];
    assert.deepEqual(etapasPuladas(o), [{ orcamento_id: 'o1', pulou: 'cidade' }]);
  });

  it('não acusa nada quando cadastro, cidade e lista existem', () => {
    const o = [orcamento('o1', 'c1', '2026-10-12T10:00:00Z', 'aguardando_vendedor', { cliente: {}, entrega: {}, itens: [{}] })];
    assert.deepEqual(etapasPuladas(o), []);
  });
});

describe('como a IA tratou o item', () => {
  const corrigidos = new Set(['i3']);
  it('separa achou sozinha, perguntou e cliente corrigiu', () => {
    assert.deepEqual(
      [
        comoFoiOItem({ id: 'i1', status: 'resolvido', resultado: { status: 'resolvido' } }, corrigidos),
        comoFoiOItem({ id: 'i2', status: 'respondido', resultado: { status: 'ambiguo' } }, corrigidos),
        comoFoiOItem({ id: 'i3', status: 'respondido', resultado: { status: 'confirmar' } }, corrigidos),
      ],
      ['sozinha', 'perguntou', 'corrigido'],
    );
  });

  it('conta o item que saiu da lista por correção como corrigido', () => {
    assert.equal(comoFoiOItem({ id: 'i9', status: 'fora_do_orcamento', resultado: { status: 'resolvido' } }, new Set()), 'corrigido');
  });
});

describe('tempo de resposta', () => {
  it('devolve mediana, 90% e o pior, em segundos', () => {
    const t = [1000, 2000, 3000, 4000, 20000].map(ms => ({ duracao_ms: ms }));
    assert.deepEqual(tempoDeResposta(t), { respostas: 5, mediana_s: 3, p90_s: 20, max_s: 20 });
  });
});

describe('métricas da semana', () => {
  it('conta a frase de falha e o custo por lista confirmada', () => {
    const m = calcularMetricas({
      periodo: { de: '2026-10-12T00:00:00Z', ate: '2026-10-19T00:00:00Z' },
      orcamentos: [orcamento('o1', 'c1', '2026-10-12T10:00:00Z', 'aguardando_vendedor', { cliente: {}, entrega: {}, itens: [{}] })],
      turnos: [turno('c1', '2026-10-12T10:00:30Z', 'aguardando_documento', { resposta: 'Vou consultar o vendedor para ele falar com você.' })],
      itens: [],
      corrigidos: new Set(),
      usos: [{ origem: 'agente', custo_usd: 0.03 }, { origem: 'v2', custo_usd: '0.01' }],
      chamadasErp: [{ ok: true }, { ok: false }],
      mensagensDoCliente: 4,
    });
    assert.deepEqual([m.falhas.disse_vou_consultar, m.falhas.erp_falhas, m.custo.por_lista_usd], [1, 1, 0.04]);
  });
});

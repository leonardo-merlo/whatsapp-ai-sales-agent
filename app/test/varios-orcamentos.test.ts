// Vários orçamentos abertos na mesma conversa (reunião de 27/10, chave VARIOS_ORCAMENTOS). O banco é o falso; ERP, v2
// e IA são executores de mentira, então nada aqui chama a API nem o ERP.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso } from './apoio/supabase-falso.mts';
import { conduzirMensagem, type Executores } from '@/lib/agente/maquina/conduzir';
import { lerFicha } from '@/lib/agente/maquina/ficha';
import { LEITURA_VAZIA, type Leitura } from '@/lib/agente/maquina/tipos';
import {
  numeroCitado, pedeFechar, pedeListaDeOrcamentos, pedeTrocarDeOrcamento, PERGUNTA_QUAL_FECHAR, PERGUNTA_QUAL_MUDAR, PERGUNTA_QUAL_VER, semCitacao,
} from '@/lib/agente/maquina/varios-orcamentos';
import type { FormaDePagamentoDoErp } from '@/lib/erp/contrato';

const CNPJ = '11.222.333/0001-81';
const PIX: FormaDePagamentoDoErp = { codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 };

const LEITURAS: Record<string, Partial<Leitura>> = {
  'quero um orçamento': { intencao: 'pedir_orcamento' },
  'quero outro orçamento': { intencao: 'pedir_orcamento' },
  'sim': { intencao: 'confirma' },
  'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
  '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
  'coloca 5 metalon 20x20': { intencao: 'pedir_orcamento', produtosCitados: true },
  'quero 2 discos de corte': { intencao: 'pedir_orcamento', produtosCitados: true },
};

function executores(): { ex: Executores; v2: string[] } {
  const v2: string[] = [];
  const ex: Executores = {
    async interpretar(_e, _p, fala) { return { ...LEITURA_VAZIA, ...(LEITURAS[fala] ?? {}) }; },
    async consultarCliente() {
      return { resultado: 'encontrado', cliente: { id: 'Z00002/01', nome: 'EMPRESA TESTE AGENTE LTDA', cidade: 'JUNDIAI', uf: 'MG', situacao: 'ATIVO', pode_faturar: true, confirmado: false, origem: 'erp', formas_pagamento: [PIX] } };
    },
    async cadastrarCliente() { return { resultado: 'falhou' }; },
    async regioes() { return [{ regiao_id: 'M01', cidades: [{ cidade: 'JUNDIAI', uf: 'MG' }] }]; },
    async v2(pedidoId, texto) {
      v2.push(texto);
      if (texto === 'sim') return { pedidoId: pedidoId ?? 'p1', texto: '', confirmados: [{ item_id: 'i1', codigo: '700123', descricao: 'VERGALHAO 3/8', quantidade: '10' }] };
      return { pedidoId: pedidoId ?? `p${v2.length}`, texto: `Anotei: ${texto}. Confere?`, confirmados: null };
    },
    async listaDaV2() { return 'Anotei: 10 x VERGALHAO 3/8. Confere?'; },
    async responderLivre() { return 'Certo.'; },
    async cotar(condicao, _c, itens) {
      return { resultado: 'ok', cotacao: { condicao, valor_total: 500, consultado_em: null, itens: itens.map(i => ({ codigo: i.codigo, quantidade: Number(i.quantidade), preco_unitario: 1, valor_total: 500, estoque_disponivel: true, empresa: null })) } };
    },
    async pedidoV2DeAntes() { return false; },
    async fecharPedidoV2() { /* nada */ },
  };
  return { ex, v2 };
}

/** Imita `numerar_orcamento` (migration 20261021000020). */
function numerar(args: Record<string, unknown>, banco: Record<string, Record<string, unknown>[]>) {
  const linha = banco.orcamentos_em_andamento.find(l => l.id === args.p_id)!;
  if (linha.numero == null) {
    linha.numero = 122 + banco.orcamentos_em_andamento.filter(l => l.numero != null).length + 1;
    linha.expira_em = args.p_expira_em;
  }
  return [{ numero: linha.numero, expira_em: linha.expira_em }];
}

function conversa(id: string) {
  const { client, banco } = criarSupabaseFalso({}, { funcoes: { numerar_orcamento: numerar } });
  const { ex, v2 } = executores();
  const onde = { orgId: 'org-1', conversationId: id, contactId: null, waNumberId: null };
  let ultima: string | null = null;
  let n = 0;
  const falar = async (texto: string): Promise<string> => {
    const r = await conduzirMensagem(client as never, onde, { mensagemId: `${id}-m${++n}`, texto, ultimaFalaDaCasa: ultima }, ex);
    assert.equal(r.tipo, 'respondeu', JSON.stringify(r));
    ultima = (r as { resposta: string }).resposta;
    return ultima;
  };
  /** Orçamento inteiro até a forma de pagamento: fica com número e esperando o vendedor. */
  const doisOrcamentos = async () => {
    for (const t of ['quero um orçamento', CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim', 'pix']) await falar(t);
    for (const t of ['quero outro orçamento', 'sim', '10 vergalhões 3/8', 'sim', 'pix']) await falar(t);
  };
  const linha = (numero: number) => banco.orcamentos_em_andamento.find(l => l.numero === numero)!;
  return { client, banco, v2, falar, doisOrcamentos, linha };
}

before(() => { process.env.VARIOS_ORCAMENTOS = 'ligado'; });

describe('o que o cliente pede, sem banco', () => {
  test('pedir a lista dos abertos', () => {
    for (const t of ['quais orçamentos eu tenho em aberto?', 'meus orçamentos', 'tenho algum orçamento em aberto?', 'me mostra os orçamentos']) assert.ok(pedeListaDeOrcamentos(t), t);
    for (const t of ['quero um orçamento', 'quero outro orçamento', 'o orçamento ficou caro']) assert.ok(!pedeListaDeOrcamentos(t), t);
  });

  test('trocar de orçamento não é abrir um novo', () => {
    for (const t of ['quero mudar de orçamento', 'quero falar de outro orçamento', 'voltar pro orçamento anterior', 'quero ver o outro orçamento']) assert.ok(pedeTrocarDeOrcamento(t), t);
    for (const t of ['quero outro orçamento', 'quero um novo orçamento', 'faz outro orçamento pra mim', 'quero mudar o orçamento']) assert.ok(!pedeTrocarDeOrcamento(t), t);
  });

  test('o número citado', () => {
    assert.equal(numeroCitado('no orçamento 123 tira o vergalhão'), 123);
    assert.equal(numeroCitado('orçamento nº 124'), 124);
    assert.equal(numeroCitado('quero 10 vergalhões'), null);
    assert.equal(numeroCitado('123', true), 123);
    assert.equal(numeroCitado('o 124', true), 124);
    assert.equal(numeroCitado('10 vergalhões', true), null);
  });

  test('fechar', () => {
    for (const t of ['quero fechar', 'pode fechar o orçamento', 'quero comprar']) assert.ok(pedeFechar(t), t);
  });
});

describe('dois orçamentos na mesma conversa', () => {
  const c = conversa('conv-dois');

  test('pedir outro orçamento deixa o anterior em espera, com número e validade', async () => {
    await c.doisOrcamentos();
    assert.deepEqual([c.linha(123).etapa, c.linha(123).motivo_pausa], ['encerrado', 'em_espera']);
    assert.equal(c.linha(124).etapa, 'aguardando_vendedor');
  });

  test('"quais orçamentos eu tenho em aberto?" lista os dois com a validade', async () => {
    const r = await c.falar('quais orçamentos eu tenho em aberto?');
    assert.match(r, /Você tem 2 orçamentos em aberto:/);
    assert.match(r, /\*nº 123\* · .* · vale até .* · 1 item/);
    assert.match(r, /\*nº 124\* · .* · em andamento/);
    assert.doesNotMatch(r, /R\$/);
  });

  test('"quero falar de outro orçamento" lista e pergunta qual', async () => {
    const r = await c.falar('quero falar de outro orçamento');
    assert.ok(r.endsWith(PERGUNTA_QUAL_VER), r);
  });

  test('responder o número põe aquele orçamento em foco e mostra a lista dele', async () => {
    const r = await c.falar('123');
    assert.match(r, /^Certo, agora estamos no orçamento nº 123, vale até/);
    assert.match(r, /10 × VERGALHAO 3\/8/);
    assert.equal(c.linha(123).etapa, 'aguardando_vendedor');
    assert.deepEqual([c.linha(124).etapa, c.linha(124).motivo_pausa], ['encerrado', 'em_espera']);
  });

  test('escolhido, mandar produto vai direto para a lista dele, sem perguntar de novo', async () => {
    const r = await c.falar('coloca 5 metalon 20x20');
    assert.equal(r, 'Anotei: coloca 5 metalon 20x20. Confere?');
    assert.equal(c.linha(123).etapa, 'levantando_itens');
  });

  test('a lista mudada pede o sim de novo e mantém o número', async () => {
    await c.falar('sim');
    assert.equal(c.linha(123).numero, 123);
    assert.equal(c.linha(123).etapa, 'definindo_pagamento');
  });
});

describe('a lista já foi para o vendedor e chega produto', () => {
  test('sem ter escolhido o orçamento, pergunta se coloca nele ou abre outro; "sim" coloca', async () => {
    const c = conversa('conv-coloca');
    await c.doisOrcamentos();
    const r = await c.falar('quero 2 discos de corte');
    assert.equal(r, 'Coloco no orçamento nº 124 ou abro um novo?');
    assert.equal(await c.falar('sim'), '*Orçamento nº 124*\nAnotei: quero 2 discos de corte. Confere?');
    assert.equal(c.linha(124).etapa, 'levantando_itens');
  });

  test('"novo" abre outro orçamento e deixa o de antes em espera', async () => {
    const c = conversa('conv-novo');
    await c.doisOrcamentos();
    await c.falar('quero 2 discos de corte');
    const r = await c.falar('novo');
    assert.match(r, /mesmo cadastro/);
    assert.equal(c.linha(124).motivo_pausa, 'em_espera');
  });

  test('tirar um item com dois abertos pergunta em qual', async () => {
    const c = conversa('conv-tira');
    await c.doisOrcamentos();
    const r = await c.falar('tira o vergalhão');
    assert.ok(r.endsWith(PERGUNTA_QUAL_MUDAR), r);
    assert.equal(await c.falar('123'), '*Orçamento nº 123*\nAnotei: tira o vergalhão. Confere?');
    assert.equal(c.linha(123).etapa, 'levantando_itens');
  });

  test('citar o número na frase troca o foco e aplica nele', async () => {
    const c = conversa('conv-cita');
    await c.doisOrcamentos();
    assert.equal(await c.falar('no orçamento 123 tira o vergalhão'), '*Orçamento nº 123*\nAnotei: tira o vergalhão. Confere?');
    assert.equal(c.linha(124).motivo_pausa, 'em_espera');
  });
});

describe('teste de 29/10', () => {
  test('"quero mudar para o orçamento 123" só troca, sem mexer na lista', async () => {
    const c = conversa('conv-29-mudar');
    await c.doisOrcamentos();
    const r = await c.falar('quero mudar para o orçamento 123');
    assert.match(r, /^Certo, agora estamos no orçamento nº 123/);
    assert.equal(c.linha(123).etapa, 'aguardando_vendedor');
  });

  test('citar o orçamento que já está em foco tira o número antes de a lista ler', async () => {
    const c = conversa('conv-29-mesmo');
    await c.doisOrcamentos();
    await c.falar('quero mudar para o orçamento 124');
    assert.equal(await c.falar('no orçamento 124, tira o vergalhão'), 'Anotei: tira o vergalhão. Confere?');
  });

  test('"aorçamento" com erro de digitação ainda é trocar de orçamento', () => {
    assert.ok(pedeTrocarDeOrcamento('quero voltar pro aorçamento anterior'));
    assert.ok(pedeTrocarDeOrcamento('quero mudar de orçament'));
  });

  test('a lista em montagem não mostra validade; a que já foi ao vendedor mostra', async () => {
    const c = conversa('conv-29-validade');
    await c.doisOrcamentos();
    await c.falar('quero outro orçamento');
    await c.falar('sim');
    await c.falar('5 vergalhões 3/8');
    const r = await c.falar('quais orçamentos tenho em aberto?');
    const atual = r.split('\n').find(l => l.includes('em andamento'))!;
    assert.ok(!atual.includes('vale até') && r.includes('*nº 123* ·') && /nº 123\*[^\n]*vale até/.test(r), r);
  });

  test('semCitacao tira só o "no orçamento N"', () => {
    assert.equal(semCitacao('no orçamento 10, 10 adiciona vergalhão 8mm'), '10 adiciona vergalhão 8mm');
    assert.equal(semCitacao('Orçamento nº 12: tira o prego'), 'tira o prego');
    assert.equal(semCitacao('troca a força 10 por 12'), 'troca a força 10 por 12');
  });
});

describe('fechar com dois abertos', () => {
  test('sempre pergunta qual, e a resposta diz o escolhido', async () => {
    const c = conversa('conv-fechar');
    await c.doisOrcamentos();
    const r = await c.falar('quero fechar');
    assert.ok(r.endsWith(PERGUNTA_QUAL_FECHAR), r);
    assert.equal(await c.falar('nº 123'), 'Certo, o orçamento nº 123. O vendedor segue com ele e te manda o pedido.');
    assert.equal((await lerFicha(c.client as never, 'conv-fechar'))?.numero, 123);
  });
});

describe('chave desligada', () => {
  test('pedir outro orçamento encerra o anterior, como antes', async () => {
    process.env.VARIOS_ORCAMENTOS = '';
    try {
      const c = conversa('conv-desligada');
      await c.doisOrcamentos();
      assert.deepEqual([c.linha(123).etapa, c.linha(123).motivo_pausa === 'em_espera'], ['encerrado', false]);
      const r = await c.falar('quais orçamentos eu tenho em aberto?');
      assert.doesNotMatch(r, /orçamentos em aberto:/);
    } finally {
      process.env.VARIOS_ORCAMENTOS = 'ligado';
    }
  });
});

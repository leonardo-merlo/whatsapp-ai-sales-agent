// O condutor da máquina: o laço de transições (A2), a gravação com versão e o
// texto que sai. O banco é o falso; ERP, v2 e IA são executores de mentira,
// então nada aqui chama a API nem o ERP.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso } from './apoio/supabase-falso.mts';
import { cidadeEscritaPeloCliente, conduzirComFalasNovas, conduzirMensagem, contagemNova, semPerguntas, mensagemDaVez, temDocumentoInvalido, type Executores } from '@/lib/agente/maquina/conduzir';
import { criarFicha, ErroDeVersao, gravarFicha, lerFicha, venceu, type Ficha } from '@/lib/agente/maquina/ficha';
import { usaMaquina } from '@/lib/agente/maquina/chave';
import { novoRastreio, type Rastreio } from '@/lib/agente/rastreio/rastreio';
import { LEITURA_VAZIA, type EstadoDoOrcamento, type Leitura } from '@/lib/agente/maquina/tipos';
import { TEXTO_DA_LISTA_CONFIRMADA } from '@/lib/v2/integracao-v1';
import type { FormaDePagamentoDoErp } from '@/lib/erp/contrato';
import { diaMesEmSP } from '@/lib/fuso';

const ONDE = { orgId: 'org-1', conversationId: 'conv-1', contactId: null, waNumberId: null };
const CNPJ = '11.222.333/0001-81';

function falsos(leituras: Record<string, Partial<Leitura>>, opcoes: { erpFalha?: boolean; formas?: FormaDePagamentoDoErp[]; total?: number } = {}) {
  const chamadas = { consultar: 0, v2: [] as string[], livre: 0, fechados: [] as string[] };
  const ex: Executores = {
    async interpretar(_e, _p, fala) { return { ...LEITURA_VAZIA, ...(leituras[fala] ?? {}) }; },
    async consultarCliente() {
      chamadas.consultar++;
      if (opcoes.erpFalha) return { resultado: 'falhou' };
      return { resultado: 'encontrado', cliente: { id: 'Z00002/01', nome: 'EMPRESA TESTE AGENTE LTDA', cidade: 'JUNDIAI', uf: 'MG', situacao: 'BLOQUEADO', pode_faturar: false, confirmado: false, origem: 'erp', ...(opcoes.formas ? { formas_pagamento: opcoes.formas } : {}) } };
    },
    async cadastrarCliente() { return { resultado: 'falhou' }; },
    async regioes() { return [{ regiao_id: 'M01', cidades: [{ cidade: 'JUNDIAI', uf: 'MG' }] }]; },
    async v2(pedidoId, texto) {
      chamadas.v2.push(texto);
      if (texto === 'sim') return { pedidoId: pedidoId ?? 'p1', texto: '', confirmados: [{ item_id: 'i1', codigo: '700123', descricao: 'VERGALHAO 3/8', quantidade: '10' }] };
      return { pedidoId: pedidoId ?? 'p1', texto: 'Anotei: 10 x VERGALHAO 3/8. Confere?', confirmados: null };
    },
    async listaDaV2() { return 'Anotei: 10 x VERGALHAO 3/8. Confere?'; },
    async responderLivre() { chamadas.livre++; return 'Abrimos sábado até meio-dia.'; },
    async cotar(condicao, _clienteId, itens) {
      const total = opcoes.total ?? 500;
      return { resultado: 'ok', cotacao: { condicao, valor_total: total, consultado_em: null, itens: itens.map(i => ({ codigo: i.codigo, quantidade: Number(i.quantidade), preco_unitario: 1, valor_total: total, estoque_disponivel: true, empresa: null })) } };
    },
    async pedidoV2DeAntes() { return false; },
    async fecharPedidoV2(pedidoId) { chamadas.fechados.push(pedidoId); },
  };
  return { ex, chamadas };
}

let n = 0;
const vez = (texto: string, mensagemId = `m${++n}`) => ({ mensagemId, texto, ultimaFalaDaCasa: null });

describe('caminho feliz, mensagem a mensagem', () => {
  const { client } = criarSupabaseFalso({});
  const { ex } = falsos({
    'quero um orçamento': { intencao: 'pedir_orcamento' },
    'sim': { intencao: 'confirma' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
  });
  const conduzir = async (texto: string) => {
    const r = await conduzirMensagem(client as never, ONDE, vez(texto), ex);
    assert.equal(r.tipo, 'respondeu');
    return r as Extract<typeof r, { tipo: 'respondeu' }>;
  };

  test('pedido de orçamento: pede o documento', async () => {
    assert.match((await conduzir('quero um orçamento')).resposta, /CPF ou CNPJ/);
  });

  test('CNPJ: consulta e mostra o cadastro achado', async () => {
    const r = await conduzir(CNPJ);
    assert.deepEqual([r.transicoes, r.resposta], [['T2', 'T3'], 'Achei aqui: EMPRESA TESTE AGENTE LTDA, de Jundiai/MG. É esse cadastro mesmo?']);
  });

  test('"sim": pergunta a cidade de entrega (a região não é pulada)', async () => {
    assert.equal((await conduzir('sim')).resposta, 'Qual a cidade de entrega?');
  });

  test('cidade atendida: pede os produtos', async () => {
    const r = await conduzir('Jundiaí');
    assert.deepEqual([r.etapa, r.resposta], ['levantando_itens', 'Certo! O que você precisa? Pode mandar a lista com as quantidades.']);
  });

  test('produtos: a v2 responde', async () => {
    assert.equal((await conduzir('10 vergalhões 3/8')).resposta, 'Anotei: 10 x VERGALHAO 3/8. Confere?');
  });

  test('"sim" na lista: lista confirmada e a conversa para no vendedor', async () => {
    const r = await conduzir('sim');
    assert.deepEqual([r.etapa, r.resposta], ['aguardando_vendedor', TEXTO_DA_LISTA_CONFIRMADA]);
  });

  test('a ficha guarda a lista confirmada', async () => {
    const ficha = await lerFicha(client as never, 'conv-1');
    assert.equal(ficha?.estado.dados.itens?.[0].codigo, '700123');
  });
});

describe('caminho feliz com as formas de pagamento do ERP (14/10)', () => {
  const { client } = criarSupabaseFalso({});
  const pix: FormaDePagamentoDoErp = { codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 };
  const boleto: FormaDePagamentoDoErp = { ...pix, codigo: 'B00', descricao: 'BOL ANTECIPADO', forma: 'BO' };
  const { ex } = falsos({
    'sim': { intencao: 'confirma' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
  }, { formas: [pix, boleto] });
  const conduzir = async (texto: string) => {
    const r = await conduzirMensagem(client as never, { ...ONDE, conversationId: 'conv-pag' }, vez(texto), ex);
    assert.equal(r.tipo, 'respondeu');
    return r as Extract<typeof r, { tipo: 'respondeu' }>;
  };

  test('a lista confirmada pergunta a forma de pagamento em tópicos', async () => {
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8']) await conduzir(t);
    const r = await conduzir('sim');
    assert.deepEqual([r.etapa, r.resposta], ['definindo_pagamento', 'Lista confirmada! Como prefere pagar?\n\n• PIX\n• Boleto antecipado']);
  });

  test('a escolha consulta o preço e para no vendedor com a mensagem de antes', async () => {
    const r = await conduzir('no boleto');
    assert.deepEqual([r.etapa, r.resposta, r.transicoes], ['aguardando_vendedor', 'Anotado: boleto antecipado. O vendedor vai te mandar o orçamento com os preços.', ['T15', 'T16']]);
  });
});

describe('regras que não deixam pular etapa', () => {
  test('CNPJ com produtos na mesma mensagem: confirma o cadastro antes, e a v2 não é chamada', async () => {
    const { client } = criarSupabaseFalso({});
    const texto = `${CNPJ} quero 10 vergalhões`;
    const { ex, chamadas } = falsos({ [texto]: { intencao: 'pedir_orcamento', produtosCitados: true } });
    const r = await conduzirMensagem(client as never, ONDE, vez(texto), ex);
    assert.deepEqual([r.tipo === 'respondeu' && r.etapa, chamadas.v2.length], ['confirmando_regiao', 0]);
  });

  test('cidade fora da lista: não segue e diz que não entrega', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos({ 'sim': { intencao: 'confirma' }, 'Recife': { cidade: { cidade: 'Recife', uf: 'PE' } } });
    await conduzirMensagem(client as never, ONDE, vez(CNPJ), ex);
    await conduzirMensagem(client as never, ONDE, vez('sim'), ex);
    const r = await conduzirMensagem(client as never, ONDE, vez('Recife'), ex);
    assert.deepEqual([r.tipo === 'respondeu' && r.etapa, r.tipo === 'respondeu' && r.resposta.startsWith('Não entregamos em Recife.')], ['confirmando_regiao', true]);
  });

  test('a mesma mensagem repetida (varredura) não confirma o cadastro', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos({});
    await conduzirMensagem(client as never, ONDE, vez(CNPJ, 'repetida'), ex);
    const r = await conduzirMensagem(client as never, ONDE, vez(CNPJ, 'repetida'), ex);
    assert.deepEqual([r.tipo === 'respondeu' && r.transicoes, r.tipo === 'respondeu' && r.resposta.startsWith('Achei aqui')], [[], true]);
  });

  test('outro assunto no meio: a IA responde e o código repete a pergunta da etapa', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos({ 'quero orçamento': { intencao: 'pedir_orcamento' }, 'abre sábado?': { intencao: 'outro_assunto' } });
    await conduzirMensagem(client as never, ONDE, vez('quero orçamento'), ex);
    const r = await conduzirMensagem(client as never, ONDE, vez('abre sábado?'), ex);
    assert.equal(r.tipo === 'respondeu' && r.resposta, 'Abrimos sábado até meio-dia.\n\nPara montar o orçamento, me passa o CPF ou CNPJ de quem está comprando?');
  });

  test('ERP fora do ar: avisa que vai confirmar, e a próxima mensagem tenta de novo', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex, chamadas } = falsos({}, { erpFalha: true });
    const r = await conduzirMensagem(client as never, ONDE, vez(CNPJ), ex);
    await conduzirMensagem(client as never, ONDE, vez('e aí?'), ex);
    assert.deepEqual([r.tipo === 'respondeu' && r.resposta, chamadas.consultar], ['Vou consultar o vendedor para ele falar com você.', 2]);
  });
});

describe('versão: duas execuções não se atropelam', () => {
  test('a segunda gravação com a mesma versão é recusada', async () => {
    const { client } = criarSupabaseFalso({});
    const estado = { etapa: 'aguardando_documento' as const, pergunta: 'documento' as const, dados: {}, desdeMensagem: 'm1' };
    const ficha = await criarFicha(client as never, ONDE, estado);
    await gravarFicha(client as never, ficha, { ...estado, desdeMensagem: 'm2' });
    await assert.rejects(gravarFicha(client as never, ficha, { ...estado, desdeMensagem: 'm3' }), ErroDeVersao);
  });
});

describe('chave e entrada', () => {
  test('desligada por padrão: o motor de sempre responde', () => {
    assert.equal(usaMaquina('vendas', { maquina: '', pipeline: 'v2' }), false);
  });

  test('ligada só com a v2 ligada e só no roteiro de vendas', () => {
    assert.deepEqual(
      [usaMaquina('vendas', { maquina: 'ligado', pipeline: 'v2' }), usaMaquina('vendas', { maquina: 'ligado', pipeline: 'v1' }), usaMaquina('atendimento', { maquina: 'ligado', pipeline: 'v2' })],
      [true, false, false],
    );
  });

  test('última fala da IA: a mensagem já foi respondida', () => {
    const r = mensagemDaVez([{ id: 'a', autor: 'cliente', texto: 'oi', created_at: '2026-10-07T10:00:00Z' }, { id: 'b', autor: 'ia', texto: 'olá', created_at: '2026-10-07T10:00:05Z' }]);
    assert.deepEqual(r, { naoResponder: 'ja-respondida' });
  });

  test('as falas seguidas do cliente viram uma mensagem só', () => {
    const r = mensagemDaVez([
      { id: 'a', autor: 'ia', texto: 'Qual a cidade?', created_at: '2026-10-07T10:00:00Z' },
      { id: 'b', autor: 'cliente', texto: 'Jundiaí', created_at: '2026-10-07T10:01:00Z' },
      { id: 'c', autor: 'cliente', texto: 'MG', created_at: '2026-10-07T10:01:05Z' },
    ]);
    assert.deepEqual(r, { vez: { mensagemId: 'c', texto: 'Jundiaí\nMG', ultimaFalaDaCasa: 'Qual a cidade?' } });
  });

  test('cidade que a IA tirou da pergunta, e não da fala do cliente, é descartada (ensaio de 07/10)', () => {
    const leitura = { ...LEITURA_VAZIA, intencao: 'confirma' as const, cidade: { cidade: 'Jundiai', uf: 'MG' } };
    assert.deepEqual([cidadeEscritaPeloCliente(leitura, 'sim, é essa').cidade, cidadeEscritaPeloCliente(leitura, 'sim, entrega em Jundiaí').cidade], [null, { cidade: 'Jundiai', uf: 'MG' }]);
  });

  test('a resposta livre perde a pergunta que a IA fez por conta própria (ensaio de 07/10)', () => {
    assert.equal(
      semPerguntas('Vou confirmar o horário com o vendedor. Enquanto isso, me passa o CPF ou CNPJ para eu começar o orçamento?'),
      'Vou confirmar o horário com o vendedor.',
    );
  });

  test('CNPJ com dígito errado é reconhecido como documento inválido; telefone curto não', () => {
    assert.deepEqual([temDocumentoInvalido('11.222.333/0001-00'), temDocumentoInvalido('meu zap 32 99133')], [true, false]);
  });
});

describe('T5: CPF/CNPJ inválido ganha aviso (teste de campo de 20/10)', () => {
  test('o CNPJ com um dígito a menos do Vendedor 1 ("1122333000181", 13 dígitos) é documento inválido', () => {
    assert.equal(temDocumentoInvalido('1122333000181'), true);
  });

  test('qualquer tentativa de 9 a 15 dígitos, com ou sem pontuação, que não é CPF nem CNPJ', () => {
    assert.deepEqual(
      ['123456789', '112.223.330-00', '11.222.333/0001-8', '1234567890123456', '11222333000181'].map(temDocumentoInvalido),
      [true, true, true, false, false],
    );
  });

  test('quantidade, CEP e lista de itens não são tentativa de documento', () => {
    assert.deepEqual(
      ['150 parafuso', 'cep 36880-000', '10 telhas 4,5 m\n5 telhas 5,5 m\n12 metros de calha', '2 3 4 5 6 7 8 9 10'].map(temDocumentoInvalido),
      [false, false, false, false],
    );
  });

  test('na conversa: avisa que o número não é válido em vez de repetir o pedido do documento', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex, chamadas } = falsos({ 'Orçamento\n10 telhas': { intencao: 'pedir_orcamento', produtosCitados: true } });
    await conduzirMensagem(client as never, { ...ONDE, conversationId: 'conv-t5' }, vez('Orçamento\n10 telhas'), ex);
    const r = await conduzirMensagem(client as never, { ...ONDE, conversationId: 'conv-t5' }, vez('1122333000181'), ex);
    assert.deepEqual(
      [r.tipo === 'respondeu' && r.resposta, chamadas.consultar],
      ['Esse número não é um CPF ou CNPJ válido. Pode conferir? Se ainda não tem cadastro com a gente, me manda o CPF ou CNPJ certo que eu faço o cadastro agora.', 0],
    );
  });
});

describe('T1: número e validade de 5 dias, vários orçamentos ao mesmo tempo (teste de campo de 20/10)', () => {
  const pix: FormaDePagamentoDoErp = { codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 };
  const leituras = {
    'quero um orçamento': { intencao: 'pedir_orcamento' as const },
    'quero outro orçamento': { intencao: 'pedir_orcamento' as const },
    'sim': { intencao: 'confirma' as const },
    'Jundiaí': { intencao: 'responde' as const, cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos' as const, produtosCitados: true },
  };
  /** Imita `numerar_orcamento` da migration 20261021000020: um contador por organização, uma vez por orçamento. */
  const numerar = (args: Record<string, unknown>, banco: Record<string, Record<string, unknown>[]>) => {
    const linha = banco.orcamentos_em_andamento.find(l => l.id === args.p_id)!;
    if (linha.numero == null) {
      const da = banco.orcamentos_em_andamento.filter(l => l.organization_id === linha.organization_id && l.numero != null);
      linha.numero = 122 + da.length + 1;
      linha.expira_em = args.p_expira_em;
    }
    return [{ numero: linha.numero, expira_em: linha.expira_em }];
  };
  const onde = { ...ONDE, conversationId: 'conv-t1' };
  const { client, banco, rpcsChamadas } = criarSupabaseFalso({}, { funcoes: { numerar_orcamento: numerar } });
  const { ex } = falsos(leituras, { formas: [pix] });
  const conduzir = async (texto: string) => {
    const r = await conduzirMensagem(client as never, onde, vez(texto), ex);
    assert.equal(r.tipo, 'respondeu');
    return r as Extract<typeof r, { tipo: 'respondeu' }>;
  };
  const daquiA5Dias = () => new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

  test('a lista confirmada ganha número, e a validade é de 5 dias', async () => {
    for (const t of ['quero um orçamento', CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim']) await conduzir(t);
    const expira = Date.parse(String(rpcsChamadas.find(c => c.nome === 'numerar_orcamento')?.args.p_expira_em));
    assert.ok(Math.abs(expira - daquiA5Dias().getTime()) < 60_000);
  });

  test('a forma de pagamento anotada diz o número e a validade', async () => {
    const r = await conduzir('pix');
    assert.equal(r.resposta, `Anotado: PIX. Orçamento nº 123, vale até ${diaMesEmSP(daquiA5Dias())}. O vendedor vai te mandar o orçamento com os preços.`);
  });

  test('um orçamento novo não cancela o anterior: ele segue com número e validade', async () => {
    await conduzir('quero outro orçamento');
    const anterior = banco.orcamentos_em_andamento.find(l => l.numero === 123);
    assert.deepEqual([anterior?.etapa, typeof anterior?.expira_em], ['encerrado', 'string']);
  });

  test('com número, a ficha vale até a validade: esperando o vendedor vence depois dela, e a forma de pagamento não vence em 24 h', () => {
    const agora = Date.parse('2026-10-24T12:00:00Z');
    const ficha = (etapa: 'aguardando_vendedor' | 'definindo_pagamento', expiraEm: string): Ficha => ({
      id: 'f', versao: 1, atualizadoEm: '2026-10-21T12:00:00Z', numero: 123, expiraEm,
      estado: { etapa, pergunta: null, dados: {}, desdeMensagem: null },
    });
    assert.deepEqual(
      [venceu(ficha('aguardando_vendedor', '2026-10-23T12:00:00Z'), agora), venceu(ficha('definindo_pagamento', '2026-10-26T12:00:00Z'), agora)],
      [true, false],
    );
  });
});

describe('T20: segundo orçamento do mesmo cliente no dia (teste de campo de 20/10)', () => {
  const leituras = {
    'quero um orçamento': { intencao: 'pedir_orcamento' as const },
    'quero outro orçamento': { intencao: 'pedir_orcamento' as const },
    'sim': { intencao: 'confirma' as const },
    'não': { intencao: 'nega' as const },
    'Jundiaí': { intencao: 'responde' as const, cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos' as const, produtosCitados: true },
  };
  const primeiroOrcamento = async (client: unknown, onde: typeof ONDE, ex: Executores) => {
    for (const t of ['quero um orçamento', CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim']) await conduzirMensagem(client as never, onde, vez(t), ex);
  };

  test('o segundo pergunta se é o mesmo cadastro; "sim" vai para a cidade sem consultar o ERP de novo', async () => {
    const { client } = criarSupabaseFalso({});
    const onde = { ...ONDE, conversationId: 'conv-t20' };
    const { ex, chamadas } = falsos(leituras);
    await primeiroOrcamento(client, onde, ex);
    const pergunta = await conduzirMensagem(client as never, onde, vez('quero outro orçamento'), ex);
    const consultasAntes = chamadas.consultar;
    const sim = await conduzirMensagem(client as never, onde, vez('sim'), ex);
    assert.deepEqual(
      [pergunta.tipo === 'respondeu' && pergunta.resposta, sim.tipo === 'respondeu' && sim.resposta, chamadas.consultar - consultasAntes],
      ['Esse orçamento é para o mesmo cadastro, EMPRESA TESTE AGENTE LTDA, com entrega em Jundiaí?', 'Certo! Entrega em Jundiaí. O que você precisa? Pode mandar a lista com as quantidades.', 0],
    );
  });

  // E4 (23/10): um "sim" responde ao cadastro e à entrega; a cidade dita pelo cliente manda.
  test('"sim, mas em Itatiba" troca a entrega do orçamento anterior', async () => {
    const { client } = criarSupabaseFalso({});
    const onde = { ...ONDE, conversationId: 'conv-t20-outra-cidade' };
    const { ex } = falsos({ ...leituras, 'sim, mas em Itatiba': { intencao: 'confirma', cidade: { cidade: 'Itatiba', uf: null } } });
    await primeiroOrcamento(client, onde, ex);
    await conduzirMensagem(client as never, onde, vez('quero outro orçamento'), ex);
    const r = await conduzirMensagem(client as never, onde, vez('sim, mas em Itatiba'), ex);
    assert.notEqual(r.tipo === 'respondeu' && /Entrega em Jundiaí/.test(r.resposta), true);
  });

  test('"não": pede o CPF ou CNPJ', async () => {
    const { client } = criarSupabaseFalso({});
    const onde = { ...ONDE, conversationId: 'conv-t20-nao' };
    const { ex } = falsos(leituras);
    await primeiroOrcamento(client, onde, ex);
    await conduzirMensagem(client as never, onde, vez('quero outro orçamento'), ex);
    const r = await conduzirMensagem(client as never, onde, vez('não'), ex);
    assert.equal(r.tipo === 'respondeu' && r.resposta, 'Sem problema. Me passa o CPF ou CNPJ certo?');
  });

  test('orçamento de ontem não conta: pede o documento', async () => {
    const ontem = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const { client } = criarSupabaseFalso({
      orcamentos_em_andamento: [{
        id: 'f-ontem', organization_id: 'org-1', conversation_id: 'conv-t20-ontem', modo: 'valendo', etapa: 'encerrado', versao: 3,
        dados: { documento: { valor: '11222333000181', origem: 'cliente' }, cliente: { id: 'Z00002/01', nome: 'EMPRESA TESTE AGENTE LTDA', cidade: 'JUNDIAI', uf: 'MG', situacao: null, pode_faturar: null, confirmado: true, origem: 'erp' } },
        created_at: ontem, updated_at: ontem,
      }],
    });
    const { ex } = falsos(leituras);
    const r = await conduzirMensagem(client as never, { ...ONDE, conversationId: 'conv-t20-ontem' }, vez('quero outro orçamento'), ex);
    assert.match(r.tipo === 'respondeu' ? r.resposta : '', /^Para montar o orçamento, me passa o CPF ou CNPJ/);
  });
});

// Válvula de escape, item 2 (22/10): a mesma pergunta repetida sem fim. Na 2ª vez sem andar, a frase
// fixa com as opções da etapa; na 3ª, o vendedor assume a conversa.
describe('o cliente fora do roteiro, em 3 tempos', () => {
  const pix: FormaDePagamentoDoErp = { codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 };
  const boleto: FormaDePagamentoDoErp = { ...pix, codigo: 'B00', descricao: 'BOL ANTECIPADO', forma: 'BO' };
  const leituras: Record<string, Partial<Leitura>> = {
    'quero um orçamento': { intencao: 'pedir_orcamento' },
    'sim': { intencao: 'confirma' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
    'oi tudo bem': { intencao: 'outro_assunto' },
  };
  const novo = (conversationId: string, opcoes: Parameters<typeof falsos>[1] = {}) => {
    const { client } = criarSupabaseFalso({});
    const { ex, chamadas } = falsos(leituras, opcoes);
    const onde = { ...ONDE, conversationId };
    const conduzir = async (texto: string, executores: Executores = ex, rastreio?: Rastreio) => {
      const r = await conduzirMensagem(client as never, onde, vez(texto), executores, rastreio);
      assert.equal(r.tipo, 'respondeu');
      return r as Extract<typeof r, { tipo: 'respondeu' }>;
    };
    return { client, ex, chamadas, conduzir };
  };
  const ateACidade = async (conduzir: (t: string) => Promise<unknown>): Promise<void> => { for (const t of [CNPJ, 'sim']) await conduzir(t); };

  test('repete a pergunta na 1ª vez, mostra o jeito de responder na 2ª e passa ao atendente na 3ª', async () => {
    const { conduzir } = novo('conv-3t-cidade');
    await ateACidade(conduzir);
    const respostas = [];
    for (let i = 0; i < 3; i++) respostas.push(await conduzir('hmm'));
    assert.deepEqual(respostas.map(r => [r.resposta, !!r.transferir]), [
      ['Qual a cidade de entrega?', false],
      ['Não entendi. Me diga só o nome da cidade de entrega, por exemplo: Jundiaí.', false],
      ['Vou passar para um atendente continuar com você.', true],
    ]);
  });

  test('zera a contagem quando a etapa anda', async () => {
    const { conduzir } = novo('conv-3t-zera');
    await ateACidade(conduzir);
    await conduzir('hmm');
    await conduzir('Jundiaí');
    assert.equal((await conduzir('hmm')).resposta, 'Certo! O que você precisa? Pode mandar a lista com as quantidades.');
  });

  test('pede só os números do documento na 2ª vez', async () => {
    const { conduzir } = novo('conv-3t-doc');
    await conduzir('quero um orçamento');
    await conduzir('hmm');
    assert.equal((await conduzir('hmm')).resposta, 'Não entendi. Me manda só os números do CPF ou do CNPJ.');
  });

  test('responde o outro assunto e mostra as opções na 2ª vez', async () => {
    const { conduzir } = novo('conv-3t-livre');
    await conduzir('quero um orçamento');
    await conduzir('oi tudo bem');
    assert.equal((await conduzir('oi tudo bem')).resposta, 'Abrimos sábado até meio-dia.\n\nMe manda só os números do CPF ou do CNPJ.');
  });

  test('mostra as formas do menu na 2ª vez do pagamento', async () => {
    const { conduzir } = novo('conv-3t-pag', { formas: [pix, boleto] });
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim', 'hmm']) await conduzir(t);
    assert.equal((await conduzir('hmm')).resposta, 'Não entendi a forma. Pode escolher uma destas:\n\n• PIX\n• Boleto antecipado');
  });

  test('conta o "Não sei qual tirar" da lista e mostra como editar na 2ª vez', async () => {
    const { conduzir, ex } = novo('conv-3t-lista');
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8']) await conduzir(t);
    const naoSei: Executores = { ...ex, async v2(pedidoId) { return { pedidoId: pedidoId ?? 'p1', texto: 'Não sei qual tirar: "tira aquele". Pode escrever o nome como está na lista?', confirmados: null }; } };
    await conduzir('tira aquele', naoSei);
    assert.equal((await conduzir('tira aquele', naoSei)).resposta, 'Não entendi. Responda SIM para seguir com a lista, ou me diga o que tirar ou trocar, por exemplo: tira o prego.');
  });

  test('marca no rastreio a etapa, a pergunta, as vezes e o motivo', async () => {
    const { conduzir } = novo('conv-3t-rastreio');
    await ateACidade(conduzir);
    await conduzir('hmm');
    const rastreio = novoRastreio('webhook');
    await conduzir('hmm', undefined, rastreio);
    assert.deepEqual([rastreio.caminho.includes('maquina_nao_entendeu'), rastreio.estadoDepois?.nao_entendeu],
      [true, { etapa: 'confirmando_regiao', pergunta: 'cidade', vezes: 2, motivo: 'repetiu_pergunta' }]);
  });
});

describe('áudio que não deu para ouvir e mensagem que não abre', () => {
  const leituras: Record<string, Partial<Leitura>> = { 'sim': { intencao: 'confirma' } };

  test('pede para escrever e repete a pergunta, sem chamar a IA de leitura', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos(leituras);
    let leituraChamada = 0;
    const contando: Executores = { ...ex, async interpretar(e, p, f) { leituraChamada++; return ex.interpretar(e, p, f); } };
    const onde = { ...ONDE, conversationId: 'conv-audio' };
    for (const t of [CNPJ, 'sim']) await conduzirMensagem(client as never, onde, vez(t), contando);
    const antes = leituraChamada;
    const r = await conduzirMensagem(client as never, onde, vez('[Áudio que não foi possível ouvir]'), contando);
    assert.deepEqual([r.tipo === 'respondeu' && r.resposta, leituraChamada - antes], ['Não consegui ouvir o áudio. Pode escrever?\n\nQual a cidade de entrega?', 0]);
  });

  test('trata o áudio sem fala do mesmo jeito', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos(leituras);
    const onde = { ...ONDE, conversationId: 'conv-audio-sem-fala' };
    await conduzirMensagem(client as never, onde, vez(CNPJ), ex);
    const r = await conduzirMensagem(client as never, onde, vez('[Áudio sem fala que desse para entender]'), ex);
    assert.match(r.tipo === 'respondeu' ? r.resposta : '', /^Não consegui ouvir o áudio\. Pode escrever\?\n\nAchei aqui/);
  });

  test('uma reação não confirma o cadastro', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos({ ...leituras, '[tipo não suportado: reaction]': { intencao: 'confirma' } });
    const onde = { ...ONDE, conversationId: 'conv-reacao' };
    await conduzirMensagem(client as never, onde, vez(CNPJ), ex);
    const r = await conduzirMensagem(client as never, onde, vez('[tipo não suportado: reaction]'), ex);
    assert.deepEqual([r.tipo === 'respondeu' && r.resposta.split('\n\n')[0], (await lerFicha(client as never, 'conv-reacao'))?.estado.pergunta],
      ['Não consigo abrir esse tipo de mensagem. Pode escrever?', 'confirmar_cliente']);
  });

  test('conta o áudio e passa ao atendente na 3ª vez', async () => {
    const { client } = criarSupabaseFalso({});
    const { ex } = falsos(leituras);
    const onde = { ...ONDE, conversationId: 'conv-audio-3' };
    for (const t of [CNPJ, 'sim']) await conduzirMensagem(client as never, onde, vez(t), ex);
    const r = [];
    for (let i = 0; i < 3; i++) r.push(await conduzirMensagem(client as never, onde, vez('[Áudio que não foi possível ouvir]'), ex));
    assert.deepEqual(r.map(x => x.tipo === 'respondeu' && x.resposta), [
      'Não consegui ouvir o áudio. Pode escrever?\n\nQual a cidade de entrega?',
      'Não consegui ouvir o áudio. Pode escrever?\n\nMe diga só o nome da cidade de entrega, por exemplo: Jundiaí.',
      'Vou passar para um atendente continuar com você.',
    ]);
  });
});

// Válvula de escape, item 3 (22/10): cada mensagem dispara uma execução. A 2ª perdia na versão e ficava
// calada, e o que vinha nela sumia. Agora a execução que ganhou confere, antes de responder, se chegaram
// falas novas e as processa; a que perdeu (ou ficou com o estado velho) não responde.
describe('mensagens seguidas não se perdem', () => {
  type Linha = { id: string; autor: string; texto: string; created_at: string };
  let relogio = 0;
  const fala = (id: string, texto: string, autor = 'cliente'): Linha => ({ id, autor, texto, created_at: new Date(Date.UTC(2026, 9, 22, 12, 0, relogio++)).toISOString() });
  const leituras: Record<string, Partial<Leitura>> = {
    'quero um orçamento': { intencao: 'pedir_orcamento' },
    'sim': { intencao: 'confirma' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
    '5 kg de prego': { intencao: 'produtos', produtosCitados: true },
    '10 vergalhões 3/8\n5 kg de prego': { intencao: 'produtos', produtosCitados: true },
  };
  const unico = { unicos: { orcamentos_em_andamento: [['conversation_id', 'modo']] } };

  /** B lê a ficha e para na leitura da IA até o teste soltar: assim A grava primeiro. */
  function pausado(ex: Executores) {
    let soltar!: () => void;
    let leu!: () => void;
    const solto = new Promise<void>(r => { soltar = r; });
    const chegou = new Promise<void>(r => { leu = r; });
    const exB: Executores = { ...ex, async interpretar(e, p, f) { leu(); await solto; return ex.interpretar(e, p, f); } };
    return { exB, chegou, soltar };
  }

  /** Leva a conversa até a etapa pedida, pelo caminho normal. */
  async function preparar(conversationId: string, ate: string[]) {
    const { client } = criarSupabaseFalso({}, unico);
    const { ex, chamadas } = falsos(leituras);
    const onde = { ...ONDE, conversationId };
    const historico: Linha[] = [];
    for (const [i, t] of ate.entries()) {
      historico.push(fala(`${conversationId}-c${i}`, t));
      const r = await conduzirComFalasNovas(client as never, onde, vez(t, `${conversationId}-c${i}`), ex, async () => historico);
      historico.push(fala(`${conversationId}-ia${i}`, r.tipo === 'respondeu' ? r.resposta : '', 'ia'));
    }
    return { client, ex, chamadas, onde, historico };
  }

  /** As duas mensagens chegam juntas: A com a 1ª, B com as duas (é o que `mensagemDaVez` vê). */
  async function correr(conversationId: string, ate: string[], primeira: string, segunda: string) {
    const c = await preparar(conversationId, ate);
    c.historico.push(fala(`${conversationId}-a`, primeira), fala(`${conversationId}-b`, segunda));
    const daVez = mensagemDaVez(c.historico);
    assert.ok('vez' in daVez);
    const { exB, chegou, soltar } = pausado(c.ex);
    const b = conduzirComFalasNovas(c.client as never, c.onde, daVez.vez, exB, async () => c.historico);
    await chegou;
    const a = await conduzirComFalasNovas(c.client as never, c.onde, vez(primeira, `${conversationId}-a`), c.ex, async () => c.historico);
    soltar();
    return { a, b: await b, chamadas: c.chamadas, client: c.client };
  }

  test('responde ao CNPJ que chegou logo depois do pedido de orçamento', async () => {
    const { a, b } = await correr('conv-seg-doc', [], 'quero um orçamento', CNPJ);
    assert.deepEqual([a.tipo === 'respondeu' && a.resposta, b.tipo], ['Achei aqui: EMPRESA TESTE AGENTE LTDA, de Jundiai/MG. É esse cadastro mesmo?', 'nao_responder']);
  });

  test('junta a lista partida em duas mensagens, sem mandar a mesma lista duas vezes para a v2', async () => {
    const { a, b, chamadas } = await correr('conv-seg-lista', [CNPJ, 'sim', 'Jundiaí'], '10 vergalhões 3/8', '5 kg de prego');
    assert.deepEqual([a.tipo, b.tipo, chamadas.v2], ['respondeu', 'nao_responder', ['10 vergalhões 3/8', '5 kg de prego']]);
  });

  test('segue para os produtos com o "sim" e a cidade em mensagens seguidas', async () => {
    const { a, b } = await correr('conv-seg-cidade', [CNPJ], 'sim', 'Jundiaí');
    assert.deepEqual([a.tipo === 'respondeu' && a.resposta, b.tipo], ['Certo! O que você precisa? Pode mandar a lista com as quantidades.', 'nao_responder']);
  });

  test('não responde com o estado velho quando outra execução já andou', async () => {
    // Com a lista no vendedor, "obrigado" não grava nada: só a conferência final percebe o orçamento novo.
    const c = await preparar('conv-seg-velho', [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim']);
    const { ex } = falsos({ ...leituras, 'obrigado': { intencao: 'outro_assunto' }, 'quero outro orçamento': { intencao: 'pedir_orcamento' } });
    const { exB, chegou, soltar } = pausado(ex);
    const b = conduzirMensagem(c.client as never, c.onde, vez('obrigado'), exB);
    await chegou;
    await conduzirMensagem(c.client as never, c.onde, vez('quero outro orçamento'), ex);
    soltar();
    assert.equal((await b).tipo, 'nao_responder');
  });

  test('guarda a resposta da IA ao outro assunto da primeira mensagem', async () => {
    const c = await preparar('conv-seg-livre', ['quero um orçamento']);
    const comLivre = falsos({ ...leituras, 'vocês abrem sábado?': { intencao: 'outro_assunto' } });
    c.historico.push(fala('conv-seg-livre-a', 'vocês abrem sábado?'), fala('conv-seg-livre-b', CNPJ));
    const r = await conduzirComFalasNovas(c.client as never, c.onde, vez('vocês abrem sábado?', 'conv-seg-livre-a'), comLivre.ex, async () => c.historico);
    assert.equal(r.tipo === 'respondeu' && r.resposta, 'Abrimos sábado até meio-dia.\n\nAchei aqui: EMPRESA TESTE AGENTE LTDA, de Jundiai/MG. É esse cadastro mesmo?');
  });
});

// Válvula de escape, item 4 (22/10): cancelar e recomeçar em qualquer etapa da coleta, sempre com confirmação.
describe('cancelar e recomeçar o orçamento', () => {
  const leituras: Record<string, Partial<Leitura>> = {
    'quero um orçamento': { intencao: 'pedir_orcamento' },
    'sim': { intencao: 'confirma' },
    'não': { intencao: 'nega' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
    'quero desistir dessa compra': { intencao: 'cancelar' },
    'quero começar de novo': { intencao: 'recomecar' },
  };
  const novo = (conversationId: string) => {
    const { client } = criarSupabaseFalso({});
    const { ex, chamadas } = falsos(leituras);
    const onde = { ...ONDE, conversationId };
    const conduzir = async (texto: string) => {
      const r = await conduzirMensagem(client as never, onde, vez(texto), ex);
      assert.equal(r.tipo, 'respondeu');
      return r as Extract<typeof r, { tipo: 'respondeu' }>;
    };
    const ficha = () => lerFicha(client as never, conversationId);
    return { conduzir, chamadas, ficha };
  };

  test('pede confirmação antes de cancelar', async () => {
    const { conduzir, ficha } = novo('conv-cancela-pede');
    for (const t of [CNPJ, 'sim']) await conduzir(t);
    const r = await conduzir('cancela o orçamento');
    assert.deepEqual([r.resposta, (await ficha())?.estado.pergunta], ['Cancelo este orçamento? Responda sim.', 'cidade']);
  });

  test('cancela com o sim e fecha a ficha', async () => {
    const { conduzir, ficha } = novo('conv-cancela-sim');
    for (const t of [CNPJ, 'sim', 'cancela o orçamento']) await conduzir(t);
    const r = await conduzir('sim');
    assert.deepEqual([r.resposta, r.transicoes, await ficha()], ['Orçamento cancelado. Se precisar de outro, é só chamar.', ['X6'], null]);
  });

  test('fecha também o pedido da v2 quando já havia lista', async () => {
    const { conduzir, ficha, chamadas } = novo('conv-cancela-v2');
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'cancela tudo', 'sim']) await conduzir(t);
    assert.deepEqual([chamadas.fechados, await ficha()], [['p1'], null]);
  });

  test('não cancela nem nega o cadastro quando o cliente responde não', async () => {
    const { conduzir, ficha } = novo('conv-cancela-nao');
    for (const t of [CNPJ, 'cancela']) await conduzir(t);
    const r = await conduzir('não');
    assert.deepEqual([r.resposta, (await ficha())?.estado.pergunta], ['Certo, o orçamento continua. Achei aqui: EMPRESA TESTE AGENTE LTDA, de Jundiai/MG. É esse cadastro mesmo?', 'confirmar_cliente']);
  });

  // Teste ao vivo de 22/10 (L6): com a lista pronta, o "não" pedia os produtos de novo.
  test('mostra a lista de volta quando o cliente desiste de cancelar com a lista em montagem', async () => {
    const { conduzir } = novo('conv-cancela-nao-lista');
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'cancela o orçamento']) await conduzir(t);
    assert.equal((await conduzir('não')).resposta, 'Certo, o orçamento continua.\n\nAnotei: 10 x VERGALHAO 3/8. Confere?');
  });

  // Teste de 22/10, 15h: o "quero um orçamento" com um aberto contava como "não entendi".
  test('segue o orçamento aberto quando o cliente pede orçamento de novo, sem contar como não entendido', async () => {
    const { conduzir, ficha } = novo('conv-pede-de-novo');
    for (const t of [CNPJ, 'sim', 'Jundiaí']) await conduzir(t);
    const r = await conduzir('quero um orçamento');
    assert.deepEqual([r.resposta, (await ficha())?.estado.dados.sem_entender], ['Vamos seguir com o orçamento que já começamos. Certo! O que você precisa? Pode mandar a lista com as quantidades.', undefined]);
  });

  test('mostra a lista quando o cliente pede orçamento de novo com a lista em montagem', async () => {
    const { conduzir } = novo('conv-pede-de-novo-lista');
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8']) await conduzir(t);
    assert.equal((await conduzir('quero um orçamento')).resposta, 'Vamos seguir com o orçamento que já começamos.\n\nAnotei: 10 x VERGALHAO 3/8. Confere?');
  });

  test('segue a conversa normal quando a resposta não é sim nem não', async () => {
    const { conduzir } = novo('conv-cancela-segue');
    for (const t of [CNPJ, 'sim', 'cancela']) await conduzir(t);
    assert.equal((await conduzir('Jundiaí')).resposta, 'Certo! O que você precisa? Pode mandar a lista com as quantidades.');
  });

  test('entende o pedido de cancelar pela leitura da IA', async () => {
    const { conduzir } = novo('conv-cancela-ia');
    await conduzir('quero um orçamento');
    assert.equal((await conduzir('quero desistir dessa compra')).resposta, 'Cancelo este orçamento? Responda sim.');
  });

  test('recomeça do zero e oferece o mesmo cadastro', async () => {
    const { conduzir, ficha } = novo('conv-recomeca');
    for (const t of [CNPJ, 'sim', 'Jundiaí']) await conduzir(t);
    assert.equal((await conduzir('quero começar de novo')).resposta, 'Recomeço o orçamento do zero? Responda sim.');
    const r = await conduzir('sim');
    assert.deepEqual([r.resposta, (await ficha())?.estado.pergunta],
      ['Certo, vamos recomeçar. Esse orçamento é para o mesmo cadastro, EMPRESA TESTE AGENTE LTDA, com entrega em Jundiaí?', 'mesmo_cadastro']);
  });

  test('não oferece cancelar depois da lista confirmada', async () => {
    const { conduzir } = novo('conv-cancela-vendedor');
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim']) await conduzir(t);
    assert.notEqual((await conduzir('cancela')).resposta, 'Cancelo este orçamento? Responda sim.');
  });
});

describe('janela do "não entendi" (teste de 22/10, 15h)', () => {
  const estado = (vezes: number, em: string): EstadoDoOrcamento => ({
    etapa: 'levantando_itens', pergunta: 'produtos', desdeMensagem: 'm0',
    dados: { sem_entender: { pergunta: 'levantando_itens:produtos', vezes, em } },
  });
  const agora = Date.parse('2026-10-22T18:03:00Z');
  test('starts counting again when the last miss is older than the window', () => {
    assert.equal(contagemNova(estado(2, '2026-10-22T15:01:00Z'), 'outro_assunto', [], agora)?.vezes, 1);
  });
  test('keeps counting misses inside the window', () => {
    assert.equal(contagemNova(estado(1, '2026-10-22T18:00:00Z'), 'outro_assunto', [], agora)?.vezes, 2);
  });
});

// Teste de 25/10: o orçamento nº 7 de quinta ficou parado no pagamento, e a lista nova de segunda somou à de quinta.
describe('cliente que volta com um orçamento parado há mais de um dia', () => {
  const pix: FormaDePagamentoDoErp = { codigo: 'PIX', descricao: 'PIX', forma: 'PIX', parcelas: 1, disponivel: true, valor_minimo: 0.01, valor_maximo: 10000 };
  const leituras: Record<string, Partial<Leitura>> = {
    'sim': { intencao: 'confirma' },
    'Jundiaí': { intencao: 'responde', cidade: { cidade: 'Jundiaí', uf: null } },
    '10 vergalhões 3/8': { intencao: 'produtos', produtosCitados: true },
    '2 kg de prego': { intencao: 'produtos', produtosCitados: true },
    'novo': { intencao: 'responde' },
  };
  const parado = async (conversationId: string) => {
    const { client, banco } = criarSupabaseFalso({});
    const { ex, chamadas } = falsos(leituras, { formas: [pix] });
    const onde = { ...ONDE, conversationId };
    const conduzir = async (texto: string) => {
      const r = await conduzirMensagem(client as never, onde, vez(texto), ex);
      assert.equal(r.tipo, 'respondeu');
      return r as Extract<typeof r, { tipo: 'respondeu' }>;
    };
    for (const t of [CNPJ, 'sim', 'Jundiaí', '10 vergalhões 3/8', 'sim']) await conduzir(t);
    const ficha = await lerFicha(client as never, conversationId);
    const anteontem = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const linha = (banco as Record<string, Record<string, unknown>[]>).orcamentos_em_andamento.find(l => l.id === ficha!.id)!;
    Object.assign(linha, { updated_at: anteontem, numero: 7, expira_em: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() });
    return { conduzir, chamadas, numero: 7 };
  };

  test('pergunta se continua o orçamento ou faz um novo', async () => {
    const { conduzir, chamadas, numero } = await parado('conv-parado-pergunta');
    const v2Antes = chamadas.v2.length;
    const r = await conduzir('2 kg de prego');
    assert.deepEqual([r.resposta, chamadas.v2.length - v2Antes],
      [`Você tem o orçamento nº ${numero} em aberto. Continuo esse ou faço um novo? Responda continuar ou novo.`, 0]);
  });

  test('"novo" fecha o antigo e leva os produtos para o orçamento novo', async () => {
    const { conduzir, chamadas } = await parado('conv-parado-novo');
    await conduzir('2 kg de prego');
    const r = await conduzir('novo');
    for (const t of ['sim']) await conduzir(t);
    assert.deepEqual([chamadas.fechados, r.resposta.startsWith('Certo, vamos recomeçar.'), chamadas.v2.at(-1)], [['p1'], true, '2 kg de prego']);
  });
});

// Os três defeitos que derrubaram o teste real de 20/09, e que nenhuma
// instrução resolveu.
//
// O diagnóstico saiu de `erp_chamadas` cruzado com `messages` e com o backup da
// ficha, em 21/09. Os três são independentes entre si, e os três estão aqui
// porque cada um já passou despercebido uma vez:
//
// 1. **O histórico vira fato.** O código detectou a troca de CNPJ, anulou o
//    cadastro guardado e mandou, no prompt, "use consultar_cliente ANTES de
//    qualquer outra coisa". O modelo respondeu de cabeça, sem chamar nada,
//    usando um nome que estava no histórico da conversa.
// 2. **As travas morriam no paralelo.** `consultar_preco` e `criar_orcamento`
//    liam um contexto que a consulta ao lado ainda estava escrevendo.
// 3. **O modelo corrompe a saída.** Um `cliente_id` com lixo dentro saiu pela
//    rede até a homologação da Distribuidora Exemplo.
//
// O motor aqui é o de produção e o ERP é o simulador — nada dublado no meio,
// pela mesma razão do arquivo `vendas-ponta-a-ponta.test.ts`: o que estes
// testes precisam provar é o comportamento das travas de verdade.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-TRAVAS';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000f1f1';
const MEMBRO = 'membro-travas';
const CLIENTE_TELEFONE = '5500900000555';
const BASE_DO_ERP = 'https://erp.exemplo.teste/v1';
const CHAVE_DO_ERP = 'CHAVE-NO-VAULT';

// Os dois cadastros do teste do Leonardo, com os papéis que eles tiveram lá: o
// PRIMEIRO é o que a conversa identificou, e o SEGUNDO é o que ele pediu depois.
// **Os dígitos verificadores precisam fechar.** `documentoCitado` confere o DV
// de propósito (um celular tem os mesmos 11 dígitos de um CPF), então um CNPJ
// inventado sem DV válido nunca é reconhecido como documento e a troca de
// cadastro simplesmente não acontece. Estes dois são fictícios e válidos.
const DOC_PRIMEIRO = '12345678000195';
const DOC_SEGUNDO = '11222333000181';
const ID_PRIMEIRO = 'CLI-4471';
const ID_SEGUNDO = 'CLI-9900';

// O valor real que o modelo mandou como `cliente_id` em 20/09 às 22:46, e que
// chegou à homologação da Distribuidora Exemplo.
const LIXO_DO_MODELO = '</antml parameter>';

let banco: Banco;
let http: HttpFalso;
let erp: SimuladorExemplo;
let tarefasPendentes: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  delete process.env.WEBHOOK_FILA_ORGS;

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 73 90000-0555', papel: 'vendedor', member_id: MEMBRO, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-travas', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor João, da Distribuidora Exemplo.',
    tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  banco.organization_members = [
    { id: MEMBRO, organization_id: ORG_A, nome: 'João', codigo_erp: 'V-07',
      telefone_whatsapp: '5573900000555', ativo: true, role: 'atendente' },
  ];
  banco.organization_integrations = [
    { id: 'integracao-travas', organization_id: ORG_A, tipo: 'erp', endereco_base: BASE_DO_ERP,
      token_secret_id: 'segredo-1', ativo: true, config: { condicao_pagamento_padrao: '001' } },
  ];
  banco.catalogo_grupos = [
    { id: 'g-4101', organization_id: ORG_A, codigo: '4101', nome: 'VERGALHOES CA50', ativo: true },
  ];
  banco.catalogo_produtos = [
    { id: 'p-1', organization_id: ORG_A, grupo_id: 'g-4101', codigo: '700005',
      descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40, dados: {}, ativo: true },
  ];
  banco.erp_idempotencia = [];

  const supabase = criarSupabaseFalso(banco, {
    ...INDICES_UNICOS,
    unicos: {
      ...INDICES_UNICOS.unicos,
      erp_idempotencia: [['organization_id', 'operacao', 'assinatura']],
    },
    funcoes: { credencial_da_integracao: () => CHAVE_DO_ERP },
  });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
});

beforeEach(() => {
  banco.contacts.length = 0;
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.ai_usage.length = 0;
  banco.erp_idempotencia.length = 0;
  tarefasPendentes = [];

  erp = criarSimuladorExemplo({
    produtos: [{ codigo: '700005', descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40 }],
    chave: CHAVE_DO_ERP,
    clientes: [
      { id: ID_PRIMEIRO, documento: DOC_PRIMEIRO, tipo: 'PJ',
        nome: 'Construtora Aurora Ltda', cidade: 'Porto Seguro', uf: 'BA', vendedor_id: 'V-07' },
      { id: ID_SEGUNDO, documento: DOC_SEGUNDO, tipo: 'PJ',
        nome: 'Marcenaria Boa Vista Ltda', cidade: 'Eunapolis', uf: 'BA', vendedor_id: 'V-07' },
    ],
  });
});

depois(() => http?.restaurar());

function comRespostas(respostas: RespostaAnthropic[]) {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
  const fetchDoDuble = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith(BASE_DO_ERP)) return responderComoFetch(erp, BASE_DO_ERP, entrada, init);
    return fetchDoDuble(entrada, init);
  }) as typeof fetch;
}

async function entregar(texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_VENDEDOR, telefone: CLIENTE_TELEFONE, texto });
  const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  return resposta;
}

const RESPOSTA_FINAL: RespostaAnthropic = {
  json: {
    resposta: 'Certo, já te retorno.',
    transferir_para_atendente: false, questionario_completo: false, respostas: [],
    resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
    agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
};

const ITENS = [{ produto_codigo: '700005', quantidade: 50 }];
const consulta = (documento: string): RespostaAnthropic =>
  ({ ferramentas: [{ nome: 'consultar_cliente', entrada: { documento } }] });

/** Deixa a conversa com o PRIMEIRO cadastro já identificado, como estava na
 *  conversa do Leonardo quando ele trocou de CNPJ. */
async function jaIdentificado() {
  comRespostas([consulta(DOC_PRIMEIRO), RESPOSTA_FINAL]);
  await entregar(`quero um orçamento, meu cnpj é ${DOC_PRIMEIRO}`);
  assert.equal(banco.conversations[0].erp_cliente_id, ID_PRIMEIRO, 'o primeiro cadastro ficou guardado');
  erp.chamadas.length = 0;
}

const clientesCotados = () =>
  erp.chamadas.filter(c => c.caminho === '/cotacoes').map(c => (c.corpo as { cliente_id?: string }).cliente_id);

describe('1. documento novo: o modelo não pode responder de cabeça', () => {
  test('a volta obriga consultar_cliente, em vez de pedir por favor no prompt', async () => {
    await jaIdentificado();

    // O roteiro do dublê responde a consulta — mas o que este teste prova é que
    // o MOTOR obrigou: com `tool_choice: {type:'tool'}` a API não tem a opção de
    // devolver texto, e o dublê recusa um roteiro que não respeite isso.
    comRespostas([consulta(DOC_SEGUNDO), RESPOSTA_FINAL]);
    await entregar(`na verdade esse orçamento é para o outro cnpj, ${DOC_SEGUNDO}`);

    const primeira = http.chamadasAnthropic[0]?.corpo as { tool_choice?: { type: string; name?: string } };
    assert.deepEqual(primeira.tool_choice, { type: 'tool', name: 'consultar_cliente' },
      'sem isto o modelo responde do histórico, como em 20/09 às 22:35');

    const consultas = erp.chamadas.filter(c => c.caminho.startsWith('/clientes/consulta'));
    assert.equal(consultas.length, 1, 'o cadastro novo foi consultado de verdade');
    assert.equal(banco.conversations[0].erp_cliente_id, ID_SEGUNDO, 'e passou a valer');
  });

  test('a obrigação vale só na primeira volta, senão o laço consulta para sempre', async () => {
    await jaIdentificado();

    comRespostas([consulta(DOC_SEGUNDO), RESPOSTA_FINAL]);
    await entregar(`agora é para o cnpj ${DOC_SEGUNDO}`);

    const segunda = http.chamadasAnthropic[1]?.corpo as { tool_choice?: unknown };
    assert.equal(segunda.tool_choice, undefined, 'da segunda volta em diante o modelo escolhe');
  });

  test('sem troca de documento, nada é obrigado — o Atendimento não muda', async () => {
    comRespostas([RESPOSTA_FINAL]);
    await entregar('bom dia, vocês abrem sábado?');

    const primeira = http.chamadasAnthropic[0]?.corpo as { tool_choice?: unknown };
    assert.equal(primeira.tool_choice, undefined);
  });
});

describe('2. as travas não morrem mais no paralelo', () => {
  // A forma do pedido de 20/09 às 17:36:23: o modelo pede DUAS ferramentas na
  // mesma resposta, e a que depende de saber quem é o cliente vem ANTES da que
  // descobre. No `Promise.all` as duas partiam juntas e a cotação lia um
  // contexto vazio; com a execução serializada e ordenada, a consulta roda
  // primeiro e a cotação bate na trava que já existia.
  //
  // Sem troca de documento de propósito: a chamada forçada do bloco 1 nem
  // deixaria o modelo montar este pedido, e o que este bloco precisa provar é a
  // corrida — que existe em qualquer conversa, não só quando o CNPJ muda.
  const PEDE_AS_DUAS: RespostaAnthropic = {
    ferramentas: [
      { nome: 'consultar_preco', entrada: { cliente_id: ID_PRIMEIRO, itens: ITENS } },
      { nome: 'consultar_cliente', entrada: { documento: DOC_PRIMEIRO } },
    ],
  };

  test('cotar pedido junto da consulta roda DEPOIS dela, e cai na trava', async () => {
    comRespostas([PEDE_AS_DUAS, RESPOSTA_FINAL]);
    await entregar(`quero 50 barras de 12.5, meu cnpj é ${DOC_PRIMEIRO}`);

    assert.equal(
      erp.chamadas.filter(c => c.caminho.startsWith('/clientes/consulta')).length, 1,
      'a consulta saiu',
    );
    assert.deepEqual(clientesCotados(), [],
      'e a cotação não: o cliente acabou de ser identificado e não confirmou nada depois disso');
  });

  test('a ordem dos RESULTADOS continua sendo a dos pedidos do modelo', async () => {
    comRespostas([PEDE_AS_DUAS, RESPOSTA_FINAL]);
    await entregar(`quero 50 barras de 12.5, meu cnpj é ${DOC_PRIMEIRO}`);

    const segunda = http.chamadasAnthropic[1]?.corpo as { messages?: { content: unknown }[] };
    const blocos = segunda.messages?.at(-1)?.content as { tool_use_id: string; content: string }[];
    assert.equal(blocos.length, 2);
    // A execução foi reordenada; a conversa que volta ao modelo, não.
    assert.match(blocos[0].tool_use_id, /_0$/, 'o primeiro resultado é o do primeiro pedido');
    assert.match(blocos[1].tool_use_id, /_1$/);
    // E o conteúdo confirma quem é quem: o pedido 0 era a cotação, que foi
    // barrada; o pedido 1 era a consulta, que achou o cadastro.
    assert.match(blocos[0].content, /NÃO consulte preço agora/);
    assert.match(blocos[1].content, /Cliente encontrado/);
  });
});

describe('5. erro 500 da Anthropic: responde sem o formulário em vez de não responder', () => {
  // Medido em 20/09: o formulário estruturado junto com as ferramentas estoura
  // em 500 num terço das requisições, e cada estouro deixava o cliente final
  // sem mensagem nenhuma até a varredura refazer o turno minutos depois. As
  // duas metades sozinhas nunca falharam em 90 tentativas.
  //
  // Enquanto a separação definitiva não existe, o motor troca o modo de falha.
  // Caminho de resgate que nunca foi exercitado é caminho que não existe — por
  // isso o dublê aprendeu a devolver 500.
  // **Três, e não uma.** O SDK da Anthropic repete falha de servidor duas vezes
  // sozinho antes de desistir, então um 500 que chega ao nosso código já é a
  // terceira tentativa da mesma requisição. Isso importa além do teste: bate
  // com a rajada que a bancada mostrou (cinco falhas seguidas numa corrida de
  // 30) e com o que os relatos públicos dizem — repetir o pedido idêntico na
  // hora tende a falhar de novo. O resgate não repete o pedido: ele muda.
  const CINQUENTA = { status: 500 } as RespostaAnthropic;
  const ANTHROPIC_FORA = [CINQUENTA, CINQUENTA, CINQUENTA];

  test('o cliente recebe a resposta mesmo quando a Anthropic quebra', async () => {
    comRespostas([...ANTHROPIC_FORA, { texto: 'Bom dia, Léo. Me passa o seu CNPJ que eu já vejo isso.' }]);
    await entregar('bom dia, preciso de um orçamento');

    const daIA = banco.messages.filter(m => m.autor === 'ia');
    assert.equal(daIA.length, 1, 'o cliente NÃO pode ficar sem resposta');
    assert.match(String(daIA[0].texto), /me passa o seu cnpj/i);
    assert.equal(http.chamadasWhatsApp.length, 1, 'e a mensagem saiu de verdade pelo WhatsApp');
  });

  test('a chamada de resgate vai sem formulário e sem ferramentas', async () => {
    comRespostas([...ANTHROPIC_FORA, { texto: 'Já te retorno com isso.' }]);
    await entregar('bom dia, preciso de um orçamento');

    // A quarta chamada é o resgate: as três primeiras são a original e os dois
    // retries do SDK, todas com o formulário.
    const resgate = http.chamadasAnthropic[3]?.corpo as Record<string, unknown>;
    assert.equal('tools' in resgate, false, 'é a forma que a bancada não conseguiu quebrar');
    assert.equal('output_config' in resgate, false);
  });

  test('o que se perde é o metadado, não a conversa', async () => {
    // O modelo do resgate escreve texto puro, então não há como ele dizer que
    // houve venda ou que é para transferir. O turno passa com tudo neutro — e
    // isso é melhor do que o cliente falar sozinho.
    comRespostas([...ANTHROPIC_FORA, { texto: 'Perfeito, vou registrar aqui e te retorno.' }]);
    await entregar('quero fechar as 50 barras');

    assert.equal(banco.conversations[0].modo, 'ia', 'não transferiu para humano por engano');
    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 1);
  });

  test('erro 400 NÃO é resgatado: pedido malformado nosso tem que aparecer', async () => {
    comRespostas([{ status: 400 } as RespostaAnthropic, { texto: 'não deveria chegar aqui' }]);
    await entregar('bom dia');

    assert.equal(banco.messages.filter(m => m.autor === 'ia').length, 0,
      'contornar um 400 esconderia um bug nosso');
    assert.equal(http.chamadasAnthropic.length, 1,
      'nem tentou o resgate, e o SDK também não repete um 400');
  });
});

describe('4. a trava sobrevive a uma tentativa que morreu no meio', () => {
  // O caso real de 20/09 às 21:06, já com as correções anteriores no ar: a
  // Anthropic devolveu 500, a execução morreu DEPOIS de consultar o cadastro, e
  // a varredura refez o turno um minuto depois. Para a execução nova o cliente
  // "já estava identificado desde antes", então `clienteIdentificadoAgora`
  // nasceu falso e a cotação saiu — sem o cliente final ter dito nada entre a
  // identificação e o preço.
  //
  // Aqui a tentativa morta é encenada do jeito que ela aparece no banco: o
  // cadastro ficou gravado, a resposta ao cliente não. É exatamente o estado
  // que a varredura encontra.
  test('a varredura refazendo o MESMO turno não cota o que ninguém confirmou', async () => {
    comRespostas([consulta(DOC_PRIMEIRO), RESPOSTA_FINAL]);
    await entregar(`quero 50 barras de 12.5, meu cnpj é ${DOC_PRIMEIRO}`);

    const conversa = banco.conversations[0];
    assert.equal(conversa.erp_cliente_id, ID_PRIMEIRO);
    assert.ok(conversa.erp_cliente_desde_mensagem, 'a conversa guardou desde qual mensagem');

    // A tentativa morreu: o cadastro ficou, a resposta sumiu.
    banco.messages = banco.messages.filter(m => m.autor !== 'ia');
    erp.chamadas.length = 0;

    comRespostas([
      { ferramentas: [{ nome: 'consultar_preco', entrada: { cliente_id: ID_PRIMEIRO, itens: ITENS } }] },
      RESPOSTA_FINAL,
    ]);

    const { responderConversaComIA } = await import('@/lib/agente/responder-conversa');
    const { createServiceClient } = await import('@/lib/supabase/service');
    await responderConversaComIA(createServiceClient(), {
      orgId: ORG_A, conversationId: String(conversa.id), contatoNome: 'Léo',
      destino: { telefone: CLIENTE_TELEFONE, bsuid: null }, phoneNumberId: NUMERO_VENDEDOR,
    });

    assert.deepEqual(clientesCotados(), [],
      'o cadastro foi descoberto respondendo a ESTA mesma mensagem — o cliente não falou desde então');
  });

  test('mas na mensagem SEGUINTE do cliente a cotação sai normalmente', async () => {
    comRespostas([consulta(DOC_PRIMEIRO), RESPOSTA_FINAL]);
    await entregar(`quero 50 barras de 12.5, meu cnpj é ${DOC_PRIMEIRO}`);
    erp.chamadas.length = 0;

    // O cliente confirmou. A trava é sobre ele não ter falado; ele falou.
    comRespostas([
      { ferramentas: [{ nome: 'consultar_preco', entrada: { cliente_id: ID_PRIMEIRO, itens: ITENS } }] },
      RESPOSTA_FINAL,
    ]);
    await entregar('isso mesmo, pode ver o preço');

    assert.deepEqual(clientesCotados(), [ID_PRIMEIRO], 'a trava não pode virar um bloqueio permanente');
  });
});

describe('3. o cliente_id que o modelo manda é conferido', () => {
  test('lixo no cliente_id não sai para o ERP', async () => {
    await jaIdentificado();

    comRespostas([
      { ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: LIXO_DO_MODELO, itens: ITENS } }] },
      RESPOSTA_FINAL,
    ]);
    await entregar('pode fechar o orçamento');

    assert.equal(erp.orcamentos.length, 1, 'o orçamento saiu');
    // E saiu com o cadastro que a CONVERSA identificou, não com o lixo.
    const criacao = erp.chamadas.find(c => c.caminho === '/orcamentos')!;
    assert.equal((criacao.corpo as { cliente_id?: string }).cliente_id, ID_PRIMEIRO);
  });

  test('sem cadastro guardado, o lixo não vira um orçamento qualquer', async () => {
    comRespostas([
      { ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: LIXO_DO_MODELO, itens: ITENS } }] },
      RESPOSTA_FINAL,
    ]);
    await entregar('quero 50 barras de 12.5');

    assert.equal(erp.orcamentos.length, 0, 'nada foi criado no sistema da Distribuidora Exemplo');
    const segunda = http.chamadasAnthropic[1]?.corpo as { messages?: { content: unknown }[] };
    const blocos = segunda.messages?.at(-1)?.content as { content: string }[];
    assert.match(blocos[0].content, /Sem cliente_id/, 'e o modelo foi mandado consultar o cadastro');
  });

  test('um cliente_id normal continua passando', async () => {
    comRespostas([
      { ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: ID_PRIMEIRO, itens: ITENS } }] },
      RESPOSTA_FINAL,
    ]);
    await entregar('quero 50 barras de 12.5');

    assert.equal(erp.orcamentos.length, 1);
  });
});

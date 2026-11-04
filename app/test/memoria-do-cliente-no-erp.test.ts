// O que a conversa lembra do sistema do cliente, de uma mensagem para a outra.
//
// **Este arquivo existe por causa de um teste que não existia.** Todos os
// testes do fluxo de vendas exercitavam UMA resposta — e dentro de uma
// resposta o `cliente_id` que a ferramenta descobriu está ali, na conversa que
// o laço montou. O primeiro teste real com uma conversa inteira (14/09) mostrou
// o buraco: três mensagens depois, aquilo não existe mais, e o modelo chamou
// `criar_orcamento` sem o id. `422 cliente_nao_encontrado`, orçamento não sai.
//
// Por isso o teste central aqui manda DUAS mensagens, com a resposta da
// primeira terminada, e confere que o orçamento da segunda sai com o cliente
// que a primeira descobriu.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { ehDoSerializador, instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-MEMORIA';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-00000000memo';
const MEMBRO_JOAO = 'membro-joao-memoria';
const INTEGRACAO = 'integracao-memoria';
const CLIENTE_TELEFONE = '5500900000456';
const BASE_DO_ERP = 'https://erp.memoria.teste/v1';
const CHAVE_DO_ERP = 'CHAVE-NO-VAULT';

const PRODUTOS_DO_ERP = [
  { codigo: '700005', descricao: 'CA50 1/2 (12.5 MM)', unidade: 'PC', preco: 112.40 },
];

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
    telefone: '+55 73 90000-0008', papel: 'vendedor', member_id: MEMBRO_JOAO, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-memoria', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor João, da Distribuidora Exemplo.',
    tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  banco.organization_members = [
    { id: MEMBRO_JOAO, organization_id: ORG_A, nome: 'João', codigo_erp: 'V-07',
      telefone_whatsapp: '5573900000007', ativo: true, role: 'atendente' },
  ];
  banco.organization_integrations = [
    { id: INTEGRACAO, organization_id: ORG_A, tipo: 'erp', endereco_base: BASE_DO_ERP,
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
    produtos: PRODUTOS_DO_ERP,
    chave: CHAVE_DO_ERP,
    clientes: [{
      id: 'CLI-4471', documento: '12345678000190', tipo: 'PJ',
      nome: 'Construtora Aurora Ltda', cidade: 'Porto Seguro', uf: 'BA', vendedor_id: 'V-07',
    }, {
      id: 'CLI-9002', documento: '98765432000110', tipo: 'PJ',
      nome: 'Obras do Litoral Ltda', cidade: 'Eunápolis', uf: 'BA', vendedor_id: 'V-07',
    }],
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
    resposta: 'Perfeito, já anotei.',
    transferir_para_atendente: false, questionario_completo: false, respostas: [],
    resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
    agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
};

const pedeCliente: RespostaAnthropic = {
  ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12.345.678/0001-90' } }],
};
/** O pedido que quebrou em 14/09: o modelo não manda o cliente_id porque não o
 *  tem mais — o laço da resposta anterior já não existe. */
const pedeOrcamentoSemCliente: RespostaAnthropic = {
  ferramentas: [{ nome: 'criar_orcamento', entrada: { itens: [{ produto_codigo: '700005', quantidade: 10 }] } }],
};

const conversa = () => banco.conversations[0] as Record<string, unknown>;
// A última requisição DA CONVERSA, e não a última de todas: com as duas fases
// ligadas, a última é o serializador, que tem um prompt curto e próprio e não
// leva o system da conversa (ver `interruptor-duas-fases.ts`). Mudança de 27/09,
// autorizada pelo Leonardo para os testes que leem a última requisição.
const ultimaDaConversa = () => http.chamadasAnthropic.filter(c => !ehDoSerializador(c)).at(-1);
const ultimoSystem = () => String(
  (ultimaDaConversa()?.corpo as { system?: string } | undefined)?.system ?? '',
);

describe('a conversa lembra quem é o cliente no sistema', () => {
  test('consultar_cliente grava o cliente_id na conversa', async () => {
    comRespostas([pedeCliente, RESPOSTA_FINAL]);

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');

    assert.equal(conversa().erp_cliente_id, 'CLI-4471');
    assert.equal(conversa().erp_cliente_nome, 'Construtora Aurora Ltda');
  });

  test('a FICHA DO CONTATO também recebe o cliente e o documento', async () => {
    // É o que torna "todos os orçamentos e pedidos deste cliente" uma consulta
    // simples. Guardar só na conversa deixa a mesma empresa, falando de dois
    // números, com dois históricos que ninguém junta.
    comRespostas([pedeCliente, RESPOSTA_FINAL]);

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');

    const contato = banco.contacts[0] as Record<string, unknown>;
    assert.equal(contato.erp_cliente_id, 'CLI-4471');
    // Só dígitos: o cliente escreveu com ponto, barra e traço.
    assert.equal(contato.documento, '12345678000190');
  });

  test('a ficha guarda o CADASTRO INTEIRO, não só o id', async () => {
    // É o que o desenvolvedor do cliente abre na homologação para conferir se o
    // que a IA criou gravou com os dados certos. Antes de 20/09 a consulta lia
    // tudo isto, usava dentro de uma resposta e jogava fora.
    comRespostas([pedeCliente, RESPOSTA_FINAL]);

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');

    const contato = banco.contacts[0] as Record<string, unknown>;
    const cadastro = contato.erp_cadastro as Record<string, unknown>;
    assert.ok(cadastro, 'o cadastro foi gravado');
    assert.equal(cadastro.cliente_id, 'CLI-4471');
    assert.equal(cadastro.nome, 'Construtora Aurora Ltda');
    assert.equal(cadastro.vendedor_id, 'V-07');
    assert.equal(cadastro.situacao, 'ATIVO');
    assert.deepEqual(cadastro.empresas, ['EXEMPLO CENTRO']);
    assert.equal(cadastro.origem, 'consulta');
    assert.ok(typeof cadastro.atualizado_em === 'string', 'diz de quando é o dado');
  });

  test('o telefone do ERP NÃO vira o telefone da ficha', async () => {
    // A armadilha que deixaria o cliente sem resposta: `contacts.telefone` é o
    // número de WhatsApp por onde a pessoa escreveu, e é por ele que a mensagem
    // sai. O fixo do cadastro é outro dado, e mora dentro do jsonb.
    erp.clientes.push({
      id: 'CLI-7777', documento: '44555666000177', tipo: 'PJ', nome: 'Serralheria Central',
      telefone: '3733339999', email: 'compras@central.com.br',
      cidade: 'Jundiai', uf: 'MG', vendedor_id: 'V-07',
    });
    const consulta: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '44555666000177' } }],
    };
    comRespostas([consulta, RESPOSTA_FINAL]);

    await entregar('cnpj 44.555.666/0001-77');

    const contato = banco.contacts[0] as Record<string, unknown>;
    assert.equal(contato.telefone, CLIENTE_TELEFONE, 'o número de WhatsApp continua sendo o da ficha');
    assert.notEqual(contato.telefone, '3733339999');
    assert.equal(contato.email ?? null, null, 'o e-mail da ficha também não é tocado');
    const cadastro = contato.erp_cadastro as Record<string, unknown>;
    assert.equal(cadastro.telefone, '3733339999', 'o do cadastro está guardado, rotulado como tal');
    assert.equal(cadastro.email, 'compras@central.com.br');
  });

  test('uma consulta magra depois do cadastro não apaga o que o cadastro descobriu', async () => {
    // O caso real da Distribuidora Exemplo: o cadastro devolve e-mail e telefone; a consulta
    // pelo documento não. Sem a regra de merge, a segunda mensagem do cliente
    // zeraria os dois.
    const consultaVazia: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '11222333000144' } }],
    };
    const cadastra: RespostaAnthropic = {
      ferramentas: [{ nome: 'cadastrar_cliente', entrada: { documento: '11222333000144', nome: 'Marcenaria Boa Vista', email: 'contato@boavista.com.br', logradouro: 'Rua das Palmeiras', numero: '77', cidade: 'Eunapolis', uf: 'BA', cep: '45820000' } }],
    };
    const consultaDeNovo: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '11222333000144' } }],
    };
    comRespostas([consultaVazia, cadastra, RESPOSTA_FINAL, consultaDeNovo, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 11.222.333/0001-44');
    const depoisDoCadastro = { ...(banco.contacts[0] as Record<string, unknown>).erp_cadastro as Record<string, unknown> };
    assert.equal(depoisDoCadastro.email, 'contato@boavista.com.br', 'o cadastro trouxe o e-mail');
    assert.equal(depoisDoCadastro.origem, 'cadastro');

    await entregar('confere meu cnpj de novo: 11.222.333/0001-44');

    const cadastro = (banco.contacts[0] as Record<string, unknown>).erp_cadastro as Record<string, unknown>;
    assert.equal(cadastro.email, 'contato@boavista.com.br', 'a consulta magra não apagou o e-mail');
    // O telefone do cadastro é o WhatsApp de quem escreveu, e isso é de
    // propósito: `cadastrar_cliente` manda o número do contato, não um que o
    // modelo tenha lido na conversa (ver o comentário em `erp-cliente.ts`). A
    // ficha mostra o que foi enviado, que é o que o desenvolvedor precisa
    // conferir.
    assert.equal(cadastro.telefone, CLIENTE_TELEFONE, 'nem o telefone');
    assert.equal((cadastro.endereco as Record<string, unknown>).cep, '45820000', 'nem o endereço');
    assert.equal(cadastro.origem, 'consulta', 'mas a origem passou a ser a da última leitura');
  });

  test('o nome do contato NÃO é sobrescrito pela razão social', async () => {
    // Trocar o nome na tela de Conversas no meio de um atendimento, sem ninguém
    // pedir, é pior que não ter a razão social lá — ela já vive na conversa.
    comRespostas([pedeCliente, RESPOSTA_FINAL]);
    const antes = (banco.contacts[0] as Record<string, unknown> | undefined)?.nome;

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');

    const contato = banco.contacts[0] as Record<string, unknown>;
    assert.notEqual(contato.nome, 'Construtora Aurora Ltda');
    if (antes !== undefined) assert.equal(contato.nome, antes);
  });

  test('cadastrar_cliente também grava — quem acabou de nascer é lembrado igual', async () => {
    const consultaVazia: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '11222333000144' } }],
    };
    const cadastra: RespostaAnthropic = {
      ferramentas: [{ nome: 'cadastrar_cliente', entrada: { documento: '11222333000144', nome: 'Marcenaria Boa Vista', logradouro: 'Rua das Palmeiras', numero: '77', cidade: 'Eunapolis', uf: 'BA', cep: '45820000' } }],
    };
    comRespostas([consultaVazia, cadastra, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 11.222.333/0001-44');

    const cliente = erp.clientes.find(c => c.documento === '11222333000144')!;
    assert.equal(conversa().erp_cliente_id, cliente.id);
    assert.equal(conversa().erp_cliente_nome, 'Marcenaria Boa Vista');

    // E a ficha do contato, pelo caminho do CADASTRO — o outro dos dois.
    const contato = banco.contacts[0] as Record<string, unknown>;
    assert.equal(contato.erp_cliente_id, cliente.id);
    assert.equal(contato.documento, '11222333000144');
  });

  // ── o teste que resume o arquivo ──
  test('o orçamento da MENSAGEM SEGUINTE sai com o cliente que a primeira descobriu', async () => {
    comRespostas([pedeCliente, RESPOSTA_FINAL, pedeOrcamentoSemCliente, RESPOSTA_FINAL]);

    await entregar('bom dia, meu cnpj é 12.345.678/0001-90');
    await entregar('pode fechar, 10 barras de 1/2');

    assert.equal(erp.orcamentos.length, 1, 'o orçamento saiu, sem 422');
    const criacao = erp.chamadas.find(c => c.metodo === 'POST' && c.caminho === '/orcamentos')!;
    assert.equal((criacao.corpo as { cliente_id?: string }).cliente_id, 'CLI-4471');
    // E o cliente recebeu a tabela de valores, que é o desfecho que faltava.
    const enviados = http.chamadasWhatsApp.map(c => String((c.corpo as { text?: { body?: string } })?.text?.body ?? ''));
    assert.ok(enviados.some(t => t.includes('Total:')), 'a tabela de valores chegou ao cliente');
  });

  test('sem nada guardado e sem o modelo mandar, a ferramenta recusa em vez de inventar', async () => {
    comRespostas([pedeOrcamentoSemCliente, RESPOSTA_FINAL]);

    await entregar('quero 10 barras de 1/2');

    assert.equal(erp.orcamentos.length, 0, 'nada foi criado sem cliente');
    // E o modelo foi instruído a pedir o documento, não a inventar um id.
    const resultado = JSON.stringify(ultimaDaConversa()?.corpo);
    assert.match(resultado, /Sem cliente_id não dá para criar orçamento/);
  });

  test('o cliente_id que o modelo manda vence o guardado — trocar de cadastro continua possível', async () => {
    const pedeOutroCliente: RespostaAnthropic = {
      ferramentas: [{ nome: 'criar_orcamento', entrada: { cliente_id: 'CLI-9002', itens: [{ produto_codigo: '700005', quantidade: 2 }] } }],
    };
    comRespostas([pedeCliente, RESPOSTA_FINAL, pedeOutroCliente, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90');
    await entregar('na verdade é para a outra empresa, cnpj 98.765.432/0001-10');

    const criacao = erp.chamadas.find(c => c.metodo === 'POST' && c.caminho === '/orcamentos')!;
    assert.equal((criacao.corpo as { cliente_id?: string }).cliente_id, 'CLI-9002');
  });

  test('o cliente já identificado entra no prompt, para ela não pedir o CNPJ de novo', async () => {
    comRespostas([pedeCliente, RESPOSTA_FINAL, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90');
    await entregar('e vocês entregam em Eunápolis?');

    const system = ultimoSystem();
    assert.match(system, /cliente_id: CLI-4471/);
    assert.match(system, /Construtora Aurora Ltda/);
    assert.match(system, /Não peça o CPF ou CNPJ de novo/);
  });

  test('na primeira mensagem, o prompt NÃO fala de cliente identificado', async () => {
    comRespostas([RESPOSTA_FINAL]);

    await entregar('bom dia');

    assert.doesNotMatch(ultimoSystem(), /já está identificado no sistema/);
  });
});

describe('o que a IA conta ao cliente quando o sistema recusa', () => {
  test('recusa que é assunto do vendedor não chega ao modelo', async () => {
    // Falta de crédito é 422, e o motivo não é assunto do cliente final. Em
    // 14/09 a IA escreveu "seu cadastro não está trazendo o ID que preciso" — é
    // exatamente isso que este teste impede.
    erp.definirFalha('sem-credito');
    const consulta: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12345678000190' } }],
    };
    const pedeOrcamento: RespostaAnthropic = {
      ferramentas: [{ nome: 'criar_orcamento', entrada: { itens: [{ produto_codigo: '700005', quantidade: 1 }] } }],
    };
    comRespostas([consulta, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('cnpj 12.345.678/0001-90, quero 1 barra');

    const tudoQueOModeloLeu = JSON.stringify(http.chamadasAnthropic.map(c => c.corpo));
    assert.match(tudoQueOModeloLeu, /o motivo é interno da empresa/);
    // Nem o código nem o motivo chegam a ele pela recusa do orçamento.
    assert.doesNotMatch(tudoQueOModeloLeu, /limite de crédito/);
    assert.doesNotMatch(tudoQueOModeloLeu, /cliente_sem_credito/);
  });

  test('cadastro bloqueado NÃO impede o orçamento, e o modelo é instruído a seguir', async () => {
    // Regra da Distribuidora Exemplo, confirmada no documento deles de 17/09: bloqueado
    // cota, e o que ele não faz é faturar. Toda pessoa jurídica cadastrada pelo
    // Agente nasce bloqueada — tratar isso como "não pode orçar" faria a IA
    // cadastrar o cliente e recusar-se a atendê-lo na mensagem seguinte.
    erp.clientes.push({
      id: 'Z00009/01', documento: '55666777000188', tipo: 'PJ', nome: 'Recem Cadastrada Ltda',
      endereco: {
        logradouro: 'Rua A', numero: '1', complemento: null, bairro: null,
        cidade: 'Jundiai', uf: 'MG', cep: '36880000',
      },
      situacao: 'BLOQUEADO', podeFaturar: false, vendedor_id: 'V-07',
    });
    const consulta: RespostaAnthropic = {
      ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '55666777000188' } }],
    };
    const pedeOrcamento: RespostaAnthropic = {
      ferramentas: [{ nome: 'criar_orcamento', entrada: { itens: [{ produto_codigo: '700005', quantidade: 1 }] } }],
    };
    comRespostas([consulta, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('cnpj 55.666.777/0001-88, quero 1 barra');

    const tudoQueOModeloLeu = JSON.stringify(http.chamadasAnthropic.map(c => c.corpo));
    assert.match(tudoQueOModeloLeu, /não está liberado para fechar compra/);
    assert.match(tudoQueOModeloLeu, /Faça o orçamento/);
    // E o orçamento saiu mesmo, que é o ponto.
    assert.equal(erp.orcamentos.length, 1, 'o orçamento de um cadastro bloqueado é criado normalmente');
  });

  test('recusa que o cliente resolve continua explicada — com o que falta', async () => {
    const cadastroInvalido: RespostaAnthropic = {
      ferramentas: [{ nome: 'cadastrar_cliente', entrada: { documento: '123', nome: 'Fulano' } }],
    };
    comRespostas([cadastroInvalido, RESPOSTA_FINAL]);

    await entregar('meu cpf é 123');

    const tudoQueOModeloLeu = JSON.stringify(http.chamadasAnthropic.map(c => c.corpo));
    assert.match(tudoQueOModeloLeu, /documento_invalido/);
    assert.match(tudoQueOModeloLeu, /Peça ao cliente exatamente o dado que falta/);
  });
});

describe('consulte primeiro, escreva depois', () => {
  test('o número de vendas recebe a regra de não anunciar a consulta', async () => {
    comRespostas([RESPOSTA_FINAL]);

    await entregar('bom dia');

    const system = ultimoSystem();
    assert.match(system, /Consulte primeiro, escreva depois/);
    assert.match(system, /"deixa eu buscar"/);
  });
});

describe('identificou agora não cota agora', () => {
  // O teste real do Leonardo em 20/09, duas vezes seguidas: o agente
  // identificava o cliente e, na volta seguinte do MESMO laço, cotava preço —
  // sem o cliente final ter dito nada entre uma coisa e outra. Duas instruções
  // tentaram impedir e foram ignoradas; a trava virou código.
  const pedeClienteEDepoisPreco: RespostaAnthropic = {
    ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: '12.345.678/0001-90' } }],
  };
  const pedePreco: RespostaAnthropic = {
    ferramentas: [{ nome: 'consultar_preco', entrada: { itens: [{ produto_codigo: '700005', quantidade: 50 }] } }],
  };
  const pedeOrcamento: RespostaAnthropic = {
    ferramentas: [{ nome: 'criar_orcamento', entrada: { itens: [{ produto_codigo: '700005', quantidade: 50 }] } }],
  };

  test('cotar na mesma resposta da identificação é recusado', async () => {
    comRespostas([pedeClienteEDepoisPreco, pedePreco, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90, quero 50 barras de 1/2');

    // A consulta do cadastro saiu; a cotação NÃO.
    const caminhos = erp.chamadas.map(c => c.caminho);
    assert.ok(caminhos.includes('/clientes/consulta'), 'o cadastro foi consultado');
    assert.ok(!caminhos.includes('/cotacoes'), 'o preço NÃO foi consultado logo após identificar');
    // E o modelo foi instruído a confirmar antes, não a inventar preço.
    const tudoQueOModeloLeu = JSON.stringify(http.chamadasAnthropic.map(c => c.corpo));
    assert.match(tudoQueOModeloLeu, /ainda não confirmou nada depois disso/);
  });

  test('criar_orcamento NÃO tem esta trava, e isso é decisão de produto', async () => {
    // O fluxo combinado com a Distribuidora Exemplo em 13/09 é automático: o cliente diz o
    // documento e o que quer, e o orçamento sai pronto na mesma resposta. Travar
    // as duas ferramentas revertia essa decisão — dois testes do bloco C
    // quebraram e foi assim que a tentativa foi barrada, em 20/09.
    comRespostas([pedeClienteEDepoisPreco, pedeOrcamento, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90, quero 50 barras de 1/2');

    assert.equal(erp.orcamentos.length, 1, 'o orçamento continua saindo na mesma resposta');
  });

  test('na MENSAGEM SEGUINTE, com o cliente já identificado antes, a cotação sai', async () => {
    // A trava é sobre "acabou de descobrir", não sobre "sabe quem é". Sem esta
    // asserção, a correção viraria um agente que nunca cota.
    comRespostas([pedeClienteEDepoisPreco, RESPOSTA_FINAL, pedePreco, RESPOSTA_FINAL]);

    await entregar('meu cnpj é 12.345.678/0001-90');
    await entregar('isso mesmo, pode cotar 50 barras de 1/2');

    const caminhos = erp.chamadas.map(c => c.caminho);
    assert.ok(caminhos.includes('/cotacoes'), 'a cotação saiu na volta seguinte');
  });
});

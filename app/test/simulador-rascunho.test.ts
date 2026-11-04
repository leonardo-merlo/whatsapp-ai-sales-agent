// Item 9, caminho D (29/09): o simulador responde com o que está na tela,
// salvo ou não. O WhatsApp continua lendo só o que está gravado.

import { describe, test, before } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, WA_NUMBER_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { lerNumeroNaTela, lerRascunho } from '../src/lib/simulador/rascunho.ts';

let banco: Banco;
let client: never;

before(() => {
  banco = cenarioBase();
  client = criarSupabaseFalso(banco, INDICES_UNICOS).client as never;
  banco.ai_agent_config[0].prompt = 'INSTRUCAO GRAVADA';
});

function rascunho(extra: Record<string, unknown> = {}) {
  return lerRascunho({
    agentPrompt: 'INSTRUCAO DA TELA', tom: 'formal', nomeNegocio: 'Nome Novo',
    faqs: [{ q: 'Tem estacionamento?', a: 'Sim, gratuito.' }],
    horario: [{ dia: 'Segunda', hora: '8h às 18h' }],
    ...extra,
  });
}

async function prompt(r: ReturnType<typeof lerRascunho>): Promise<string> {
  const { buildSystemPrompt } = await import('@/lib/simulador/build-prompt');
  return (await buildSystemPrompt(client, ORG_A, null, r)).systemPrompt;
}

describe('simulador com o que está na tela', () => {
  test('usa a instrução da tela no lugar da gravada', async () => {
    const texto = await prompt(rascunho());
    assert.ok(texto.includes('INSTRUCAO DA TELA'));
    assert.ok(!texto.includes('INSTRUCAO GRAVADA'));
  });

  test('usa nome, dúvidas e horário da tela', async () => {
    const texto = await prompt(rascunho());
    assert.match(texto, /"Nome Novo"/);
    assert.match(texto, /Tem estacionamento\?/);
    assert.match(texto, /Segunda: 8h às 18h/);
  });

  test('sem o que está na tela, continua usando o que está gravado', async () => {
    assert.ok((await prompt(null)).includes('INSTRUCAO GRAVADA'));
  });

  test('o motor do WhatsApp não enxerga nada da tela', async () => {
    const { buildSystemPrompt } = await import('@/lib/simulador/build-prompt');
    const { systemPrompt } = await buildSystemPrompt(client, ORG_A, null);
    assert.ok(!systemPrompt.includes('INSTRUCAO DA TELA'));
  });
});

describe('leitura do que vem do navegador', () => {
  test('recusa o que não é objeto', () => {
    assert.deepEqual([lerRascunho(null), lerRascunho('texto'), lerRascunho([1])], [null, null, null]);
  });

  test('troca tipo errado por vazio em vez de quebrar', () => {
    const r = lerRascunho({ agentPrompt: 42, tom: 'gritando', faqs: 'não é lista', precos: [null, { proc: 'Consulta', valor: 'R$ 100' }] });
    assert.deepEqual([r?.agentPrompt, r?.tom, r?.faqs], ['', 'simpatico', []]);
    assert.deepEqual(r?.precos.map(p => p.proc), ['Consulta']);
  });

  test('corta texto longo demais', () => {
    assert.equal(lerRascunho({ agentPrompt: 'x'.repeat(50_000) })?.agentPrompt.length, 20_000);
  });
});

describe('simulador no número escolhido', () => {
  const ID_DA_LINHA = 'cfg-numero-a';

  before(() => {
    banco.ai_agent_config.push({
      ...banco.ai_agent_config[0], id: ID_DA_LINHA, wa_number_id: WA_NUMBER_A,
      prompt: 'INSTRUCAO GRAVADA DO NUMERO', limitacoes: 'LIMITE GRAVADO DO NUMERO',
    });
  });

  async function doNumero(campos: Record<string, unknown> | null): Promise<string> {
    const { buildSystemPrompt } = await import('@/lib/simulador/build-prompt');
    const numero = lerNumeroNaTela({ id: WA_NUMBER_A, campos });
    return (await buildSystemPrompt(client, ORG_A, WA_NUMBER_A, rascunho(), numero)).systemPrompt;
  }

  test('usa a instrução da tela do número no lugar da gravada', async () => {
    const texto = await doNumero({ prompt: 'INSTRUCAO DA TELA DO NUMERO', limitacoes: 'LIMITE GRAVADO DO NUMERO' });
    assert.ok(texto.includes('INSTRUCAO DA TELA DO NUMERO'));
    assert.ok(!texto.includes('INSTRUCAO GRAVADA DO NUMERO'));
  });

  test('campo apagado na tela do número segue o padrão que está na tela', async () => {
    const texto = await doNumero({ prompt: '', limitacoes: 'LIMITE GRAVADO DO NUMERO' });
    assert.ok(texto.includes('INSTRUCAO DA TELA'));
  });

  test('com a tela do número ainda carregando, vale o que está gravado nele', async () => {
    assert.ok((await doNumero(null)).includes('INSTRUCAO GRAVADA DO NUMERO'));
  });

  test('id que não é de número vira nulo', () => {
    assert.equal(lerNumeroNaTela({ id: 'x; drop table', campos: {} }), null);
  });
});

describe('convênios na tela', () => {
  test('o simulador da clínica usa o convênio que está na tela', async () => {
    banco.organizations[0].segmento = 'clinica-medica';
    const texto = await prompt(rascunho({ dadosSaude: { convenios: 'Unimed Tela', atendeParticular: false, valorConsultaCentavos: 0 } }));
    banco.organizations[0].segmento = 'outro';
    assert.match(texto, /Convênios aceitos: Unimed Tela\./);
  });
});

describe('catálogo na tela', () => {
  test('lê dicionário e regras que vêm da tela', () => {
    const r = lerRascunho({ textosDoCatalogo: { dicionario: 'vara = barra', regras: 42 } });
    assert.deepEqual(r?.textosDoCatalogo, { dicionario: 'vara = barra', regras: '' });
  });

  test('sem o campo, o simulador fica com o que está gravado', () => {
    assert.equal(lerRascunho({})?.textosDoCatalogo, undefined);
  });
});

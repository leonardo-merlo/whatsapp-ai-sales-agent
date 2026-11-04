// S8: numa clínica, as regras de saúde entram no prompt acima das instruções
// do painel; fora da saúde, nada muda.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { ehSaude, lerDadosDeSaude, secaoDeConveniosEValores } from '../src/lib/saude.ts';

describe('convênios e valores', () => {
  test('monta a seção com convênio e valor', () => {
    const secao = secaoDeConveniosEValores({ convenios: 'Unimed, Bradesco', atendeParticular: true, valorConsultaCentavos: 25000 });
    assert.match(secao, /Convênios aceitos: Unimed, Bradesco\./);
    assert.match(secao, /Consulta particular: R\$\s?250,00\./);
  });

  test('sem nada preenchido, manda a IA dizer que a equipe confirma', () => {
    const secao = secaoDeConveniosEValores(lerDadosDeSaude({}));
    assert.match(secao, /Convênios não cadastrados: diga que a equipe confirma\./);
  });

  test('valor inválido no banco vira não informado', () => {
    assert.equal(lerDadosDeSaude({ valorConsultaCentavos: -5 }).valorConsultaCentavos, 0);
  });

  test('só os segmentos de saúde contam', () => {
    assert.deepEqual(['clinica-medica', 'nutricao', 'salao', null].map(ehSaude), [true, true, false, false]);
  });
});

let banco: Banco;
let client: never;

before(() => {
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  client = supabase.client as never;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.organizations[0].segmento = 'outro';
  banco.organizations[0].dados_saude = {};
});

async function prompt(): Promise<string> {
  const { buildSystemPrompt } = await import('@/lib/simulador/build-prompt');
  return (await buildSystemPrompt(client, ORG_A, null)).systemPrompt;
}

describe('prompt da clínica', () => {
  test('fora da saúde, as regras não entram', async () => {
    assert.ok(!(await prompt()).includes('Regras da área da saúde'));
  });

  test('numa clínica, as regras vêm antes das instruções do painel', async () => {
    banco.organizations[0].segmento = 'clinica-medica';
    const texto = await prompt();
    assert.ok(texto.indexOf('Regras da área da saúde') > -1);
    assert.ok(texto.indexOf('Regras da área da saúde') < texto.indexOf('## Tom de voz'));
  });

  test('numa clínica, o prompt proíbe diagnóstico e remédio e manda urgência para a equipe', async () => {
    banco.organizations[0].segmento = 'nutricao';
    const texto = await prompt();
    assert.match(texto, /Não dê diagnóstico/);
    assert.match(texto, /ligar 192/);
  });

  test('o prompt da clínica não usa travessão', async () => {
    banco.organizations[0].segmento = 'clinica-odonto';
    const texto = await prompt();
    const regras = texto.slice(texto.indexOf('## Regras da área da saúde'), texto.indexOf('## Tom de voz'));
    assert.ok(!regras.includes('—'));
  });

  test('os convênios cadastrados entram no prompt', async () => {
    banco.organizations[0].segmento = 'clinica-medica';
    banco.organizations[0].dados_saude = { convenios: 'Unimed', atendeParticular: true, valorConsultaCentavos: 30000 };
    assert.match(await prompt(), /Convênios aceitos: Unimed\./);
  });
});

describe('valor da consulta digitado na tela', () => {
  test('aceita vírgula e vira centavos', async () => {
    const { dadosDeSaudeDaTela } = await import('../src/lib/saude.ts');
    assert.equal(dadosDeSaudeDaTela({ convenios: '', atendeParticular: true, valorConsulta: 'R$ 250,50' })?.valorConsultaCentavos, 25050);
  });

  test('recusa o que não é número', async () => {
    const { dadosDeSaudeDaTela } = await import('../src/lib/saude.ts');
    assert.equal(dadosDeSaudeDaTela({ convenios: '', atendeParticular: true, valorConsulta: '1,2,3' }), null);
  });

  test('ida e volta devolve o mesmo valor', async () => {
    const { dadosDeSaudeDaTela, dadosDeSaudeNaTela } = await import('../src/lib/saude.ts');
    const d = { convenios: 'Unimed', atendeParticular: true, valorConsultaCentavos: 30000 };
    assert.deepEqual(dadosDeSaudeDaTela(dadosDeSaudeNaTela(d)), d);
  });
});

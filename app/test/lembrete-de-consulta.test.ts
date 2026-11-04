// S5: lembrete antes da consulta, com confirmação sim/não.
//
// Três pontas: (1) as regras puras de horário e janela; (2) a varredura, que
// só manda com template aprovado e avisa no sino quando não pode; (3) o motor,
// que só recebe o campo `confirmacao_agendamento` quando há lembrete pendente
// e grava o "sim" e o "não" no código, sem regex.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, ORG_B, WA_NUMBER_A, NUMERO_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import { estaNaJanelaDoLembrete, horaEmMinutos, horaFalada } from '../src/lib/agenda/lembrete.ts';

const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000c1';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000c1';
const CONSULTA = 'eeeeeeee-0000-4000-8000-0000000000c1';

// 10/10/2026, 10h em Brasília: a consulta de amanhã às 9h está a 23 h.
const AGORA = new Date('2026-10-10T10:00:00-03:00');

describe('horário da consulta', () => {
  test('lê os três formatos que existem no banco', () => {
    assert.deepEqual(['14:30', '14h30', '10', '9h'].map(horaEmMinutos), [870, 870, 600, 540]);
  });

  test('hora ilegível não vira lembrete', () => {
    assert.equal(horaEmMinutos('de manhã'), null);
  });

  test('fala a hora como a clínica fala', () => {
    assert.deepEqual([horaFalada('14:00'), horaFalada('09:30')], ['14h', '9h30']);
  });
});

describe('janela do lembrete', () => {
  const marcadaHaTempo = '2026-10-01T12:00:00Z';

  test('consulta a 23 h entra na janela de 24 h', () => {
    assert.equal(estaNaJanelaDoLembrete({ data: '2026-10-11', hora: '09:00', created_at: marcadaHaTempo }, AGORA, 24), true);
  });

  test('consulta a 3 dias ainda não entra', () => {
    assert.equal(estaNaJanelaDoLembrete({ data: '2026-10-13', hora: '09:00', created_at: marcadaHaTempo }, AGORA, 24), false);
  });

  test('consulta que já passou não entra', () => {
    assert.equal(estaNaJanelaDoLembrete({ data: '2026-10-10', hora: '08:00', created_at: marcadaHaTempo }, AGORA, 24), false);
  });

  test('consulta marcada dentro da janela não recebe lembrete', () => {
    assert.equal(estaNaJanelaDoLembrete({ data: '2026-10-11', hora: '09:00', created_at: '2026-10-10T12:00:00Z' }, AGORA, 24), false);
  });
});

// ── Varredura e motor, com o banco dublado ──

let banco: Banco;
let client: never;
let http: HttpFalso;

const TEMPLATE_LEMBRETE = {
  id: 'tpl-lembrete', organization_id: ORG_A, waba_id: 'WABA-A', nome: 'lembrete_agendamento',
  idioma: 'pt_BR', categoria: 'UTILITY', corpo: '...', status: 'APPROVED', origem: 'wappia', meta_template_id: '9100', oculto: false,
  variaveis: [
    { nome: 'nome', exemplo: 'Ana' }, { nome: 'empresa', exemplo: 'X' },
    { nome: 'data', exemplo: '12/10' }, { nome: 'hora', exemplo: '14h' },
  ],
};

function consulta(extra: Record<string, unknown> = {}) {
  return {
    id: CONSULTA, organization_id: ORG_A, contact_id: CONTATO, paciente_nome: 'Ana Souza', servico: 'Consulta',
    data: '2026-10-11', hora: '09:00', status: 'agendado', atendente_id: null, duracao_min: 30,
    lembrete_enviado_em: null, lembrete_tentativas: 0, confirmado_em: null, lembrete_resposta: null,
    created_at: '2026-10-01T12:00:00Z',
    ...extra,
  };
}

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  client = supabase.client as never;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  http?.restaurar();
  banco.organizations[0].lembrete_ativo = true;
  banco.organizations[0].lembrete_horas_antes = 24;
  banco.organizations[1].lembrete_ativo = true;
  banco.organizations[1].lembrete_horas_antes = 24;
  (banco.wa_numbers as Record<string, unknown>[]).forEach(n => { n.waba_id = n.id === WA_NUMBER_A ? 'WABA-A' : 'WABA-B'; });
  banco.contacts.length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Ana Souza', telefone: '5532999990001', origem: 'whatsapp', perfil: null });
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.appointments = [consulta()];
  banco.wa_templates = [];
  banco.notificacoes = [];
});

const enviosDeTemplate = () =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { type?: string })?.type === 'template');

describe('varredura dos lembretes', () => {
  test('com template aprovado, o lembrete sai e a consulta fica marcada', async () => {
    banco.wa_templates = [{ ...TEMPLATE_LEMBRETE }];
    http = instalarHttpFalso([]);
    const { enviarLembretesPendentes } = await import('@/lib/agenda/lembrete');

    await enviarLembretesPendentes(client, AGORA);

    const corpo = enviosDeTemplate()[0]?.corpo as { template?: { name?: string; components?: { parameters: { text: string }[] }[] } };
    assert.deepEqual(corpo.template?.components?.[0].parameters.map(p => p.text), ['Ana', 'Clínica A', '11/10', '9h']);
    assert.ok(banco.appointments[0].lembrete_enviado_em);
  });

  test('sem template aprovado, nada sai e o sino avisa', async () => {
    http = instalarHttpFalso([]);
    const { enviarLembretesPendentes } = await import('@/lib/agenda/lembrete');

    await enviarLembretesPendentes(client, AGORA);

    assert.equal(enviosDeTemplate().length, 0);
    assert.equal(banco.appointments[0].lembrete_tentativas, 1);
    assert.equal(banco.notificacoes.filter(n => n.tipo === 'aviso_nao_enviado').length, 1);
  });

  test('sem template, a conversa não ganha mensagem fingindo que saiu', async () => {
    http = instalarHttpFalso([]);
    const { enviarLembretesPendentes } = await import('@/lib/agenda/lembrete');

    await enviarLembretesPendentes(client, AGORA);

    assert.equal(banco.messages.length, 0);
  });

  test('empresa com lembrete desligado não recebe nada', async () => {
    banco.organizations[0].lembrete_ativo = false;
    banco.wa_templates = [{ ...TEMPLATE_LEMBRETE }];
    http = instalarHttpFalso([]);
    const { enviarLembretesPendentes } = await import('@/lib/agenda/lembrete');

    await enviarLembretesPendentes(client, AGORA);

    assert.equal(enviosDeTemplate().length, 0);
  });

  test('o template de uma empresa não serve para a consulta de outra', async () => {
    banco.appointments = [consulta({ organization_id: ORG_B })];
    banco.wa_templates = [{ ...TEMPLATE_LEMBRETE }];
    http = instalarHttpFalso([]);
    const { enviarLembretesPendentes } = await import('@/lib/agenda/lembrete');

    await enviarLembretesPendentes(client, AGORA);

    assert.equal(enviosDeTemplate().length, 0);
  });
});

// ── Motor ──

function respostaDoModelo(extra: Record<string, unknown> = {}) {
  return {
    resposta: 'Obrigada, até amanhã!',
    transferir_para_atendente: false, questionario_completo: false, respostas: [], resultado: 'nenhum',
    itens_vendidos: [], agendamento_data: '', agendamento_hora: '', agendamento_servico: '',
    agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
    ...extra,
  };
}

function conversaComMensagem(texto: string) {
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, wa_number_id: WA_NUMBER_A,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-0000000000c1', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto, read: false, camp: false, created_at: new Date().toISOString(),
  });
}

async function chamarMotor() {
  const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
  return gerarRespostaIA(client, ORG_A, CONVERSA);
}

type CorpoAnthropic = { system?: string; output_config?: { format?: { schema?: { required?: string[] } } } };

describe('resposta ao lembrete no motor', () => {
  // A consulta do motor precisa estar no futuro de verdade: ele usa o relógio.
  const amanha = new Date(Date.now() + 20 * 60 * 60 * 1000);
  const dataDeAmanha = amanha.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const horaDeAmanha = amanha.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const comLembrete = () => { banco.appointments = [consulta({ data: dataDeAmanha, hora: horaDeAmanha, lembrete_enviado_em: new Date().toISOString() })]; };

  test('sem lembrete pendente, o formato sai como antes', async () => {
    conversaComMensagem('Vocês abrem sábado?');
    http = instalarHttpFalso([{ json: respostaDoModelo() }]);

    await chamarMotor();

    const corpo = http.chamadasAnthropic[0].corpo as CorpoAnthropic;
    assert.ok(!corpo.output_config?.format?.schema?.required?.includes('confirmacao_agendamento'));
    assert.ok(!String(corpo.system).includes('Lembrete de consulta pendente'));
  });

  test('com lembrete pendente, o prompt e o formato ganham a confirmação', async () => {
    comLembrete();
    conversaComMensagem('Confirmo sim');
    http = instalarHttpFalso([{ json: respostaDoModelo({ confirmacao_agendamento: 'nenhuma' }) }]);

    await chamarMotor();

    const corpo = http.chamadasAnthropic[0].corpo as CorpoAnthropic;
    assert.ok(corpo.output_config?.format?.schema?.required?.includes('confirmacao_agendamento'));
    assert.match(String(corpo.system), /Lembrete de consulta pendente/);
  });

  test('"sim" confirma a consulta', async () => {
    comLembrete();
    conversaComMensagem('Confirmo sim');
    http = instalarHttpFalso([{ json: respostaDoModelo({ confirmacao_agendamento: 'sim' }) }]);

    await chamarMotor();

    assert.equal(banco.appointments[0].status, 'confirmado');
    assert.ok(banco.appointments[0].confirmado_em);
  });

  test('"não" avisa a clínica e não cancela o horário sozinho', async () => {
    comLembrete();
    conversaComMensagem('Não vou conseguir ir');
    http = instalarHttpFalso([{ json: respostaDoModelo({ confirmacao_agendamento: 'nao', resposta: 'Quer remarcar?' }) }]);

    await chamarMotor();

    assert.equal(banco.appointments[0].lembrete_resposta, 'nao');
    assert.equal(banco.appointments[0].status, 'agendado');
    assert.equal(banco.notificacoes.filter(n => n.tipo === 'consulta_desmarcada').length, 1);
  });

  test('o lembrete de outra empresa não entra no prompt', async () => {
    banco.appointments = [consulta({ organization_id: ORG_B, data: dataDeAmanha, hora: horaDeAmanha, lembrete_enviado_em: new Date().toISOString() })];
    conversaComMensagem('Confirmo sim');
    http = instalarHttpFalso([{ json: respostaDoModelo() }]);

    await chamarMotor();

    assert.ok(!String((http.chamadasAnthropic[0].corpo as CorpoAnthropic).system).includes('Lembrete de consulta pendente'));
  });
});

void NUMERO_A;

// S9: exportar e apagar os dados de um paciente, sem nunca atravessar a
// organização.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, ORG_B } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { consultar, urlDoBanco } from './apoio/psql.mts';

const PACIENTE = 'aaaaaaaa-0000-4000-8000-0000000000e1';
const PACIENTE_DE_OUTRA = 'aaaaaaaa-0000-4000-8000-0000000000e2';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000e1';

let banco: Banco;
let client: never;

before(() => {
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  client = supabase.client as never;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  banco.contacts.length = 0;
  banco.contacts.push(
    { id: PACIENTE, organization_id: ORG_A, nome: 'Ana Souza', telefone: '5532999990003', origem: 'whatsapp', perfil: null },
    { id: PACIENTE_DE_OUTRA, organization_id: ORG_B, nome: 'Bia Lima', telefone: '5532999990004', origem: 'whatsapp', perfil: null },
  );
  banco.conversations.length = 0;
  banco.conversations.push({ id: CONVERSA, organization_id: ORG_A, contact_id: PACIENTE, status: 'aberta', modo: 'ia', created_at: '2026-09-01T12:00:00Z' });
  banco.messages.length = 0;
  banco.messages.push(
    { id: 'm1', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'Quero marcar consulta', created_at: '2026-09-01T12:00:00Z' },
    { id: 'm2', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'sys', texto: 'linha interna', created_at: '2026-09-01T12:00:01Z' },
  );
  banco.appointments = [
    { id: 'ap1', organization_id: ORG_A, contact_id: PACIENTE, paciente_nome: 'Ana Souza', servico: 'Consulta', data: '2026-10-01', hora: '10:00', status: 'agendado' },
    { id: 'ap2', organization_id: ORG_B, contact_id: PACIENTE_DE_OUTRA, paciente_nome: 'Bia Lima', servico: 'Consulta', data: '2026-10-01', hora: '10:00', status: 'agendado' },
  ];
  banco.contact_history = [];
  banco.questionnaire_responses = [];
  banco.notificacoes = [];
  banco.agente_turnos = [{ id: 't1', organization_id: ORG_A, conversation_id: CONVERSA }];
});

describe('exportar paciente', () => {
  test('traz contato, mensagens e consultas', async () => {
    const { exportarPaciente } = await import('@/lib/lgpd/dados-do-paciente');
    const dados = await exportarPaciente(client, ORG_A, PACIENTE);
    assert.equal(dados?.conversas[0].mensagens[0].texto, 'Quero marcar consulta');
    assert.equal(dados?.consultas.length, 1);
  });

  test('não leva linha interna do sistema', async () => {
    const { exportarPaciente } = await import('@/lib/lgpd/dados-do-paciente');
    const dados = await exportarPaciente(client, ORG_A, PACIENTE);
    assert.equal(dados?.conversas[0].mensagens.length, 1);
  });

  test('paciente de outra empresa não existe', async () => {
    const { exportarPaciente } = await import('@/lib/lgpd/dados-do-paciente');
    assert.equal(await exportarPaciente(client, ORG_A, PACIENTE_DE_OUTRA), null);
  });
});

describe('apagar paciente', () => {
  test('tira o contato, as consultas e a ficha do agente', async () => {
    const { apagarPaciente } = await import('@/lib/lgpd/dados-do-paciente');
    assert.deepEqual(await apagarPaciente(client, ORG_A, PACIENTE), { apagado: true });
    assert.deepEqual(
      [banco.contacts.some(c => c.id === PACIENTE), banco.appointments.some(a => a.id === 'ap1'), banco.agente_turnos.length],
      [false, false, 0],
    );
  });

  test('pedido de outra empresa não apaga nada', async () => {
    const { apagarPaciente } = await import('@/lib/lgpd/dados-do-paciente');
    const resultado = await apagarPaciente(client, ORG_A, PACIENTE_DE_OUTRA);
    assert.deepEqual(resultado, { apagado: false, motivo: 'nao-encontrado' });
    assert.ok(banco.contacts.some(c => c.id === PACIENTE_DE_OUTRA) && banco.appointments.some(a => a.id === 'ap2'));
  });
});

// O resto sai pelo ON DELETE CASCADE do banco, que o dublê não imita. Aqui é
// o banco de verdade, em BEGIN … ROLLBACK.
const motivoDoPulo = urlDoBanco() ? null : 'SUPABASE_DB_URL não definida.';

describe('o banco leva junto o que o código não apaga', { skip: motivoDoPulo ?? false }, () => {
  test('apagar o contato apaga conversas, mensagens e resumos', () => {
    const [[resultado]] = consultar(`
      BEGIN;
      INSERT INTO public.contacts (id, organization_id, nome, telefone)
        SELECT 'aaaaaaaa-0000-4000-8000-0000000000f9', id, 'Teste LGPD', '5500000000099' FROM public.organizations LIMIT 1;
      INSERT INTO public.conversations (id, organization_id, contact_id)
        SELECT 'bbbbbbbb-0000-4000-8000-0000000000f9', organization_id, id FROM public.contacts WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000f9';
      INSERT INTO public.messages (organization_id, conversation_id, autor, texto)
        SELECT organization_id, id, 'cliente', 'dado de saude' FROM public.conversations WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000f9';
      DELETE FROM public.contacts WHERE id = 'aaaaaaaa-0000-4000-8000-0000000000f9';
      SELECT (SELECT count(*) FROM public.conversations WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000f9')
           + (SELECT count(*) FROM public.messages WHERE conversation_id = 'bbbbbbbb-0000-4000-8000-0000000000f9');
      ROLLBACK;`);
    assert.equal(resultado, '0');
  });
});

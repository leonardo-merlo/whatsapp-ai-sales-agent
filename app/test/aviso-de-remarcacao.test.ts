// S6: ao arrastar a consulta na agenda, o paciente recebe o aviso de
// remarcação pelo mesmo caminho do lembrete.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A, WA_NUMBER_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000d1';

let banco: Banco;
let client: never;
let http: HttpFalso;

const TEMPLATE_REMARCACAO = {
  id: 'tpl-remarcacao', organization_id: ORG_A, waba_id: 'WABA-A', nome: 'aviso_remarcacao',
  idioma: 'pt_BR', categoria: 'UTILITY', corpo: '...', status: 'APPROVED', origem: 'wappia', meta_template_id: '9200', oculto: false,
  variaveis: [
    { nome: 'nome', exemplo: 'Ana' }, { nome: 'empresa', exemplo: 'X' },
    { nome: 'data', exemplo: '15/10' }, { nome: 'hora', exemplo: '10h' },
  ],
};

const CONSULTA = {
  id: 'eeeeeeee-0000-4000-8000-0000000000d1', organization_id: ORG_A, contact_id: CONTATO,
  paciente_nome: 'Ana Souza', servico: 'Retorno', data: '2026-10-15', hora: '10:30', lembrete_tentativas: 0,
};

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  client = supabase.client as never;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  http?.restaurar();
  http = instalarHttpFalso([]);
  (banco.wa_numbers as Record<string, unknown>[]).forEach(n => { n.waba_id = n.id === WA_NUMBER_A ? 'WABA-A' : 'WABA-B'; });
  banco.contacts.length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Ana Souza', telefone: '5532999990002', origem: 'whatsapp', perfil: null });
  banco.conversations.length = 0;
  banco.messages.length = 0;
  banco.wa_templates = [];
  banco.notificacoes = [];
});

const enviosDeTemplate = () =>
  http.chamadasWhatsApp.filter(c => (c.corpo as { type?: string })?.type === 'template');

describe('aviso de remarcação', () => {
  test('sai com a data e a hora novas', async () => {
    banco.wa_templates = [{ ...TEMPLATE_REMARCACAO }];
    const { enviarAvisoDaConsulta } = await import('@/lib/agenda/lembrete');

    const envio = await enviarAvisoDaConsulta(client, CONSULTA, 'aviso_remarcacao');

    assert.equal(envio.enviado, true);
    const corpo = enviosDeTemplate()[0]?.corpo as { template?: { name?: string; components?: { parameters: { text: string }[] }[] } };
    assert.deepEqual(corpo.template?.components?.[0].parameters.map(p => p.text), ['Ana', 'Clínica A', '15/10', '10h30']);
  });

  test('fica escrito na conversa para a equipe ver', async () => {
    banco.wa_templates = [{ ...TEMPLATE_REMARCACAO }];
    const { enviarAvisoDaConsulta } = await import('@/lib/agenda/lembrete');

    await enviarAvisoDaConsulta(client, CONSULTA, 'aviso_remarcacao');

    assert.ok(banco.messages.some(m => String(m.texto).startsWith('Aviso de remarcação enviado')));
  });

  test('sem template aprovado, nada sai e o sino avisa', async () => {
    const { enviarAvisoDaConsulta } = await import('@/lib/agenda/lembrete');

    const envio = await enviarAvisoDaConsulta(client, CONSULTA, 'aviso_remarcacao');

    assert.equal(envio.enviado, false);
    assert.equal(enviosDeTemplate().length, 0);
    assert.deepEqual(banco.notificacoes.map(n => n.titulo), ['Aviso de remarcação não enviado']);
  });
});

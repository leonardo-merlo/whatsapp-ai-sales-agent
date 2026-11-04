// Eventos de status do pedido (contrato v5, aba "Eventos de status"): a Distribuidora Exemplo chama o nosso endereço a cada
// mudança. O que não pode falhar: assinatura errada não entra, evento repetido não avisa o cliente duas vezes, evento
// fora de ordem não faz o status andar para trás, e o aviso vai a quem deve (cliente ou vendedor).

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cenarioBase, INDICES_UNICOS, ORG_A, WA_NUMBER_A, NUMERO_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import { lerEvento, projetar, TIPOS_DE_EVENTO } from '@/lib/erp/eventos-do-pedido';

const SEGREDO = 'segredo-dos-eventos-de-teste';
const PEDIDO = 'pedido-uuid-1';
const CONVERSA = 'conversa-1';
const CONTATO = 'contato-1';
const MEMBRO = 'membro-vendedor';
const COPILOTO = 'dddddddd-0000-4000-8000-0000000000cc';

let banco: Banco;
let http: HttpFalso;
const tarefas: (() => Promise<void> | void)[] = [];

before(() => {
  process.env.EXEMPLO_EVENTOS_SEGREDO = SEGREDO;
  process.env.EXEMPLO_ORG_ID = ORG_A;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, { unicos: { ...INDICES_UNICOS.unicos, erp_eventos: [['organization_id', 'evento_id']] } });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  mock.module('next/server', { namedExports: { after: (cb: () => Promise<void> | void) => { tarefas.push(cb); } } });
});

beforeEach(() => {
  http = instalarHttpFalso();
  tarefas.length = 0;
  banco.erp_eventos = [];
  banco.messages = [{ id: 'm1', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'quero comprar', created_at: new Date().toISOString() }];
  banco.contacts = [{ id: CONTATO, organization_id: ORG_A, nome: 'Metalúrgica Exemplo', telefone: '5532999990000', wa_user_id: null }];
  banco.conversations = [{ id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO, wa_number_id: WA_NUMBER_A, modo: 'ia' }];
  banco.organization_members = [{ id: MEMBRO, organization_id: ORG_A, nome: 'João', telefone_whatsapp: '5532988887777' }];
  banco.wa_numbers = [
    { id: WA_NUMBER_A, organization_id: ORG_A, phone_number_id: NUMERO_A, telefone: '+55 11 90000-0001', papel: 'vendedor', member_id: MEMBRO, ativo: true, waba_id: 'WABA-A' },
    { id: COPILOTO, organization_id: ORG_A, phone_number_id: 'COPILOTO', telefone: '+55 11 90000-0099', papel: 'copiloto', member_id: null, ativo: true, waba_id: 'WABA-A' },
  ];
  banco.wa_templates = [];
  banco.erp_pedidos = [{
    id: PEDIDO, organization_id: ORG_A, erp_pedido_id: 'PED-556', conversation_id: CONVERSA, contact_id: CONTATO, wa_number_id: WA_NUMBER_A,
    modalidade_entrega: 'ENTREGA', status: 'AGUARDANDO_VALIDACAO', status_ocorrido_em: '2026-10-27T10:00:00.000Z', pagamento_link: null,
  }];
});

depois(() => http?.restaurar());

function evento(tipo: string, extra: Record<string, unknown> = {}) {
  return { evento_id: `EVT-${tipo}`, tipo_evento: tipo, ocorrido_em: '2026-10-27T15:00:00-03:00', pedido_id: 'PED-556', cliente_id: 'Z06586/01', dados: {}, ...extra };
}

async function chamar(corpo: unknown, assinatura?: string | null) {
  const { POST } = await import('@/app/api/integracoes/exemplo/eventos/route');
  const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const sig = assinatura === undefined ? `sha256=${createHmac('sha256', SEGREDO).update(texto).digest('hex')}` : assinatura;
  if (sig !== null) headers['x-exemplo-assinatura'] = sig;
  const r = await POST(new Request('https://www.wappia.com.br/api/integracoes/exemplo/eventos', { method: 'POST', headers, body: texto }));
  for (const t of tarefas.splice(0)) await t();
  return r;
}

const pedido = () => banco.erp_pedidos[0];
const enviadoAoCliente = () => http.chamadasWhatsApp.map(c => JSON.stringify(c.corpo)).join('\n');

describe('endereço de eventos do pedido', () => {
  test('sem assinatura ou com assinatura errada responde 401 e não grava', async () => {
    for (const sig of [null, 'sha256=abc', `sha256=${createHmac('sha256', 'outro').update('{}').digest('hex')}`]) {
      const r = await chamar(evento('pedido.pago'), sig);
      assert.equal(r.status, 401);
    }
    assert.equal(banco.erp_eventos.length, 0);
  });

  test('tipo de evento desconhecido responde 400 dizendo qual', async () => {
    const r = await chamar(evento('pedido.voou'));
    assert.equal(r.status, 400);
    assert.match((await r.json() as { erro: string }).erro, /pedido\.voou/);
  });

  test('aguardando pagamento guarda o link e manda ao cliente dentro da janela, em texto', async () => {
    const r = await chamar(evento('pedido.aguardando_pagamento', { dados: { link_pagamento: 'https://pagamento.distribuidora-exemplo.test/p/9f2a', expira_em: '2026-10-29T23:59:59-03:00' } }));
    assert.equal(r.status, 200);
    assert.equal(pedido().status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(pedido().pagamento_link, 'https://pagamento.distribuidora-exemplo.test/p/9f2a');
    assert.match(enviadoAoCliente(), /pagamento\.distribuidora-exemplo\.test\/p\/9f2a/);
  });

  test('evento repetido responde 200 e não avisa de novo', async () => {
    await chamar(evento('pedido.pago'));
    const antes = http.chamadasWhatsApp.length;
    const r = await chamar(evento('pedido.pago'));
    assert.equal(r.status, 200);
    assert.equal((await r.json() as { duplicado: boolean }).duplicado, true);
    assert.equal(http.chamadasWhatsApp.length, antes);
  });

  test('evento mais velho que o status de agora não faz o pedido voltar nem avisa', async () => {
    await chamar(evento('pedido.saiu_para_entrega', { ocorrido_em: '2026-10-28T09:00:00-03:00' }));
    const enviados = http.chamadasWhatsApp.length;
    await chamar(evento('pedido.em_separacao', { ocorrido_em: '2026-10-28T08:00:00-03:00' }));
    assert.equal(pedido().status, 'SAIU_PARA_ENTREGA');
    assert.equal(http.chamadasWhatsApp.length, enviados);
  });

  test('pedido que não é nosso fica guardado, sem mexer em nada', async () => {
    const r = await chamar(evento('pedido.pago', { pedido_id: 'PED-DE-OUTRO' }));
    assert.equal(r.status, 200);
    assert.equal(banco.erp_eventos.length, 1);
    assert.equal(pedido().status, 'AGUARDANDO_VALIDACAO');
  });

  test('erro de faturamento vai ao vendedor pelo copiloto, nunca ao cliente', async () => {
    await chamar(evento('pedido.erro_faturamento', { dados: { motivo: 'NCM inválido' } }));
    const para = http.chamadasWhatsApp.map(c => (c.corpo as { to?: string }).to);
    assert.deepEqual(para, []);
    const naConversaDoVendedor = banco.messages.filter(m => String(m.texto).includes('NCM inválido'));
    assert.ok(naConversaDoVendedor.length >= 1, 'o aviso ao vendedor fica registrado (sai quando o template for aprovado)');
    assert.ok(naConversaDoVendedor.every(m => m.conversation_id !== CONVERSA));
  });

  test('fora da janela de 24 h, sem template aprovado, o aviso fica na conversa com o motivo', async () => {
    banco.messages = [{ id: 'm1', organization_id: ORG_A, conversation_id: CONVERSA, autor: 'cliente', texto: 'oi', created_at: '2026-10-20T10:00:00Z' }];
    await chamar(evento('pedido.faturado', { dados: { numero_nota: '12345' } }));
    assert.equal(pedido().nota_numero, '12345');
    assert.equal(http.chamadasWhatsApp.length, 0);
    assert.ok(banco.messages.some(m => m.autor === 'sys' && String(m.texto).includes('pedido_faturado')));
  });
});

describe('regras do evento, sem servidor', () => {
  test('todo evento do contrato tem status, destino e template', () => {
    assert.equal(Object.keys(TIPOS_DE_EVENTO).length, 15);
    for (const [tipo, t] of Object.entries(TIPOS_DE_EVENTO)) assert.ok(t.status && t.template && t.variaveis.length, tipo);
  });

  test('fora de ordem, o link que faltava entra mesmo assim', () => {
    const lido = lerEvento(evento('pedido.aguardando_pagamento', { ocorrido_em: '2026-10-27T08:00:00Z', dados: { link_pagamento: 'https://x/p' } }));
    assert.ok(lido.ok);
    const r = projetar({ status: 'PAGO', status_ocorrido_em: '2026-10-27T09:00:00Z', pagamento_link: null }, lido.evento);
    assert.deepEqual(r, { avanca: false, mudanca: { pagamento_link: 'https://x/p' } });
  });
});

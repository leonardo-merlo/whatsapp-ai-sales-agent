// Fase 6: a operação 5 do contrato — o sistema do cliente avisa o desfecho de
// um orçamento. É o endpoint que dá ao desenvolvedor da Distribuidora Exemplo um alvo real
// para programar contra, antes de a API deles existir.
//
// Duas coisas precisam ser verdade e as duas quebram feio se falharem: o token
// tem que barrar quem não tem, e o mesmo evento reenviado **não pode contar
// duas vezes** — do outro lado isso seria um orçamento marcado como fechado
// duas vezes.

import { test, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';

const TOKEN = 'token-do-contrato-da-exemplo';

let banco: Banco;

before(() => {
  process.env.ORCAMENTOS_API_TOKEN = TOKEN;
  process.env.ORCAMENTOS_ORG_ID = ORG_A;
  banco = cenarioBase();
  banco.orcamento_eventos = [];
  const supabase = criarSupabaseFalso(banco, {
    unicos: {
      ...INDICES_UNICOS.unicos,
      // 20260908000004_orcamento_eventos.sql
      orcamento_eventos: [['organization_id', 'evento_id']],
    },
  });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

async function chamar(corpo: unknown, token: string | null = TOKEN) {
  const { POST } = await import('@/app/api/v1/orcamentos/resultado/route');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return POST(new Request('https://www.wappia.com.br/api/v1/orcamentos/resultado', {
    method: 'POST',
    headers,
    body: typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
  }));
}

const eventoValido = {
  evento_id: 'EVT-2026-0001',
  orcamento_id: 'ORC-88123',
  status: 'aprovado',
  ocorrido_em: '2026-09-08T14:30:00-03:00',
  vendedor_id: 'V-001',
  valor_total: 18450.9,
};

test('sem token, ou com token errado, responde 401 e não grava nada', async () => {
  for (const token of [null, '', 'token-errado', `${TOKEN}x`]) {
    const resposta = await chamar(eventoValido, token);
    assert.equal(resposta.status, 401, `token ${JSON.stringify(token)} devia ser recusado`);
  }
  assert.equal(banco.orcamento_eventos.length, 0);
});

test('com o token certo, grava o evento e devolve 200', async () => {
  const resposta = await chamar(eventoValido);
  assert.equal(resposta.status, 200);
  assert.deepEqual(await resposta.json(), { ok: true, evento_id: 'EVT-2026-0001', duplicado: false });

  assert.equal(banco.orcamento_eventos.length, 1);
  const evento = banco.orcamento_eventos[0];
  assert.equal(evento.organization_id, ORG_A);
  assert.equal(evento.evento_id, 'EVT-2026-0001');
  assert.equal(evento.orcamento_id, 'ORC-88123');
  assert.equal(evento.status, 'aprovado');
  assert.equal(evento.ocorrido_em, new Date('2026-09-08T14:30:00-03:00').toISOString());
});

test('o corpo inteiro é guardado, inclusive o que o contrato ainda não previu', async () => {
  const evento = banco.orcamento_eventos[0];
  const payload = evento.payload as Record<string, unknown>;
  assert.equal(payload.vendedor_id, 'V-001', 'campo fora das colunas promovidas se perdeu');
  assert.equal(payload.valor_total, 18450.9);
});

test('o mesmo evento reenviado responde 200 e não conta duas vezes', async () => {
  const resposta = await chamar(eventoValido);
  assert.equal(resposta.status, 200, 'erro aqui faz o outro lado reenviar em loop');
  assert.deepEqual(await resposta.json(), { ok: true, evento_id: 'EVT-2026-0001', duplicado: true });
  assert.equal(banco.orcamento_eventos.length, 1, 'o desfecho foi registrado duas vezes');
});

test('evento diferente do mesmo orçamento é registrado normalmente', async () => {
  const resposta = await chamar({ ...eventoValido, evento_id: 'EVT-2026-0002', status: 'faturado' });
  assert.equal(resposta.status, 200);
  assert.equal(banco.orcamento_eventos.length, 2);
  assert.equal(banco.orcamento_eventos[1].status, 'faturado');
});

test('corpo sem os obrigatórios responde 400 com o motivo', async () => {
  const casos: unknown[] = [
    {},
    { evento_id: 'EVT-3' },
    { orcamento_id: 'ORC-3' },
    { evento_id: '   ', orcamento_id: 'ORC-3' },
    { evento_id: 'x'.repeat(201), orcamento_id: 'ORC-3' },
    { evento_id: 42, orcamento_id: 'ORC-3' },
    [eventoValido],
    'não é json',
  ];
  const antes = banco.orcamento_eventos.length;
  for (const caso of casos) {
    const resposta = await chamar(caso);
    assert.equal(resposta.status, 400, `${JSON.stringify(caso)} devia ser recusado`);
    assert.match((await resposta.json()).error, /obrigatórios|inválido/i);
  }
  assert.equal(banco.orcamento_eventos.length, antes, 'corpo recusado não podia gravar nada');
});

test('data mal formada não derruba o evento — vira nulo', async () => {
  await chamar({ evento_id: 'EVT-2026-0003', orcamento_id: 'ORC-88123', ocorrido_em: 'ontem à tarde' });
  const evento = banco.orcamento_eventos.at(-1)!;
  assert.equal(evento.evento_id, 'EVT-2026-0003');
  assert.equal(evento.ocorrido_em, null, 'o desfecho importa mais que o carimbo de hora');
  assert.equal((evento.payload as Record<string, unknown>).ocorrido_em, 'ontem à tarde',
    'o valor original continua no payload cru');
});

test('sem as variáveis de ambiente, responde 500 em vez de aceitar qualquer um', async () => {
  const original = process.env.ORCAMENTOS_API_TOKEN;
  delete process.env.ORCAMENTOS_API_TOKEN;
  try {
    const resposta = await chamar(eventoValido, null);
    assert.equal(resposta.status, 500, 'sem token configurado, aceitar seria pior do que falhar');
  } finally {
    process.env.ORCAMENTOS_API_TOKEN = original;
  }
});

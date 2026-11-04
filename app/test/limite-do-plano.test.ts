// O que acontece com a conversa quando a organização passa do limite do plano.
//
// Havia um comportamento só: a IA parava e a conversa ia para `humano`. Num
// piloto B2B isso é desastre — o vendedor está na rua, ninguém olha o painel, e
// o cliente fica falando sozinho justamente no dia de maior volume, que é
// quando o limite estoura. A migration `20260914000003` separou **cortar** de
// **avisar**, com `transferir` (o de sempre) como padrão.
//
// Os dois testes que importam aqui são um o espelho do outro: com o padrão,
// nada mudou; com `avisar`, a IA responde e o aviso sai uma vez só.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';
import { AVISO_AO_CLIENTE_LIMITE_DO_PLANO } from '../src/lib/agente/responder-conversa.ts';

let banco: Banco;
let http: HttpFalso;
let tarefasPendentes: (() => Promise<void> | void)[] = [];

const CLIENTE = '5500900000777';

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  delete process.env.WEBHOOK_FILA_ORGS;

  banco = cenarioBase();
  // O teto do plano padrão do cenário é 1000; aqui ele vira 2 para o limite
  // estourar com duas mensagens, sem precisar forjar mil linhas.
  banco.plans = [{ id: 'plano-unico', key: 'unico', max_msgs_mes: 2 }];

  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
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
  banco.notificacoes = [];
  tarefasPendentes = [];
  banco.organizations[0].ao_estourar_limite = 'transferir';
  http?.restaurar();
  http = instalarHttpFalso([]);
});

depois(() => http?.restaurar());

async function entregar(texto: string) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId: NUMERO_A, telefone: CLIENTE, texto });
  const resposta = await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  return resposta;
}

const respostasDaIA = () => banco.messages.filter(m => m.autor === 'ia');
const avisosDoSistema = () => banco.messages.filter(m => m.autor === 'sys').map(m => String(m.texto));
const modoDaConversa = () => String(banco.conversations[0]?.modo ?? '');

describe('ao estourar o limite do plano', () => {
  // S3 (29/09, decisão do Leonardo): no padrão a conversa continua indo para
  // uma pessoa, mas o cliente deixa de ficar sem resposta. Até 29/09 a
  // terceira mensagem não recebia nada.
  test('no padrão, a conversa vai para uma pessoa e o cliente recebe a frase fixa', async () => {
    await entregar('oi');
    await entregar('tudo bem?');
    assert.equal(respostasDaIA().length, 2, 'as duas primeiras foram respondidas');

    await entregar('e o orçamento?');

    assert.equal(modoDaConversa(), 'humano');
    assert.ok(avisosDoSistema().some(t => t.includes('atendimento manual necessário')));
    assert.equal(respostasDaIA().at(-1)?.texto, AVISO_AO_CLIENTE_LIMITE_DO_PLANO);
  });

  test('a frase fixa sai pelo WhatsApp e a IA não é chamada', async () => {
    await entregar('oi');
    await entregar('tudo bem?');
    const chamadasAntes = http.chamadasAnthropic.length;

    await entregar('e o orçamento?');

    assert.equal(http.chamadasAnthropic.length, chamadasAntes, 'o modelo não escreveu nada');
    const enviados = http.chamadasWhatsApp.map(c => JSON.stringify(c.corpo));
    assert.ok(enviados.at(-1)?.includes(AVISO_AO_CLIENTE_LIMITE_DO_PLANO));
  });

  test('a frase sai uma vez por conversa, mesmo se a conversa voltar para a IA', async () => {
    await entregar('oi');
    await entregar('tudo bem?');
    await entregar('e o orçamento?');
    banco.conversations[0].modo = 'ia';
    await entregar('alguém aí?');

    const frases = respostasDaIA().filter(m => m.texto === AVISO_AO_CLIENTE_LIMITE_DO_PLANO);
    assert.equal(frases.length, 1);
  });

  test('a clínica é avisada pelo sino, um aviso em aberto por empresa', async () => {
    await entregar('oi');
    await entregar('tudo bem?');
    await entregar('e o orçamento?');
    banco.conversations[0].modo = 'ia';
    await entregar('alguém aí?');

    const avisos = (banco.notificacoes ?? []).filter(n => n.tipo === 'limite_do_plano');
    assert.equal(avisos.length, 1);
  });

  test('em "avisar", a IA continua respondendo e a conversa não muda de modo', async () => {
    banco.organizations[0].ao_estourar_limite = 'avisar';

    await entregar('oi');
    await entregar('tudo bem?');
    await entregar('e o orçamento?');

    assert.equal(respostasDaIA().length, 3, 'a terceira foi respondida mesmo passando do limite');
    assert.equal(modoDaConversa(), 'ia', 'a conversa continua com a IA');
  });

  test('o aviso de excedente sai UMA vez, não a cada mensagem', async () => {
    banco.organizations[0].ao_estourar_limite = 'avisar';

    await entregar('oi');
    await entregar('tudo bem?');
    await entregar('mensagem que passa do limite');
    await entregar('e mais uma');
    await entregar('e mais outra');

    const excedentes = avisosDoSistema().filter(t => t.includes('Limite de mensagens do plano ultrapassado'));
    assert.equal(excedentes.length, 1, 'um aviso só, com o número de mensagens usadas');
    assert.match(excedentes[0], /a IA continua respondendo/);
  });
});

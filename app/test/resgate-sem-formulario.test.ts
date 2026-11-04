// A rede de segurança do erro 500 precisa entregar uma MENSAGEM, e não o formulário.
//
// O caso: em 21/09, 12:22, o cliente escreveu "quero orçamento" e ficou sem
// resposta. Os logs da Vercel mostram, nas três tentativas (o webhook e duas
// varreduras): "Anthropic falhou com erro de servidor; respondendo sem o
// formulário" seguido de "A resposta da IA veio com o formulário dentro; nada foi
// enviado ao cliente". O resgate chama o modelo sem o formato estruturado, mas o
// system continuava dizendo "Responda em JSON com os campos...": o modelo
// obedecia e escrevia o formulário como texto, e o motor (com razão) recusava
// mandá-lo ao cliente. Os testes de `travas-do-cadastro.test.ts` não pegavam
// isso porque o dublê do resgate devolve texto limpo, que é o que o modelo de
// verdade não fazia.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';

const CONTATO = 'aaaaaaaa-0000-4000-8000-0000000000a1';
const CONVERSA = 'bbbbbbbb-0000-4000-8000-0000000000a1';

/** Três, e não uma: o SDK repete a falha de servidor duas vezes antes de o motor decidir resgatar. */
const CINQUENTA = { status: 500 } as RespostaAnthropic;
const ANTHROPIC_FORA = [CINQUENTA, CINQUENTA, CINQUENTA];

let banco: Banco;
let supabaseClient: unknown;
let http: HttpFalso;

before(() => {
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  banco = cenarioBase();
  const supabase = criarSupabaseFalso(banco, INDICES_UNICOS);
  supabaseClient = supabase.client;
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
});

beforeEach(() => {
  for (const t of ['contacts', 'conversations', 'messages', 'ai_usage']) banco[t].length = 0;
  banco.contacts.push({ id: CONTATO, organization_id: ORG_A, nome: 'Joana', telefone: '5500900000092', origem: 'whatsapp', perfil: null });
  banco.conversations.push({
    id: CONVERSA, organization_id: ORG_A, contact_id: CONTATO,
    assunto: 'WhatsApp', status: 'aberta', modo: 'ia', atendente_id: null,
  });
  banco.messages.push({
    id: 'cccccccc-0000-4000-8000-0000000000a1', organization_id: ORG_A, conversation_id: CONVERSA,
    autor: 'cliente', texto: 'quero orçamento', read: false, camp: false, created_at: new Date().toISOString(),
  });
});

depois(() => http?.restaurar());

async function responderComResgate(textoDoResgate: string) {
  http = instalarHttpFalso([...ANTHROPIC_FORA, { texto: textoDoResgate }]);
  try {
    const { gerarRespostaIA } = await import('@/lib/agente/gerar-resposta');
    return await gerarRespostaIA(supabaseClient as never, ORG_A, CONVERSA);
  } finally {
    http.restaurar();
  }
}

const FORMULARIO = (resposta: string) => '```json\n' + JSON.stringify({
  resposta, transferir_para_atendente: false, questionario_completo: false, respostas: [], resultado: 'nenhum',
}, null, 2) + '\n```';

describe('o resgate sem formulário', () => {
  test('não manda o modelo responder em JSON', async () => {
    await responderComResgate('Qual é o seu CPF ou CNPJ?');

    const original = String((http.chamadasAnthropic[0].corpo as { system?: string }).system);
    const resgate = String((http.chamadasAnthropic[3].corpo as { system?: string }).system);
    assert.match(original, /Responda em JSON/, 'a chamada normal continua pedindo o formulário');
    assert.doesNotMatch(resgate, /Responda em JSON/, 'sem formato estruturado, pedir JSON é pedir o formulário como texto');
    assert.match(resgate, /texto normal/);
  });

  test('entrega a mensagem quando o modelo escreve o formulário como texto mesmo assim', async () => {
    const r = await responderComResgate(FORMULARIO('Qual é o seu CPF ou CNPJ?'));

    assert.equal(r.resposta, 'Qual é o seu CPF ou CNPJ?');
  });

  test('recusa quando o campo resposta do formulário está vazio', async () => {
    await assert.rejects(
      responderComResgate(FORMULARIO('')),
      /não devolveu texto/,
      'sem mensagem dentro do formulário não há o que mandar ao cliente',
    );
  });
});

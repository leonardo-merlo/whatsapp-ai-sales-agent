// C2, a outra ponta: a conexão pelo Embedded Signup tem que **guardar** o
// business token do cliente.
//
// Este é o ponto sem segunda chance de todo o bloco C: a Meta entrega esse
// token uma única vez, na conexão. Se a rota descartar (era o que ela fazia),
// a única forma de tê-lo de volta é o cliente refazer o cadastro inteiro.
//
// O teste exercita `POST /api/whatsapp/connect` com o code que o pop-up da Meta
// devolveria, e confere que o token guardado é o que veio da troca — e que o
// número passa a enviar por ele.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco, type OpcoesBanco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const USUARIO = '99999999-9999-4999-8999-999999999999';
const MEMBRO = '88888888-8888-4888-8888-888888888888';
const NUMERO_NOVO = 'PHONE-NUMBER-ID-EXEMPLO';

let banco: Banco;
let http: HttpFalso;
let falharAoGuardar = false;

/** Mesma imitação do `token-do-cliente.test.ts`, reduzida ao que esta rota usa. */
const FUNCOES: OpcoesBanco['funcoes'] = {
  guardar_token_do_numero: (args, b) => {
    if (falharAoGuardar) throw new Error('Vault indisponível');
    const phoneNumberId = args.p_phone_number_id as string;
    const token = args.p_token as string;
    if (!token?.trim()) throw new Error('token vazio');
    const numero = (b.wa_numbers ?? []).find(n => n.phone_number_id === phoneNumberId);
    if (!numero) throw new Error(`número ${phoneNumberId} não está em wa_numbers`);
    const cofre = (b.vault ??= []);
    const id = `secret-${cofre.length + 1}`;
    cofre.push({ id, name: `wa_token_${phoneNumberId}`, decrypted_secret: token });
    numero.token_secret_id = id;
    return id;
  },
  token_do_numero: (args, b) => {
    const numero = (b.wa_numbers ?? []).find(n => n.phone_number_id === args.p_phone_number_id);
    if (!numero?.token_secret_id) return null;
    return (b.vault ?? []).find(s => s.id === numero.token_secret_id)?.decrypted_secret ?? null;
  },
};

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'TOKEN-DA-WAPPIA';
  process.env.NEXT_PUBLIC_WHATSAPP_APP_ID = 'app-de-teste';
  process.env.WHATSAPP_APP_SECRET = 'segredo-de-teste';
  delete process.env.WHATSAPP_REG_PIN;

  banco = cenarioBase();
  banco.vault = [];
  banco.organization_members.push({
    id: MEMBRO, organization_id: ORG_A, user_id: USUARIO, role: 'owner', nome: 'Dono', ativo: true,
  });

  const supabase = criarSupabaseFalso(banco, { ...INDICES_UNICOS, funcoes: FUNCOES }, { id: USUARIO });
  mock.module('@/lib/supabase/server', { namedExports: { createClient: async () => supabase.client } });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();
});

beforeEach(() => {
  falharAoGuardar = false;
  banco.vault = [];
  banco.wa_numbers = banco.wa_numbers.filter(n => n.phone_number_id !== NUMERO_NOVO);
  banco.wa_numbers.forEach(n => { n.token_secret_id = null; });
});

depois(() => http.restaurar());

function conectar(phoneNumberId: string) {
  return import('@/app/api/whatsapp/connect/route').then(({ POST }) =>
    POST(new Request('https://www.wappia.com.br/api/whatsapp/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'CODE-DO-POPUP', wabaId: 'WABA-DO-CLIENTE', phoneNumberId }),
    })),
  );
}

describe('conexão pelo Embedded Signup', () => {
  test('o business token do cliente é guardado, não descartado', async () => {
    const resposta = await conectar(NUMERO_NOVO);
    const corpo = await resposta.json() as { ok?: boolean; tokenGuardado?: boolean };

    assert.equal(resposta.status, 200);
    assert.equal(corpo.ok, true);
    assert.equal(corpo.tokenGuardado, true);
    assert.equal(banco.vault.length, 1);
    assert.equal(banco.vault[0].decrypted_secret, http.tokenDoEmbeddedSignup);
  });

  test('o token fica ligado ao número que acabou de ser conectado', async () => {
    await conectar(NUMERO_NOVO);

    const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_NOVO);
    assert.ok(numero, 'o número tinha que estar em wa_numbers');
    assert.equal(numero.token_secret_id, banco.vault[0].id);
  });

  test('o número conectado passa a enviar pelo token do cliente', async () => {
    await conectar(NUMERO_NOVO);
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    let bearer: string | undefined;
    const interceptado = globalThis.fetch;
    globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
      if (url.includes('/messages')) bearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '');
      return interceptado(entrada, init);
    }) as typeof fetch;

    try {
      await sendWhatsAppMessage(ORG_A, '5500900000001', 'oi', NUMERO_NOVO);
    } finally {
      globalThis.fetch = interceptado;
    }

    assert.equal(bearer, http.tokenDoEmbeddedSignup);
  });

  test('Vault fora do ar não desfaz a conexão, mas avisa que o token não foi guardado', async () => {
    falharAoGuardar = true;

    const resposta = await conectar(NUMERO_NOVO);
    const corpo = await resposta.json() as { ok?: boolean; tokenGuardado?: boolean };

    // A conexão está feita do lado da Meta; devolver erro faria o cliente
    // tentar de novo um cadastro que já existe.
    assert.equal(resposta.status, 200);
    assert.equal(corpo.ok, true);
    assert.equal(corpo.tokenGuardado, false);
    assert.equal(banco.vault.length, 0);
  });

  test('reconectar o número da demo guarda o token sem duplicar a linha', async () => {
    await conectar(NUMERO_A);

    assert.equal(banco.wa_numbers.filter(n => n.phone_number_id === NUMERO_A).length, 1);
    assert.equal(banco.vault.length, 1);
  });
});

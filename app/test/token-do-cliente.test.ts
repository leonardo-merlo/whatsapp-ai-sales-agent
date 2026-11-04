// C2: o business token do cliente, guardado no Vault e usado no envio.
//
// O que está em jogo: até aqui toda mensagem saía com o `WHATSAPP_ACCESS_TOKEN`,
// que é o token da Wappia. Isso funciona no número da própria Wappia; no número
// de um cliente (a Distribuidora Exemplo), quem autoriza é o business token que a Meta
// entrega uma única vez, no Embedded Signup — e o código jogava fora.
//
// O que os testes provam, e que não dá para conferir olhando: (1) o Bearer que
// sai na chamada à Graph API é o do dono do número; (2) número sem token
// guardado continua exatamente como antes, com o token da Wappia; (3) o Vault
// fora do ar não deixa o cliente sem resposta.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, NUMERO_A, NUMERO_B, ORG_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco, type OpcoesBanco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const TOKEN_DA_WAPPIA = 'TOKEN-DA-WAPPIA';
const TOKEN_DO_CLIENTE = 'TOKEN-DO-CLIENTE-EXEMPLO';

let banco: Banco;
let http: HttpFalso;
/** Liga o "Vault do teste" a um erro, para o caso de leitura falhando. */
let vaultQuebrado = false;
/** Authorization da última chamada à Graph API — é o que este teste inspeciona. */
let ultimoBearer: string | undefined;

/**
 * Imitação das duas funções da migration `20260913000001`. Mora aqui, ao lado
 * do teste, para ficar evidente quando a função do banco mudar e esta não.
 */
const FUNCOES: OpcoesBanco['funcoes'] = {
  guardar_token_do_numero: (args, b) => {
    const phoneNumberId = args.p_phone_number_id as string;
    const token = args.p_token as string;
    if (!token?.trim()) throw new Error('token vazio');
    const numero = (b.wa_numbers ?? []).find(n => n.phone_number_id === phoneNumberId);
    if (!numero) throw new Error(`número ${phoneNumberId} não está em wa_numbers`);
    const cofre = (b.vault ??= []);
    const nome = `wa_token_${phoneNumberId}`;
    const existente = cofre.find(s => s.name === nome);
    const id = (existente?.id as string) ?? `secret-${cofre.length + 1}`;
    if (existente) existente.decrypted_secret = token;
    else cofre.push({ id, name: nome, decrypted_secret: token });
    numero.token_secret_id = id;
    numero.token_atualizado_em = new Date().toISOString();
    return id;
  },
  token_do_numero: (args, b) => {
    if (vaultQuebrado) throw new Error('Vault indisponível');
    const numero = (b.wa_numbers ?? []).find(n => n.phone_number_id === args.p_phone_number_id);
    if (!numero?.token_secret_id) return null;
    return (b.vault ?? []).find(s => s.id === numero.token_secret_id)?.decrypted_secret ?? null;
  },
};

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = TOKEN_DA_WAPPIA;
  banco = cenarioBase();
  banco.vault = [];
  const supabase = criarSupabaseFalso(banco, { ...INDICES_UNICOS, funcoes: FUNCOES });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => supabase.client } });
  http = instalarHttpFalso();

  // O dublê de HTTP guarda corpo e URL, não cabeçalhos. Aqui ele é envolvido só
  // para anotar o Authorization, que é o que muda neste item.
  const interceptado = globalThis.fetch;
  globalThis.fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.includes('graph.facebook.com')) {
      ultimoBearer = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '');
    }
    return interceptado(entrada, init);
  }) as typeof fetch;
});

beforeEach(() => {
  vaultQuebrado = false;
  banco.vault = [];
  banco.wa_numbers.forEach(n => { n.token_secret_id = null; n.token_atualizado_em = null; });
  http.chamadasWhatsApp.length = 0;
  ultimoBearer = undefined;
});

depois(() => http.restaurar());

describe('token de envio por número', () => {
  test('número com token do cliente envia com o token dele', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await guardarTokenDoCliente(NUMERO_A, TOKEN_DO_CLIENTE);
    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A);

    assert.equal(ultimoBearer, TOKEN_DO_CLIENTE);
    assert.equal(http.chamadasWhatsApp.length, 1);
  });

  test('número sem token guardado continua com o token da Wappia', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A);

    assert.equal(ultimoBearer, TOKEN_DA_WAPPIA);
  });

  test('o token é por número: o de um não vale para o outro', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await guardarTokenDoCliente(NUMERO_A, TOKEN_DO_CLIENTE);
    await sendWhatsAppMessage(ORG_A, '5511900000002', 'oi', NUMERO_B);

    assert.equal(ultimoBearer, TOKEN_DA_WAPPIA);
  });

  test('reconexão troca o token, sem criar um segredo novo', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await guardarTokenDoCliente(NUMERO_A, TOKEN_DO_CLIENTE);
    await guardarTokenDoCliente(NUMERO_A, 'TOKEN-NOVO');
    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A);

    assert.equal(ultimoBearer, 'TOKEN-NOVO');
    assert.equal(banco.vault.length, 1);
  });

  test('Vault fora do ar não deixa o cliente sem resposta: cai no token da Wappia', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');

    await guardarTokenDoCliente(NUMERO_A, TOKEN_DO_CLIENTE);
    vaultQuebrado = true;
    await sendWhatsAppMessage(ORG_A, '5511900000001', 'oi', NUMERO_A);

    assert.equal(ultimoBearer, TOKEN_DA_WAPPIA);
    assert.equal(http.chamadasWhatsApp.length, 1);
  });

  test('token vazio é recusado antes de virar segredo', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');

    await assert.rejects(() => guardarTokenDoCliente(NUMERO_A, '   '), /token vazio/);
    assert.equal(banco.vault.length, 0);
  });

  test('número que não está em wa_numbers não guarda token', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');

    await assert.rejects(() => guardarTokenDoCliente('PN-INEXISTENTE', 'tok'), /não está em wa_numbers/);
  });
});

describe('template também sai pelo token do dono do número', () => {
  test('o Bearer do envio de template é o do cliente', async () => {
    const { guardarTokenDoCliente } = await import('@/lib/whatsapp/token-do-cliente');
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/send-message');

    await guardarTokenDoCliente(NUMERO_A, TOKEN_DO_CLIENTE);
    await sendWhatsAppTemplate(
      ORG_A,
      '5511900000001',
      { nome: 'lembrete_agendamento', variaveis: ['Ana', 'Corte', '14/09', '10:00'] },
      NUMERO_A,
    );

    assert.equal(ultimoBearer, TOKEN_DO_CLIENTE);
  });
});

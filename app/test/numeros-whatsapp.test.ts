// C4: a tela que diz de quem é cada número.
//
// A regra que não é óbvia e que o teste protege: o dono é apagado quando o
// papel deixa de ser vendedor. Número de atendimento ou copiloto é da empresa,
// e um dono pendurado ali faria a visibilidade por vendedor (bloco C) esconder
// conversa de quem deveria ver — um bug que só apareceria semanas depois, na
// tela de outra pessoa.

import { describe, test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, WA_NUMBER_A } from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { listarNumerosWhatsApp, salvarNumeroWhatsApp } from '../src/lib/data/numeros-whatsapp.ts';

const MEMBRO_JOAO = '77777777-7777-4777-8777-777777777777';

let banco: Banco;
// O módulo recebe o client por parâmetro, então o dublê entra direto — sem
// mock de módulo e sem webhook no caminho.
let client: Parameters<typeof listarNumerosWhatsApp>[0];

before(() => {
  banco = cenarioBase();
  client = criarSupabaseFalso(banco, INDICES_UNICOS).client as typeof client;
});

beforeEach(() => {
  const numero = banco.wa_numbers.find(n => n.phone_number_id === NUMERO_A)!;
  numero.papel = 'atendimento';
  numero.member_id = null;
  numero.ativo = true;
  numero.coexistencia = false;
  numero.token_secret_id = null;
});

describe('números da organização', () => {
  test('lista só os da própria organização', async () => {
    const lista = await listarNumerosWhatsApp(client, ORG_A);

    assert.equal(lista.length, 1);
    assert.equal(lista[0].phoneNumberId, NUMERO_A);
  });

  test('a credencial própria aparece como sim/não, nunca como o token', async () => {
    const antes = await listarNumerosWhatsApp(client, ORG_A);
    assert.equal(antes[0].temCredencialPropria, false);

    banco.wa_numbers.find(n => n.id === WA_NUMBER_A)!.token_secret_id = 'secret-1';
    const depois = await listarNumerosWhatsApp(client, ORG_A);

    assert.equal(depois[0].temCredencialPropria, true);
    // O objeto que chega no navegador não pode carregar o segredo nem o id dele.
    assert.equal(JSON.stringify(depois).includes('secret-1'), false);
  });

  test('número de vendedor guarda o dono', async () => {
    await salvarNumeroWhatsApp(client, WA_NUMBER_A, { papel: 'vendedor', memberId: MEMBRO_JOAO, ativo: true });

    const numero = banco.wa_numbers.find(n => n.id === WA_NUMBER_A)!;
    assert.equal(numero.papel, 'vendedor');
    assert.equal(numero.member_id, MEMBRO_JOAO);
  });

  test('virando atendimento ou copiloto, o dono é apagado', async () => {
    await salvarNumeroWhatsApp(client, WA_NUMBER_A, { papel: 'vendedor', memberId: MEMBRO_JOAO, ativo: true });
    await salvarNumeroWhatsApp(client, WA_NUMBER_A, { papel: 'copiloto', memberId: MEMBRO_JOAO, ativo: true });

    const numero = banco.wa_numbers.find(n => n.id === WA_NUMBER_A)!;
    assert.equal(numero.papel, 'copiloto');
    assert.equal(numero.member_id, null);
  });

  test('desativar não apaga o número nem o papel dele', async () => {
    await salvarNumeroWhatsApp(client, WA_NUMBER_A, { papel: 'vendedor', memberId: MEMBRO_JOAO, ativo: false });

    const numero = banco.wa_numbers.find(n => n.id === WA_NUMBER_A)!;
    assert.equal(numero.ativo, false);
    assert.equal(numero.papel, 'vendedor');
    assert.equal(banco.wa_numbers.length, 2);
  });
});

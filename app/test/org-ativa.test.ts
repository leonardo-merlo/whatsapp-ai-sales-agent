// C5: um mesmo login em mais de uma organização.
//
// O que estava quebrado não era "faltava a funcionalidade": era pior. Toda
// resolução de organização fazia `.maybeSingle()` em `organization_members`
// filtrando só por usuário. Com DOIS vínculos o PostgREST devolve erro, o
// resultado vira nulo e a pessoa é tratada como se não tivesse organização
// nenhuma — ou seja, entrar numa segunda empresa fazia perder o acesso à
// primeira.
//
// O cookie escolhe entre os vínculos que o banco confirma. Ele nunca é
// acreditado sozinho: id de uma empresa em que a pessoa não está cai no padrão.

import { describe, test, before, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';

const ORG_PROPRIA = '11111111-1111-4111-8111-111111111111';
const ORG_CLIENTE = '22222222-2222-4222-8222-222222222222';
const ORG_DE_OUTRO = '33333333-3333-4333-8333-333333333333';
const USUARIO = '99999999-9999-4999-8999-999999999999';

let banco: Banco;
let client: never;
/** O que o cookie `wappia_org` vale em cada caso do teste. */
let cookieOrg: string | undefined;

before(() => {
  mock.module('next/headers', {
    namedExports: {
      cookies: async () => ({ get: (nome: string) => (nome === 'wappia_org' && cookieOrg ? { value: cookieOrg } : undefined) }),
    },
  });
});

beforeEach(() => {
  cookieOrg = undefined;
  banco = {
    organizations: [
      { id: ORG_PROPRIA, nome: 'Wappia Demo LTDA', nome_fantasia: 'Wappia Demo', segmento: 'outro' },
      { id: ORG_CLIENTE, nome: 'Distribuidora Exemplo Comercio LTDA', nome_fantasia: 'Distribuidora Exemplo', segmento: 'outro' },
      { id: ORG_DE_OUTRO, nome: 'Empresa de Terceiro', nome_fantasia: 'Terceiro', segmento: 'outro' },
    ],
    organization_members: [
      { id: 'm1', organization_id: ORG_PROPRIA, user_id: USUARIO, role: 'owner', nome: 'Leonardo', ativo: true, created_at: '2026-01-01T00:00:00Z' },
      { id: 'm2', organization_id: ORG_CLIENTE, user_id: USUARIO, role: 'atendente', nome: 'Leonardo', ativo: true, created_at: '2026-09-01T00:00:00Z' },
      { id: 'm3', organization_id: ORG_DE_OUTRO, user_id: 'outro-usuario', role: 'owner', nome: 'Alguém', ativo: true, created_at: '2026-01-01T00:00:00Z' },
    ],
  };
  client = criarSupabaseFalso(banco).client as never;
});

async function ativa() {
  const { membroAtivo } = await import('@/lib/data/org-ativa');
  return membroAtivo(client, USUARIO);
}

describe('organização ativa', () => {
  test('sem cookie, vale o vínculo mais antigo', async () => {
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_PROPRIA);
    assert.equal(m?.role, 'owner');
  });

  test('com cookie, vale a organização escolhida — e o papel é o dela', async () => {
    cookieOrg = ORG_CLIENTE;
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_CLIENTE);
    // O mesmo login é dono numa empresa e atendente na outra. O papel não pode
    // vazar de uma para a outra: é ele que decide o que a pessoa vê na tela.
    assert.equal(m?.role, 'atendente');
  });

  test('cookie de organização em que o usuário não está cai no padrão', async () => {
    cookieOrg = ORG_DE_OUTRO;
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_PROPRIA);
  });

  test('cookie com lixo cai no padrão, sem quebrar', async () => {
    cookieOrg = 'nao-e-nem-uuid';
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_PROPRIA);
  });

  test('a lista para a troca traz as duas empresas, e só as do usuário', async () => {
    const m = await ativa();

    assert.deepEqual(m?.vinculos.map(v => v.orgNome), ['Wappia Demo', 'Distribuidora Exemplo']);
  });

  test('quem tem uma organização só continua como sempre foi', async () => {
    banco.organization_members = banco.organization_members.filter(v => v.id !== 'm2');
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_PROPRIA);
    assert.equal(m?.vinculos.length, 1);
  });

  test('sem vínculo nenhum, devolve nulo (a tela manda para o cadastro)', async () => {
    banco.organization_members = banco.organization_members.filter(v => v.user_id !== USUARIO);

    assert.equal(await ativa(), null);
  });

  test('vínculo desativado não conta', async () => {
    banco.organization_members.find(v => v.id === 'm2')!.ativo = false;
    cookieOrg = ORG_CLIENTE;
    const m = await ativa();

    assert.equal(m?.organizationId, ORG_PROPRIA);
    assert.equal(m?.vinculos.length, 1);
  });
});

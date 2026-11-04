// S4: o convite para a equipe sai por e-mail, com o link de cadastro.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { montarEmailDeConvite } from '../src/lib/email/convite.ts';

const BASE = { para: 'ana@clinica.com.br', nomeDoConvidado: 'Ana', nomeDaEmpresa: 'Clínica Exemplo', appUrl: 'https://www.wappia.com.br/' };

describe('e-mail de convite', () => {
  test('leva o link de cadastro do Wappia', () => {
    assert.match(montarEmailDeConvite(BASE).html, /href="https:\/\/www\.wappia\.com\.br\/cadastro"/);
  });

  test('não põe o e-mail do convidado na URL', () => {
    const href = montarEmailDeConvite(BASE).html.match(/href="([^"]+)"/)?.[1] ?? '';
    assert.ok(!href.includes('ana'));
  });

  test('escapa o nome digitado pelo admin', () => {
    assert.ok(!montarEmailDeConvite({ ...BASE, nomeDoConvidado: '<script>x</script>' }).html.includes('<script>'));
  });

  test('o assunto diz de qual empresa é o convite', () => {
    assert.equal(montarEmailDeConvite(BASE).subject, 'Convite para a equipe de Clínica Exemplo no Wappia');
  });
});

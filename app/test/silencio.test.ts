// Quando a IA de vendas pode ficar calada. O caso que originou a regra: em
// 21/09 ela calou em "quero um orçamento", na conversa de teste do Leonardo.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { silencioPermitido } from '@/lib/agente/silencio';
import { pareceFormularioCru } from '@/lib/agente/gerar-resposta';

const base = { ultimaFalaDaIa: null, minutosDesdeAFalaDaIa: null, usouFerramenta: false };

describe('o silêncio da IA de vendas', () => {
  test('vale num bom dia solto', () => {
    assert.equal(silencioPermitido({ ...base, falaDoCliente: 'bom dia' }), true);
  });

  test('não vale quando o cliente pede orçamento', () => {
    assert.equal(silencioPermitido({ ...base, falaDoCliente: 'quero um orçamento' }), false);
  });

  test('não vale quando o cliente manda um CNPJ', () => {
    assert.equal(silencioPermitido({ ...base, falaDoCliente: '45.723.174/0001-10' }), false);
  });

  test('não vale quando a IA usou ferramenta nesta resposta', () => {
    assert.equal(silencioPermitido({ ...base, falaDoCliente: 'ok', usouFerramenta: true }), false);
  });

  test('não vale quando o cliente responde uma pergunta recente da IA', () => {
    assert.equal(silencioPermitido({
      ...base, falaDoCliente: 'sim', ultimaFalaDaIa: 'Achei aqui: ACME. É esse mesmo?', minutosDesdeAFalaDaIa: 2,
    }), false);
  });

  test('vale num bom dia bem depois de uma pergunta antiga', () => {
    assert.equal(silencioPermitido({
      ...base, falaDoCliente: 'bom dia', ultimaFalaDaIa: 'É esse mesmo?', minutosDesdeAFalaDaIa: 15,
    }), true);
  });
});

describe('o formulário nunca vai ao cliente', () => {
  test('reconhece o JSON entre crases que saiu em 21/09', () => {
    assert.equal(pareceFormularioCru('```json\n{\n  "resposta": "",\n  "transferir_para_atendente": false'), true);
  });

  test('não confunde uma mensagem normal com formulário', () => {
    assert.equal(pareceFormularioCru('Qual é o CPF ou CNPJ de quem vai comprar?'), false);
  });
});

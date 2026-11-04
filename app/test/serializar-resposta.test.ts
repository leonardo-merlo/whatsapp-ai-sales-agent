// A fase 2 do conserto do erro 500: o serializador não pode reescrever a
// mensagem do cliente, e o pedido dele não pode levar nada que dispare o 500.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {
  lerSaidaDoSerializador,
  pedidoDoSerializador,
  textoParaOCliente,
} from '@/lib/agente/serializar-resposta';

const ORIGINAL = 'Achei seu cadastro, WAPPIA TESTE LTDA. Quantas barras de 12.5 você precisa?';

function mensagem(texto: string): Anthropic.Message {
  return { content: [{ type: 'text', text: texto }] } as unknown as Anthropic.Message;
}

describe('a cópia da mensagem', () => {
  test('usa a cópia quando ela é idêntica ao original', () => {
    assert.deepEqual(textoParaOCliente(ORIGINAL, ORIGINAL), { texto: ORIGINAL, usouACopia: true });
  });

  test('descarta a cópia que trocou uma palavra e usa o original', () => {
    const reescrita = ORIGINAL.replace('Quantas barras', 'Quantos metros');
    assert.equal(textoParaOCliente(ORIGINAL, reescrita).texto, ORIGINAL);
  });

  test('descarta a cópia picada, que é o artefato da saída estruturada', () => {
    const picada = 'Ach ei seu ca das tro, WAPPIA TESTE LTDA. Qua nt as bar ras de 12.5 vo cê precisa?';
    assert.equal(textoParaOCliente(ORIGINAL, picada).usouACopia, false);
  });

  test('cópia vazia ou ausente cai no original', () => {
    assert.equal(textoParaOCliente(ORIGINAL, '').texto, ORIGINAL);
  });
});

describe('o pedido da fase 2', () => {
  const pedido = pedidoDoSerializador('claude-haiku-4-5', {
    falaDoCliente: 'meu cnpj é 45.723.174/0001-10', mensagemDaFase1: ORIGINAL, fichaAtual: [],
  });

  test('não leva ferramentas nem escolha de ferramenta', () => {
    assert.equal('tools' in pedido || 'tool_choice' in pedido, false);
  });

  test('a conversa é uma mensagem de texto só, sem bloco de ferramenta', () => {
    assert.deepEqual(pedido.messages.map(m => typeof m.content), ['string']);
  });

  test('não reenvia o system prompt do agente: o dele é curto', () => {
    assert.ok(String(pedido.system).length < 1500);
  });
});

describe('a leitura da saída', () => {
  test('JSON quebrado não lança, devolve nulo', () => {
    assert.equal(lerSaidaDoSerializador(mensagem('{"mensagem_cliente_ver')), null);
  });

  test('lê a cópia e a ficha', () => {
    const saida = lerSaidaDoSerializador(mensagem(JSON.stringify({
      mensagem_cliente_verbatim: ORIGINAL,
      atualizacao_perfil: { preferencias: [], dados_chave: [{ rotulo: 'CNPJ', valor: '45723174000110' }], ultimo_interesse: 'vergalhão 12.5', observacoes: '' },
    })));
    assert.equal(saida?.perfil.ultimo_interesse, 'vergalhão 12.5');
  });
});

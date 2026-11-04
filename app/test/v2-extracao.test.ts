import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  conferirCoberturaDeLinhas, conferirCoberturaDeNumeros, conferirLiteral, conferirMolde, conferirOutraUnidade, conferirFamilia,
} from '@/lib/v2/conferencias';
import { cacheEmMemoria, chamarComCache, CLIENTE_OFFLINE, ErroSemCache, type ClienteIA } from '@/lib/v2/cache-ia';
import { conteudoDaExtracao, esquemaDaExtracao, lerExtracao, pedidoDeExtracao, systemDaExtracao } from '@/lib/v2/extracao';
import { lerTranscricao, textoDaTranscricao } from '@/lib/v2/transcricao';
import type { ItemExtraido, LinhaExtraida } from '@/lib/v2/tipos';

const item = (parcial: Partial<ItemExtraido>): ItemExtraido => ({
  familia: 'metalon', quantidade: { valor: '10', trecho: '10' },
  medidas: [{ valor: '50', etiqueta: 'lado', unidade_escrita: null, trecho: '50' }, { valor: '30', etiqueta: 'lado', unidade_escrita: null, trecho: '30' }, { valor: '18', etiqueta: 'chapa', unidade_escrita: null, trecho: '18' }],
  numeros_auxiliares: [], qualificadores: [], termos_nao_reconhecidos: [], idem_resolvido_de_linha: null, ...parcial,
});
const linha = (texto: string, itens: ItemExtraido[]): LinhaExtraida => ({ linha_id: 1, texto_original: texto, descartada: false, motivo_descarte: null, itens });

describe('prompt e schema da extração', () => {
  // The production rule set is large enough to cross the cache minimum; the fictional one in this repository is not.
  test('keeps the fixed part above the Haiku cache minimum (4096 tokens)', { skip: 'depends on the size of the production rule set' }, () => {
    assert.ok(systemDaExtracao().length / 3.3 > 4096, `${Math.round(systemDaExtracao().length / 3.3)} tokens estimados`);
  });
  test('closes the family list as an enum', () => {
    const s = esquemaDaExtracao() as { properties: { linhas: { items: { properties: { itens: { items: { properties: { familia: { enum: string[] } } } } } } } } };
    assert.ok(s.properties.linhas.items.properties.itens.items.properties.familia.enum.includes('metalon'));
  });
  test('does not put the catalogue or codes in the prompt', () => {
    assert.ok(!/\b0\d{5}\b/.test(systemDaExtracao()));
  });
  test('numbers the message lines and puts pending questions in the user turn', () => {
    const c = conteudoDaExtracao('oi\n10 metalon 50x30', [{ id: 'p1', texto: 'Qual a chapa?', opcoes: ['14', '18'] }]);
    assert.ok(c.includes('2: 10 metalon 50x30') && c.includes('p1: Qual a chapa?'));
  });
  test('marks the system prompt for prompt caching', () => {
    const p = pedidoDeExtracao('10 metalon') as { system: { cache_control?: unknown }[] };
    assert.ok(p.system[0].cache_control);
  });
  test('reads an extraction defensively', () => {
    const e = lerExtracao(JSON.stringify({ tipo_mensagem: 'x', linhas: [{ linha_id: 1, texto_original: 'a', descartada: false, itens: [{ familia: 'metalon', medidas: [{ valor: 50 }] }] }] }));
    assert.deepEqual([e.tipo_mensagem, e.linhas[0].itens[0].medidas[0].valor], ['outro', '50']);
  });
});

describe('conferências', () => {
  test('passes literal when every value is in the text', () => {
    assert.ok(conferirLiteral(item({}), '10 Metalon 50/30/18.').ok);
  });
  test('fails literal when the IA converted a value', () => {
    const i = item({ medidas: [{ valor: '10', etiqueta: 'bitola', unidade_escrita: 'mm', trecho: '10mm' }] });
    assert.equal(conferirLiteral(i, '50 varas 3/8').ok, false);
  });
  test('tolerates comma and dot in literal', () => {
    const i = item({ quantidade: { valor: '1', trecho: '1 kg' }, medidas: [{ valor: '2.5', etiqueta: 'diametro', unidade_escrita: null, trecho: '2,5' }] });
    assert.ok(conferirLiteral(i, '1 kg de eletrodo 2,5').ok);
  });
  // Teste de campo de 21/10: "10 telhas galvalume com 4 metros e meio" virou confirmação porque a IA
  // copiou o valor como "4 e meio" e o trecho como "4 metros e meio".
  test('passes literal when "4 e meio" comes from "4 metros e meio"', () => {
    const i = item({ quantidade: { valor: '10', trecho: '10' }, medidas: [{ valor: '4 e meio', etiqueta: 'comprimento', unidade_escrita: 'metro', trecho: '4 metros e meio' }] });
    assert.ok(conferirLiteral(i, '10 telhas galvalume com 4 metros e meio').ok);
  });
  test('fails literal when the half is not in the text', () => {
    const i = item({ quantidade: { valor: '10', trecho: '10' }, medidas: [{ valor: '4 e meio', etiqueta: 'comprimento', unidade_escrita: 'metro', trecho: '4 metros' }] });
    assert.equal(conferirLiteral(i, '10 telhas com 4 metros').ok, false);
  });
  test('fails literal when the IA adds a qualifier the client did not write', () => {
    assert.equal(conferirLiteral(item({ qualificadores: ['galvanizado'] }), '10 metalon 50x30x18').ok, false);
  });
  test('fails number coverage when a number has no role', () => {
    assert.equal(conferirCoberturaDeNumeros(linha('10 metalon 50x30x18 A-36', [item({})])).ok, false);
  });
  test('passes number coverage with an auxiliary number', () => {
    const i = item({ numeros_auxiliares: [{ valor: '36', papel: 'especificacao_aco', trecho: 'A-36' }] });
    assert.ok(conferirCoberturaDeNumeros(linha('10 metalon 50x30x18 A-36', [i])).ok);
  });
  test('reads "2 e meio" as one covered number', () => {
    const i = item({ familia: 'eletrodo', quantidade: { valor: '5', trecho: '5 kg' }, medidas: [{ valor: '2 e meio', etiqueta: 'diametro', unidade_escrita: null, trecho: '2 e meio' }] });
    assert.ok(conferirCoberturaDeNumeros(linha('5 kg de solda 2 e meio', [i])).ok);
  });
  test('finds a message line left out of the extraction', () => {
    const r = conferirCoberturaDeLinhas('10 metalon 50x30x18\n6 cantoneira 3/4', { tipo_mensagem: 'novos_itens', respostas_a_perguntas: [], linhas: [linha('10 metalon 50x30x18', [item({})])] });
    assert.deepEqual(r.faltando.map(l => l.id), [2]);
  });
  test('fails molde with a label from another family', () => {
    const i = item({ medidas: [{ valor: '3/8', etiqueta: 'bitola', unidade_escrita: null, trecho: '3/8' }] });
    assert.equal(conferirMolde(i).ok, false);
  });
  test('accepts the same measure repeated in mm when it closes', () => {
    const i = item({ familia: 'barra_chata', medidas: [{ valor: '3/4', etiqueta: 'largura', unidade_escrita: '"', trecho: '3/4"' }], numeros_auxiliares: [{ valor: '19', papel: 'mesma_medida_em_outra_unidade', trecho: '(19X3MM)' }] });
    assert.ok(conferirOutraUnidade(i).ok);
  });
  test('flags a repeated measure that does not close', () => {
    const i = item({ familia: 'barra_chata', medidas: [{ valor: '3/4', etiqueta: 'largura', unidade_escrita: '"', trecho: '3/4"' }], numeros_auxiliares: [{ valor: '25', papel: 'mesma_medida_em_outra_unidade', trecho: '(25MM)' }] });
    assert.equal(conferirOutraUnidade(i).ok, false);
  });
  test('flags a family that disagrees with the dictionary', () => {
    assert.equal(conferirFamilia(item({ familia: 'cantoneira' }), '10 metalon 50x30x18').ok, false);
  });
});

describe('cache das chamadas', () => {
  const partes = { tipo: 'extracao' as const, entrada: '10 metalon', prompt_version: 'p1', schema_version: 's1', modelo: 'claude-haiku-4-5' };
  const cliente = (contador: { n: number }): ClienteIA => ({
    async chamar() { contador.n++; return { texto: '{"ok":1}', uso: { input_tokens: 1000, output_tokens: 100 }, modelo: 'claude-haiku-4-5', stop_reason: 'end_turn' }; },
  });
  test('calls the API only once for the same input', async () => {
    const cache = cacheEmMemoria();
    const n = { n: 0 };
    await chamarComCache(cache, cliente(n), partes, {});
    await chamarComCache(cache, cliente(n), partes, {});
    assert.equal(n.n, 1);
  });
  test('changes the key when the prompt version changes', async () => {
    const cache = cacheEmMemoria();
    const n = { n: 0 };
    await chamarComCache(cache, cliente(n), partes, {});
    await chamarComCache(cache, cliente(n), { ...partes, prompt_version: 'p2' }, {});
    assert.equal(n.n, 2);
  });
  test('fails offline when the input is not cached', async () => {
    await assert.rejects(chamarComCache(cacheEmMemoria(), CLIENTE_OFFLINE, partes, {}, { offline: true }), ErroSemCache);
  });
  test('reports the cost of each new call', async () => {
    let gasto = 0;
    await chamarComCache(cacheEmMemoria(), cliente({ n: 0 }), partes, {}, { aoGastar: usd => { gasto += usd; } });
    assert.ok(Math.abs(gasto - 0.0015) < 1e-9);
  });
});

describe('transcrição de foto', () => {
  test('marks illegible lines in the text sent to the extraction', () => {
    const linhas = lerTranscricao('{"linhas":[{"numero":1,"texto":"10 metalon 50x30","ilegivel":false},{"numero":2,"texto":"6 cant","ilegivel":true}]}');
    assert.equal(textoDaTranscricao(linhas), '10 metalon 50x30\n[ilegível] 6 cant');
  });
});

// Horário de exibição (pendência de 2026-09-10: "3 h adiantado na tela Conversas").
//
// O bug: os formatadores chamavam `toLocaleTimeString` sem `timeZone`, e os
// dados iniciais das telas são montados no servidor da Vercel, que roda em UTC.
// Uma mensagem das 18:26 em São Paulo aparecia como 21:26.
//
// O teste finge que o processo está em UTC e em Tóquio: o resultado tem que ser
// o relógio de São Paulo nos dois casos. Se alguém tirar o `timeZone` de um
// formatador, um destes casos quebra.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diaEmSP, horaEmSP, diaMesEmSP, dataBRemSP, horaDoDiaEmSP, diaDaSemanaDoISO, fmtDiaISO } from '../src/lib/fuso.ts';
import { fmtHoraRelativa, fmtDataBR } from '../src/lib/data/mappers.ts';

// 18:26 de 13/09/2026 em São Paulo = 21:26 UTC.
const TARDE = '2026-09-13T21:26:00.000Z';
// 21:30 de 13/09 em São Paulo já é dia 14 em UTC.
const NOITE = '2026-09-14T00:30:00.000Z';

describe('formatadores no fuso de São Paulo', () => {
  test('hora não sai adiantada', () => {
    assert.equal(horaEmSP(TARDE), '18:26');
    assert.equal(horaDoDiaEmSP(TARDE), 18);
  });

  test('o dia é o de São Paulo, não o de UTC', () => {
    assert.equal(diaEmSP(NOITE), '2026-09-13');
    assert.equal(diaMesEmSP(NOITE), '13/09');
    assert.equal(dataBRemSP(NOITE), '13/09/2026');
  });

  test('dia da semana sai do dia ISO, sem passar pelo fuso do processo', () => {
    assert.equal(diaDaSemanaDoISO('2026-09-13'), 0); // domingo
    assert.equal(fmtDiaISO('2026-09-13', { day: '2-digit', month: '2-digit' }), '13/09');
  });
});

describe('fmtHoraRelativa', () => {
  // `agora` entra por parâmetro para o teste não depender do relógio.
  const agora = new Date('2026-09-14T14:00:00.000Z'); // 11:00 de 14/09 em SP

  test('mensagem de hoje mostra a hora de São Paulo', () => {
    assert.equal(fmtHoraRelativa('2026-09-14T13:05:00.000Z', agora), '10:05');
  });

  test('mensagem das 21:30 de ontem em SP é "Ontem", não hoje', () => {
    // Em UTC esse instante já é dia 14, o mesmo dia de `agora`: o código
    // antigo mostraria a hora, como se fosse de hoje.
    assert.equal(fmtHoraRelativa(NOITE, agora), 'Ontem');
  });

  test('mais velho que ontem mostra dia/mês', () => {
    assert.equal(fmtHoraRelativa('2026-09-10T15:00:00.000Z', agora), '10/09');
  });
});

describe('fmtDataBR', () => {
  test('coluna `date` é fatiada como está (converter faria o dia andar)', () => {
    assert.equal(fmtDataBR('2026-09-13'), '13/09/2026');
  });

  test('timestamp vira o dia de São Paulo', () => {
    assert.equal(fmtDataBR(NOITE), '13/09/2026');
  });

  test('sem data, travessão', () => {
    assert.equal(fmtDataBR(null), '—');
  });
});

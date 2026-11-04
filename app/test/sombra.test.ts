// A máquina de estados do orçamento em SOMBRA (fase 1 do spec de 21/09).
//
// Função pura: etapa e eventos entram, etapa sai. Por isso aqui o teste é
// unitário, uma transição por teste, como pede o spec da máquina. As
// divergências também são puras: cada uma tem um caso que dispara e um que não.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  divergencias, eventosDaExecucao, proximaEtapaSombra,
  type ChamadaErpDaExecucao, type EventoSombra,
} from '@/lib/agente/rastreio/sombra';
import { documentosCitados } from '@/lib/agente/documento-na-mensagem';

const CNPJ_A = '45723174000110';
const CNPJ_B = '11222333000181';

const doc = (documento: string): EventoSombra => ({ tipo: 'documento', documento });

describe('proximaEtapaSombra: uma transição, um teste', () => {
  test('T1: sem orçamento ativo, o cliente pede → aguardando_documento', () => {
    assert.equal(proximaEtapaSombra(null, [{ tipo: 'pediu_orcamento' }]).depois, 'aguardando_documento');
  });

  test('T2: aguardando_documento + documento válido → consultando_cadastro', () => {
    assert.equal(proximaEtapaSombra('aguardando_documento', [doc(CNPJ_A)]).depois, 'consultando_cadastro');
  });

  test('T3: consultando_cadastro + ERP encontrou → cadastro_concluido (escopo até o cadastro)', () => {
    const r = proximaEtapaSombra('consultando_cadastro', [{ tipo: 'erp_consulta', resultado: 'encontrado' }]);
    assert.equal(r.depois, 'cadastro_concluido');
  });

  test('T4: consultando_cadastro + ERP não encontrou → coletando_cadastro', () => {
    const r = proximaEtapaSombra('consultando_cadastro', [{ tipo: 'erp_consulta', resultado: 'nao_encontrado' }]);
    assert.equal(r.depois, 'coletando_cadastro');
  });

  test('T6 + T8: coletando_cadastro + cadastro criado → cadastro_concluido, passando por criando_cadastro', () => {
    const r = proximaEtapaSombra('coletando_cadastro', [{ tipo: 'erp_cadastro', resultado: 'criado' }]);
    assert.deepEqual([r.depois, r.transicoes], ['cadastro_concluido', ['T6', 'T8']]);
  });

  test('T6 + T9: cadastro recusado por campo → volta a coletando_cadastro', () => {
    const r = proximaEtapaSombra('coletando_cadastro', [{ tipo: 'erp_cadastro', resultado: 'recusado' }]);
    assert.deepEqual([r.depois, r.transicoes], ['coletando_cadastro', ['T6', 'T9']]);
  });

  test('T6 + T7: documento já cadastrado → consultando_cadastro', () => {
    const r = proximaEtapaSombra('coletando_cadastro', [{ tipo: 'erp_cadastro', resultado: 'ja_existe' }]);
    assert.deepEqual([r.depois, r.transicoes], ['consultando_cadastro', ['T6', 'T7']]);
  });

  test('X1: documento diferente numa etapa de coleta → consultando_cadastro', () => {
    const r = proximaEtapaSombra('coletando_cadastro', [doc(CNPJ_B)]);
    assert.deepEqual([r.depois, r.transicoes], ['consultando_cadastro', ['X1']]);
  });

  test('uma mensagem atravessa várias etapas (A2): pedido, documento e consulta na mesma execução', () => {
    const r = proximaEtapaSombra(null, [
      { tipo: 'pediu_orcamento' }, doc(CNPJ_A), { tipo: 'erp_consulta', resultado: 'encontrado' },
    ]);
    assert.deepEqual(r.visitadas, ['aguardando_documento', 'consultando_cadastro', 'cadastro_concluido']);
  });

  test('ERP que falhou não move a etapa (X5 fica fora do escopo coberto)', () => {
    const r = proximaEtapaSombra('consultando_cadastro', [{ tipo: 'erp_consulta', resultado: 'falhou' }]);
    assert.deepEqual([r.depois, r.transicoes], ['consultando_cadastro', ['X5_ignorado']]);
  });

  test('sem evento, a etapa fica onde estava', () => {
    assert.equal(proximaEtapaSombra('aguardando_documento', []).depois, 'aguardando_documento');
  });

  test('sem orçamento e sem pedido, nada nasce', () => {
    assert.equal(proximaEtapaSombra(null, [doc(CNPJ_A)]).depois, null);
  });

  test('limite de segurança: no máximo 6 transições por execução', () => {
    const eventos: EventoSombra[] = Array.from({ length: 5 }, () => [
      { tipo: 'erp_cadastro', resultado: 'ja_existe' } as EventoSombra,
      { tipo: 'erp_consulta', resultado: 'nao_encontrado' } as EventoSombra,
    ]).flat();
    const r = proximaEtapaSombra('coletando_cadastro', eventos);
    assert.equal(r.transicoes.filter(t => t !== 'limite').length, 6);
  });
});

describe('eventosDaExecucao', () => {
  const base = {
    ativo: false, silencio: false, falaDoCliente: 'quero um orçamento', documentoGuardado: null,
    chamadasErp: [] as ChamadaErpDaExecucao[],
  };

  test('silêncio não abre orçamento', () => {
    assert.deepEqual(eventosDaExecucao({ ...base, silencio: true }), []);
  });

  test('documento igual ao guardado não é evento', () => {
    const eventos = eventosDaExecucao({ ...base, ativo: true, falaDoCliente: `cnpj ${CNPJ_A}`, documentoGuardado: CNPJ_A });
    assert.deepEqual(eventos, []);
  });

  test('consulta sem cadastro (corpo encontrado:false) vira nao_encontrado', () => {
    const eventos = eventosDaExecucao({
      ...base, ativo: true,
      chamadasErp: [{ operacao: 'consultar_cliente', ok: true, motivo: null, codigo: null, resposta: { encontrado: false } }],
    });
    assert.deepEqual(eventos, [{ tipo: 'erp_consulta', resultado: 'nao_encontrado' }]);
  });

  test('409 de documento já cadastrado vira ja_existe', () => {
    const eventos = eventosDaExecucao({
      ...base, ativo: true,
      chamadasErp: [{ operacao: 'criar_cliente', ok: false, motivo: 'recusado', codigo: 'DOCUMENTO_JA_CADASTRADO', resposta: null }],
    });
    assert.deepEqual(eventos, [{ tipo: 'erp_cadastro', resultado: 'ja_existe' }]);
  });
});

describe('divergencias: cada uma com um caso que dispara e um que não', () => {
  const semNada = {
    transicoes: [] as string[], visitadas: [] as string[], ferramentas: [] as string[],
    resposta: 'Certo!', clienteDoErp: false, nomeGuardado: null, turnoAnteriorDaMesmaMensagem: false,
    falaDoCliente: '', havia_ativo: false,
  };

  test('respondeu_sem_consultar dispara: a máquina consultaria e o motor não consultou', () => {
    const d = divergencias({ ...semNada, transicoes: ['T1', 'T2'], visitadas: ['aguardando_documento', 'consultando_cadastro'] });
    assert.ok(d.includes('respondeu_sem_consultar'));
  });
  test('respondeu_sem_consultar não dispara quando o motor consultou', () => {
    const d = divergencias({
      ...semNada, transicoes: ['T2', 'T3'], visitadas: ['consultando_cadastro', 'cadastro_concluido'], ferramentas: ['consultar_cliente'],
    });
    assert.ok(!d.includes('respondeu_sem_consultar'));
  });

  test('acao_fora_da_etapa dispara: cotar sem a etapa permitir', () => {
    const d = divergencias({ ...semNada, visitadas: ['aguardando_documento'], ferramentas: ['cotar'] });
    assert.ok(d.includes('acao_fora_da_etapa'));
  });
  test('acao_fora_da_etapa não dispara: consultar_cliente em consultando_cadastro', () => {
    const d = divergencias({ ...semNada, visitadas: ['consultando_cadastro'], ferramentas: ['consultar_cliente'] });
    assert.ok(!d.includes('acao_fora_da_etapa'));
  });

  test('cliente_sem_origem_erp dispara: a resposta cita razão social sem cliente vindo do ERP', () => {
    const d = divergencias({ ...semNada, resposta: 'Já mando o orçamento pra WAPPIA TESTE 2 LTDA.' });
    assert.ok(d.includes('cliente_sem_origem_erp'));
  });
  test('cliente_sem_origem_erp não dispara com o cliente vindo do ERP', () => {
    const d = divergencias({ ...semNada, resposta: 'Achei: WAPPIA TESTE 2 LTDA. É esse?', clienteDoErp: true });
    assert.ok(!d.includes('cliente_sem_origem_erp'));
  });

  test('execucao_repetida dispara quando já houve turno para a mesma mensagem', () => {
    assert.ok(divergencias({ ...semNada, turnoAnteriorDaMesmaMensagem: true }).includes('execucao_repetida'));
  });
  test('execucao_repetida não dispara na primeira execução', () => {
    assert.ok(!divergencias(semNada).includes('execucao_repetida'));
  });

  test('dois_orcamentos dispara com dois documentos diferentes na mesma fala', () => {
    const d = divergencias({ ...semNada, falaDoCliente: `um para ${CNPJ_A} e outro para ${CNPJ_B}` });
    assert.ok(d.includes('dois_orcamentos'));
  });
  test('dois_orcamentos dispara com "outro orçamento" e um aberto', () => {
    const d = divergencias({ ...semNada, falaDoCliente: 'quero fazer outro orçamento', havia_ativo: true });
    assert.ok(d.includes('dois_orcamentos'));
  });
  test('dois_orcamentos não dispara com um documento repetido', () => {
    const d = divergencias({ ...semNada, falaDoCliente: `${CNPJ_A}, repito: ${CNPJ_A}` });
    assert.ok(!d.includes('dois_orcamentos'));
  });
});

describe('documentosCitados', () => {
  test('devolve todos os documentos válidos, sem repetir', () => {
    assert.deepEqual(documentosCitados(`a 45.723.174/0001-10, b ${CNPJ_B}, a de novo ${CNPJ_A}`), [CNPJ_A, CNPJ_B]);
  });
});

// Avisos de formato do ERP (pedido do Leonardo em 16/10: "qualquer coisa que
// vem do ERP deles fora do padrão é importante"). Os exemplos são reais: a
// consulta do cadastro de teste Z00005/01 e os 4 produtos que o molde não lê.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { avisosDaResposta } from '@/lib/erp/avisos';
import { registrarAvisos, type RegistroDaChamada } from '@/lib/erp/registro-de-chamadas';

const EXEMPLO = 'e8e00000-0000-4000-8000-0000000000e1';

const forma = (codigo: string, descricao: string, tipo: string, extra: Record<string, unknown> = {}) => ({
  codigo, descricao, forma: tipo, parcelas: 1, disponivel: true, valor_minimo: null, valor_maximo: null, ...extra,
});

const consulta = (formas: unknown, extra: Record<string, unknown> = {}) => ({
  encontrado: true, cliente_id: 'Z00005/01', tipo_pessoa: 'JURIDICA', situacao: 'BLOQUEADO', formas_pagamento: formas, ...extra,
});

const FORMAS_DO_Z00005 = [
  forma('001', 'A VISTA', 'R$'),
  forma('B00', 'BOL ANTECIPADO', 'BO'),
  forma('BOA', 'BOL 30/60/90 DIAS', 'BOL'),
  forma('CVD', 'C. C. 13 PARCELAS', 'CC'),
  forma('CV3', 'C.C. VISA 3 PARCELAS', 'CC'),
  forma('CDV', 'CARTAO DEBITO VISA', 'CD'),
  forma('PIX', 'PIX', 'PIX'),
  forma('D30', '30 DIAS DUPLICATA', 'DP'),
  forma('D18', '35 DIAS', ''),
  forma('CH1', 'CHEQUE A VISTA', ''),
  forma('CHQ', 'CHEQUES', 'CQ'),
];

const tipos = (avisos: { tipo: string; chave: string }[]): string[] => avisos.map(a => `${a.tipo} ${a.chave}`);

describe('formas de pagamento da consulta de cliente', () => {
  test('avisa as três formas reais que somem do menu', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta(FORMAS_DO_Z00005));
    assert.deepEqual(tipos(avisos), ['forma_desconhecida D18|', 'forma_desconhecida CH1|', 'forma_desconhecida CHQ|CQ']);
  });

  test('diz o que chegou e de qual cliente', () => {
    const [aviso] = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta([forma('CHQ', 'CHEQUES', 'CQ')]));
    assert.deepEqual(aviso, {
      tipo: 'forma_desconhecida', chave: 'CHQ|CQ', origem: 'cliente', descricao: 'CHEQUES, forma CQ, código CHQ', referencia: 'Z00005/01',
    });
  });

  test('não avisa R$, DP, cartão sem bandeira nem forma indisponível', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta([
      forma('001', 'A VISTA', 'R$'), forma('D30', '30 DIAS DUPLICATA', 'DP'), forma('CVD', 'C. C. 13 PARCELAS', 'CC'),
      forma('XYZ', 'NOVA FORMA', 'NV', { disponivel: false }),
    ]));
    assert.deepEqual(avisos, []);
  });

  test('avisa boleto cuja descrição não dá prazo', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta([forma('BXX', 'BOLETO BANCARIO', 'BO')]));
    assert.deepEqual(tipos(avisos), ['boleto_sem_prazo BXX']);
  });

  test('avisa forma sem código e lista que não é lista', () => {
    const semCodigo = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta([{ descricao: 'PIX', forma: 'PIX', disponivel: true }]));
    assert.deepEqual(tipos(semCodigo), ['forma_sem_codigo PIX']);
    const objeto = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta({ PIX: true }));
    assert.deepEqual(tipos(objeto), ['formas_fora_do_formato object']);
  });

  test('avisa situação e tipo de pessoa que o código não conhece', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'consultar_cliente', consulta([], { situacao: 'INATIVO', tipo_pessoa: 'PJ' }));
    assert.deepEqual(tipos(avisos), ['situacao_desconhecida INATIVO', 'tipo_pessoa_desconhecido PJ']);
  });

  test('cliente não encontrado não tem aviso', () => {
    assert.deepEqual(avisosDaResposta(EXEMPLO, 'consultar_cliente', { encontrado: false }), []);
  });
});

describe('sync de produtos', () => {
  const produto = (produto_id: string, descricao: string, grupo: string, extra: Record<string, unknown> = {}) => ({
    produto_id, descricao, grupo, unidade_venda: 'PC', peso_kg: 1, ...extra,
  });

  test('avisa os produtos que o molde não lê', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'sync_produtos', { produtos: [
      produto('100499', 'ARAME OVALADO RL1000', 'ARAMES'),
      produto('100198', 'TUBO METALON ESPECIAL SOB MEDIDA', 'TUBO METALON CH. 18'),
    ] });
    assert.deepEqual(tipos(avisos), ['produto_sem_medida 100499', 'produto_sem_medida 100198']);
  });

  test('produto que o molde lê não tem aviso', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'sync_produtos', { produtos: [
      produto('100003', 'VERGALHAO CA50 3/8 (10.0 MM)', 'ACO CA50'),
    ] });
    assert.deepEqual(avisos.filter(a => a.tipo === 'produto_sem_medida'), []);
  });

  test('avisa produto incompleto, parte do ERP que falhou e lista sem produtos', () => {
    const avisos = avisosDaResposta(EXEMPLO, 'sync_produtos', {
      produtos: [produto('709999', 'ARRUELA', 'FIXADORES', { peso_kg: 'leve' })], falhas: ['filial 05'],
    });
    assert.deepEqual(tipos(avisos), ['produto_incompleto 709999', 'parte_do_erp_falhou produtos|filial 05']);
    assert.deepEqual(tipos(avisosDaResposta(EXEMPLO, 'sync_produtos', { itens: [] })), ['lista_fora_do_formato produtos']);
  });
});

describe('gravação', () => {
  const registro = (resposta: unknown, ok = true): RegistroDaChamada => ({
    metodo: 'POST', operacao: 'consultar_cliente', caminho: '/clientes/consulta', requisicao: {}, statusHttp: 200,
    resposta, ok, motivo: null, codigo: null, mensagem: null, tentativas: 1, duracaoMs: 10, chaveDeIdempotencia: null,
  });

  test('chama a função do banco com os avisos da chamada', async () => {
    const chamadas: { fn: string; args: { p_org: string; p_avisos: unknown[] } }[] = [];
    const supabase = { rpc: async (fn: string, args: { p_org: string; p_avisos: unknown[] }) => { chamadas.push({ fn, args }); return { error: null }; } };
    registrarAvisos(supabase as never, EXEMPLO, registro(consulta([forma('CHQ', 'CHEQUES', 'CQ')])));
    await new Promise(r => setImmediate(r));
    assert.equal(chamadas[0].fn, 'registrar_avisos_erp');
    assert.equal(chamadas[0].args.p_avisos.length, 1);
  });

  test('falha do banco não escapa', async () => {
    const supabase = { rpc: () => Promise.reject(new Error('banco fora')) };
    const erro = console.error;
    console.error = () => {};
    try {
      assert.doesNotThrow(() => registrarAvisos(supabase as never, EXEMPLO, registro(consulta([forma('CHQ', 'CHEQUES', 'CQ')]))));
      await new Promise(r => setImmediate(r));
    } finally {
      console.error = erro;
    }
  });

  test('chamada que falhou não gera aviso', () => {
    let chamou = false;
    const supabase = { rpc: async () => { chamou = true; return { error: null }; } };
    registrarAvisos(supabase as never, EXEMPLO, registro(consulta([forma('CHQ', 'CHEQUES', 'CQ')]), false));
    assert.equal(chamou, false);
  });
});

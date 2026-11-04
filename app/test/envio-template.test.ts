// A6: envio de template aprovado da Meta, ao lado do texto livre (que continua
// igual — os testes do webhook e do atendente cobrem isso sem mudança).
//
// O que importa provar aqui é o corpo que sai para a Graph API: o nome do
// template, o idioma e as variáveis na ordem certa. Variável fora de ordem não
// dá erro nenhum — a Meta entrega a mensagem com o nome do cliente no lugar da
// data.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { instalarHttpFalso, type HttpFalso } from './apoio/http-falso.mts';

const NUMERO = 'PHONE-NUMBER-ID-A';
let http: HttpFalso;

before(() => {
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  http = instalarHttpFalso();
});

after(() => http.restaurar());

type CorpoTemplate = {
  to?: string; recipient?: string; type: string;
  template: { name: string; language: { code: string }; components?: { type: string; parameters: { type: string; text: string }[] }[] };
};
const ultimoCorpo = () => http.chamadasWhatsApp.at(-1)!.corpo as CorpoTemplate;

describe('envio de template', () => {
  test('manda nome, idioma pt_BR e as variáveis na ordem do template', async () => {
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/send-message');
    // A ordem por nome vem do catálogo (catalogo-de-templates.test.ts); aqui
    // o que se prova é que a posição recebida é a posição que sai.
    await sendWhatsAppTemplate('org', '5511900000301',
      { nome: 'lembrete_agendamento', variaveis: ['Ana', 'Estúdio Exemplo', '12/09', '14h'] }, NUMERO);

    const corpo = ultimoCorpo();
    assert.deepEqual([corpo.type, corpo.template.name, corpo.template.language.code], ['template', 'lembrete_agendamento', 'pt_BR']);
    assert.deepEqual(corpo.template.components?.[0].parameters.map(p => p.text), ['Ana', 'Estúdio Exemplo', '12/09', '14h']);
  });

  test('sai pelo número informado e devolve o wamid da Meta', async () => {
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/send-message');
    const wamid = await sendWhatsAppTemplate('org', '5511900000302', { nome: 'aviso_remarcacao', variaveis: ['a', 'b', 'c', 'd'] }, NUMERO);
    assert.ok(http.chamadasWhatsApp.at(-1)!.url.endsWith(`/${NUMERO}/messages`));
    assert.equal(wamid, 'wamid.enviado');
  });

  test('cliente só com BSUID recebe o template pelo recipient', async () => {
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/send-message');
    await sendWhatsAppTemplate('org', { telefone: null, bsuid: 'BR.3000' }, { nome: 'aviso_remarcacao', variaveis: ['a', 'b', 'c', 'd'] }, NUMERO);
    assert.equal(ultimoCorpo().recipient, 'BR.3000');
  });

  test('variável vazia é recusada antes de gastar a chamada', async () => {
    const { sendWhatsAppTemplate } = await import('@/lib/whatsapp/send-message');
    const chamadasAntes = http.chamadasWhatsApp.length;
    await assert.rejects(
      sendWhatsAppTemplate('org', '5511900000303', { nome: 'aviso_remarcacao', variaveis: ['Ana', '', '13/09', '10h'] }, NUMERO),
      /variável vazia/,
    );
    assert.equal(http.chamadasWhatsApp.length, chamadasAntes);
  });

  test('o texto livre continua saindo como texto', async () => {
    const { sendWhatsAppMessage } = await import('@/lib/whatsapp/send-message');
    await sendWhatsAppMessage('org', '5511900000304', 'oi', NUMERO);
    const corpo = http.chamadasWhatsApp.at(-1)!.corpo as { type: string; text: { body: string } };
    assert.deepEqual([corpo.type, corpo.text.body], ['text', 'oi']);
  });
});

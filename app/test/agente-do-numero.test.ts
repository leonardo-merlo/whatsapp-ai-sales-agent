// A aba Agente quando se está configurando UM número.
//
// O que estes testes protegem não é o formulário: são as duas armadilhas que
// ele desarma.
//
// **A primeira, de 13/09:** `wa_numbers.papel` era quase só um rótulo — quem
// governa o comportamento da IA é `ai_agent_config.roteiro`. Um administrador
// que marcava "Vendedor" numa tela e não mexia na outra ficava com um número
// rotulado de vendedor que continuava atendendo como antes, sem forma de
// descobrir por quê. Desde 14/09 é **uma escolha só**, gravada nos dois lugares.
//
// **A segunda, de 14/09:** dar configuração própria a um número zerava tudo que
// a tela dele não perguntava. Agora o número guarda só o que foi mudado, e
// campo em branco segue o padrão.

import { describe, test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import {
  cadastrarMembroSemLogin, carregarAgenteDoNumero, listarMembrosDaEquipe, listarNumerosConfiguraveis,
  roteiroPadraoDoPapel, salvarAgenteDoNumero, salvarTextosDoCatalogo, definirPapelDoNumero, atualizarMembro,
  type CamposDoAgente,
} from '@/lib/data/agente-do-numero';
import { combinarComOPadrao } from '@/lib/agente/config-do-numero';

type Cliente = SupabaseClient<Database>;

const ORG = '11111111-1111-4111-8111-111111111111';
const NUM_ATENDIMENTO = 'num-atendimento';
const NUM_VENDEDOR = 'num-vendedor';
const NUM_COPILOTO = 'num-copiloto';
const MEMBRO_JOAO = 'membro-joao';

const NADA_PROPRIO: CamposDoAgente = {
  prompt: '', limitacoes: '', infoAdicional: '', welcomeMsg: '', tom: null,
};

let banco: Banco;
let cliente: Cliente;

beforeEach(() => {
  banco = {
    organizations: [{ id: ORG, nome: 'Distribuidora Exemplo' }],
    wa_numbers: [
      { id: NUM_ATENDIMENTO, organization_id: ORG, telefone: '+55 11 90000-0001', papel: 'atendimento', member_id: null, ativo: true, created_at: '2026-01-01' },
      { id: NUM_VENDEDOR, organization_id: ORG, telefone: '+55 73 90000-0007', papel: 'vendedor', member_id: null, ativo: true, created_at: '2026-01-02' },
      { id: NUM_COPILOTO, organization_id: ORG, telefone: '+55 73 90000-0099', papel: 'copiloto', member_id: null, ativo: true, created_at: '2026-01-03' },
    ],
    ai_agent_config: [
      { id: 'cfg-org', organization_id: ORG, wa_number_id: null, roteiro: 'atendimento', ativo: true,
        prompt: 'Você atende a Distribuidora Exemplo.', limitacoes: 'Não dê desconto.', info_adicional: 'Aberto de 7h às 17h.',
        welcome_msg: 'Oi! Aqui é a Distribuidora Exemplo.', tom: 'simpatico' },
    ],
    organization_members: [
      { id: MEMBRO_JOAO, organization_id: ORG, nome: 'João', codigo_erp: null, telefone_whatsapp: null, ativo: true, acessa_painel: true },
      { id: 'membro-pedro', organization_id: ORG, nome: 'Pedro', codigo_erp: 'V-09', telefone_whatsapp: '5573900000009', ativo: true, acessa_painel: true },
      { id: 'membro-saiu', organization_id: ORG, nome: 'Antigo', codigo_erp: null, telefone_whatsapp: null, ativo: false, acessa_painel: true },
    ],
    catalogo_produtos: [],
    catalogo_grupos: [],
    catalogo_config: [],
  };
  cliente = criarSupabaseFalso(banco, {
    unicos: { ai_agent_config: [['wa_number_id']], catalogo_config: [['organization_id']] },
    // `ai_agent_config_um_por_numero` é PARCIAL (`WHERE wa_number_id IS NOT NULL`,
    // migration 20260908000003), porque a linha da empresa toda tem número nulo.
    // Declarar isso aqui é o que faz o teste abaixo reproduzir o banco real.
    unicosParciais: { ai_agent_config: [['wa_number_id']] },
  }).client as Cliente;
});

function numero(id: string) {
  const linha = banco.wa_numbers.find(n => n.id === id)!;
  return {
    id: String(linha.id), telefone: linha.telefone as string, papel: linha.papel as 'atendimento' | 'vendedor' | 'copiloto',
    roteiro: null, memberId: (linha.member_id as string) ?? null, ativo: true,
  };
}

describe('o roteiro nasce combinando com o papel', () => {
  test('cada papel sugere o roteiro que faz sentido', () => {
    assert.equal(roteiroPadraoDoPapel('atendimento'), 'atendimento');
    assert.equal(roteiroPadraoDoPapel('vendedor'), 'vendas');
    assert.equal(roteiroPadraoDoPapel('copiloto'), 'copiloto');
  });

  test('número de vendedor sem configuração própria abre já como Vendas', async () => {
    const dados = await carregarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR));

    assert.equal(dados.roteiro, 'vendas', 'é isto que impede o número rotulado de vendedor de seguir atendendo');
    assert.equal(dados.temConfigPropria, false, 'e a tela avisa que ele ainda herda o agente da empresa');
    assert.equal(dados.proprio.prompt, '');
  });

  test('número de atendimento sem configuração própria abre como Atendimento', async () => {
    const dados = await carregarAgenteDoNumero(cliente, ORG, numero(NUM_ATENDIMENTO));
    assert.equal(dados.roteiro, 'atendimento');
  });

  test('quando existe configuração própria, vale o que está gravado', async () => {
    banco.ai_agent_config.push({
      id: 'cfg-vendedor', organization_id: ORG, wa_number_id: NUM_VENDEDOR, roteiro: 'atendimento',
      ativo: false, prompt: 'de propósito', limitacoes: 'sem desconto', info_adicional: '',
      welcome_msg: '', tom: null,
    });

    const dados = await carregarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR));

    assert.equal(dados.roteiro, 'atendimento', 'o gravado manda — o padrão só vale para linha que não existe');
    assert.equal(dados.ativo, false);
    assert.equal(dados.proprio.limitacoes, 'sem desconto');
    assert.equal(dados.temConfigPropria, true);
  });
});

describe('herança: o número guarda só o que foi mudado', () => {
  test('a tela recebe o valor do padrão ao lado do que é próprio', async () => {
    banco.ai_agent_config.push({
      id: 'cfg-vendedor', organization_id: ORG, wa_number_id: NUM_VENDEDOR, roteiro: 'vendas',
      ativo: true, prompt: 'Assistente do João.', limitacoes: '', info_adicional: '',
      welcome_msg: '', tom: null,
    });

    const dados = await carregarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR));

    assert.equal(dados.proprio.prompt, 'Assistente do João.', 'o que ele respondeu');
    assert.equal(dados.proprio.limitacoes, '', 'o que ele não respondeu fica vazio');
    assert.equal(dados.padrao.limitacoes, 'Não dê desconto.', 'e a tela mostra em cinza o que vai valer');
    assert.equal(dados.padrao.tom, 'simpatico');
  });

  // Estes quatro exercitam a junção que o MOTOR faz, que é onde a herança
  // deixa de ser enfeite de tela e vira comportamento.
  test('campo em branco no número pega o valor do padrão', () => {
    const padrao = { prompt: 'padrão', limitacoes: 'nada de desconto', info_adicional: 'x', welcome_msg: 'oi', tom: 'formal', roteiro: 'atendimento', ativo: true, id: 'a', wa_number_id: null } as never;
    const doNumero = { prompt: '', limitacoes: '', info_adicional: '', welcome_msg: '', tom: null, roteiro: 'vendas', ativo: true, id: 'b', wa_number_id: 'n1' } as never;

    const junta = combinarComOPadrao(doNumero, padrao)!;

    assert.equal(junta.prompt, 'padrão');
    assert.equal(junta.limitacoes, 'nada de desconto');
    assert.equal(junta.tom, 'formal', 'tom de voz também se herda — a IA fala com o cliente no número do vendedor');
    assert.equal(junta.roteiro, 'vendas', 'o roteiro NÃO se herda: é a identidade do número');
  });

  test('campo preenchido no número vence o padrão', () => {
    const padrao = { prompt: 'padrão', limitacoes: 'a', info_adicional: '', welcome_msg: '', tom: 'formal', roteiro: 'atendimento', ativo: true, id: 'a', wa_number_id: null } as never;
    const doNumero = { prompt: 'só deste número', limitacoes: '', info_adicional: '', welcome_msg: '', tom: 'direto', roteiro: 'vendas', ativo: true, id: 'b', wa_number_id: 'n1' } as never;

    const junta = combinarComOPadrao(doNumero, padrao)!;

    assert.equal(junta.prompt, 'só deste número');
    assert.equal(junta.tom, 'direto');
  });

  test('número sem linha própria é o padrão inteiro', () => {
    const padrao = { prompt: 'padrão', id: 'a', wa_number_id: null } as never;
    assert.equal(combinarComOPadrao(null, padrao), padrao);
  });

  test('sem padrão, o número vale sozinho — nada quebra numa org sem linha da empresa', () => {
    const doNumero = { prompt: 'só dele', id: 'b', wa_number_id: 'n1' } as never;
    assert.equal(combinarComOPadrao(doNumero, null), doNumero);
  });
});

describe('a lista de números da tela', () => {
  test('traz o roteiro de quem tem configuração, e nulo de quem não tem', async () => {
    banco.ai_agent_config.push({
      id: 'cfg-vendedor', organization_id: ORG, wa_number_id: NUM_VENDEDOR, roteiro: 'vendas',
      ativo: true, prompt: '', limitacoes: '', info_adicional: '', welcome_msg: '', tom: null,
    });

    const lista = await listarNumerosConfiguraveis(cliente, ORG);

    assert.equal(lista.length, 3);
    assert.equal(lista.find(n => n.id === NUM_VENDEDOR)!.roteiro, 'vendas');
    assert.equal(lista.find(n => n.id === NUM_COPILOTO)!.roteiro, null);
  });

  test('a equipe traz só quem está ativo, com código e telefone', async () => {
    const equipe = await listarMembrosDaEquipe(cliente, ORG);

    assert.deepEqual(equipe.map(m => m.nome).sort(), ['João', 'Pedro']);
    assert.equal(equipe.find(m => m.nome === 'Pedro')!.codigoErp, 'V-09');
  });
});

describe('cadastrar vendedor sem convidar', () => {
  test('entra na equipe sem login e sem ocupar vaga de atendente', async () => {
    const membro = await cadastrarMembroSemLogin(cliente, ORG, {
      nome: 'Vendedor 1', cargo: 'Vendedor — Jundiaí', codigoErp: 'V-11', telefoneWhatsapp: '5532900000011',
    });

    assert.equal(membro.acessaPainel, false, 'é isto que o limite do plano lê para não contar a vaga');
    const linha = banco.organization_members.find(m => m.id === membro.id)!;
    assert.equal(linha.user_id, undefined, 'sem login: ninguém foi convidado por e-mail');
    assert.equal(linha.codigo_erp, 'V-11');
    assert.equal(linha.telefone_whatsapp, '5532900000011');
    assert.equal(linha.ativo, true);
  });

  test('código e telefone em branco viram nulo, não string vazia', async () => {
    const membro = await cadastrarMembroSemLogin(cliente, ORG, {
      nome: 'Sem dados', cargo: '', codigoErp: '  ', telefoneWhatsapp: '',
    });
    const linha = banco.organization_members.find(m => m.id === membro.id)!;
    assert.equal(linha.codigo_erp, null);
    assert.equal(linha.telefone_whatsapp, null);
  });
});

describe('salvar', () => {
  test('cria a configuração do número sem tocar na da empresa', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), {
      roteiro: 'vendas', ativo: true,
      proprio: { ...NADA_PROPRIO, prompt: 'Assistente do João.', limitacoes: 'Não negocie desconto.' },
      memberId: MEMBRO_JOAO, codigoErp: 'V-07', telefoneWhatsapp: '5573999990000',
    });

    const daEmpresa = banco.ai_agent_config.find(c => c.wa_number_id === null)!;
    assert.equal(daEmpresa.prompt, 'Você atende a Distribuidora Exemplo.', 'a configuração da empresa não pode ser tocada');

    const doNumero = banco.ai_agent_config.find(c => c.wa_number_id === NUM_VENDEDOR)!;
    assert.equal(doNumero.roteiro, 'vendas');
    assert.equal(doNumero.limitacoes, 'Não negocie desconto.');
    assert.equal(doNumero.info_adicional, '', 'o que não foi respondido fica vazio — e vazio quer dizer herdado');
  });

  test('salvar duas vezes não cria duas configurações para o mesmo número', async () => {
    const dados = {
      roteiro: 'vendas' as const, ativo: true, proprio: { ...NADA_PROPRIO, prompt: 'a' },
      memberId: MEMBRO_JOAO, codigoErp: 'V-07',
    };
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), dados);
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), { ...dados, proprio: { ...NADA_PROPRIO, prompt: 'b' } });

    const doNumero = banco.ai_agent_config.filter(c => c.wa_number_id === NUM_VENDEDOR);
    assert.equal(doNumero.length, 1);
    assert.equal(doNumero[0].prompt, 'b');
  });

  test('o dono e o código do vendedor ficam gravados', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), {
      roteiro: 'vendas', ativo: true, proprio: NADA_PROPRIO,
      memberId: MEMBRO_JOAO, codigoErp: 'V-07', telefoneWhatsapp: '5573999990000',
    });

    assert.equal(banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!.member_id, MEMBRO_JOAO);
    const joao = banco.organization_members.find(m => m.id === MEMBRO_JOAO)!;
    assert.equal(joao.codigo_erp, 'V-07', 'é ele que vai em toda cotação e todo orçamento');
    assert.equal(joao.telefone_whatsapp, '5573999990000', 'é para lá que o copiloto avisa');
  });

  test('código em branco vira nulo, e não string vazia', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), {
      roteiro: 'vendas', ativo: true, proprio: NADA_PROPRIO,
      memberId: MEMBRO_JOAO, codigoErp: '   ',
    });
    assert.equal(banco.organization_members.find(m => m.id === MEMBRO_JOAO)!.codigo_erp, null);
  });

  test('número que não é de vendedor não ganha dono', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_COPILOTO), {
      roteiro: 'copiloto', ativo: true, proprio: NADA_PROPRIO, memberId: MEMBRO_JOAO,
    });

    assert.equal(banco.wa_numbers.find(n => n.id === NUM_COPILOTO)!.member_id, null,
      'dono pendurado em número da empresa esconderia conversa de quem deveria ver');
  });

  // O teste que fecha a armadilha do aviso amarelo: escolher o roteiro grava o
  // papel junto, então os dois não têm como divergir.
  test('escolher o roteiro grava o papel do número junto', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_ATENDIMENTO), {
      roteiro: 'vendas', ativo: true, proprio: NADA_PROPRIO, memberId: MEMBRO_JOAO,
    });

    const linha = banco.wa_numbers.find(n => n.id === NUM_ATENDIMENTO)!;
    assert.equal(linha.papel, 'vendedor', 'não existe mais número rotulado de um jeito e agindo de outro');
    assert.equal(linha.member_id, MEMBRO_JOAO);
  });

  test('voltar um número de vendas para atendimento tira o dono junto', async () => {
    banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!.member_id = MEMBRO_JOAO;

    await salvarAgenteDoNumero(cliente, ORG, { ...numero(NUM_VENDEDOR), memberId: MEMBRO_JOAO }, {
      roteiro: 'atendimento', ativo: true, proprio: NADA_PROPRIO, memberId: MEMBRO_JOAO,
    });

    const linha = banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!;
    assert.equal(linha.papel, 'atendimento');
    assert.equal(linha.member_id, null);
  });

  test('o dicionário e as regras são da organização, não do número', async () => {
    await salvarTextosDoCatalogo(cliente, ORG, { dicionario: 'vara = barra de 12 m', regras: 'não troque a medida' });
    await salvarTextosDoCatalogo(cliente, ORG, { dicionario: 'vara = barra de 12 m', regras: 'nunca troque a medida' });

    assert.equal(banco.catalogo_config.length, 1, 'uma linha por organização, não uma por salvamento');
    assert.equal(banco.catalogo_config[0].regras, 'nunca troque a medida');
  });
});

// ── O que mudou em 14/09 (segunda rodada, depois da conferência do Leonardo) ──
//
// A escolha de **o que o número faz** e **de quem ele é** saiu da tela do
// agente e foi para Configurações → Integração WhatsApp. A régua ficou: quais
// números existem, o que cada um faz e de quem é se decide em Integração; a
// tela do agente responde só como a IA fala.
//
// Continua sendo **uma** escolha gravada nos dois lugares — o que estes testes
// protegem é a fronteira nova: a tela do agente não pode desfazer, calada, o
// que foi decidido em Integração.
describe('quem é o número se decide em Integração WhatsApp', () => {
  test('escolher Vendas grava o papel e o roteiro de uma vez', async () => {
    await definirPapelDoNumero(cliente, ORG, numero(NUM_ATENDIMENTO), {
      roteiro: 'vendas', memberId: MEMBRO_JOAO,
    });

    const linha = banco.wa_numbers.find(n => n.id === NUM_ATENDIMENTO)!;
    assert.equal(linha.papel, 'vendedor');
    assert.equal(linha.member_id, MEMBRO_JOAO);
    const cfg = banco.ai_agent_config.find(c => c.wa_number_id === NUM_ATENDIMENTO)!;
    assert.equal(cfg.roteiro, 'vendas', 'sem isto o número vira vendedor de nome e segue atendendo');
  });

  test('trocar o papel não apaga o que já foi escrito naquele número', async () => {
    banco.ai_agent_config.push({
      id: 'cfg-vendedor', organization_id: ORG, wa_number_id: NUM_VENDEDOR, roteiro: 'vendas',
      ativo: true, prompt: 'Assistente do João.', limitacoes: 'Não prometa prazo.',
      info_adicional: '', welcome_msg: '', tom: 'direto',
    });

    await definirPapelDoNumero(cliente, ORG, numero(NUM_VENDEDOR), {
      roteiro: 'atendimento', memberId: null,
    });

    const cfg = banco.ai_agent_config.find(c => c.wa_number_id === NUM_VENDEDOR)!;
    assert.equal(cfg.roteiro, 'atendimento');
    assert.equal(cfg.prompt, 'Assistente do João.', 'mexer no papel não pode levar junto o texto de outra tela');
    assert.equal(cfg.limitacoes, 'Não prometa prazo.');
    assert.equal(cfg.tom, 'direto');
  });

  test('número que deixa de ser de vendas perde o dono', async () => {
    banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!.member_id = MEMBRO_JOAO;

    await definirPapelDoNumero(cliente, ORG, { ...numero(NUM_VENDEDOR), memberId: MEMBRO_JOAO }, {
      roteiro: 'atendimento', memberId: MEMBRO_JOAO,
    });

    const linha = banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!;
    assert.equal(linha.member_id, null, 'dono pendurado em número da empresa esconderia conversa de quem deveria ver');
  });

  test('copiloto não guarda dono', async () => {
    await definirPapelDoNumero(cliente, ORG, numero(NUM_COPILOTO), {
      roteiro: 'copiloto', memberId: MEMBRO_JOAO,
    });

    assert.equal(banco.wa_numbers.find(n => n.id === NUM_COPILOTO)!.member_id, null);
  });

  // O aviso do orçamento pega o primeiro copiloto que encontra: um segundo
  // nunca seria usado, e quem o cadastrou ficaria procurando por que aquele
  // número não avisa ninguém.
  test('segundo copiloto é recusado, dizendo qual número já é o copiloto', async () => {
    await assert.rejects(
      () => definirPapelDoNumero(cliente, ORG, numero(NUM_ATENDIMENTO), { roteiro: 'copiloto', memberId: null }),
      /já tem um número copiloto \(\+55 73 90000-0099\)/,
    );
  });

  test('a recusa acontece antes de gravar: papel e roteiro não ficam discordando', async () => {
    await assert.rejects(
      () => definirPapelDoNumero(cliente, ORG, numero(NUM_ATENDIMENTO), { roteiro: 'copiloto', memberId: null }),
    );

    assert.equal(banco.wa_numbers.find(n => n.id === NUM_ATENDIMENTO)!.papel, 'atendimento');
    assert.equal(
      banco.ai_agent_config.find(c => c.wa_number_id === NUM_ATENDIMENTO),
      undefined,
      'nenhuma configuração própria foi criada para um papel que não chegou a valer',
    );
  });

  test('o número que já é copiloto continua podendo ser salvo como copiloto', async () => {
    await definirPapelDoNumero(cliente, ORG, numero(NUM_COPILOTO), { roteiro: 'copiloto', memberId: null });

    assert.equal(banco.wa_numbers.find(n => n.id === NUM_COPILOTO)!.papel, 'copiloto');
  });
});

describe('a tela do agente não desfaz o que Integração decidiu', () => {
  test('salvar só os textos não mexe no papel nem no dono', async () => {
    banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!.member_id = MEMBRO_JOAO;

    await salvarAgenteDoNumero(cliente, ORG, { ...numero(NUM_VENDEDOR), memberId: MEMBRO_JOAO }, {
      ativo: true,
      proprio: { ...NADA_PROPRIO, prompt: 'Fale de aço, não de futebol.' },
    });

    const linha = banco.wa_numbers.find(n => n.id === NUM_VENDEDOR)!;
    assert.equal(linha.papel, 'vendedor', 'omitir o roteiro quer dizer "não mexi", e não "volte para atendimento"');
    assert.equal(linha.member_id, MEMBRO_JOAO, 'nem o dono some por salvar um texto');
  });

  test('a linha do número nasce com o roteiro do papel, não com atendimento', async () => {
    await salvarAgenteDoNumero(cliente, ORG, numero(NUM_VENDEDOR), {
      ativo: true,
      proprio: { ...NADA_PROPRIO, prompt: 'Assistente do João.' },
    });

    const cfg = banco.ai_agent_config.find(c => c.wa_number_id === NUM_VENDEDOR)!;
    assert.equal(cfg.roteiro, 'vendas', 'a coluna tem default atendimento, e o default rebaixaria o vendedor calado');
  });
});

// O código no sistema e o WhatsApp de aviso sempre foram da PESSOA, no banco.
// O que faltava era onde editá-los: dava para preencher ao cadastrar e nunca
// mais, e quem era **convidado** não tinha onde preencher código nenhum.
describe('editar quem já está na equipe', () => {
  test('quem foi convidado também ganha código e WhatsApp', async () => {
    await atualizarMembro(cliente, ORG, MEMBRO_JOAO, {
      codigoErp: 'V-07', telefoneWhatsapp: '5573900000007',
    });

    const membro = banco.organization_members.find(m => m.id === MEMBRO_JOAO)!;
    assert.equal(membro.codigo_erp, 'V-07', 'sem código o orçamento nasce sem vendedor');
    assert.equal(membro.telefone_whatsapp, '5573900000007');
    assert.equal(membro.acessa_painel, true, 'e editar não pode mexer no acesso dela ao painel');
  });

  test('apagar o campo grava vazio, não a string em branco', async () => {
    await atualizarMembro(cliente, ORG, 'membro-pedro', { codigoErp: '   ' });

    assert.equal(banco.organization_members.find(m => m.id === 'membro-pedro')!.codigo_erp, null);
  });

  test('pedido sem campo nenhum não escreve nada', async () => {
    await atualizarMembro(cliente, ORG, 'membro-pedro', {});

    assert.equal(banco.organization_members.find(m => m.id === 'membro-pedro')!.codigo_erp, 'V-09');
  });

  test('não alcança membro de outra organização', async () => {
    const OUTRA = '22222222-2222-4222-8222-222222222222';
    banco.organization_members.push({
      id: 'membro-de-fora', organization_id: OUTRA, nome: 'De fora',
      codigo_erp: 'X-01', telefone_whatsapp: null, ativo: true, acessa_painel: true,
    });

    await atualizarMembro(cliente, ORG, 'membro-de-fora', { codigoErp: 'V-99' });

    assert.equal(banco.organization_members.find(m => m.id === 'membro-de-fora')!.codigo_erp, 'X-01');
  });
});

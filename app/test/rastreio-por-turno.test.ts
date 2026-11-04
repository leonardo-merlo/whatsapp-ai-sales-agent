// A ficha de cada execução do motor (`agente_turnos`) e a sombra da máquina de
// estados, ponta a ponta: webhook → fila → motor → ERP falso → Claude falso.
//
// Spec: `docs/superpowers/specs/2026-09-27-rastreio-por-turno-e-sombra-design.md`.
// Nenhuma chamada paga: a Anthropic e o ERP são os dublês de sempre.

import { describe, test, before, beforeEach, after as depois, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  assinar, cenarioBase, INDICES_UNICOS, NUMERO_A, ORG_A, requisicaoDoWebhook,
  payloadDeMensagem, SEGREDO_DO_APP,
} from './apoio/cenario.mts';
import { criarSupabaseFalso, type Banco } from './apoio/supabase-falso.mts';
import { instalarHttpFalso, type HttpFalso, type RespostaAnthropic } from './apoio/http-falso.mts';
import { criarSimuladorExemplo, responderComoFetch, type SimuladorExemplo } from '@/lib/erp/simulador';
import { abrirTurno, novoRastreio } from '@/lib/agente/rastreio/rastreio';
import { reconstruirTurno, type TurnoGravado } from '@/lib/agente/rastreio/reconstruir';

const NUMERO_VENDEDOR = 'PHONE-NUMBER-ID-RASTREIO';
const WA_NUMBER_VENDEDOR = 'dddddddd-0000-4000-8000-0000000rastro';
const MEMBRO = 'membro-rastreio';
const BASE_DO_ERP = 'https://erp.rastreio.teste/v1';
const CHAVE_DO_ERP = 'CHAVE-NO-VAULT';
// CNPJ com dígito verificador válido: é o que a sombra reconhece como documento.
const CNPJ = '45723174000110';
const CNPJ_FORMATADO = '45.723.174/0001-10';

let banco: Banco;
let http: HttpFalso;
let erp: SimuladorExemplo;
let tarefasPendentes: (() => Promise<void> | void)[] = [];
/** Liga a gravação quebrada: `agente_turnos` e `orcamentos_em_andamento` lançam. */
let quebrarRastreio = false;
type ClienteComFrom = { from: (tabela: string) => unknown };
let clienteFalso: ClienteComFrom;

before(() => {
  process.env.WHATSAPP_APP_SECRET = SEGREDO_DO_APP;
  process.env.WHATSAPP_ACCESS_TOKEN = 'token-de-teste';
  process.env.ANTHROPIC_API_KEY = 'chave-de-teste';
  delete process.env.WEBHOOK_FILA_ORGS;

  banco = cenarioBase();
  banco.wa_numbers.push({
    id: WA_NUMBER_VENDEDOR, organization_id: ORG_A, phone_number_id: NUMERO_VENDEDOR,
    telefone: '+55 32 90000-0009', papel: 'vendedor', member_id: MEMBRO, ativo: true, coexistencia: true,
  });
  banco.ai_agent_config.push({
    id: 'cfg-rastreio', organization_id: ORG_A, ativo: true,
    prompt: 'Você é o assistente do vendedor.', tom: 'direto', limitacoes: null, info_adicional: null, sucessos: null,
    fallback_mode: 'transferir', fallback_atendente_id: null,
    wa_number_id: WA_NUMBER_VENDEDOR, roteiro: 'vendas',
  });
  banco.organization_members = [
    { id: MEMBRO, organization_id: ORG_A, nome: 'Rafa', codigo_erp: 'V-09',
      telefone_whatsapp: '5532900000009', ativo: true, role: 'atendente' },
  ];
  banco.organization_integrations = [
    { id: 'integracao-rastreio', organization_id: ORG_A, tipo: 'erp', endereco_base: BASE_DO_ERP,
      token_secret_id: 'segredo-1', ativo: true, config: {} },
  ];
  banco.erp_idempotencia = [];

  const supabase = criarSupabaseFalso(banco, {
    ...INDICES_UNICOS,
    unicos: { ...INDICES_UNICOS.unicos, erp_idempotencia: [['organization_id', 'operacao', 'assinatura']] },
    funcoes: { credencial_da_integracao: () => CHAVE_DO_ERP },
  });
  clienteFalso = supabase.client as ClienteComFrom;
  // Com `quebrarRastreio`, as duas tabelas do rastreio estouram de verdade
  // (exceção, não `error`): é o pior caso para provar que a resposta sai igual.
  const comRastreioQuebrado = new Proxy(clienteFalso, {
    get(alvo, prop, recebedor) {
      if (prop === 'from') {
        return (tabela: string) => {
          if (quebrarRastreio && (tabela === 'agente_turnos' || tabela === 'orcamentos_em_andamento')) {
            throw new Error(`banco fora do ar em ${tabela}`);
          }
          return alvo.from(tabela);
        };
      }
      return Reflect.get(alvo, prop, recebedor);
    },
  });
  mock.module('@/lib/supabase/service', { namedExports: { createServiceClient: () => comRastreioQuebrado } });
  mock.module('next/server', {
    namedExports: { after: (cb: () => Promise<void> | void) => { tarefasPendentes.push(cb); } },
  });
});

beforeEach(() => {
  for (const t of ['contacts', 'conversations', 'messages', 'ai_usage', 'erp_idempotencia', 'erp_chamadas',
    'agente_turnos', 'orcamentos_em_andamento']) {
    banco[t] = [];
  }
  tarefasPendentes = [];
  quebrarRastreio = false;
  erp = criarSimuladorExemplo({
    chave: CHAVE_DO_ERP,
    clientes: [{
      id: 'Z00003/01', documento: CNPJ, tipo: 'PJ',
      nome: 'Metalurgica Exemplo', cidade: 'Jundiaí', uf: 'MG', vendedor_id: 'V-09',
    }],
  });
});

depois(() => http?.restaurar());

function comRespostas(respostas: RespostaAnthropic[]) {
  http?.restaurar();
  http = instalarHttpFalso(respostas);
  const fetchDoDuble = globalThis.fetch;
  globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (url.startsWith(BASE_DO_ERP)) return responderComoFetch(erp, BASE_DO_ERP, entrada, init);
    return fetchDoDuble(entrada, init);
  }) as typeof fetch;
}

async function entregar(texto: string, phoneNumberId = NUMERO_VENDEDOR) {
  const { POST } = await import('@/app/api/webhooks/whatsapp/route');
  const corpo = payloadDeMensagem({ phoneNumberId, telefone: '5532911112222', texto });
  await POST(requisicaoDoWebhook(corpo, assinar(corpo)));
  while (tarefasPendentes.length) await tarefasPendentes.shift()!();
  // O registro de `erp_chamadas` é disparado sem `await`: deixa o insert assentar.
  await new Promise(resolve => setImmediate(resolve));
}

const resposta = (texto: string): RespostaAnthropic => ({
  json: {
    resposta: texto, transferir_para_atendente: false, questionario_completo: false, respostas: [],
    resultado: 'nenhum', itens_vendidos: [], agendamento_data: '', agendamento_hora: '',
    agendamento_servico: '', agendamento_remarcacao: false,
    atualizacao_perfil: { preferencias: [], dados_chave: [], ultimo_interesse: '', observacoes: '' },
  },
});
const consulta: RespostaAnthropic = { ferramentas: [{ nome: 'consultar_cliente', entrada: { documento: CNPJ } }] };
const RESPOSTA_DO_CADASTRO = 'Achei aqui: Metalurgica Exemplo, em Jundiaí. É esse mesmo?';

const turnos = () => banco.agente_turnos as Record<string, unknown>[];
const soTurno = () => {
  assert.equal(turnos().length, 1, 'uma execução, uma ficha');
  return turnos()[0];
};

describe('a ficha de uma resposta de vendas', () => {
  test('grava origem, mensagem respondida, status e resposta', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`bom dia, cnpj ${CNPJ_FORMATADO}`);

    const turno = soTurno();
    const doCliente = banco.messages.find(m => m.autor === 'cliente')!;
    assert.deepEqual(
      [turno.origem, turno.status, turno.mensagem_id, turno.resposta],
      ['fila', 'respondeu', doCliente.id, RESPOSTA_DO_CADASTRO],
    );
  });

  test('liga as chamadas ao Claude e ao ERP à ficha', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const turno = soTurno();
    const doMotor = banco.ai_usage.filter(u => u.origem === 'motor');
    assert.ok(doMotor.length > 0 && doMotor.every(u => u.turno_id === turno.id), 'todo ai_usage do motor aponta para o turno');
    const chamada = banco.erp_chamadas.find(c => c.operacao === 'consultar_cliente')!;
    assert.equal(chamada.turno_id, turno.id);
    const ferramentas = turno.ferramentas as { nome: string; erp_chamadas: string[] }[];
    assert.deepEqual(ferramentas.map(f => [f.nome, f.erp_chamadas]), [['consultar_cliente', [chamada.id]]]);
  });

  test('grava o prompt enviado e o estado das travas antes', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const turno = soTurno();
    assert.match(String(turno.prompt_system), /Você é o assistente do vendedor/);
    assert.equal((turno.estado_antes as { documento_citado: string }).documento_citado, CNPJ);
  });

  test('a sombra anda de "sem orçamento" até cadastro_concluido, sem divergência', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const turno = soTurno();
    assert.deepEqual(
      [turno.sombra_etapa_antes, turno.sombra_etapa_depois, turno.divergencias],
      [null, 'cadastro_concluido', []],
    );
  });

  test('a sombra grava o orçamento com o cliente vindo do ERP', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const orcamento = (banco.orcamentos_em_andamento as Record<string, unknown>[])[0];
    assert.deepEqual(
      [orcamento.modo, orcamento.etapa, (orcamento.dados as { cliente: { id: string; origem: string } }).cliente],
      ['sombra', 'cadastro_concluido', { id: 'Z00003/01', nome: 'Metalurgica Exemplo', origem: 'erp' }],
    );
  });

  test('responder sem consultar um CNPJ novo vira a divergência respondeu_sem_consultar', async () => {
    comRespostas([resposta('Beleza, já mando o orçamento.')]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    assert.deepEqual(soTurno().divergencias, ['respondeu_sem_consultar']);
  });

  test('mensagem sem documento abre o orçamento em aguardando_documento', async () => {
    comRespostas([resposta('Claro! Me passa o CPF ou CNPJ?')]);
    await entregar('quero um orçamento de vergalhão');

    assert.equal(soTurno().sombra_etapa_depois, 'aguardando_documento');
  });
});

describe('o rastreio nunca muda a resposta', () => {
  test('com a gravação quebrada, o cliente recebe exatamente o mesmo texto', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    quebrarRastreio = true;
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const enviado = http.chamadasWhatsApp.map(c => (c.corpo as { text?: { body?: string } }).text?.body);
    assert.deepEqual(enviado, [RESPOSTA_DO_CADASTRO]);
  });

  test('com a gravação quebrada, nada fica apontando para uma ficha que não existe', async () => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    quebrarRastreio = true;
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    assert.ok(banco.ai_usage.every(u => !u.turno_id) && banco.erp_chamadas.every(c => !c.turno_id));
  });
});

describe('outros roteiros e execuções que não terminam bem', () => {
  test('o número de atendimento grava a ficha, mas não a sombra', async () => {
    comRespostas([resposta('Oi! Posso ajudar?')]);
    await entregar('Bom dia', NUMERO_A);

    assert.deepEqual([soTurno().status, banco.orcamentos_em_andamento.length], ['respondeu', 0]);
  });

  test('erro do modelo fecha a ficha como erro, com a mensagem', async () => {
    comRespostas([{ status: 400 }]);
    await entregar(`cnpj ${CNPJ_FORMATADO}`);

    const turno = soTurno();
    assert.deepEqual([turno.status, typeof turno.erro], ['erro', 'string']);
  });

  test('uma execução que morre entre abrir e fechar fica em_andamento', async () => {
    const r = novoRastreio('varredura');
    await abrirTurno(clienteFalso as never, r, { orgId: ORG_A, conversationId: null });

    assert.equal(soTurno().status, 'em_andamento');
  });
});

describe('reconstruir um turno só com o que ficou gravado', () => {
  test('o relato traz a mensagem, a ferramenta, a chamada ao ERP, a sombra e a resposta', async t => {
    comRespostas([consulta, resposta(RESPOSTA_DO_CADASTRO)]);
    await entregar(`bom dia, meu cnpj é ${CNPJ_FORMATADO}`);

    const turno = soTurno() as unknown as TurnoGravado;
    const relato = reconstruirTurno({
      turno,
      textoDaMensagem: String(banco.messages.find(m => m.id === turno.mensagem_id)?.texto ?? ''),
      usos: banco.ai_usage.filter(u => u.turno_id === turno.id) as never,
      chamadas: banco.erp_chamadas.filter(c => c.turno_id === turno.id) as never,
    });
    t.diagnostic(`\n${relato}`);
    for (const trecho of ['meu cnpj é 45.723.174/0001-10', 'consultar_cliente', 'ERP: consultar_cliente ok',
      'Sombra: (sem orçamento) → cadastro_concluido', RESPOSTA_DO_CADASTRO]) {
      assert.ok(relato.includes(trecho), `faltou no relato: ${trecho}`);
    }
  });
});

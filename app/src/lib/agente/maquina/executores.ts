// Os executores de verdade da máquina (ERP, regiões, v2, IA) e a entrada que
// `responder-conversa.ts` chama com a chave ligada.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../supabase/database.types';
import { consultarClientePorDocumento } from '../../erp/operacoes/consultar-cliente';
import { criarCliente } from '../../erp/operacoes/criar-cliente';
import { cotarProdutos } from '../../erp/operacoes/cotar';
import { umaVezSo } from '../../erp/idempotencia';
import { quantidadeNaUnidadeDoErp } from '../../erp/unidade-do-erp';
import type { ClienteDoErp } from '../../erp/contrato';
import { buildSystemPrompt } from '../../simulador/build-prompt';
import { clienteAnthropic, type ClienteIA } from '../../v2/cache-ia';
import { armazemSupabase } from '../../v2/armazem';
import { listaDaV2, pedidoV2DeAntesDaMaquina, processarNaV2 } from '../../v2/integracao-v1';
import { conexaoDaFerramenta } from '../ferramentas/erp-apoio';
import { lembrarClienteDoErp } from '../ferramentas/memoria-do-erp';
import type { ContextoDaFerramenta } from '../ferramentas/tipos';
import { logAiUsage, MODELO_IA } from '../log-uso';
import { gravarEntrada, turnoIdGravado, type Rastreio } from '../rastreio/rastreio';
import { conduzirComFalasNovas, mensagemDaVez, type Executores, type ResultadoDaConducao } from './conduzir';
import { interpretarMensagem } from './interpretar';
import type { RegiaoDeEntrega } from './cidades';
import type { ClienteDoOrcamento } from './tipos';

type Client = SupabaseClient<Database>;

function doErp(c: ClienteDoErp): ClienteDoOrcamento {
  return {
    id: c.id, nome: c.nome, cidade: c.cidade ?? c.endereco?.cidade ?? null, uf: c.uf ?? c.endereco?.uf ?? null,
    situacao: c.situacao ?? null, pode_faturar: c.podeFaturar ?? null, confirmado: false, origem: 'erp',
    ...(c.formas_pagamento ? { formas_pagamento: c.formas_pagamento } : {}),
  };
}

/** No ensaio de 07/10, sem horário cadastrado, a IA respondeu "Sábado fechado". */
const NAO_INVENTE = 'Se a resposta não estiver nas informações acima, diga que vai confirmar com o vendedor. '
  + 'Nunca invente horário, endereço, preço, prazo, frete nem estoque. '
  // Teste de 22/10: "Vou consultar o orçamento e já te mando com o valor final", e quem manda é o vendedor.
  + 'Não prometa mandar valor, desconto nem orçamento, e não diga que vai consultar nada: quem manda o orçamento com os preços é o vendedor. '
  // Teste de 22/10, 12h: "O vendedor dessa região vai te atender agora mesmo", e ninguém foi avisado.
  + 'Não diga que vai passar para o vendedor ou para um atendente, nem que alguém vai entrar em contato.';

/** No topo do system, para valer acima do roteiro do painel (memória "exemplo-limites-do-motor"). */
const SO_RESPONDA = '## Sua tarefa agora (vale acima de tudo abaixo)\n'
  + 'Responda só à mensagem do cliente, em no máximo 2 frases curtas. Não faça pergunta nenhuma e não peça '
  + 'documento, cidade nem produto: o sistema faz a próxima pergunta logo depois da sua resposta. Responda em texto puro.\n'
  + `${NAO_INVENTE}\n\n`;
const RESPONDA_CURTO = `\n\n## Formato\nResponda em texto puro, no máximo 3 frases curtas de WhatsApp.\n${NAO_INVENTE}`;

interface Carregado {
  contactId: string | null;
  waNumberId: string | null;
  historico: { id: string; autor: string; texto: string; created_at: string }[];
}

async function carregar(supabase: Client, conversationId: string): Promise<Carregado> {
  const [{ data: conv }, { data: msgs, error }] = await Promise.all([
    supabase.from('conversations').select('contact_id, wa_number_id').eq('id', conversationId).maybeSingle(),
    supabase.from('messages').select('id, autor, texto, created_at').eq('conversation_id', conversationId)
      .order('created_at', { ascending: false }).limit(30),
  ]);
  if (error) throw new Error(`Máquina: mensagens: ${error.message}`);
  return {
    contactId: conv?.contact_id ?? null,
    waNumberId: conv?.wa_number_id ?? null,
    historico: [...(msgs ?? [])].reverse().map(m => ({ id: m.id, autor: m.autor, texto: m.texto ?? '', created_at: m.created_at })),
  };
}

/** O contexto que as funções do ERP já sabem usar (registro da chamada, ficha do contato). */
async function contextoDoErp(supabase: Client, orgId: string, conversationId: string, c: Carregado, mensagemId: string, rastreio?: Rastreio): Promise<ContextoDaFerramenta> {
  const [{ data: contato }, { data: numero }] = await Promise.all([
    c.contactId ? supabase.from('contacts').select('nome, telefone').eq('id', c.contactId).maybeSingle() : Promise.resolve({ data: null }),
    c.waNumberId ? supabase.from('wa_numbers').select('member_id').eq('id', c.waNumberId).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  let vendedor: ContextoDaFerramenta['vendedor'] = null;
  if (numero?.member_id) {
    const { data: m } = await supabase.from('organization_members').select('id, nome, codigo_erp, telefone_whatsapp').eq('id', numero.member_id).maybeSingle();
    if (m) vendedor = { memberId: m.id, nome: m.nome, codigoErp: m.codigo_erp ?? '', telefoneWhatsapp: m.telefone_whatsapp ?? '' };
  }
  return {
    supabase, orgId, conversationId, contactId: c.contactId, waNumberId: c.waNumberId, roteiro: 'vendas',
    contatoNome: contato?.nome ?? '', contatoTelefone: contato?.telefone ?? null, vendedor, mensagemId, rastreio,
  };
}

function executoresReais(
  supabase: Client, orgId: string, conversationId: string, c: Carregado, ctx: ContextoDaFerramenta, ia: ClienteIA, rastreio?: Rastreio,
): Executores {
  let regioes: Promise<RegiaoDeEntrega[]> | null = null;
  const turnoId = turnoIdGravado(rastreio);
  const registrar = (nome: string, entrada: unknown, ok: boolean, inicio: number) =>
    rastreio?.ferramentas.push({ nome, entrada, ok, duracao_ms: Date.now() - inicio, erp_chamadas: [] });

  return {
    interpretar: (estado, perguntaFeita, fala) =>
      interpretarMensagem(supabase, ia, { orgId, conversationId, turnoId }, estado, perguntaFeita, fala),

    async consultarCliente(documento) {
      const inicio = Date.now();
      const conexao = await conexaoDaFerramenta(ctx);
      if (!conexao.ok) return { resultado: 'falhou' };
      const r = await consultarClientePorDocumento(conexao.conexao, documento);
      registrar('consultar_cliente', { documento }, r.ok, inicio);
      if (!r.ok) return { resultado: 'falhou' };
      if (!r.dados.encontrado) return { resultado: 'nao_encontrado' };
      await lembrarClienteDoErp(supabase, conversationId, { ...r.dados.cliente, documento: r.dados.cliente.documento ?? documento }, ctx);
      return { resultado: 'encontrado', cliente: doErp(r.dados.cliente) };
    },

    async cadastrarCliente(documento, campos, chave) {
      const inicio = Date.now();
      const conexao = await conexaoDaFerramenta(ctx);
      if (!conexao.ok) return { resultado: 'falhou' };
      const dados = {
        documento,
        nome: campos.nome ?? '',
        telefone: ctx.contatoTelefone ?? null,
        email: null,
        inscricaoEstadual: campos.inscricao_estadual ?? null,
        endereco: {
          logradouro: campos.logradouro ?? '', numero: campos.numero ?? '', complemento: null, bairro: campos.bairro ?? null,
          cidade: campos.cidade ?? '', uf: campos.uf ?? '', cep: campos.cep ?? '',
        },
        vendedorId: ctx.vendedor?.codigoErp || null,
      };
      const r = await umaVezSo(
        { supabase, orgId, conversationId, mensagemId: chave }, 'criar_cliente', dados,
        async (chaveHttp) => { const x = await criarCliente(conexao.conexao, dados, chaveHttp); return { ok: x.ok, valor: x }; },
      );
      if (r.estado === 'em-andamento' || r.estado === 'falhou') return { resultado: 'falhou' };
      const x = r.dados;
      registrar('cadastrar_cliente', { documento }, x.ok, inicio);
      if (x.ok) {
        await lembrarClienteDoErp(supabase, conversationId, x.dados, ctx, 'cadastro');
        return { resultado: 'criado', cliente: doErp(x.dados) };
      }
      if (x.motivo !== 'recusado') return { resultado: 'falhou' };
      if ((x.codigo ?? '').toLowerCase() === 'documento_ja_cadastrado') return { resultado: 'ja_existe' };
      return { resultado: 'recusado', campo: x.campo ?? null };
    },

    regioes() {
      regioes ??= (async () => {
        const { data, error } = await supabase.from('erp_regioes').select('regiao_id, cidades').eq('organization_id', orgId).eq('ativo', true);
        if (error) throw new Error(`Máquina: regiões: ${error.message}`);
        return (data ?? []).map(r => ({ regiao_id: r.regiao_id, cidades: (r.cidades ?? []) as RegiaoDeEntrega['cidades'] }));
      })();
      return regioes;
    },

    v2: (pedidoId, texto) => processarNaV2(supabase as unknown as SupabaseClient, orgId, conversationId, pedidoId, texto),
    listaDaV2: (pedidoId) => listaDaV2(supabase as unknown as SupabaseClient, orgId, conversationId, pedidoId),

    async responderLivre(comPerguntaDepois) {
      const montado = (await buildSystemPrompt(supabase, orgId, c.waNumberId)).systemPrompt;
      // O modelo não reage à FALTA de informação (memória "exemplo-limites-do-motor"):
      // sem horário cadastrado ele inventou "sábado fechado". Precisa do aviso positivo.
      const systemPrompt = montado.includes('## Horário de funcionamento')
        ? montado
        : `${montado}\n\n## Horário de funcionamento\nNão cadastrado. Se perguntarem, diga que vai confirmar com o vendedor.`;
      const conversa = c.historico.filter(m => m.autor === 'cliente' || m.autor === 'ia').slice(-6)
        .map(m => ({ role: m.autor === 'cliente' ? 'user' : 'assistant', content: m.texto }));
      while (conversa.length && conversa[0].role === 'assistant') conversa.shift();
      const r = await ia.chamar({
        model: MODELO_IA,
        max_tokens: 300,
        system: comPerguntaDepois ? `${SO_RESPONDA}${systemPrompt}` : `${systemPrompt}${RESPONDA_CURTO}`,
        messages: conversa,
      });
      await logAiUsage(supabase, { orgId, origem: 'motor', model: MODELO_IA, usage: r.uso, conversationId, turnoId });
      return r.texto;
    },

    async cotar(condicao, clienteId, itens) {
      const inicio = Date.now();
      const quantidades = itens.map(i => Number(String(i.quantidade ?? '').replace(',', '.')));
      if (quantidades.some(q => !Number.isFinite(q) || q <= 0)) {
        return { resultado: 'falhou', codigo: 'quantidade_invalida', mensagem: 'Item da lista sem quantidade.' };
      }
      const conexao = await conexaoDaFerramenta(ctx);
      if (!conexao.ok) return { resultado: 'falhou', codigo: 'sem_conexao', mensagem: 'Sem conexão com o ERP.' };
      const { data: unidades, error: erroDasUnidades } = await supabase.from('catalogo_produtos').select('codigo, unidade')
        .eq('organization_id', orgId).in('codigo', itens.map(i => i.codigo));
      if (erroDasUnidades) return { resultado: 'falhou', codigo: 'sem_catalogo', mensagem: 'Não consegui ler a unidade dos produtos.' };
      const unidadeDe = new Map((unidades ?? []).map(u => [u.codigo, u.unidade]));
      const r = await cotarProdutos(conexao.conexao, {
        clienteId, vendedorId: ctx.vendedor?.codigoErp || null, condicaoPagamento: condicao,
        itens: itens.map((i, n) => ({ produto_codigo: i.codigo, quantidade: quantidadeNaUnidadeDoErp(quantidades[n], unidadeDe.get(i.codigo)) })),
      });
      registrar('cotar', { condicao, itens: itens.length }, r.ok, inicio);
      if (!r.ok) return { resultado: 'falhou', codigo: r.codigo, mensagem: r.mensagem };
      return {
        resultado: 'ok',
        cotacao: {
          condicao: r.dados.condicao_pagamento ?? condicao,
          valor_total: r.dados.valor_total,
          consultado_em: r.dados.consultado_em ?? null,
          itens: r.dados.itens.map(i => ({
            codigo: i.produto_codigo, quantidade: i.quantidade, preco_unitario: i.preco_unitario, valor_total: i.valor_total,
            estoque_disponivel: i.estoque_disponivel ?? null, empresa: i.empresa ?? null,
          })),
        },
      };
    },

    async pedidoV2DeAntes() {
      return !!(await pedidoV2DeAntesDaMaquina(supabase as unknown as SupabaseClient, orgId, conversationId));
    },

    // O `v2_pedidos` só conhece 'confirmado' como fechado (CHECK da migration 20261005000001): é o
    // mesmo jeito de fechar do reset de orçamento de teste. A lista não vai a lugar nenhum por isso.
    async fecharPedidoV2(pedidoId) {
      await armazemSupabase(supabase as unknown as SupabaseClient, orgId).atualizarPedido(pedidoId, { estado: 'confirmado' });
    },
  };
}

/** `transferir`: a 3ª vez sem entender (válvula de escape, 22/10); a conversa passa para uma pessoa. */
export type RespostaDaMaquina = { resposta: string; naoResponder?: undefined; transferir?: true } | { resposta: ''; naoResponder: string; transferir?: undefined };

/**
 * A entrada da máquina no motor. Null: não é com ela (a conversa já estava na
 * v2 antes de a chave ligar), e o caminho de antes responde.
 */
export async function conduzirOrcamento(
  supabase: Client, orgId: string, conversationId: string, rastreio?: Rastreio,
): Promise<RespostaDaMaquina | null> {
  const c = await carregar(supabase, conversationId);
  const daVez = mensagemDaVez(c.historico);
  if ('naoResponder' in daVez) return { resposta: '', naoResponder: daVez.naoResponder };
  const { vez } = daVez;

  if (rastreio) {
    rastreio.entrada = { mensagemId: vez.mensagemId, roteiro: 'vendas', system: '', mensagens: [], falaDoCliente: vez.texto, contactId: c.contactId };
    await gravarEntrada(supabase, rastreio);
  }

  const ctx = await contextoDoErp(supabase, orgId, conversationId, c, vez.mensagemId, rastreio);
  const ex = executoresReais(supabase, orgId, conversationId, c, ctx, await clienteAnthropic(), rastreio);
  // As falas que chegarem enquanto esta execução pensa são conduzidas por ela mesma (item 3, 22/10).
  const r: ResultadoDaConducao = await conduzirComFalasNovas(
    supabase, { orgId, conversationId, contactId: c.contactId, waNumberId: c.waNumberId }, vez, ex,
    async () => (await carregar(supabase, conversationId)).historico, rastreio,
  );
  if (r.tipo === 'caminho_antigo') return null;
  if (r.tipo === 'nao_responder') return { resposta: '', naoResponder: r.motivo };
  return r.transferir ? { resposta: r.resposta, transferir: true } : { resposta: r.resposta };
}

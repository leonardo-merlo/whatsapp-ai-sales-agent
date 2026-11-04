// Carga inicial de dados da organização — roda no Server Component
// (app)/layout.tsx e alimenta o estado do reducer no client.

import { lerDadosDeSaude } from '../saude';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { InitialData, ProximoCompromisso, Sucessos, QuestionarioResposta, RespostaItem, TipoSucesso } from '../types';
import { SUCESSOS_PADRAO } from '../types';
import {
  mapContato, mapConversa, mapAgendaItem, mapCampanha, mapTemplate,
  mapAgente, mapPlano, mapFatura, mapConhecimentoOrg, mapDisponibilidade, fmtDataBR, type MembrosPorId,
} from './mappers';
import { diaEmSP, diaDaSemanaDoISO, hojeEmSP, horaDoDiaEmSP } from '../fuso';

type Client = SupabaseClient<Database>;

/**
 * Qual número representa a empresa nas telas (selo da conexão, remetente do
 * simulador).
 *
 * Não existe "número oficial" na Meta: uma conta pode ter vários, e o que
 * diferencia um do outro é o papel. O de atendimento é o que fala com o
 * cliente final em nome da empresa, então é ele. Uma empresa só de Vendas não
 * tem nenhum, e aí vale o primeiro ativo — melhor um número certo de vendedor
 * do que um campo vazio.
 */
function numeroDaEmpresa(numeros: { telefone: string | null; papel: string; ativo: boolean }[]): string {
  const ativos = numeros.filter(n => n.ativo);
  const atendimento = ativos.find(n => n.papel === 'atendimento');
  return (atendimento ?? ativos[0])?.telefone ?? '';
}

export async function fetchInitialData(supabase: Client, orgId: string): Promise<InitialData> {
  // Uma assinatura só vale enquanto o período pago não venceu (periodo_fim >= hoje).
  const hojeGating = hojeEmSP();
  const [
    contacts, contactHistory, conversations, messages, convTags,
    appointments, campaigns, templates, categorias,
    members, agentPrices, agentHours, agentFaqs, agentKnowledge,
    agentConfig, clinicPrices, clinicHours, clinicFaqs, clinicPerguntas, clinicGatilhos,
    organization, subscription, plans, invoices, customFieldDefs,
    labels, contactLabels, conversationLabels, questionarioRespostas, availability,
    quickReplies, notificacoes, vendasPendentes, vendasConfirmadas, numerosConectados, textosDoCatalogo,
  ] = await Promise.all([
    supabase.from('contacts').select('*').eq('organization_id', orgId).order('nome'),
    supabase.from('contact_history').select('*').eq('organization_id', orgId),
    supabase.from('conversations').select('*').eq('organization_id', orgId).order('updated_at', { ascending: false }),
    supabase.from('messages').select('*').eq('organization_id', orgId),
    supabase.from('conversation_tags').select('*').eq('organization_id', orgId),
    supabase.from('appointments').select('*').eq('organization_id', orgId).order('data'),
    supabase.from('campaigns').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    // Catálogo da Meta. O que o cliente escolhe para enviar precisa estar aprovado,
    // mas a lista vem inteira: quem filtra é a tela, que explica o que falta.
    supabase.from('wa_templates').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('campaign_categories').select('*').eq('organization_id', orgId).order('nome'),
    supabase.from('organization_members').select('*').eq('organization_id', orgId).order('created_at'),
    supabase.from('agent_prices').select('*').eq('organization_id', orgId),
    supabase.from('agent_business_hours').select('*').eq('organization_id', orgId),
    supabase.from('agent_faqs').select('*').eq('organization_id', orgId),
    supabase.from('agent_knowledge').select('*').eq('organization_id', orgId),
    // A tela do painel edita sempre a configuração DA EMPRESA TODA; roteiro por
    // número não tem tela ainda (ver docs/progresso-bloco-a.md).
    supabase.from('ai_agent_config').select('*').eq('organization_id', orgId).is('wa_number_id', null).maybeSingle(),
    supabase.from('business_prices').select('*').eq('organization_id', orgId),
    supabase.from('business_hours').select('*').eq('organization_id', orgId),
    supabase.from('business_faqs').select('*').eq('organization_id', orgId),
    supabase.from('business_qualification_questions').select('*').eq('organization_id', orgId),
    supabase.from('business_triggers').select('*').eq('organization_id', orgId),
    supabase.from('organizations').select('*').eq('id', orgId).single(),
    supabase.from('subscriptions').select('*, plans(key)').eq('organization_id', orgId).eq('status', 'ativa').or(`periodo_fim.is.null,periodo_fim.gte.${hojeGating}`).maybeSingle(),
    supabase.from('plans').select('*').order('preco_centavos'),
    supabase.from('invoices').select('*').eq('organization_id', orgId).neq('status', 'cancelado').order('created_at', { ascending: false }),
    supabase.from('custom_field_definitions').select('*').eq('organization_id', orgId).order('ordem'),
    supabase.from('labels').select('*').eq('organization_id', orgId).order('nome'),
    supabase.from('contact_labels').select('contact_id, label_id'),
    supabase.from('conversation_labels').select('conversation_id, label_id'),
    supabase.from('questionnaire_responses').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('availability').select('*').eq('organization_id', orgId),
    supabase.from('quick_replies').select('*').eq('organization_id', orgId).order('ordem').order('created_at'),
    // Sino de notificações: só o que ainda importa ver. Descartadas ficam fora.
    // A RLS restringe a owner/admin — para atendente isso volta vazio.
    supabase.from('notificacoes').select('*').eq('organization_id', orgId)
      .neq('status', 'descartada').order('created_at', { ascending: false }).limit(40),
    // Itens vêm embutidos e o filtro de status limita o volume: só venda aberta
    // aguardando aprovação de baixa.
    supabase.from('sales').select('*, sale_items(*)').eq('organization_id', orgId).eq('status', 'pendente'),
    // Cards de faturamento do painel: só venda com baixa aprovada conta, e só
    // até 90 dias — é o período mais longo que o painel oferece.
    supabase.from('sales').select('created_at, valor_total_centavos, sale_items(nome_snapshot, quantidade, valor_unit_centavos)')
      .eq('organization_id', orgId).eq('status', 'confirmada')
      .gte('created_at', new Date(Date.now() - 90 * 86400000).toISOString()),
    // Os números conectados são a fonte de verdade de qual é o WhatsApp da
    // empresa. Antes isso vinha de `organizations.wa_number`, um campo de
    // texto digitado à mão que ninguém atualizava numa reconexão.
    supabase.from('wa_numbers').select('id, telefone, papel, ativo, waba_id').eq('organization_id', orgId).order('created_at'),
    // Dicionário e regras do catálogo: gravam com o Salvar da tela Conhecimento.
    supabase.from('catalogo_config').select('dicionario, regras').eq('organization_id', orgId).maybeSingle(),
  ]);

  const questionariosPorContato = new Map<string, QuestionarioResposta[]>();
  (questionarioRespostas.data ?? []).forEach(r => {
    const arr = questionariosPorContato.get(r.contact_id) ?? [];
    arr.push({
      id: r.id,
      data: fmtDataBR(r.created_at),
      resultado: (r.resultado as TipoSucesso | null) ?? null,
      respostas: (r.respostas as unknown as RespostaItem[] | null) ?? [],
    });
    questionariosPorContato.set(r.contact_id, arr);
  });

  // labelIds por contato (contact_labels não tem organization_id; a RLS já
  // restringe à org, então basta agrupar por contact_id).
  const labelIdsPorContato = new Map<string, string[]>();
  (contactLabels.data ?? []).forEach(cl => {
    const arr = labelIdsPorContato.get(cl.contact_id) ?? [];
    arr.push(cl.label_id);
    labelIdsPorContato.set(cl.contact_id, arr);
  });

  const labelIdsPorConversa = new Map<string, string[]>();
  (conversationLabels.data ?? []).forEach(cl => {
    const arr = labelIdsPorConversa.get(cl.conversation_id) ?? [];
    arr.push(cl.label_id);
    labelIdsPorConversa.set(cl.conversation_id, arr);
  });

  if (members.error) throw new Error(`Falha ao carregar equipe: ${members.error.message}`);
  const membrosRows = members.data ?? [];
  const membros: MembrosPorId = new Map(membrosRows.map(m => [m.id, m]));

  const msgsRows = messages.data ?? [];
  const tagsRows = convTags.data ?? [];
  const templatesRows = templates.data ?? [];
  const categoriasRows = categorias.data ?? [];

  const cfg = agentConfig.data;
  const conhecimento = mapConhecimentoOrg({
    prices: clinicPrices.data ?? [],
    hours: clinicHours.data ?? [],
    faqs: clinicFaqs.data ?? [],
    perguntas: clinicPerguntas.data ?? [],
    gatilhos: clinicGatilhos.data ?? [],
  });

  const fallbackMembro = cfg?.fallback_atendente_id ? membros.get(cfg.fallback_atendente_id) : undefined;
  const orgRow = organization.data;

  // ── Notificações do sino ──
  // O estoque atual de cada item sai do catálogo já carregado (clinicPrices),
  // então a notificação mostra o saldo de agora, não o de quando a venda entrou.
  const estoquePorProduto = new Map(
    (clinicPrices.data ?? []).map(p => [p.id, { controla: p.controla_estoque, qtd: p.estoque_qtd }]),
  );
  const nomePorContato = new Map((contacts.data ?? []).map(c => [c.id, c.nome]));
  const vendaPorId = new Map((vendasPendentes.data ?? []).map(v => [v.id, v]));

  const notificacoesMapeadas = (notificacoes.data ?? []).map(n => {
    const venda = n.sale_id ? vendaPorId.get(n.sale_id) : undefined;
    return {
      id: n.id,
      tipo: n.tipo,
      titulo: n.titulo,
      corpo: n.corpo,
      criadaEm: n.created_at,
      lida: n.lida_em !== null,
      saleId: n.sale_id,
      contatoNome: venda?.contact_id ? (nomePorContato.get(venda.contact_id) ?? null) : null,
      itens: (venda?.sale_items ?? []).map(it => {
        const est = it.product_id ? estoquePorProduto.get(it.product_id) : undefined;
        return {
          produtoId: it.product_id,
          nome: it.nome_snapshot,
          quantidade: it.quantidade,
          valorUnitCentavos: it.valor_unit_centavos,
          controlaEstoque: est?.controla ?? false,
          estoqueAtual: est?.qtd ?? null,
        };
      }),
    };
  });

  // ── Estatísticas do painel (calculadas dos dados brutos) ──
  const agora = Date.now();
  const dia = 86400000;
  const msgsCliente = msgsRows.filter(m => m.autor === 'cliente');

  const inicioDoMes = new Date();
  inicioDoMes.setUTCDate(1);
  inicioDoMes.setUTCHours(0, 0, 0, 0);
  const msgsUsadasMes = msgsRows.filter(m => m.autor === 'ia' && new Date(m.created_at) >= inicioDoMes).length;

  const convsComClienteDesde = (ms: number) => new Set(
    msgsCliente.filter(m => agora - new Date(m.created_at).getTime() < ms).map(m => m.conversation_id),
  ).size;

  const contatosDesde = (ms: number) =>
    (contacts.data ?? []).filter(c => agora - new Date(c.created_at).getTime() < ms).length;

  const DIAS_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const dias = Array.from({ length: 7 }, (_, i) => {
    const chave = diaEmSP(agora - (6 - i) * dia);
    const convsNoDia = new Set(
      msgsCliente.filter(m => diaEmSP(m.created_at) === chave).map(m => m.conversation_id),
    ).size;
    return { dia: i === 6 ? 'Hoje' : DIAS_LABEL[diaDaSemanaDoISO(chave)], valor: convsNoDia, hoje: i === 6 };
  });

  const horas = [8, 10, 12, 14, 16, 18, 20].map(h => ({
    hora: `${h}h`,
    valor: msgsCliente.filter(m => {
      const mh = horaDoDiaEmSP(m.created_at);
      return mh >= h && mh < h + 2;
    }).length,
  }));

  // ── Vendas confirmadas (cards de faturamento) ──
  const vendasRows = vendasConfirmadas.data ?? [];
  const vendasDesde = (ms: number) => vendasRows.filter(v => agora - new Date(v.created_at).getTime() < ms);
  const somaCentavos = (rows: typeof vendasRows) => rows.reduce((a, v) => a + v.valor_total_centavos, 0);

  const porProduto = new Map<string, { unidades: number; valorCentavos: number }>();
  vendasRows.forEach(v => v.sale_items.forEach(it => {
    const atual = porProduto.get(it.nome_snapshot) ?? { unidades: 0, valorCentavos: 0 };
    atual.unidades += it.quantidade;
    atual.valorCentavos += it.quantidade * it.valor_unit_centavos;
    porProduto.set(it.nome_snapshot, atual);
  }));
  const produtosVendidos = [...porProduto.entries()]
    .sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 5)
    .map(([nome, v]) => ({ nome, unidades: v.unidades, valorCentavos: v.valorCentavos }));

  // Transferência para humano não tem tipo próprio no schema — o registro é a
  // mensagem `sys` que o webhook grava. Casar pelo prefixo do texto é frágil de
  // propósito reconhecido: se o texto mudar, o insight some, mas nada quebra.
  const PREFIXO_TRANSFERENCIA = 'Conversa transferida';
  const transferencias30d = msgsRows.filter(m =>
    m.autor === 'sys'
    && m.texto.startsWith(PREFIXO_TRANSFERENCIA)
    && agora - new Date(m.created_at).getTime() < 30 * dia,
  ).length;

  const porServico = new Map<string, number>();
  (appointments.data ?? []).forEach(a => porServico.set(a.servico, (porServico.get(a.servico) ?? 0) + 1));
  const totalAgs = (appointments.data ?? []).length || 1;
  const tipos = [...porServico.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([tipo, n]) => ({ tipo, valor: Math.round((n / totalAgs) * 100) }));

  // Última mensagem por contato (via conversas)
  const convParaContato = new Map<string, string>();
  (conversations.data ?? []).forEach(c => convParaContato.set(c.id, c.contact_id));
  const ultimaMsgPorContato = new Map<string, string>();
  msgsRows.forEach(m => {
    const cid = convParaContato.get(m.conversation_id);
    if (!cid) return;
    const atual = ultimaMsgPorContato.get(cid);
    if (!atual || m.created_at > atual) ultimaMsgPorContato.set(cid, m.created_at);
  });

  // Próximo compromisso futuro (não cancelado) por contato
  const hojeIso = hojeEmSP();
  const proximoPorContato = new Map<string, ProximoCompromisso>();
  (appointments.data ?? [])
    .filter(a => a.contact_id && a.status !== 'cancelado' && a.data >= hojeIso)
    .sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora))
    .forEach(a => {
      if (proximoPorContato.has(a.contact_id!)) return;
      proximoPorContato.set(a.contact_id!, {
        data: fmtDataBR(a.data),
        hora: a.hora,
        servico: a.servico,
        atendente: a.atendente_id ? (membros.get(a.atendente_id)?.nome ?? '—') : '—',
      });
    });

  return {
    painel: {
      dias,
      horas,
      tipos,
      interagindo: { d7: convsComClienteDesde(7 * dia), d30: convsComClienteDesde(30 * dia), d90: convsComClienteDesde(90 * dia) },
      novosContatos: { d7: contatosDesde(7 * dia), d30: contatosDesde(30 * dia), d90: contatosDesde(90 * dia) },
      valorVendas: {
        d7: somaCentavos(vendasDesde(7 * dia)),
        d30: somaCentavos(vendasDesde(30 * dia)),
        d90: somaCentavos(vendasDesde(90 * dia)),
      },
      qtdVendas: {
        d7: vendasDesde(7 * dia).length,
        d30: vendasDesde(30 * dia).length,
        d90: vendasDesde(90 * dia).length,
      },
      produtosVendidos,
      transferencias30d,
    },
    contatos: (contacts.data ?? []).map(c => mapContato(
      c, contactHistory.data ?? [], membros,
      ultimaMsgPorContato.get(c.id) ?? null,
      proximoPorContato.get(c.id) ?? null,
      labelIdsPorContato.get(c.id) ?? [],
      questionariosPorContato.get(c.id) ?? [],
    )),
    customFieldDefs: (customFieldDefs.data ?? []).map(d => ({ key: d.key, label: d.label })),
    labels: (labels.data ?? []).map(l => ({ id: l.id, nome: l.nome, cor: l.cor })),
    respostasProntas: (quickReplies.data ?? []).map(r => ({ id: r.id, titulo: r.titulo, texto: r.texto })),
    conversas: (conversations.data ?? []).map(c => mapConversa(c, msgsRows, tagsRows, membros, labelIdsPorConversa.get(c.id) ?? [])),
    agendaItens: (appointments.data ?? [])
      .filter(a => a.status !== 'cancelado')
      .map(a => mapAgendaItem(a, membros)),
    disponibilidades: (availability.data ?? []).map(mapDisponibilidade),
    campanhas: (campaigns.data ?? []).map(c => mapCampanha(c, templatesRows, categoriasRows)),
    templates: templatesRows.map(mapTemplate),
    campCategorias: categoriasRows.map(c => c.nome),
    agentesData: membrosRows.map(m => mapAgente(
      m, agentPrices.data ?? [], agentHours.data ?? [], agentFaqs.data ?? [], agentKnowledge.data ?? [],
    )),
    planos: (plans.data ?? []).map(mapPlano),
    planoAtual: (subscription.data?.plans as { key: string } | null)?.key ?? '',
    assinatura: subscription.data ? {
      metodoPagamento: subscription.data.metodo_pagamento === 'PIX' || subscription.data.metodo_pagamento === 'CREDIT_CARD' ? subscription.data.metodo_pagamento : null,
      intervalo: subscription.data.intervalo === 'mensal' || subscription.data.intervalo === 'anual' ? subscription.data.intervalo : null,
      renovaAutomatico: subscription.data.renova_automatico,
      validoAte: subscription.data.periodo_fim ? fmtDataBR(subscription.data.periodo_fim) : null,
    } : null,
    faturas: (invoices.data ?? []).map(mapFatura),
    msgsUsadasMes,
    cl: {
      razao: orgRow?.nome ?? '',
      // Orgs criadas antes da separação (20260731000003) têm fantasia vazia até
      // alguém editar; nesse caso o nome jurídico é o melhor rótulo disponível.
      fantasia: orgRow?.nome_fantasia || (orgRow?.nome ?? ''),
      cnpj: orgRow?.cnpj ?? '',
      endereco: orgRow?.endereco ?? '',
      telefone: orgRow?.telefone ?? '',
      descricao: orgRow?.descricao ?? '',
    },
    dadosSaude: lerDadosDeSaude(orgRow?.dados_saude),
    textosDoCatalogo: { dicionario: textosDoCatalogo.data?.dicionario ?? '', regras: textosDoCatalogo.data?.regras ?? '' },
    // O número que representa a empresa é o de atendimento; sem ele, o
    // primeiro que estiver ativo (uma empresa de Vendas só tem vendedores e
    // copiloto). `organizations.wa_number` fica para trás de propósito: era
    // texto livre, e texto livre envelhece sem ninguém perceber.
    waNumber: numeroDaEmpresa(numerosConectados.data ?? []),
    waConectado: (numerosConectados.data ?? []).length > 0,
    numeros: (numerosConectados.data ?? []).map(n => ({ id: n.id, telefone: n.telefone, papel: n.papel, ativo: n.ativo, wabaId: n.waba_id })),
    notificacoes: notificacoesMapeadas,
    agente: {
      ativo: cfg?.ativo ?? true,
      welcomeMsg: cfg?.welcome_msg ?? '',
      agentPrompt: cfg?.prompt ?? '',
      limitacoes: cfg?.limitacoes ?? '',
      tom: cfg?.tom ?? 'simpatico',
      fallbackMode: cfg?.fallback_mode === 'transferir' ? 'atendente' : 'mensagem',
      fallbackMsg: cfg?.fallback_msg ?? '',
      fallbackAtendente: fallbackMembro ? `${fallbackMembro.nome} — ${fallbackMembro.cargo}` : '',
      horarioVinculaAgenda: cfg?.horario_vincula_agenda ?? false,
      notifNova: cfg?.notif_nova_conversa ?? true,
      notifExcedido: cfg?.notif_excedido ?? true,
      notifResumo: cfg?.notif_resumo ?? true,
      ...conhecimento,
      sucessos: (cfg?.sucessos as unknown as Sucessos | null) ?? SUCESSOS_PADRAO,
      infoAdicional: cfg?.info_adicional ?? '',
      horario: conhecimento.horario,
    },
  };
}

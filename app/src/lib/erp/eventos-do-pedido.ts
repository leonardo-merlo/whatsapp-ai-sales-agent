// Os eventos de status do pedido que o ERP do cliente manda (contrato v5, aba "Eventos de status").
//
// Esta parte não toca banco nem rede: lê o envelope, decide o que muda no pedido e qual mensagem
// sai, e para quem. A rota (`api/integracoes/exemplo/eventos`) grava e o aviso
// (`avisar-status-do-pedido.ts`) envia. Separado assim, cada regra se testa sem servidor.
//
// O texto que o cliente lê é montado aqui, com os dados do evento: a IA não escreve nada disso.

export type Destinatario = 'cliente' | 'vendedor';

interface TipoDeEvento {
  status: string;
  vai: Destinatario;
  /** Template da Meta, usado fora da janela de 24 h. */
  template: string;
  /** Os nomes das variáveis do template, na ordem {{1}}, {{2}}... */
  variaveis: readonly string[];
  /** O texto que vai ao cliente (dentro da janela) e fica na conversa. */
  texto: (v: Record<string, string>) => string;
}

const AO_VENDEDOR = (v: Record<string, string>): string =>
  `Aviso de pedido: ${v.situacao} no pedido ${v.pedido}, cliente ${v.cliente}. Motivo: ${v.motivo}. Fale com o cliente pelo seu WhatsApp.`;

export const TIPOS_DE_EVENTO: Record<string, TipoDeEvento> = {
  'pedido.validacao_recusada': {
    status: 'VALIDACAO_RECUSADA', vai: 'vendedor', template: 'pedido_aviso_ao_vendedor', variaveis: ['situacao', 'pedido', 'cliente', 'motivo'],
    texto: AO_VENDEDOR,
  },
  'pedido.aguardando_pagamento': {
    status: 'AGUARDANDO_PAGAMENTO', vai: 'cliente', template: 'pedido_aguardando_pagamento', variaveis: ['pedido', 'link', 'prazo'],
    texto: v => `Seu pedido ${v.pedido} foi criado. Para concluir, é só pagar por este link: ${v.link}. O link vale até ${v.prazo}.`,
  },
  'pedido.pago': {
    status: 'PAGO', vai: 'cliente', template: 'pedido_pago', variaveis: ['pedido'],
    texto: v => `Pagamento do pedido ${v.pedido} confirmado. Te aviso por aqui quando ele for faturado.`,
  },
  'pedido.cancelado': {
    status: 'CANCELADO', vai: 'cliente', template: 'pedido_cancelado', variaveis: ['pedido'],
    texto: v => `O pedido ${v.pedido} foi cancelado. Se ainda quiser o material, é só responder esta mensagem que eu refaço o orçamento.`,
  },
  'pedido.faturado': {
    status: 'FATURADO', vai: 'cliente', template: 'pedido_faturado', variaveis: ['pedido', 'nota'],
    texto: v => `Pedido ${v.pedido} faturado, nota fiscal ${v.nota}. O próximo passo é a separação do material.`,
  },
  'pedido.erro_faturamento': {
    status: 'ERRO_FATURAMENTO', vai: 'vendedor', template: 'pedido_aviso_ao_vendedor', variaveis: ['situacao', 'pedido', 'cliente', 'motivo'],
    texto: AO_VENDEDOR,
  },
  'pedido.pronto_para_retirada': {
    status: 'PRONTO_PARA_RETIRADA', vai: 'cliente', template: 'pedido_pronto_para_retirada', variaveis: ['pedido', 'loja', 'prazo'],
    texto: v => `Seu pedido ${v.pedido} está separado e pronto para retirada na ${v.loja}, até ${v.prazo}. Leve um documento com foto.`,
  },
  'pedido.retirado': {
    status: 'RETIRADO_NA_LOJA', vai: 'cliente', template: 'pedido_retirado', variaveis: ['pedido'],
    texto: v => `Retirada do pedido ${v.pedido} confirmada. Obrigado pela compra, qualquer coisa é só chamar.`,
  },
  'pedido.em_separacao': {
    status: 'EM_SEPARACAO', vai: 'cliente', template: 'pedido_em_separacao', variaveis: ['pedido'],
    texto: v => `Seu pedido ${v.pedido} está em separação. Te aviso quando ele sair para entrega.`,
  },
  'pedido.saiu_para_entrega': {
    status: 'SAIU_PARA_ENTREGA', vai: 'cliente', template: 'pedido_saiu_para_entrega', variaveis: ['pedido'],
    texto: v => `Pedido ${v.pedido} saiu para entrega. Deixe alguém no local para receber e conferir o material.`,
  },
  'pedido.entregue': {
    status: 'ENTREGA_REALIZADA', vai: 'cliente', template: 'pedido_entregue', variaveis: ['pedido'],
    texto: v => `Entrega do pedido ${v.pedido} concluída. Obrigado pela compra, qualquer coisa é só chamar.`,
  },
  'pedido.entrega_nao_realizada': {
    status: 'ENTREGA_NAO_REALIZADA', vai: 'cliente', template: 'pedido_entrega_nao_realizada', variaveis: ['pedido', 'motivo', 'vendedor'],
    texto: v => `Não conseguimos entregar o pedido ${v.pedido}. Motivo: ${v.motivo}. Já avisei ${v.vendedor}, que vai te chamar para remarcar.`,
  },
  'devolucao.saiu_para_coleta': {
    status: 'DEVOLUCAO_EM_COLETA', vai: 'cliente', template: 'devolucao_em_coleta', variaveis: ['pedido'],
    texto: v => `A coleta da devolução do pedido ${v.pedido} foi programada. Deixe o material separado para o motorista.`,
  },
  'devolucao.coletada': {
    status: 'DEVOLUCAO_COLETADA', vai: 'cliente', template: 'devolucao_coletada', variaveis: ['pedido'],
    texto: v => `Material da devolução do pedido ${v.pedido} coletado. Assim que der entrada, eu confirmo por aqui.`,
  },
  'devolucao.concluida': {
    status: 'DEVOLUCAO_CONCLUIDA', vai: 'cliente', template: 'devolucao_concluida', variaveis: ['pedido'],
    texto: v => `Devolução do pedido ${v.pedido} concluída. Qualquer dúvida, é só chamar.`,
  },
};

export interface EventoDoPedido {
  eventoId: string;
  tipo: string;
  ocorridoEm: string;
  pedidoId: string;
  clienteId: string | null;
  status: string;
  dados: Record<string, unknown>;
  bruto: Record<string, unknown>;
}

const texto = (v: unknown, limite = 200): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = String(v).trim();
  return t && t.length <= limite ? t : null;
};
const data = (v: unknown): string | null => {
  const t = texto(v, 64);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

/** Lê o envelope. Erro devolve o motivo (vira 400 para eles corrigirem). */
export function lerEvento(corpo: unknown): { ok: true; evento: EventoDoPedido } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) return { ok: false, erro: 'Corpo inválido: esperado um objeto JSON.' };
  const c = corpo as Record<string, unknown>;
  const eventoId = texto(c.evento_id);
  const tipo = texto(c.tipo_evento, 64);
  const pedidoId = texto(c.pedido_id);
  const ocorridoEm = data(c.ocorrido_em);
  const faltando = [!eventoId && 'evento_id', !tipo && 'tipo_evento', !pedidoId && 'pedido_id', !ocorridoEm && 'ocorrido_em'].filter(Boolean);
  if (faltando.length) return { ok: false, erro: `Campos obrigatórios ausentes ou inválidos: ${faltando.join(', ')}.` };
  const conhecido = TIPOS_DE_EVENTO[tipo!];
  if (!conhecido) return { ok: false, erro: `tipo_evento desconhecido: ${tipo}. Os aceitos estão na aba "Eventos de status" do contrato.` };
  const dados = c.dados && typeof c.dados === 'object' && !Array.isArray(c.dados) ? c.dados as Record<string, unknown> : {};
  return {
    ok: true,
    evento: { eventoId: eventoId!, tipo: tipo!, ocorridoEm: ocorridoEm!, pedidoId: pedidoId!, clienteId: texto(c.cliente_id), status: conhecido.status, dados, bruto: c },
  };
}

/** O pedido como está na tabela, só o que a projeção precisa. */
export interface PedidoAtual {
  status: string;
  status_ocorrido_em: string;
  pagamento_link: string | null;
}

export type MudancaNoPedido = Record<string, string | number | null>;

/**
 * O que o evento muda no pedido. `avanca` falso: o evento é mais velho que o estado de agora (chegou fora de ordem) e
 * o status não anda para trás; mesmo assim um dado que faltava (o link) entra.
 */
export function projetar(atual: PedidoAtual, e: EventoDoPedido): { avanca: boolean; mudanca: MudancaNoPedido } {
  const avanca = new Date(e.ocorridoEm).getTime() >= new Date(atual.status_ocorrido_em).getTime();
  const d = e.dados;
  const campos: MudancaNoPedido = {};
  switch (e.tipo) {
    case 'pedido.aguardando_pagamento':
      campos.pagamento_link = texto(d.link_pagamento, 2000);
      campos.pagamento_expira_em = data(d.expira_em);
      break;
    case 'pedido.pago':
      campos.pago_em = data(d.pago_em) ?? e.ocorridoEm;
      campos.valor_pago = numero(d.valor_pago);
      break;
    case 'pedido.faturado':
      campos.nota_numero = texto(d.numero_nota, 64);
      campos.nota_chave_acesso = texto(d.chave_acesso, 64);
      campos.faturado_em = e.ocorridoEm;
      break;
    case 'pedido.retirado':
      campos.concluido_em = data(d.retirado_em) ?? e.ocorridoEm;
      break;
    case 'pedido.entregue':
      campos.concluido_em = data(d.entregue_em) ?? e.ocorridoEm;
      break;
    case 'pedido.cancelado':
    case 'pedido.erro_faturamento':
    case 'pedido.entrega_nao_realizada':
    case 'pedido.validacao_recusada':
      campos.motivo = texto(d.motivo, 500);
      break;
  }
  const preenchidos = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== null));
  if (!avanca) {
    // Fora de ordem: só o link que ainda não existia (o cliente precisa dele de qualquer jeito).
    return { avanca, mudanca: preenchidos.pagamento_link && !atual.pagamento_link ? { pagamento_link: preenchidos.pagamento_link } : {} };
  }
  return { avanca, mudanca: { ...preenchidos, status: e.status, status_ocorrido_em: e.ocorridoEm } };
}

const dataCurta = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
};

/** As variáveis do aviso. Variável vazia a Meta recusa: cada uma tem um texto de reserva. */
export function variaveisDoAviso(e: EventoDoPedido, contexto: { cliente: string; vendedor: string }): Record<string, string> {
  const d = e.dados;
  return {
    pedido: e.pedidoId,
    link: texto(d.link_pagamento, 2000) ?? 'o link que o vendedor vai te mandar',
    prazo: dataCurta(data(d.expira_em) ?? data(d.prazo_retirada)) || 'o prazo combinado',
    nota: texto(d.numero_nota, 64) ?? 'emitida',
    loja: texto(d.loja) ?? 'loja',
    motivo: texto(d.motivo, 500) ?? 'motivo não informado',
    vendedor: contexto.vendedor || 'o vendedor',
    cliente: contexto.cliente || 'cliente',
    situacao: e.tipo === 'pedido.erro_faturamento' ? 'erro no faturamento' : 'entrega recusada na validação',
  };
}

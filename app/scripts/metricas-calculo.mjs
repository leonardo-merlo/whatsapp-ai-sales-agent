// O cálculo das métricas semanais do roteiro de vendas. Funções puras: recebem
// as linhas do banco e devolvem os números. Quem busca no banco e gera os
// arquivos é `metricas.mjs`; os testes ficam em `app/test/metricas.test.ts`.

/** A ordem das etapas da máquina, para saber até onde cada orçamento chegou. */
const ORDEM = {
  aguardando_documento: 1,
  consultando_cadastro: 2,
  coletando_cadastro: 2,
  criando_cadastro: 2,
  confirmando_regiao: 2,
  levantando_itens: 4,
  aguardando_vendedor: 5,
};

export const PASSOS_DO_FUNIL = [
  'Pediu orçamento',
  'Mandou CPF/CNPJ',
  'Cadastro confirmado',
  'Cidade aceita',
  'Lista confirmada',
];

/** Até que passo do funil (1 a 5) um estado chegou. */
export function passoDoEstado(estado) {
  if (!estado?.etapa) return 0;
  if (estado.etapa === 'confirmando_regiao' && estado.pergunta === 'cidade') return 3;
  return ORDEM[estado.etapa] ?? 0;
}

const FRASE_DE_FALHA = 'Vou consultar o vendedor para ele falar com você.';

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(v.length / 2);
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

function percentil(valores, p) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}

const segundos = ms => (ms == null ? null : Math.round(ms / 100) / 10);

/**
 * Cada orçamento com as respostas que caem nele: mesma conversa, a partir da
 * criação dele e antes do orçamento seguinte da mesma conversa.
 */
export function turnosPorOrcamento(orcamentos, turnos) {
  const porConversa = new Map();
  for (const o of orcamentos) {
    if (!porConversa.has(o.conversation_id)) porConversa.set(o.conversation_id, []);
    porConversa.get(o.conversation_id).push(o);
  }
  for (const lista of porConversa.values()) lista.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const resultado = new Map(orcamentos.map(o => [o.id, []]));
  for (const t of turnos) {
    const lista = porConversa.get(t.conversation_id);
    if (!lista) continue;
    let dono = null;
    for (const o of lista) if (o.created_at <= t.created_at) dono = o;
    // A resposta que criou o orçamento é gravada um pouco antes da ficha.
    dono ??= lista[0];
    resultado.get(dono.id).push(t);
  }
  return resultado;
}

/** O funil: quantos orçamentos chegaram a cada passo. */
export function funil(orcamentos, turnos) {
  const porOrcamento = turnosPorOrcamento(orcamentos, turnos);
  const contagem = PASSOS_DO_FUNIL.map(() => 0);
  for (const o of orcamentos) {
    let maior = Math.max(1, passoDoEstado({ etapa: o.etapa, pergunta: o.pergunta_pendente }));
    for (const t of porOrcamento.get(o.id)) maior = Math.max(maior, passoDoEstado(t.estado_depois));
    for (let i = 0; i < maior; i++) contagem[i]++;
  }
  return PASSOS_DO_FUNIL.map((passo, i) => ({ passo, quantidade: contagem[i] }));
}

/**
 * Etapa pulada: o orçamento está numa etapa sem o dado que ela exige. Com a
 * máquina deve dar zero; é o alarme de que algo passou por fora.
 */
export function etapasPuladas(orcamentos) {
  const casos = [];
  for (const o of orcamentos) {
    const passo = passoDoEstado({ etapa: o.etapa, pergunta: o.pergunta_pendente });
    const d = o.dados ?? {};
    if (passo >= 3 && !d.cliente) casos.push({ orcamento_id: o.id, pulou: 'cadastro' });
    if (passo >= 4 && !d.entrega) casos.push({ orcamento_id: o.id, pulou: 'cidade' });
    if (passo >= 5 && !(d.itens?.length)) casos.push({ orcamento_id: o.id, pulou: 'lista' });
  }
  return casos;
}

/**
 * Como a IA tratou cada item da lista de produtos (v2):
 * - sozinha: achou o produto sem perguntar nada;
 * - perguntou: precisou confirmar ou escolher com o cliente;
 * - corrigido: o cliente respondeu "não, é outro" e trocou o item;
 * - vendedor: ficou para o vendedor;
 * - nao_vende: a loja não trabalha com o produto.
 */
export function comoFoiOItem(item, corrigidos) {
  if (corrigidos.has(item.id) || item.status === 'fora_do_orcamento') return 'corrigido';
  if (item.status === 'vendedor') return 'vendedor';
  if (item.status === 'nao_vende' || item.resultado?.status === 'nao_vende') return 'nao_vende';
  return item.resultado?.status === 'resolvido' ? 'sozinha' : 'perguntou';
}

export function resumoDosItens(itens, corrigidos) {
  const r = { total: itens.length, sozinha: 0, perguntou: 0, corrigido: 0, vendedor: 0, nao_vende: 0 };
  for (const it of itens) r[comoFoiOItem(it, corrigidos)]++;
  return r;
}

export function tempoDeResposta(turnos) {
  const ms = turnos.map(t => t.duracao_ms).filter(v => typeof v === 'number');
  return { respostas: ms.length, mediana_s: segundos(mediana(ms)), p90_s: segundos(percentil(ms, 90)), max_s: segundos(ms.length ? Math.max(...ms) : null) };
}

export function falhas(turnos, chamadasErp) {
  const semResposta = turnos.filter(t => t.status !== 'respondeu');
  return {
    sem_resposta: semResposta.length,
    com_erro: turnos.filter(t => t.erro).length,
    disse_vou_consultar: turnos.filter(t => typeof t.resposta === 'string' && t.resposta.includes(FRASE_DE_FALHA)).length,
    erp_chamadas: chamadasErp.length,
    erp_falhas: chamadasErp.filter(c => c.ok === false).length,
    por_status: Object.fromEntries(
      Object.entries(semResposta.reduce((acc, t) => ({ ...acc, [t.status ?? 'sem_status']: (acc[t.status ?? 'sem_status'] ?? 0) + 1 }), {})),
    ),
  };
}

export function custo(usos) {
  const porOrigem = {};
  let total = 0;
  for (const u of usos) {
    const v = Number(u.custo_usd ?? 0);
    total += v;
    porOrigem[u.origem ?? 'sem_origem'] = (porOrigem[u.origem ?? 'sem_origem'] ?? 0) + v;
  }
  const arredonda = v => Math.round(v * 10000) / 10000;
  return { total_usd: arredonda(total), por_origem: Object.fromEntries(Object.entries(porOrigem).map(([k, v]) => [k, arredonda(v)])) };
}

/** Junta tudo num objeto só, o que vai para o JSON, a imagem e o artefato. */
export function calcularMetricas({ periodo, orcamentos, turnos, itens, corrigidos, usos, chamadasErp, mensagensDoCliente }) {
  const f = funil(orcamentos, turnos);
  const c = custo(usos);
  const listas = f[4].quantidade;
  return {
    periodo,
    volume: {
      conversas: new Set(turnos.map(t => t.conversation_id).filter(Boolean)).size,
      mensagens_do_cliente: mensagensDoCliente,
      respostas_da_ia: turnos.length,
      orcamentos: orcamentos.length,
      listas_confirmadas: listas,
    },
    funil: f,
    etapas_puladas: etapasPuladas(orcamentos),
    itens: resumoDosItens(itens, corrigidos),
    tempo: tempoDeResposta(turnos),
    falhas: falhas(turnos, chamadasErp),
    custo: { ...c, por_lista_usd: listas ? Math.round((c.total_usd / listas) * 10000) / 10000 : null },
  };
}

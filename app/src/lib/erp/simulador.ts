// O sistema da Distribuidora Exemplo, de mentira.
//
// A API deles ainda não existe (sem endereço, sem chave, sem homologação). Sem
// um alvo, o cliente HTTP só poderia ser escrito depois — e o piloto ficaria
// parado esperando um time de fora. Este arquivo é o alvo: responde exatamente
// o que `docs/contrato-api-exemplo.md` descreve, **inclusive os erros**, que
// é a parte que ninguém testa quando o servidor é de verdade.
//
// Ele serve a dois usos com o mesmo código, e isso é de propósito:
//
// - nos testes, o `fetch` é desviado para cá, então o cliente HTTP é exercitado
//   de ponta a ponta, montagem de corpo e leitura de resposta incluídas;
// - no navegador/terminal, `scripts/simulador-exemplo.mjs` levanta um
//   servidor em cima dele, para conversar com a IA como se a Distribuidora Exemplo
//   estivesse ligada.
//
// Um simulador que os testes não usam vira ficção em pouco tempo.

import type { ClienteDoErp, ItemComPreco, ItemPedido, Orcamento, PrecoDoErp, RespostaDePrecos } from './contrato';

export interface ProdutoDoErp {
  codigo: string;
  descricao: string;
  unidade?: string;
  preco: number;
  /** Saldo em estoque na consulta de preço. Sem valor, sobra estoque. */
  saldo?: number;
}

/** O jeito de pedir ao simulador que se comporte mal. Testar o caminho feliz
 *  contra um servidor que nunca falha é a forma mais fácil de descobrir os
 *  erros em produção. */
export type FalhaSimulada =
  | 'fora-do-ar'        // 500 em tudo
  | 'chave-invalida'    // 401 em tudo
  | 'sem-credito'       // 422 ao criar orçamento
  | 'lento'             // devolve certo, mas com atraso
  | 'instavel'          // falha a primeira vez de cada operação e acerta depois
  | 'sync-vazio'        // os syncs devolvem a lista vazia
  | 'sync-malformado';  // os syncs devolvem corpo sem a lista (e um item incompleto no outro)

export interface OpcoesDoSimulador {
  produtos?: ProdutoDoErp[];
  clientes?: ClienteDoErp[];
  chave?: string;
  falha?: FalhaSimulada | null;
  /** Atraso em ms quando `falha === 'lento'`. */
  atrasoMs?: number;
  /**
   * Os dois syncs do contrato v4 (GET, lista inteira). As listas são lidas AO
   * VIVO a cada chamada — o teste pode mudar um item entre dois syncs. Os
   * caminhos são os que a organização configurar; o contrato ainda não tem os
   * de verdade ("a definir pelo TI do cliente").
   */
  syncs?: {
    produtos?: unknown[];
    regioes?: unknown[];
    caminhos?: { produtos?: string; regioes?: string };
    /** O `falhas` da raiz, como a Distribuidora Exemplo manda quando uma filial não
     *  respondeu (30/09). Lido ao vivo, como as listas. */
    falhas?: string[];
  };
}

export interface RequisicaoSimulada {
  metodo: string;
  /** Caminho mais busca, como chega na URL (ex.: `/clientes?documento=123`). */
  caminho: string;
  cabecalhos: Record<string, string>;
  corpo: unknown;
}

export interface RespostaSimulada {
  status: number;
  corpo: unknown;
}

const CHAVE_PADRAO = 'chave-de-homologacao';

/** Desconto do simulador: 5 % no item que passa de mil reais.
 *  A regra de verdade é de vocês; aqui ela existe só para que a resposta tenha
 *  desconto de vez em quando — se fosse sempre zero, o código que copia o
 *  desconto para a mensagem do cliente nunca seria exercitado. */
function descontoDoItem(valorBruto: number): number {
  return valorBruto >= 1000 ? 5 : 0;
}

function arredondar(v: number): number {
  return Math.round(v * 100) / 100;
}

function erro(status: number, codigo: string, mensagem: string, campo?: string): RespostaSimulada {
  return { status, corpo: { erro: { codigo, mensagem, campo: campo ?? null } } };
}

function soDigitos(valor: string): string {
  return (valor ?? '').replace(/\D/g, '');
}

export interface SimuladorExemplo {
  responder(req: RequisicaoSimulada): Promise<RespostaSimulada>;
  /** O que foi criado, para o teste conferir sem depender da resposta. */
  clientes: ClienteDoErp[];
  orcamentos: Orcamento[];
  /** Toda requisição recebida, na ordem. É o que prova que a retentativa
   *  aconteceu (ou não aconteceu). */
  chamadas: RequisicaoSimulada[];
  /** Liga e desliga a falha durante o teste. */
  definirFalha(falha: FalhaSimulada | null): void;
}

export function criarSimuladorExemplo(opcoes: OpcoesDoSimulador = {}): SimuladorExemplo {
  const produtos = new Map((opcoes.produtos ?? []).map(p => [p.codigo, p]));
  const clientes: ClienteDoErp[] = [...(opcoes.clientes ?? [])];
  const orcamentos: Orcamento[] = [];
  const chamadas: RequisicaoSimulada[] = [];
  // Idempotência do lado deles: chave → resposta já dada.
  const idempotencia = new Map<string, RespostaSimulada>();
  const jaFalhou = new Set<string>();
  const chave = opcoes.chave ?? CHAVE_PADRAO;
  let falha: FalhaSimulada | null = opcoes.falha ?? null;
  let proximoId = 1;

  function precificar(itens: ItemPedido[]): { itens: ItemComPreco[]; total: number; desconto: number } | RespostaSimulada {
    if (!Array.isArray(itens) || !itens.length) {
      return erro(422, 'itens_vazios', 'Informe ao menos um item.', 'itens');
    }
    const comPreco: ItemComPreco[] = [];
    let total = 0;
    let desconto = 0;
    for (const [i, item] of itens.entries()) {
      const produto = produtos.get(String(item.produto_codigo));
      if (!produto) {
        // Recusa a cotação INTEIRA, e não só o item: devolver o resto faria a
        // IA passar ao cliente um total que não é o do pedido dele.
        return erro(422, 'produto_nao_encontrado', `O produto ${item.produto_codigo} não existe.`, `itens[${i}].produto_codigo`);
      }
      const quantidade = Number(item.quantidade);
      if (!Number.isFinite(quantidade) || quantidade <= 0) {
        return erro(422, 'quantidade_invalida', `Quantidade inválida no item ${item.produto_codigo}.`, `itens[${i}].quantidade`);
      }
      const bruto = arredondar(produto.preco * quantidade);
      const percentual = descontoDoItem(bruto);
      const abatido = arredondar(bruto * (percentual / 100));
      const liquido = arredondar(bruto - abatido);
      comPreco.push({
        produto_codigo: produto.codigo,
        descricao: produto.descricao,
        unidade: produto.unidade ?? null,
        quantidade,
        preco_unitario: produto.preco,
        desconto_percentual: percentual,
        valor_total: liquido,
      });
      total += liquido;
      desconto += abatido;
    }
    return { itens: comPreco, total: arredondar(total), desconto: arredondar(desconto) };
  }

  async function responder(req: RequisicaoSimulada): Promise<RespostaSimulada> {
    chamadas.push(req);

    if (falha === 'fora-do-ar') {
      return { status: 503, corpo: { erro: { codigo: 'indisponivel', mensagem: 'Sistema em manutenção.' } } };
    }
    if (falha === 'instavel') {
      // Falha a PRIMEIRA vez de cada operação. É o cenário que separa uma
      // retentativa que funciona de uma que só repete o erro.
      const assinatura = `${req.metodo} ${req.caminho.split('?')[0]}`;
      if (!jaFalhou.has(assinatura)) {
        jaFalhou.add(assinatura);
        return { status: 502, corpo: { erro: { codigo: 'indisponivel', mensagem: 'Tente de novo.' } } };
      }
    }
    if (falha === 'lento') {
      await new Promise(r => setTimeout(r, opcoes.atrasoMs ?? 50));
    }

    const autorizacao = req.cabecalhos['authorization'] ?? req.cabecalhos['Authorization'] ?? '';
    if (falha === 'chave-invalida' || autorizacao !== `Bearer ${chave}`) {
      return erro(401, 'nao_autorizado', 'Chave inválida.');
    }

    // A query string é descartada: desde 17/09 nenhuma operação usa parâmetro
    // na URL — o documento vai no corpo, que é onde dado pessoal não vira log.
    const [caminho] = req.caminho.split('?');
    const corpo = (req.corpo ?? {}) as Record<string, unknown>;
    const chaveIdem = req.cabecalhos['idempotency-key'] ?? req.cabecalhos['Idempotency-Key'] ?? '';

    // ── syncs (contrato v4): GET, nada no corpo, a lista inteira ──
    // 401 e 503 já saíram acima, como em qualquer operação. As duas falhas
    // próprias daqui existem porque são as que o nosso lado precisa recusar:
    // uma lista vazia aplicada desativaria o catálogo inteiro.
    const caminhosDosSyncs = { produtos: '/produtos', regioes: '/regioes', ...opcoes.syncs?.caminhos };
    for (const tipo of ['produtos', 'regioes'] as const) {
      if (req.metodo !== 'GET' || caminho !== caminhosDosSyncs[tipo]) continue;
      if (falha === 'sync-vazio') return { status: 200, corpo: { [tipo]: [] } };
      if (falha === 'sync-malformado') return { status: 200, corpo: { itens: opcoes.syncs?.[tipo] ?? [] } };
      const falhas = opcoes.syncs?.falhas;
      return { status: 200, corpo: { [tipo]: opcoes.syncs?.[tipo] ?? [], ...(falhas ? { falhas } : {}) } };
    }

    // ── operação 1: consultar cliente ──
    // POST com o documento no corpo, como a Distribuidora Exemplo documentou em 17/09.
    // Não encontrado responde 200 { encontrado: false }, e NÃO 404: é o caminho
    // previsto que leva ao cadastro, não uma falha.
    if (req.metodo === 'POST' && caminho === '/clientes/consulta') {
      const documento = soDigitos(String(corpo.documento ?? ''));
      if (!documento) return erro(400, 'DOCUMENTO_INVALIDO', 'Informe o documento.', 'documento');
      const achado = clientes.find(c => soDigitos(c.documento ?? '') === documento);
      if (!achado) return { status: 200, corpo: { encontrado: false, cliente_id: null } };
      return {
        status: 200,
        corpo: {
          encontrado: true,
          cliente_id: achado.id,
          tipo_pessoa: achado.tipo === 'PJ' ? 'JURIDICA' : 'FISICA',
          // A classificação fiscal, que nós nunca enviamos: vem preenchida só
          // em cadastro que o comercial já classificou.
          tipo_cliente: achado.tipo_cliente ?? null,
          segmento: achado.segmento ?? null,
          nome: achado.nome,
          telefone: achado.telefone ?? null,
          email: achado.email ?? null,
          inscricao_estadual: achado.inscricao_estadual ?? null,
          contribuinte_icms: achado.contribuinte_icms ?? null,
          endereco: achado.endereco ?? null,
          vendedor_id: achado.vendedor_id ?? null,
          situacao: achado.situacao ?? 'ATIVO',
          empresas: achado.empresas ?? ['EXEMPLO CENTRO'],
        },
      };
    }

    // ── operação 2: criar cliente ──
    if (req.metodo === 'POST' && caminho === '/clientes/novo') {
      if (chaveIdem && idempotencia.has(chaveIdem)) return idempotencia.get(chaveIdem)!;

      const documento = soDigitos(String(corpo.documento ?? ''));
      const nome = String(corpo.nome ?? '').trim();
      if (!documento) return erro(422, 'documento_invalido', 'Documento obrigatório.', 'documento');
      if (documento.length !== 11 && documento.length !== 14) {
        return erro(422, 'documento_invalido', 'O documento precisa ter 11 (CPF) ou 14 (CNPJ) dígitos.', 'documento');
      }
      if (!nome) return erro(422, 'nome_invalido', 'Nome obrigatório.', 'nome');

      // Endereço completo é obrigatório do lado deles. O simulador recusa igual:
      // um dublê mais permissivo que o original deixa passar o bug que ele
      // deveria ter pego.
      const end = (corpo.endereco ?? {}) as Record<string, unknown>;
      const faltando = ['logradouro', 'numero', 'cidade', 'uf', 'cep']
        .filter(k => !String(end[k] ?? '').trim());
      if (faltando.length) {
        return erro(400, 'DADOS_OBRIGATORIOS_AUSENTES', 'Campos obrigatórios ausentes', `endereco.${faltando[0]}`);
      }
      if (soDigitos(String(end.cep)).length !== 8 || String(end.uf).trim().length !== 2) {
        return erro(400, 'ENDERECO_INVALIDO', 'UF com 2 letras, CEP com 8 dígitos.', 'endereco');
      }

      const existente = clientes.find(c => soDigitos(c.documento ?? '') === documento);
      if (existente) {
        // Alguém cadastrou entre a nossa consulta e a nossa criação. Não é
        // erro: o que queremos é o id.
        const resposta: RespostaSimulada = erro(409, 'DOCUMENTO_JA_CADASTRADO', 'Documento já cadastrado.', 'documento');
        if (chaveIdem) idempotencia.set(chaveIdem, resposta);
        return resposta;
      }

      // O código nasce com Z, como na Distribuidora Exemplo: é a letra que diz, olhando a
      // base, o que nasceu de uma conversa. E pessoa JURÍDICA nasce BLOQUEADA —
      // o cadastro entra sem classificação fiscal e o comercial confere. Isso
      // não impede cotar; impede faturar.
      const pj = documento.length === 14;
      const situacao = pj ? 'BLOQUEADO' : 'ATIVO';
      const novo: ClienteDoErp = {
        id: `Z${String(proximoId++).padStart(5, '0')}/01`,
        documento,
        nome,
        tipo: pj ? 'PJ' : 'PF',
        telefone: (corpo.telefone as string) ?? null,
        email: (corpo.email as string) ?? null,
        inscricao_estadual: (corpo.inscricao_estadual as string) ?? null,
        endereco: {
          logradouro: String(end.logradouro),
          numero: String(end.numero),
          complemento: (end.complemento as string) ?? null,
          bairro: (end.bairro as string) ?? null,
          cidade: String(end.cidade),
          uf: String(end.uf).toUpperCase(),
          cep: soDigitos(String(end.cep)),
        },
        cidade: String(end.cidade),
        uf: String(end.uf).toUpperCase(),
        vendedor_id: (corpo.vendedor_id as string) ?? null,
        empresas: ['EXEMPLO CENTRO', 'CORTE DOBRA CENTRO'],
        situacao,
        podeFaturar: !pj,
        motivo_bloqueio: null,
      };
      clientes.push(novo);
      const resposta: RespostaSimulada = {
        status: 201,
        corpo: {
          cliente_criado: true,
          cliente_id: novo.id,
          situacao,
          empresas: (novo.empresas ?? []).map(e => ({
            empresa: e, status: 'incluido', codigo: novo.id.split('/')[0], loja: '01',
          })),
          regiao_atendida: true,
        },
      };
      if (chaveIdem) idempotencia.set(chaveIdem, resposta);
      return resposta;
    }

    // ── operação 3: consulta de preço, no formato de precos (08/10/2026) ──
    // Como o real: erro de condição e de cliente é 400/422 em MAIÚSCULAS com
    // `campos` em array, e produto sem preço é 200 com `encontrado: false`.
    if (req.metodo === 'POST' && caminho === '/cotacoes') {
      const condicao = String(corpo.condicao_pagamento ?? '').trim();
      if (!condicao) {
        return { status: 400, corpo: { erro: { codigo: 'FORMA_PAGAMENTO_INVALIDA', mensagem: 'Informe condicao_pagamento (código da SE4)', campos: ['condicao_pagamento'] } } };
      }
      if (!corpo.cliente_id && !corpo.documento && !corpo.uf) {
        return { status: 400, corpo: { erro: { codigo: 'DADOS_OBRIGATORIOS_AUSENTES', mensagem: 'Informe cliente_id, documento ou uf: o preço depende do estado de destino', campos: ['uf'] } } };
      }
      const pedidos = Array.isArray(corpo.produtos) ? corpo.produtos as { produto_id: string; quantidade: number }[] : [];
      const lista: PrecoDoErp[] = pedidos.map(pedido => {
        const produto = produtos.get(String(pedido.produto_id));
        if (!produto) {
          return { produto_id: String(pedido.produto_id), encontrado: false, motivo: `Sem preço na tabela MG para a condição ${condicao}` };
        }
        // Como o real em 08/10: quantidade zero vira 1, sem erro.
        const pedida = Number(pedido.quantidade);
        const quantidade = Number.isFinite(pedida) && pedida > 0 ? pedida : 1;
        const saldo = produto.saldo ?? 100_000;
        return {
          produto_id: produto.codigo, encontrado: true, descricao: produto.descricao,
          unidade: produto.unidade ?? 'UN', quantidade, preco_unitario: produto.preco,
          total: arredondar(produto.preco * quantidade), peso_kg: quantidade,
          empresa: 'EXEMPLO CENTRO', saldo, estoque_disponivel: saldo >= quantidade,
          tabela_preco: '131', icms_st_estimado: 0,
        };
      });
      const resposta: RespostaDePrecos = {
        condicao_pagamento: condicao, uf: 'MG',
        cliente_id: (corpo.cliente_id as string) ?? null, vendedor_id: (corpo.vendedor_id as string) ?? null,
        produtos: lista, consultado_em: new Date().toISOString(),
      };
      return { status: 200, corpo: resposta };
    }

    // ── operação 4: criar orçamento ──
    if (req.metodo === 'POST' && caminho === '/orcamentos') {
      if (chaveIdem && idempotencia.has(chaveIdem)) return idempotencia.get(chaveIdem)!;

      const clienteId = String(corpo.cliente_id ?? '');
      const cliente = clientes.find(c => c.id === clienteId);
      if (!cliente) return erro(422, 'cliente_nao_encontrado', `Cliente ${clienteId} não existe.`, 'cliente_id');
      // Bloqueado NÃO impede orçar — só faturar. Antes de 17/09 o simulador
      // recusava aqui, e era justamente o bug que ele escondia: todo cliente
      // novo PJ nasce bloqueado e nunca receberia orçamento nenhum.
      if (falha === 'sem-credito') {
        return erro(422, 'cliente_sem_credito', 'Cliente sem limite de crédito disponível.', 'cliente_id');
      }

      const precos = precificar(corpo.itens as ItemPedido[]);
      if ('status' in precos) return precos;

      const numero = String(88000 + orcamentos.length + 1);
      const orcamento: Orcamento = {
        id: `ORC-${numero}`,
        numero,
        situacao: 'aberto',
        validade: emDias(7),
        itens: precos.itens,
        valor_total: precos.total,
        desconto_total: precos.desconto,
        link: `https://erp.distribuidora-exemplo.test/orcamentos/${numero}`,
      };
      orcamentos.push(orcamento);
      const resposta: RespostaSimulada = { status: 201, corpo: { orcamento } };
      if (chaveIdem) idempotencia.set(chaveIdem, resposta);
      return resposta;
    }

    return erro(404, 'rota_desconhecida', `Não existe ${req.metodo} ${caminho}.`);
  }

  return {
    responder,
    clientes,
    orcamentos,
    chamadas,
    definirFalha: (nova) => { falha = nova; },
  };
}

function emDias(dias: number): string {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Traduz uma chamada de `fetch` para o simulador e a resposta de volta.
 *  É o que permite o teste desviar o `fetch` e exercitar o cliente HTTP de
 *  verdade, sem dublê de SDK no meio. */
export async function responderComoFetch(
  simulador: SimuladorExemplo,
  enderecoBase: string,
  entrada: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
  const caminho = url.startsWith(enderecoBase) ? url.slice(enderecoBase.length) : new URL(url).pathname;

  const cabecalhos: Record<string, string> = {};
  for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
    cabecalhos[k.toLowerCase()] = v;
  }

  let corpo: unknown = null;
  if (typeof init?.body === 'string') {
    try { corpo = JSON.parse(init.body); } catch { corpo = init.body; }
  }

  const resposta = await simulador.responder({
    metodo: (init?.method ?? 'GET').toUpperCase(),
    caminho: caminho || '/',
    cabecalhos,
    corpo,
  });

  return new Response(JSON.stringify(resposta.corpo), {
    status: resposta.status,
    headers: { 'content-type': 'application/json' },
  });
}

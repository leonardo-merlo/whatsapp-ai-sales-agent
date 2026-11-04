// Supabase de mentira, em memória, com o suficiente do PostgREST para o webhook
// e o motor rodarem inteiros: filtros, ordenação, contagem, insert/update e
// relação embutida (`plans(max_msgs_mes)`).
//
// Por que um falso e não o banco de verdade: não existe Postgres local neste
// projeto e o único banco disponível é o de produção, com cliente pagando.
// Teste que escreve em produção não é opção. O custo assumido é o de sempre
// nesse arranjo — o falso não pega erro de schema. Está anotado como dúvida
// para o Leonardo em docs/progresso-bloco-a.md.

import { randomUUID } from 'node:crypto';

export type Linha = Record<string, unknown>;
export type Banco = Record<string, Linha[]>;

/** O `max_rows` padrão do PostgREST no Supabase. */
export const MAX_LINHAS_POR_SELECT = 1000;

export interface OpcoesBanco {
  /** Índices únicos por tabela, para reproduzir o erro 23505 do Postgres.
   *  Ex.: `{ messages: [['organization_id', 'wamid']] }`. Linha com valor
   *  nulo em qualquer coluna do índice não conflita, como no índice parcial. */
  unicos?: Record<string, string[][]>;
  /** Funções do banco chamadas por `rpc()`. O teste escreve o comportamento da
   *  função aqui — o que o dublê não faz é adivinhar o que o SQL faz, então a
   *  imitação precisa ficar ao lado da migration que ela imita. Lançar dentro
   *  da função vira `error`, como o RAISE do Postgres. */
  funcoes?: Record<string, (args: Record<string, unknown>, banco: Banco) => unknown>;
  /** Índices únicos PARCIAIS (com `WHERE`), por tabela. O Postgres não
   *  consegue inferir um índice parcial a partir de `ON CONFLICT (coluna)`, e
   *  o PostgREST não tem como mandar a condição junto: o `upsert` falha com
   *  `42P10`. Sem isto aqui, o dublê aceitava um upsert que o banco de verdade
   *  recusa — e foi assim que "Salvar este número" chegou em produção quebrado. */
  unicosParciais?: Record<string, string[][]>;
}

type Filtro = (linha: Linha) => boolean;

interface Resultado<T> {
  data: T;
  error: { message: string; code?: string } | null;
  count?: number | null;
}

class ErroPostgrest extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

class Consulta<T = unknown> implements PromiseLike<Resultado<T>> {
  private filtros: Filtro[] = [];
  private colunas = '*';
  private contagemExata = false;
  private soCabecalho = false;
  private ordem: { coluna: string; crescente: boolean } | null = null;
  private limite: number | null = null;
  private inicio = 0;
  private umSo: 'single' | 'maybeSingle' | null = null;

  // Campos declarados um a um em vez de parameter properties: o strip-only do
  // Node não suporta `constructor(private x: T)`.
  private readonly banco: Banco;
  private readonly opcoes: OpcoesBanco;
  private readonly tabela: string;
  private readonly tipo: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  private readonly payload: Linha[] | Linha | null;
  /** Coluna do onConflict do upsert. */
  onConflict: string | null = null;

  constructor(
    banco: Banco,
    opcoes: OpcoesBanco,
    tabela: string,
    tipo: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    payload: Linha[] | Linha | null,
  ) {
    this.banco = banco;
    this.opcoes = opcoes;
    this.tabela = tabela;
    this.tipo = tipo;
    this.payload = payload;
  }

  select(colunas = '*', opcoes?: { count?: string; head?: boolean }): this {
    this.colunas = colunas;
    if (opcoes?.count === 'exact') this.contagemExata = true;
    if (opcoes?.head) this.soCabecalho = true;
    return this;
  }

  eq(coluna: string, valor: unknown): this {
    this.filtros.push(linha => linha[coluna] === valor);
    return this;
  }

  neq(coluna: string, valor: unknown): this {
    this.filtros.push(linha => linha[coluna] !== valor);
    return this;
  }

  is(coluna: string, valor: unknown): this {
    this.filtros.push(linha => linha[coluna] === valor);
    return this;
  }

  /** Só a forma `not(coluna, 'is', null)`, a única que o código usa. */
  not(coluna: string, operador: string, valor: unknown): this {
    if (operador !== 'is' || valor !== null) throw new Error(`not(${operador}, ${String(valor)}) não suportado no dublê`);
    this.filtros.push(linha => linha[coluna] !== null && linha[coluna] !== undefined);
    return this;
  }

  in(coluna: string, valores: unknown[]): this {
    this.filtros.push(linha => valores.includes(linha[coluna]));
    return this;
  }

  /** `LIKE` do Postgres, com `%` e `_`. Sensível a maiúsculas, como o de lá
   *  (o insensível é `ILIKE`, que ninguém usa ainda). */
  like(coluna: string, padrao: string): this {
    const regex = new RegExp(
      '^' + padrao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
      's',
    );
    this.filtros.push(linha => regex.test(String(linha[coluna] ?? '')));
    return this;
  }

  gte(coluna: string, valor: string): this {
    this.filtros.push(linha => String(linha[coluna] ?? '') >= valor);
    return this;
  }

  lte(coluna: string, valor: string): this {
    this.filtros.push(linha => String(linha[coluna] ?? '') <= valor);
    return this;
  }

  /** Número compara como número (o Postgres compara pelo tipo da coluna);
   *  o resto, como texto, igual a `gte`/`lte`. Nulo nunca passa, como no SQL. */
  lt(coluna: string, valor: string | number): this {
    this.filtros.push(linha => {
      const atual = linha[coluna];
      if (atual === null || atual === undefined) return false;
      return typeof atual === 'number' ? atual < Number(valor) : String(atual) < String(valor);
    });
    return this;
  }

  /** Como `lt`, ao contrário. */
  gt(coluna: string, valor: string | number): this {
    this.filtros.push(linha => {
      const atual = linha[coluna];
      if (atual === null || atual === undefined) return false;
      return typeof atual === 'number' ? atual > Number(valor) : String(atual) > String(valor);
    });
    return this;
  }

  /**
   * `or('col.op.valor,col2.op2.valor2')` — a linha passa se QUALQUER uma das
   * condições passar.
   *
   * Ficou sem efeito até 14/09, quando o único uso era a janela de vigência da
   * assinatura e ignorar só ampliava o conjunto. Com a busca do catálogo
   * (`codigo.ilike.%x%,descricao.ilike.%x%`) isso deixou de ser inofensivo: um
   * `or` ignorado devolve o catálogo inteiro, e o teste da busca passaria sem
   * a busca existir.
   *
   * Só os operadores que o código usa. Um operador novo estoura aqui em vez de
   * ser silenciosamente ignorado — que é a única forma de o dublê não divergir
   * do banco sem ninguém perceber.
   */
  or(expressao: string): this {
    const condicoes = expressao.split(',').map(parte => {
      const [coluna, operador, ...resto] = parte.split('.');
      const valor = resto.join('.');
      return (linha: Linha): boolean => {
        const atual = linha[coluna];
        switch (operador) {
          case 'is': return valor === 'null' ? atual === null || atual === undefined : String(atual) === valor;
          case 'eq': return String(atual ?? '') === valor;
          case 'gte': return String(atual ?? '') >= valor;
          case 'lte': return String(atual ?? '') <= valor;
          case 'ilike': {
            const regex = new RegExp(
              '^' + valor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$',
              'is',
            );
            return regex.test(String(atual ?? ''));
          }
          default:
            throw new Error(`or(${operador}) não suportado no dublê — ensine antes de usar`);
        }
      };
    });
    this.filtros.push(linha => condicoes.some(passa => passa(linha)));
    return this;
  }

  order(coluna: string, opcoes?: { ascending?: boolean }): this {
    this.ordem = { coluna, crescente: opcoes?.ascending !== false };
    return this;
  }

  limit(n: number): this {
    this.limite = n;
    return this;
  }

  range(de: number, ate: number): this {
    this.inicio = de;
    this.limite = ate - de + 1;
    return this;
  }

  maybeSingle(): PromiseLike<Resultado<T>> {
    this.umSo = 'maybeSingle';
    return this;
  }

  single(): PromiseLike<Resultado<T>> {
    this.umSo = 'single';
    return this;
  }

  then<R1 = Resultado<T>, R2 = never>(
    aoResolver?: ((valor: Resultado<T>) => R1 | PromiseLike<R1>) | null,
    aoRejeitar?: ((motivo: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve()
      .then(() => this.executar())
      .then(aoResolver ?? undefined, aoRejeitar ?? undefined);
  }

  private linhasDaTabela(): Linha[] {
    this.banco[this.tabela] ??= [];
    return this.banco[this.tabela];
  }

  private conferirUnicos(nova: Linha): void {
    for (const indice of this.opcoes.unicos?.[this.tabela] ?? []) {
      if (indice.some(coluna => nova[coluna] === null || nova[coluna] === undefined)) continue;
      const conflito = this.linhasDaTabela().some(linha => indice.every(coluna => linha[coluna] === nova[coluna]));
      if (conflito) {
        throw new ErroPostgrest(
          `duplicate key value violates unique constraint on ${this.tabela} (${indice.join(', ')})`,
          '23505',
        );
      }
    }
  }

  private embutir(linha: Linha): Linha {
    // `plans(max_msgs_mes)` -> procura em banco.plans pela chave `plan_id`.
    const relacoes = [...this.colunas.matchAll(/([a-z_]+)\s*\(([^)]*)\)/g)];
    if (!relacoes.length) return linha;
    const saida: Linha = { ...linha };
    for (const [, nomeRelacao] of relacoes) {
      const chave = `${nomeRelacao.replace(/s$/, '')}_id`;
      const alvo = (this.banco[nomeRelacao] ?? []).find(r => r.id === linha[chave]) ?? null;
      saida[nomeRelacao] = alvo;
    }
    return saida;
  }

  private executar(): Resultado<T> {
    try {
      if (this.tipo === 'upsert') return this.executarUpsert();
      if (this.tipo === 'insert') return this.executarInsert();
      if (this.tipo === 'update') return this.executarUpdate();
      if (this.tipo === 'delete') return this.executarDelete();
      return this.executarSelect();
    } catch (err) {
      if (err instanceof ErroPostgrest) {
        return { data: null as T, error: { message: err.message, code: err.code }, count: null };
      }
      throw err;
    }
  }

  /** `upsert` com `onConflict`: atualiza a linha que já casa com aquelas
   *  colunas, insere quando não casa. Aceita chave composta
   *  (`'organization_id,codigo'`), que é como o catálogo é importado — sem
   *  isso o import criaria uma linha nova a cada CSV subido. */
  private executarUpsert(): Resultado<T> {
    const linhas = Array.isArray(this.payload) ? this.payload : [this.payload as Linha];
    const chave = this.onConflict ? this.onConflict.split(',').map(c => c.trim()).filter(Boolean) : null;
    // O banco recusa `ON CONFLICT` sobre índice parcial. O dublê recusa igual.
    for (const parcial of this.opcoes.unicosParciais?.[this.tabela] ?? []) {
      if (chave && parcial.length === chave.length && parcial.every(c => chave.includes(c))) {
        throw new ErroPostgrest(
          'there is no unique or exclusion constraint matching the ON CONFLICT specification',
          '42P10',
        );
      }
    }
    const saida: Linha[] = [];
    for (const nova of linhas) {
      const existente = chave ? this.linhasDaTabela().find(l => chave.every(c => l[c] === nova[c])) : undefined;
      if (existente) {
        Object.assign(existente, nova, { updated_at: new Date().toISOString() });
        saida.push(existente);
      } else {
        const criada = { id: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...nova };
        this.conferirUnicos(criada);
        this.linhasDaTabela().push(criada);
        saida.push(criada);
      }
    }
    return { data: (this.umSo ? (saida[0] ?? null) : saida) as T, error: null };
  }

  private executarInsert(): Resultado<T> {
    const novas = (Array.isArray(this.payload) ? this.payload : [this.payload as Linha]).map(linha => ({
      id: randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...linha,
    }));
    for (const nova of novas) {
      this.conferirUnicos(nova);
      this.linhasDaTabela().push(nova);
    }
    const dados = this.umSo ? (novas[0] ?? null) : novas;
    return { data: dados as T, error: null };
  }

  private executarUpdate(): Resultado<T> {
    const alvos = this.linhasDaTabela().filter(linha => this.filtros.every(f => f(linha)));
    for (const linha of alvos) Object.assign(linha, this.payload, { updated_at: new Date().toISOString() });
    const dados = this.umSo ? (alvos[0] ?? null) : alvos;
    return { data: dados as T, error: null };
  }

  private executarDelete(): Resultado<T> {
    const linhas = this.linhasDaTabela();
    const restantes = linhas.filter(linha => !this.filtros.every(f => f(linha)));
    const removidas = linhas.filter(linha => this.filtros.every(f => f(linha)));
    this.banco[this.tabela] = restantes;
    return { data: (this.umSo ? (removidas[0] ?? null) : removidas) as T, error: null };
  }

  private executarSelect(): Resultado<T> {
    let linhas = this.linhasDaTabela().filter(linha => this.filtros.every(f => f(linha)));
    if (this.ordem) {
      const { coluna, crescente } = this.ordem;
      linhas = [...linhas].sort((a, b) => {
        const va = String(a[coluna] ?? '');
        const vb = String(b[coluna] ?? '');
        return crescente ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    }
    const total = linhas.length;
    // O PostgREST do Supabase devolve no máximo 1000 linhas por select, sem
    // erro nenhum. Com o catálogo da Distribuidora Exemplo passando de 1000 (30/09), um
    // dublê sem esse teto escondia produto sumindo da leitura.
    linhas = linhas.slice(this.inicio, this.inicio + Math.min(this.limite ?? MAX_LINHAS_POR_SELECT, MAX_LINHAS_POR_SELECT));
    if (this.soCabecalho) return { data: null as T, error: null, count: total };

    const projetadas = linhas.map(linha => this.embutir(linha));
    if (this.umSo === 'single' && projetadas.length !== 1) {
      return {
        data: null as T,
        error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
        count: this.contagemExata ? total : null,
      };
    }
    if (this.umSo) return { data: (projetadas[0] ?? null) as T, error: null, count: this.contagemExata ? total : null };
    return { data: projetadas as T, error: null, count: this.contagemExata ? total : null };
  }
}

export interface SupabaseFalso {
  banco: Banco;
  /** Toda chamada `from(tabela)`, na ordem, para o teste conferir o caminho percorrido. */
  tabelasConsultadas: string[];
  /** Toda chamada `rpc(nome, args)`, na ordem. */
  rpcsChamadas: { nome: string; args: Record<string, unknown> }[];
  // O tipo real seria SupabaseClient<Database>; aqui fica `unknown` de propósito
  // para não arrastar o tipo gerado do Supabase para dentro do apoio de teste.
  client: unknown;
}

export function criarSupabaseFalso(
  banco: Banco,
  opcoes: OpcoesBanco = {},
  /** Usuário logado, para as rotas que autenticam pela sessão em vez de usar a
   *  service_role. Ausente, `auth.getUser()` devolve ninguém. */
  usuarioLogado: { id: string } | null = null,
): SupabaseFalso {
  const tabelasConsultadas: string[] = [];
  const rpcsChamadas: { nome: string; args: Record<string, unknown> }[] = [];
  const client = {
    auth: {
      getUser: async () => ({ data: { user: usuarioLogado }, error: null }),
    },
    async rpc(nome: string, args: Record<string, unknown> = {}) {
      rpcsChamadas.push({ nome, args });
      const funcao = opcoes.funcoes?.[nome];
      if (!funcao) return { data: null, error: { message: `função ${nome} não existe`, code: 'PGRST202' } };
      try {
        return { data: funcao(args, banco) ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e), code: 'P0001' } };
      }
    },
    from(tabela: string) {
      tabelasConsultadas.push(tabela);
      return {
        select: (colunas?: string, opts?: { count?: string; head?: boolean }) =>
          new Consulta(banco, opcoes, tabela, 'select', null).select(colunas, opts),
        insert: (payload: Linha[] | Linha) => new Consulta(banco, opcoes, tabela, 'insert', payload),
        update: (payload: Linha) => new Consulta(banco, opcoes, tabela, 'update', payload),
        upsert: (payload: Linha[] | Linha, opts?: { onConflict?: string }) => {
          const consulta = new Consulta(banco, opcoes, tabela, 'upsert', payload);
          consulta.onConflict = opts?.onConflict ?? null;
          return consulta;
        },
        delete: () => new Consulta(banco, opcoes, tabela, 'delete', null),
      };
    },
  };
  return { banco, tabelasConsultadas, rpcsChamadas, client };
}

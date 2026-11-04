// O cadastro do cliente no sistema de gestão, do jeito que ele fica guardado na
// ficha do contato.
//
// **Por que uma coluna jsonb e não catorze colunas.** A regra deste repositório
// é a de `erp_pedidos`: vira coluna o que a tela filtra ou ordena, ou o que a IA
// lê sem contexto; o resto fica no jsonb. Nada filtra por segmento, inscrição
// estadual ou lista de empresas — quem é chave de busca é `erp_cliente_id`, que
// já é coluna, e `documento`, que também. Se um dia existir "meus clientes
// bloqueados" ou "minha carteira", promover `situacao` e `vendedor_id` a coluna
// é aditivo e não invalida nada daqui.
//
// **Por que as funções são puras.** Guardar é fácil; guardar sem apagar é o que
// tem regra, e regra sem teste apodrece. Separadas do Supabase, as três
// armadilhas viram asserção de teste em vez de conferência manual:
//
// 1. **Nulo não apaga.** Uma consulta que volta sem inscrição estadual não pode
//    zerar a que a consulta anterior descobriu. Só entra no merge o que veio
//    preenchido — e `false` é preenchido, `0` é preenchido, `''` não é.
// 2. **`contacts.telefone` e `contacts.email` não são tocados.** O telefone da
//    ficha é o número de WhatsApp por onde a pessoa escreveu, e é por ele que a
//    resposta sai; o do ERP é outro dado, e mora aqui dentro. O e-mail segue a
//    mesma regra por decisão do Leonardo (20/09): um campo, uma fonte.
// 3. **O nome do contato não é sobrescrito** pela razão social — isso é regra de
//    `memoria-do-erp.ts`, e continua lá. Aqui a razão social entra como `nome`
//    do cadastro, que é coisa diferente do nome do contato.

import type { ClienteDoErp, EnderecoDoErp } from './contrato';

/** De qual das duas operações este cadastro veio. É a primeira pergunta de quem
 *  abre a ficha para conferir a integração. */
export type OrigemDoCadastro = 'consulta' | 'cadastro';

/**
 * O que a consulta e o cadastro devolveram, guardado em `contacts.erp_cadastro`.
 *
 * Os nomes são os do contrato (snake_case), e não os do app: quem lê esta
 * coluna é quem está comparando com a documentação do sistema do cliente.
 */
export interface CadastroDoErp {
  cliente_id?: string;
  /** O CPF/CNPJ **deste** cadastro, só dígitos.
   *
   *  Ficou de fora até 20/09, com a justificativa de que `contacts.documento`
   *  já guardava. A lista derrubou o argumento: `contacts.documento` é o
   *  documento do cadastro ATUAL, e os outros da lista ficariam sem o campo que
   *  mais os identifica. Não é duplicação — é um dado por item. */
  documento?: string;
  /** Classificação fiscal. Nós nunca a enviamos — nasce pendente do lado deles
   *  e o comercial preenche. Aparece aqui quando a consulta já a devolve. */
  tipo_cliente?: string | null;
  segmento?: string | null;
  /** A razão social. NÃO é o nome do contato. */
  nome?: string | null;
  inscricao_estadual?: string | null;
  contribuinte_icms?: boolean | null;
  endereco?: Partial<EnderecoDoErp> | null;
  vendedor_id?: string | null;
  situacao?: string | null;
  empresas?: string[];
  /** O e-mail e o telefone do CADASTRO. Os da ficha são outros campos. */
  email?: string | null;
  telefone?: string | null;
  cidade_entrega?: string | null;
  uf_entrega?: string | null;
  atualizado_em?: string;
  origem?: OrigemDoCadastro;
}

/** Veio preenchido? `false` e `0` vieram; `null`, `undefined` e string em branco
 *  não. É esta função que impede a resposta magra apagar a resposta gorda. */
function preenchido(valor: unknown): boolean {
  if (valor === null || valor === undefined) return false;
  if (typeof valor === 'string') return valor.trim() !== '';
  if (Array.isArray(valor)) return valor.length > 0;
  return true;
}

const CAMPOS_DO_ENDERECO: (keyof EnderecoDoErp)[] = [
  'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep',
];

/** O endereço também mescla campo a campo: a consulta pode devolver um endereço
 *  sem complemento, e isso não é motivo para perder o complemento que o cadastro
 *  gravou. */
function mesclarEndereco(
  anterior: Partial<EnderecoDoErp> | null | undefined,
  novo: Partial<EnderecoDoErp> | null | undefined,
): Partial<EnderecoDoErp> | undefined {
  if (!anterior && !novo) return undefined;
  const junto: Partial<EnderecoDoErp> = { ...(anterior ?? {}) };
  for (const campo of CAMPOS_DO_ENDERECO) {
    const valor = novo?.[campo];
    if (preenchido(valor)) junto[campo] = valor as never;
  }
  return Object.keys(junto).length ? junto : undefined;
}

/**
 * Traduz o cliente que a operação devolveu para o que vai ficar guardado.
 *
 * `agora` é parâmetro para o teste não depender do relógio — mesmo motivo de
 * `fmtHoraRelativa` em `lib/data/mappers.ts`.
 */
export function cadastroDoCliente(
  cliente: Partial<ClienteDoErp>,
  origem: OrigemDoCadastro,
  agora: Date = new Date(),
): CadastroDoErp {
  const bruto: CadastroDoErp = {
    cliente_id: cliente.id,
    documento: (cliente.documento ?? '').replace(/\D/g, ''),
    tipo_cliente: cliente.tipo_cliente ?? null,
    segmento: cliente.segmento ?? null,
    nome: cliente.nome ?? null,
    inscricao_estadual: cliente.inscricao_estadual ?? null,
    contribuinte_icms: cliente.contribuinte_icms ?? null,
    endereco: cliente.endereco ?? null,
    vendedor_id: cliente.vendedor_id ?? null,
    situacao: cliente.situacao ?? null,
    empresas: cliente.empresas,
    email: cliente.email ?? null,
    telefone: cliente.telefone ?? null,
    cidade_entrega: cliente.cidade_entrega ?? null,
    uf_entrega: cliente.uf_entrega ?? null,
  };

  const limpo: CadastroDoErp = {};
  for (const [chave, valor] of Object.entries(bruto)) {
    if (preenchido(valor)) (limpo as Record<string, unknown>)[chave] = valor;
  }
  limpo.atualizado_em = agora.toISOString();
  limpo.origem = origem;
  return limpo;
}

/**
 * O que fica gravado depois desta descoberta: o que já havia, mais o que veio
 * preenchido agora.
 *
 * Nunca devolve o objeto anterior por referência — quem chama grava o resultado
 * e não deve conseguir mexer no que leu.
 */
export function mesclarCadastroDoErp(
  anterior: CadastroDoErp | null | undefined,
  novo: CadastroDoErp,
): CadastroDoErp {
  // **Cliente diferente não mescla.** A regra de "nulo não apaga" vale DENTRO
  // do mesmo cadastro; entre dois cadastros ela vaza. Foi o que aconteceu em
  // 20/09, no primeiro teste real: o contato consultou um CNPJ, depois
  // cadastrou outro, e o cadastro novo apareceu na tela com o `tipo_cliente` e
  // o `contribuinte_icms` do anterior — campos que a Distribuidora Exemplo não devolve ao
  // criar, e que o merge herdou de um cliente que não era aquele.
  if (anterior?.cliente_id && novo.cliente_id && anterior.cliente_id !== novo.cliente_id) {
    return { ...novo };
  }

  const junto: CadastroDoErp = { ...(anterior ?? {}) };

  for (const [chave, valor] of Object.entries(novo)) {
    if (chave === 'endereco') continue;
    if (preenchido(valor)) (junto as Record<string, unknown>)[chave] = valor;
  }

  const endereco = mesclarEndereco(anterior?.endereco, novo.endereco);
  if (endereco) junto.endereco = endereco;

  return junto;
}

/** O que veio do banco pode ser qualquer coisa — a coluna é jsonb e ninguém
 *  garante a forma. Lista e valor solto viram "não havia nada". */
export function cadastroGuardado(valor: unknown): CadastroDoErp | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  return valor as CadastroDoErp;
}

/** Idem, para a coluna que guarda a lista. */
export function cadastrosGuardados(valor: unknown): CadastroDoErp[] {
  if (!Array.isArray(valor)) return [];
  return valor.filter((c): c is CadastroDoErp => !!c && typeof c === 'object' && !Array.isArray(c));
}

/**
 * Quantos cadastros diferentes uma ficha guarda.
 *
 * O caso real é o comprador que atende por duas empresas — foi o primeiro teste
 * do Leonardo, em 20/09: o mesmo WhatsApp consultou um CNPJ e cadastrou outro.
 * O teto existe para a ficha não virar um log; dez é muito mais do que qualquer
 * comprador de verdade usa, e o mais antigo é o primeiro a sair.
 */
export const MAX_CADASTROS_NA_FICHA = 10;

/**
 * A lista depois desta descoberta: o cadastro do mesmo `cliente_id` é
 * atualizado (mesclando, que é onde "nulo não apaga" vale), e um `cliente_id`
 * novo entra na frente.
 *
 * **A ordem é o mais recente primeiro**, porque é o que a tela mostra em cima e
 * o que a conversa está usando agora.
 */
export function mesclarNaLista(
  lista: CadastroDoErp[],
  novo: CadastroDoErp,
): CadastroDoErp[] {
  if (!novo.cliente_id) return lista;

  const igual = lista.find(c => c.cliente_id === novo.cliente_id);
  const resto = lista.filter(c => c.cliente_id !== novo.cliente_id);
  const atualizado = igual ? mesclarCadastroDoErp(igual, novo) : novo;

  return [atualizado, ...resto].slice(0, MAX_CADASTROS_NA_FICHA);
}

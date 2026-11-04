// Leitura do catálogo: o índice que vai para o prompt, a busca por assunto que
// a ferramenta usa, e o resumo que a tela mostra.
//
// A regra que separa os três: **o índice é curto e vai sempre; o produto é
// longo e só vai quando pedido.** É isso que permite um catálogo de 1055 itens
// sem pôr 36 mil tokens em toda mensagem do cliente.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { normalizarCabecalho } from '../csv';
import { lerEmPaginas } from './importar';

type Client = SupabaseClient<Database>;

export interface GrupoDoCatalogo {
  codigo: string;
  nome: string;
}

export interface ProdutoDoCatalogo {
  codigo: string;
  descricao: string;
  unidade: string | null;
  preco: number | null;
  dados: Record<string, string>;
  grupoCodigo: string;
  grupoNome: string;
  /** Só a listagem do painel lê (`listarProdutosDoCatalogo`). A busca da IA não
   *  traz as medidas: o que ela recebe só muda com o fiscal. */
  molde?: string | null;
  medidas?: Record<string, string> | null;
}

export interface ResumoDoCatalogo {
  produtos: number;
  grupos: number;
  importadoEm: string | null;
  importadoNome: string | null;
  dicionario: string;
  regras: string;
}

/** `Tampa para Calhã` e `TAMPAPARACALHA` viram a mesma coisa. */
function compactar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, '');
}

/** Teto de produtos por consulta da ferramenta. Um grupo enorme mandado
 *  inteiro desfaria o motivo de o catálogo ter saído do prompt. */
const MAX_PRODUTOS_POR_BUSCA = 80;

export async function indiceDeGrupos(supabase: Client, orgId: string): Promise<GrupoDoCatalogo[]> {
  const { data } = await supabase
    .from('catalogo_grupos').select('codigo, nome')
    .eq('organization_id', orgId).eq('ativo', true)
    .order('codigo');
  return (data ?? []).map(g => ({ codigo: g.codigo, nome: g.nome }));
}

/** O índice do catálogo pronto para entrar no prompt: a lista dos assuntos, o
 *  dicionário de gíria e as regras de quando perguntar.
 *
 *  Devolve `null` quando a organização não tem catálogo — e aí o prompt segue
 *  montado como sempre foi, com a lista de produtos da aba Empresa. Catálogo
 *  vazio nunca pode significar "a empresa não vende nada". */
export async function catalogoParaPrompt(
  supabase: Client,
  orgId: string,
): Promise<{ grupos: GrupoDoCatalogo[]; dicionario: string; regras: string; produtos: number } | null> {
  const [grupos, contagem, cfg] = await Promise.all([
    indiceDeGrupos(supabase, orgId),
    supabase.from('catalogo_produtos').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('ativo', true),
    supabase.from('catalogo_config').select('dicionario, regras').eq('organization_id', orgId).maybeSingle(),
  ]);
  if (!grupos.length) return null;
  return {
    grupos,
    dicionario: cfg.data?.dicionario ?? '',
    regras: cfg.data?.regras ?? '',
    produtos: contagem.count ?? 0,
  };
}

export async function resumoDoCatalogo(supabase: Client, orgId: string): Promise<ResumoDoCatalogo> {
  const [produtos, grupos, cfg] = await Promise.all([
    supabase.from('catalogo_produtos').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('ativo', true),
    supabase.from('catalogo_grupos').select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId).eq('ativo', true),
    supabase.from('catalogo_config').select('*').eq('organization_id', orgId).maybeSingle(),
  ]);
  return {
    produtos: produtos.count ?? 0,
    grupos: grupos.count ?? 0,
    importadoEm: cfg.data?.importado_em ?? null,
    importadoNome: cfg.data?.importado_nome ?? null,
    dicionario: cfg.data?.dicionario ?? '',
    regras: cfg.data?.regras ?? '',
  };
}

/**
 * Uma página do catálogo para a TELA, com busca e filtro por categoria.
 *
 * **Por que a busca não é feita no navegador.** Com 1055 produtos, mandar a
 * lista inteira para a tela e filtrar lá custaria alguns megabytes a cada
 * abertura da aba Empresa — e o cliente seguinte pode ter 10 mil. A busca mora
 * no banco, e a tela recebe só a página que vai desenhar.
 *
 * `ilike` com `%termo%` em código e descrição cobre o que alguém digita numa
 * caixa de busca de catálogo: um pedaço do código ("ENS"), um pedaço do nome
 * ("prego 17"), a medida.
 */
export async function listarProdutosDoCatalogo(
  supabase: Client,
  orgId: string,
  opcoes: { busca?: string; grupoCodigo?: string; limite?: number } = {},
): Promise<{ produtos: ProdutoDoCatalogo[]; total: number; cortado: boolean }> {
  const limite = opcoes.limite ?? 50;
  const { data: grupos } = await supabase
    .from('catalogo_grupos').select('id, codigo, nome')
    .eq('organization_id', orgId).eq('ativo', true);
  const porId = new Map((grupos ?? []).map(g => [g.id, g]));

  let consulta = supabase
    .from('catalogo_produtos')
    .select('codigo, descricao, unidade, preco, dados, grupo_id, molde, medidas', { count: 'exact' })
    .eq('organization_id', orgId).eq('ativo', true);

  if (opcoes.grupoCodigo) {
    const grupo = (grupos ?? []).find(g => g.codigo === opcoes.grupoCodigo);
    // Grupo que não existe não pode devolver o catálogo inteiro: devolve nada.
    if (!grupo) return { produtos: [], total: 0, cortado: false };
    consulta = consulta.eq('grupo_id', grupo.id);
  }

  const busca = (opcoes.busca ?? '').trim();
  if (busca) {
    const alvo = `%${busca.replace(/[%_]/g, '')}%`;
    consulta = consulta.or(`codigo.ilike.${alvo},descricao.ilike.${alvo}`);
  }

  const { data, count } = await consulta.order('codigo').limit(limite);
  const linhas = data ?? [];

  return {
    produtos: linhas.map(p => {
      const grupo = porId.get(p.grupo_id);
      return {
        codigo: p.codigo,
        descricao: p.descricao,
        unidade: p.unidade,
        preco: p.preco,
        dados: (p.dados ?? {}) as Record<string, string>,
        grupoCodigo: grupo?.codigo ?? '',
        grupoNome: grupo?.nome ?? '',
        molde: p.molde,
        medidas: (p.medidas ?? null) as Record<string, string> | null,
      };
    }),
    total: count ?? linhas.length,
    cortado: (count ?? 0) > linhas.length,
  };
}

/**
 * Produtos da lista DIGITADA (aba Empresa) que casam com os termos pedidos.
 *
 * **Por que esta função existe.** A partir de 14/09 quem decide se a lista vai
 * inteira ao prompt é o tamanho, não o roteiro — e uma clínica com 400
 * procedimentos digitados fica com o mesmo índice que a Distribuidora Exemplo tem com 1055
 * itens importados. Sem esta busca, o índice apontaria para produtos que a
 * ferramenta não saberia abrir.
 *
 * A lista digitada não tem grupo, então o que casa é o texto: nome, descrição
 * e observações, sem acento e sem caixa.
 */
export async function buscarProdutosDigitados(
  supabase: Client,
  orgId: string,
  termos: string[],
): Promise<{ proc: string; valor: string; descricao: string; observacoes: string }[]> {
  const { data } = await supabase
    .from('business_prices')
    .select('procedimento, valor, descricao, observacoes, ordem')
    .eq('organization_id', orgId)
    .order('ordem');

  const alvos = termos.map(t => normalizarCabecalho(t)).filter(Boolean);
  if (!alvos.length) return [];

  return (data ?? [])
    .filter(p => {
      const texto = normalizarCabecalho(
        [p.procedimento, p.descricao ?? '', p.observacoes ?? ''].join(' '),
      );
      return alvos.some(alvo => texto.includes(alvo));
    })
    .slice(0, MAX_PRODUTOS_POR_BUSCA)
    .map(p => ({
      proc: p.procedimento,
      valor: p.valor,
      descricao: p.descricao ?? '',
      observacoes: p.observacoes ?? '',
    }));
}

/** Busca os produtos dos grupos pedidos.
 *
 *  O modelo manda o **código** do grupo, porque é assim que o índice do prompt
 *  o apresenta. Mas ele às vezes manda o nome, e recusar por isso gastaria uma
 *  volta do laço para dizer "escreva de novo": o nome também casa, sem acento e
 *  sem caixa. */
export async function buscarProdutosPorGrupo(
  supabase: Client,
  orgId: string,
  termos: string[],
): Promise<{ produtos: ProdutoDoCatalogo[]; gruposEncontrados: GrupoDoCatalogo[]; naoEncontrados: string[]; cortado: boolean }> {
  const { data: grupos } = await supabase
    .from('catalogo_grupos').select('id, codigo, nome')
    .eq('organization_id', orgId).eq('ativo', true);

  const todos = grupos ?? [];
  const escolhidos = new Map<string, { id: string; codigo: string; nome: string }>();
  const naoEncontrados: string[] = [];

  for (const termo of termos) {
    const alvo = normalizarCabecalho(termo);
    const casa = todos.filter(g =>
      g.codigo.toLowerCase() === termo.trim().toLowerCase()
      || normalizarCabecalho(g.nome) === alvo
      || normalizarCabecalho(g.nome).includes(alvo));
    if (!casa.length) { naoEncontrados.push(termo); continue; }
    for (const g of casa) escolhidos.set(g.id, g);
  }

  // **Quando o termo não é um assunto, é um pedaço do nome do produto.**
  //
  // A descrição da ferramenta promete isso ao modelo, e ele usa: numa conversa
  // de verdade em 14/09 ele pediu "prego 17x21" — que não é nome de grupo
  // nenhum. Sem esta busca, a resposta era "não existe assunto com isso" e a IA
  // dizia ao cliente que o produto não existe. Ele existe: é o 700113, dentro
  // do assunto PREGOS. **Dizer que a loja não vende o que ela vende é o pior
  // erro possível nesta ferramenta.**
  //
  // **A comparação é sem acento, sem espaço e sem caixa.** O ERP da Distribuidora Exemplo
  // escreve `VERGALHAO` num código e `VERGALHÃO` nos outros, e `TAMPAPARACALHA`
  // tudo junto; o `ilike` comparava letra por letra e respondia "não tem". O
  // banco não sabe comparar assim, então a busca lê o catálogo e compara aqui.
  const semGrupo = naoEncontrados.filter(t => compactar(t).length >= 3);
  let porTexto: { codigo: string; descricao: string; unidade: string | null; preco: number | null; dados: unknown; grupo_id: string }[] = [];
  if (semGrupo.length) {
    const alvos = semGrupo.map(compactar);
    const catalogo = await lerEmPaginas<(typeof porTexto)[number]>((de, ate) => supabase
      .from('catalogo_produtos')
      .select('codigo, descricao, unidade, preco, dados, grupo_id')
      .eq('organization_id', orgId).eq('ativo', true)
      .order('codigo').range(de, ate));
    porTexto = catalogo
      .filter(p => {
        const texto = `${compactar(p.codigo)}|${compactar(p.descricao)}`;
        return alvos.some(alvo => texto.includes(alvo));
      })
      .slice(0, MAX_PRODUTOS_POR_BUSCA);
    // O grupo de cada produto achado entra na lista, para a saída sair
    // organizada por assunto como a do caminho normal.
    for (const p of porTexto) {
      const g = todos.find(x => x.id === p.grupo_id);
      if (g) escolhidos.set(g.id, g);
    }
  }

  if (!escolhidos.size) {
    return { produtos: [], gruposEncontrados: [], naoEncontrados, cortado: false };
  }

  const { data: linhas } = escolhidos.size && semGrupo.length < termos.length
    ? await supabase
        .from('catalogo_produtos')
        .select('codigo, descricao, unidade, preco, dados, grupo_id')
        .eq('organization_id', orgId).eq('ativo', true)
        .in('grupo_id', [...escolhidos.keys()])
        .order('codigo')
        .limit(MAX_PRODUTOS_POR_BUSCA + 1)
    : { data: [] as typeof porTexto };

  // Os dois caminhos podem trazer a mesma linha; o código é único por org.
  const porCodigo = new Map<string, (typeof porTexto)[number]>();
  for (const p of [...(linhas ?? []), ...porTexto]) porCodigo.set(p.codigo, p);
  const achadas = [...porCodigo.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  const cortado = achadas.length > MAX_PRODUTOS_POR_BUSCA;

  return {
    produtos: achadas.slice(0, MAX_PRODUTOS_POR_BUSCA).map(p => {
      const grupo = escolhidos.get(p.grupo_id)!;
      return {
        codigo: p.codigo,
        descricao: p.descricao,
        unidade: p.unidade,
        preco: p.preco,
        dados: (p.dados ?? {}) as Record<string, string>,
        grupoCodigo: grupo.codigo,
        grupoNome: grupo.nome,
      };
    }),
    gruposEncontrados: [...escolhidos.values()].map(g => ({ codigo: g.codigo, nome: g.nome })),
    naoEncontrados,
    cortado,
  };
}

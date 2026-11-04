// Do arquivo que o cliente manda para as linhas que o banco entende.
//
// O catálogo entra por ARQUIVO, nunca digitado à mão: são 1055 produtos na
// Distribuidora Exemplo, e digitar um preço errado num orçamento custa uma entrega. O
// arquivo é a fonte de verdade, e a tela só o recebe.
//
// **O cabeçalho é lido, não posicional.** Cada cliente exporta a planilha do
// jeito do sistema dele; exigir uma ordem fixa de colunas transformaria cada
// novo cliente num pedido de "reordene as colunas antes de subir". As colunas
// que não reconhecemos não são descartadas: vão inteiras para `dados`, porque
// o que hoje é "peso_kg" pode ser exatamente o que o vendedor precisa ver.

import { parseCSV, normalizarCabecalho, lerNumero } from '../csv';

export interface LinhaDoCatalogo {
  codigo: string;
  grupoCodigo: string;
  grupoNome: string;
  descricao: string;
  unidade: string | null;
  preco: number | null;
  /** Toda coluna que não é uma das acima, como veio. */
  dados: Record<string, string>;
}

export interface LeituraDoCatalogo {
  linhas: LinhaDoCatalogo[];
  /** Problemas por linha, já em português e com o número da linha do arquivo.
   *  A leitura não para no primeiro: quem sobe uma planilha quer a lista
   *  inteira do que está errado, não um erro por tentativa. */
  erros: string[];
  /** Colunas do arquivo que foram para `dados`. A tela mostra isso para o
   *  cliente conferir se alguma coluna importante foi ignorada por erro de
   *  digitação no cabeçalho. */
  colunasExtras: string[];
}

/** Nome da coluna no arquivo → campo nosso. A primeira que aparecer vale. */
const SINONIMOS: Record<keyof Omit<LinhaDoCatalogo, 'dados'>, string[]> = {
  codigo: ['codigo', 'cod', 'sku', 'referencia', 'ref'],
  grupoCodigo: ['grupo', 'grupo_codigo', 'codigo_grupo', 'categoria_codigo', 'cod_grupo'],
  grupoNome: ['grupo_nome', 'nome_grupo', 'grupo_descricao', 'categoria', 'familia', 'linha'],
  descricao: ['descricao', 'produto', 'nome', 'item'],
  unidade: ['unidade', 'un', 'und', 'um'],
  preco: ['preco', 'preco_tabela', 'preco_de_tabela', 'valor', 'preco_venda', 'preco_unitario'],
};

const TODOS_OS_SINONIMOS = new Set(Object.values(SINONIMOS).flat());

/**
 * O arquivo é um catálogo de sistema, ou a lista simples de produtos digitada?
 *
 * **Por que adivinhar em vez de perguntar.** A seção Produtos tem um botão de
 * importar, não dois. Dois botões seriam, de novo, "dois lugares guardando a
 * mesma ideia" — e o cliente que errasse o botão receberia uma planilha lida
 * torto sem entender por quê. O que separa as duas coisas está no cabeçalho:
 * catálogo de sistema tem **código** e **grupo**; a lista digitada tem só nome
 * e preço.
 */
export function pareceCatalogoDeSistema(texto: string): boolean {
  const primeira = parseCSV(texto).find(l => l.some(c => c.trim() !== ''));
  if (!primeira) return false;
  const cabecalho = primeira.map(normalizarCabecalho);
  const tem = (campo: keyof typeof SINONIMOS) => SINONIMOS[campo].some(n => cabecalho.includes(n));
  return tem('codigo') && (tem('grupoCodigo') || tem('grupoNome'));
}

export function lerCatalogoCSV(texto: string): LeituraDoCatalogo {
  const linhasBrutas = parseCSV(texto).filter(l => l.some(c => c.trim() !== ''));
  if (!linhasBrutas.length) {
    return { linhas: [], erros: ['O arquivo está vazio.'], colunasExtras: [] };
  }

  const cabecalho = linhasBrutas[0].map(normalizarCabecalho);
  const indiceDe = (campo: keyof typeof SINONIMOS): number => {
    for (const nome of SINONIMOS[campo]) {
      const i = cabecalho.indexOf(nome);
      if (i >= 0) return i;
    }
    return -1;
  };

  const iCodigo = indiceDe('codigo');
  const iDescricao = indiceDe('descricao');
  const iGrupoCodigo = indiceDe('grupoCodigo');
  const iGrupoNome = indiceDe('grupoNome');
  const iUnidade = indiceDe('unidade');
  const iPreco = indiceDe('preco');

  const erros: string[] = [];
  if (iCodigo < 0) erros.push('Falta a coluna de código do produto (aceita: codigo, cod, sku, referencia).');
  if (iDescricao < 0) erros.push('Falta a coluna de descrição (aceita: descricao, produto, nome, item).');
  if (iGrupoCodigo < 0 && iGrupoNome < 0) {
    erros.push('Falta a coluna de grupo (aceita: grupo, grupo_nome, categoria). É por ela que a IA acha o produto.');
  }
  if (erros.length) return { linhas: [], erros, colunasExtras: [] };

  const colunasExtras = cabecalho.filter((nome, i) =>
    nome && !TODOS_OS_SINONIMOS.has(nome) && ![iCodigo, iDescricao, iGrupoCodigo, iGrupoNome, iUnidade, iPreco].includes(i));

  const linhas: LinhaDoCatalogo[] = [];
  const jaVistos = new Set<string>();

  for (let n = 1; n < linhasBrutas.length; n++) {
    const bruta = linhasBrutas[n];
    const campo = (i: number) => (i >= 0 ? (bruta[i] ?? '').trim() : '');
    const numeroDaLinha = n + 1; // como o cliente vê na planilha

    const codigo = campo(iCodigo);
    const descricao = campo(iDescricao);
    if (!codigo) { erros.push(`Linha ${numeroDaLinha}: sem código; foi ignorada.`); continue; }
    if (!descricao) { erros.push(`Linha ${numeroDaLinha}: sem descrição; foi ignorada.`); continue; }
    if (jaVistos.has(codigo)) {
      // Código repetido não é detalhe: no orçamento ele é a identidade do
      // produto. Vale a primeira ocorrência, e a repetição fica registrada
      // para o cliente decidir qual estava certa.
      erros.push(`Linha ${numeroDaLinha}: o código ${codigo} aparece mais de uma vez; valeu a primeira.`);
      continue;
    }
    jaVistos.add(codigo);

    const grupoCodigo = campo(iGrupoCodigo) || campo(iGrupoNome);
    const grupoNome = campo(iGrupoNome) || campo(iGrupoCodigo);

    const dados: Record<string, string> = {};
    for (const [i, nome] of cabecalho.entries()) {
      if (!colunasExtras.includes(nome)) continue;
      const valor = (bruta[i] ?? '').trim();
      if (valor) dados[nome] = valor;
    }

    linhas.push({
      codigo,
      grupoCodigo,
      grupoNome,
      descricao,
      unidade: campo(iUnidade) || null,
      preco: iPreco >= 0 ? lerNumero(campo(iPreco)) : null,
      dados,
    });
  }

  if (!linhas.length && !erros.length) erros.push('O arquivo tem cabeçalho, mas nenhuma linha de produto.');
  return { linhas, erros, colunasExtras };
}

// A resposta saiu picada em pedaços de palavra?
//
// **O caso que criou este arquivo**, no primeiro teste real do Leonardo em
// 20/09: o cliente recebeu
//
//   " O cad as tro foi fe i to. Ag ora vo u c onfirmar os v al ores ... "
//
// O texto foi gravado no banco exatamente assim. Não há `join`, `split` nem
// `replace` em nenhum ponto entre o parse da resposta e o envio — o espaço veio
// de dentro do JSON que o modelo produziu. É artefato do **structured output**:
// a decodificação restrita pelo schema às vezes emite espaço em fronteira de
// token. Não é reproduzível sob demanda e não é do nosso lado.
//
// **Por que detectar em vez de consertar.** Remendar "cad as tro" exigiria um
// dicionário, e qualquer regex que junte pedaços vai colar palavras legítimas
// mais cedo ou mais tarde. Detectar e pedir de novo é barato, não inventa texto
// e, no pior caso, manda a resposta como o modelo escreveu — que é o que já
// acontecia antes desta função existir.
//
// **O detector é conservador de propósito.** Português tem muita palavra de uma
// e duas letras, e mandar o modelo repetir uma resposta boa custa tempo do
// cliente. Só contam como suspeitos os pedaços curtos que **não são palavra** —
// "cad", "fe", "vo", "çam" — e são precisos três deles para a resposta ser
// considerada picada.

/**
 * Palavras de uma e duas letras que existem em português, mais as unidades do
 * balcão. Lista curta e fechada: o que interessa é separar "de" de "fe".
 *
 * **Por que o corte é em DUAS letras, e não em três.** Português tem palavra de
 * três letras demais — sai, deu, sei, vou, tem, foi, dia, mas, por, que. Manter
 * a lista delas é jogo perdido, e cada esquecida vira uma resposta boa
 * repetida na cara do cliente. Com duas letras o detector perde os picotes de
 * três, e ainda assim sobra sinal: a mensagem de 20/09 tinha doze pedaços de
 * uma e duas letras.
 */
const PALAVRAS_CURTAS = new Set([
  'a', 'à', 'e', 'é', 'o', 'ao', 'as', 'às', 'em', 'os', 'ou', 'se', 'te', 'tu', 'eu',
  'da', 'de', 'do', 'na', 'no', 'me', 'lá', 'aí', 'cá', 'ai', 'ah', 'oi', 'ó',
  'um', 'já', 'só', 'há', 'ir', 'vi', 'ei', 'às',
  'km', 'kg', 'mm', 'cm', 'm', 'un', 'pc', 'pç', 'nf', 'ie', 'uf', 'ok', 'pf', 'pj',
]);

/** Quantos pedaços de DUAS letras bastam para desconfiar. Três porque um ou
 *  dois acontecem em texto normal (sigla, unidade, um nome cortado). */
const MINIMO_DE_PEDACOS = 3;


/** Abaixo disto não dá para julgar: "ok" e "sim" são respostas legítimas. */
const MINIMO_DE_PALAVRAS = 6;

function ehPedacoSuspeito(bruto: string): boolean {
  // **Nada com dígito conta.** Um balcão de aço fala em "30x30x1,20", "12.5" e
  // "R$ 64,00"; tirar os números de "30x30x1,20" deixa "xx", que pareceria um
  // pedaço de palavra e não é. Foi o primeiro falso positivo do detector.
  if (/\d/.test(bruto)) return false;

  // Tira só a pontuação das pontas ("to." vira "to"). O que sobrar precisa ser
  // **letra pura**: `R$` carrega um símbolo no meio, e arrancá-lo deixaria um
  // "R" solto que pareceria pedaço de palavra. Foi o segundo falso positivo do
  // detector, num "R$ 64,00" — preço é o que mais aparece aqui.
  const palavra = bruto.replace(/^[.,;:!?"'()[\]{}…-]+|[.,;:!?"'()[\]{}…-]+$/gu, '').toLowerCase();
  if (!palavra || palavra.length > 2) return false;
  if (!/^\p{L}+$/u.test(palavra)) return false;
  return !PALAVRAS_CURTAS.has(palavra);
}

/**
 * A resposta parece picada em fronteira de token?
 *
 * Pura de propósito: é regra com armadilha (português tem muita palavra curta),
 * e regra com armadilha precisa de teste sem rede nem banco no caminho.
 */
export function pareceTextoFragmentado(texto: string): boolean {
  const palavras = texto.trim().split(/\s+/).filter(Boolean);
  if (palavras.length < MINIMO_DE_PALAVRAS) return false;

  const suspeitos = palavras.filter(ehPedacoSuspeito);

  // **Uma letra solta já basta.** As únicas letras que andam sozinhas em
  // português são `a`, `e`, `o`, `é` e `à`, e todas estão na lista de palavras.
  // Um `t` ou um `c` sozinho no meio da frase não é abreviação de nada: é
  // palavra partida. Foi o que escapou na segunda ocorrência, em 20/09 às
  // 19:41 — `"O me t alon 30x30 tem em chapa 16..."` tinha UM pedaço só e
  // passou pelo teto de três.
  if (suspeitos.some(p => p.replace(/[^\p{L}]/gu, '').length === 1)) return true;

  return suspeitos.length >= MINIMO_DE_PEDACOS;
}

/**
 * Um RÓTULO da ficha do contato saiu picado?
 *
 * `pareceTextoFragmentado` não serve aqui: ela exige seis palavras para poder
 * julgar, e um rótulo tem duas. Mas o sinal mais forte dela — **uma letra
 * sozinha que não é palavra** — vale sem esse mínimo, porque rótulo é um nome
 * curto e controlado ("Novo CNPJ", "Cidade"), nunca uma frase.
 *
 * **Por que isto existe.** Em 20/09 a ficha do contato guardou
 * `{"rotulo": " C NP J", "valor": " 44 .455 .566 /000 1-83 "}`. O perfil do
 * contato volta ao prompt na resposta seguinte, na seção "O que já sabemos
 * deste cliente" — então o picote não fica parado: ele é reapresentado ao
 * modelo como fato sobre o cliente, e o modelo passa a ler lixo como dado.
 *
 * O lado do `valor` NÃO é coberto: o exemplo acima é dígito picado, e separar
 * isso de uma medida legítima ("30x30x1,20") exigiria adivinhação. O rótulo é
 * o que dá para julgar com segurança, e sem rótulo o par inteiro é descartado.
 */
export function pareceRotuloPicado(rotulo: string): boolean {
  const palavras = rotulo.trim().split(/s+/).filter(Boolean);
  if (palavras.length < 2) return false;
  return palavras.some(p => {
    const letras = p.replace(/[^p{L}]/gu, '');
    return letras.length === 1 && ehPedacoSuspeito(letras);
  });
}

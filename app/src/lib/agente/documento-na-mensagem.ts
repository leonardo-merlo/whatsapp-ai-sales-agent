// O cliente acabou de citar um CPF ou CNPJ, e ele é outro?
//
// **O caso que criou este arquivo**, no teste do Leonardo em 20/09. A conversa
// já tinha um cliente identificado. Ele escreveu:
//
//   "na verdade esse orçamento é para o outro cnpj, 45.723.174/0001-10"
//
// e o agente **ignorou o documento novo**: não consultou o cadastro e foi
// direto cotar preço com o cliente antigo, que seguia guardado na conversa. O
// prompt até previa o caso ("a menos que ele diga que o pedido é para outra
// empresa"), e o modelo passou por cima assim mesmo.
//
// **Por isso a regra saiu do prompt e virou código.** Achar 11 ou 14 dígitos
// num texto é determinístico; contar com o modelo para notar que o documento
// mudou não é. Quando o documento citado é outro, o `cliente_id` guardado
// **deixa de ser oferecido** às ferramentas nesta volta — e aí `consultar_preco`
// e `criar_orcamento` batem na trava que já existe e mandam consultar o
// cadastro primeiro. Nenhuma regra nova: a que já havia passa a valer.
//
// **O dígito verificador é conferido de propósito.** Um telefone celular tem
// os mesmos 11 dígitos de um CPF, e sem essa conferência "meu zap é
// 32 98765-4321" seria lido como documento novo. Com ela, a chance de um número
// qualquer passar é de cerca de 1 em 100.

/** Só os dígitos. */
function digitos(texto: string): string {
  return texto.replace(/\D/g, '');
}

function cpfValido(d: string): boolean {
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const conta = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return conta(9) === Number(d[9]) && conta(10) === Number(d[10]);
}

function cnpjValido(d: string): boolean {
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const conta = (pesos: number[]): number => {
    const soma = pesos.reduce((a, peso, i) => a + Number(d[i]) * peso, 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return conta([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[12])
    && conta([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(d[13]);
}

export function documentoValido(bruto: string): boolean {
  const d = digitos(bruto);
  return cpfValido(d) || cnpjValido(d);
}

/**
 * O primeiro CPF ou CNPJ **válido** citado na mensagem, só dígitos. `null`
 * quando não há nenhum.
 *
 * Aceita as formas que um cliente escreve: com ponto, barra e traço, com
 * espaços, ou tudo junto.
 */
export function documentoCitado(texto: string): string | null {
  return documentosCitados(texto)[0] ?? null;
}

/**
 * Todos os CPFs e CNPJs **válidos** citados na mensagem, só dígitos, na ordem
 * e sem repetir. Existe para a sombra da máquina de estados contar quando o
 * cliente parece falar de dois orçamentos ao mesmo tempo (dois documentos
 * diferentes na mesma fala).
 */
export function documentosCitados(texto: string): string[] {
  const achados: string[] = [];
  // Sequências de dígitos e separadores. O `{11,}` corta na origem qualquer
  // coisa curta demais para ser documento (quantidade, bitola, CEP).
  const candidatos = texto.match(/[\d][\d.\-/\s]{11,}[\d]/g) ?? [];
  for (const bruto of [...candidatos, ...(texto.match(/\d{11,14}/g) ?? [])]) {
    const d = digitos(bruto);
    // Uma sequência longa pode carregar o documento no meio ("cnpj
    // 45.723.174/0001-10 e ie 1234567890"): tenta as janelas de 11 e 14.
    // Um documento por sequência, como sempre foi: a janela de 11 dentro de um
    // CNPJ já achado não conta como um segundo documento.
    janelas: for (const tamanho of [14, 11]) {
      for (let i = 0; i + tamanho <= d.length; i++) {
        const pedaco = d.slice(i, i + tamanho);
        if (documentoValido(pedaco)) {
          if (!achados.includes(pedaco)) achados.push(pedaco);
          break janelas;
        }
      }
    }
  }
  return achados;
}

/**
 * O cliente citou um documento DIFERENTE do que está identificado na conversa?
 *
 * `false` quando não citou nada, quando citou o mesmo, ou quando ainda não há
 * nenhum identificado — nesse último caso não há o que contradizer, e o fluxo
 * normal já manda consultar.
 */
export function citouOutroDocumento(texto: string, documentoAtual: string | null | undefined): boolean {
  const atual = digitos(documentoAtual ?? '');
  if (!atual) return false;
  const citado = documentoCitado(texto);
  return !!citado && citado !== atual;
}

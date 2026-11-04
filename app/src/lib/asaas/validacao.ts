// Validação de CPF/CNPJ (dígito verificador) — usada antes de criar cliente
// na Asaas, que exige um documento válido. Puro, sem I/O.

function somenteDigitos(v: string): string {
  return v.replace(/\D/g, '');
}

export function validarCpf(v: string): boolean {
  const cpf = somenteDigitos(v);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const digitos = cpf.split('').map(Number);
  const calcularDigito = (base: number[]): number => {
    let soma = 0;
    let peso = base.length + 1;
    for (const d of base) { soma += d * peso; peso--; }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcularDigito(digitos.slice(0, 9));
  const d2 = calcularDigito(digitos.slice(0, 10));
  return d1 === digitos[9] && d2 === digitos[10];
}

export function validarCnpj(v: string): boolean {
  const cnpj = somenteDigitos(v);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;

  const digitos = cnpj.split('').map(Number);
  const calcularDigito = (base: number[]): number => {
    let soma = 0;
    const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    base.forEach((d, i) => { soma += d * pesos[i]; });
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  const d1 = calcularDigito(digitos.slice(0, 12));
  const d2 = calcularDigito(digitos.slice(0, 13));
  return d1 === digitos[12] && d2 === digitos[13];
}

export function validarCpfOuCnpj(v: string): boolean {
  const digitos = somenteDigitos(v);
  if (digitos.length === 11) return validarCpf(digitos);
  if (digitos.length === 14) return validarCnpj(digitos);
  return false;
}

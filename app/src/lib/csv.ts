// Leitura de CSV sem dependência.
//
// Estava dentro de `agente.tsx`, atendendo só o import de produtos e serviços.
// Saiu para cá quando o catálogo do Wappia Vendas passou a precisar do mesmo
// trabalho: dois parsers de CSV no mesmo projeto é um que conserta o bug do
// Excel e outro que não.

/** Divide o texto em linhas e colunas, respeitando aspas e o separador que o
 *  arquivo usar (Excel pt-BR exporta com `;`). */
export function parseCSV(input: string): string[][] {
  // Remove o BOM inicial e detecta o separador (Excel pt-BR usa ';', outros ',').
  const text = input.replace(/^﻿/, '');
  const primeiraLinha = text.split('\n')[0] ?? '';
  const delim = (primeiraLinha.split(';').length - 1) > (primeiraLinha.split(',').length - 1) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** Nome de coluna reduzido ao que dá para comparar: sem acento, sem espaço,
 *  minúsculo. `Preço de Tabela` e `preco_de_tabela` viram a mesma coisa. */
export function normalizarCabecalho(nome: string): string {
  return nome
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .trim().toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Número escrito por gente: `461.3`, `1.234,56`, `R$ 29,80`, `12`.
 *  Devolve `null` quando não é número nenhum — nunca 0, que passaria por preço
 *  de verdade. */
export function lerNumero(bruto: string): number | null {
  const limpo = (bruto ?? '').replace(/[^\d.,-]/g, '').trim();
  if (!limpo) return null;
  const temVirgula = limpo.includes(',');
  const temPonto = limpo.includes('.');
  let normalizado: string;
  if (temVirgula && temPonto) {
    // O último dos dois é o decimal: `1.234,56` (BR) e `1,234.56` (EN).
    normalizado = limpo.lastIndexOf(',') > limpo.lastIndexOf('.')
      ? limpo.replace(/\./g, '').replace(',', '.')
      : limpo.replace(/,/g, '');
  } else if (temVirgula) {
    normalizado = limpo.replace(',', '.');
  } else {
    normalizado = limpo;
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

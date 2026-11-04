// A forma de cada campo do cadastro novo, conferida pelo código antes de
// entrar em `dados` (T5). O que a IA extraiu e não passa aqui é descartado, e a
// pergunta pede o campo de novo. O ERP continua tendo a palavra final (T9).

import type { CampoDoCadastro } from './tipos';

const UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

/** O valor limpo, ou null quando não tem a forma do campo. */
export function validarCampo(campo: CampoDoCadastro, bruto: string): string | null {
  const valor = String(bruto ?? '').trim().replace(/\s+/g, ' ');
  if (!valor) return null;
  switch (campo) {
    case 'cep': {
      const digitos = valor.replace(/\D/g, '');
      return digitos.length === 8 ? digitos : null;
    }
    case 'uf': {
      const uf = valor.toUpperCase();
      return UFS.has(uf) ? uf : null;
    }
    case 'numero':
      return /^(s\/?n|sem n[uú]mero)$/i.test(valor) ? 'SN' : /\d/.test(valor) && valor.length <= 10 ? valor : null;
    case 'nome':
    case 'logradouro':
    case 'cidade':
    case 'bairro':
      return valor.length >= 2 && /[a-zA-ZÀ-ú]/.test(valor) ? valor : null;
    case 'inscricao_estadual':
      return /^isent/i.test(valor) ? 'ISENTO' : /\d/.test(valor) ? valor : null;
  }
}

/** Como cada campo aparece na frase "Falta só ...". */
export const ROTULO_DO_CAMPO: Record<CampoDoCadastro, string> = {
  nome: 'o nome ou a razão social',
  logradouro: 'a rua',
  numero: 'o número',
  bairro: 'o bairro',
  cidade: 'a cidade',
  uf: 'o estado',
  cep: 'o CEP',
  inscricao_estadual: 'a inscrição estadual',
};

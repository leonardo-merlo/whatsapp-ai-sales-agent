// Quem recebe um disparo, e quantos cabem. Sem nada de servidor: a tela usa
// para mostrar o alcance, o disparo usa para decidir quem recebe, e os dois
// contam igual.

import { normalizarTelefoneWhatsApp } from '../whatsapp/telefone';

/**
 * Quantos contatos cabem num disparo. Não é regra da Meta: é o tempo do
 * servidor (60 s por requisição na Vercel) dividido pelo tempo de um envio.
 * Acima disso o disparo seria cortado no meio, sem ninguém saber quem recebeu.
 * Lista maior pede fila, que ainda não existe.
 */
export const LIMITE_POR_DISPARO = 150;

export interface FiltrosDoPublico {
  bairro: string | null;
  status: 'ativo' | 'inativo' | null;
}

export interface ContatoDoPublico {
  id: string;
  nome: string;
  telefone: string | null;
  bairro: string | null;
  status: string;
}

/** Os filtros da tela, e só quem tem um WhatsApp válido. */
export function publicoDoDisparo<C extends ContatoDoPublico>(
  contatos: C[],
  filtros: FiltrosDoPublico,
): (C & { whatsapp: string })[] {
  return contatos
    .filter(c => (!filtros.bairro || c.bairro === filtros.bairro) && (!filtros.status || c.status === filtros.status))
    .map(c => ({ ...c, whatsapp: c.telefone ? normalizarTelefoneWhatsApp(c.telefone) : null }))
    .filter((c): c is C & { whatsapp: string } => !!c.whatsapp);
}

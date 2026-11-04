'use client'; // contexto client para dados da organização carregados no layout server

import { createContext, useContext } from 'react';
import type { Database } from './supabase/database.types';
import type { Produto } from './produtos';

export interface OrgInfo {
  orgId: string;
  orgName: string;
  segmento: string;
  memberId: string;
  memberName: string;
  memberRole: Database['public']['Enums']['member_role'];
  userEmail: string;
  /** Todas as organizações do usuário, para a troca na barra lateral. Uma só
   *  (o caso de quase todo mundo) não mostra troca nenhuma. */
  organizacoes: { id: string; nome: string }[];
  /**
   * Seções que esta organização não usa, pelo pedaço da rota (`agenda`).
   *
   * Não é papel nem permissão: é o que aquele negócio faz. Quem define é o
   * Leonardo, na mão — o cliente não saberia responder, e perguntar no
   * onboarding seria mais uma regra para ele entender. Lista vazia, que é o
   * padrão de toda organização, mostra o menu inteiro.
   */
  secoesOcultas: string[];
  /** Produtos contratados (S14). Com um só, não há seletor de produto. */
  produtos: Produto[];
  /** O produto na tela. Decide menu, cor e modelos de template. */
  produtoAtivo: Produto;
}

const OrgContext = createContext<OrgInfo | null>(null);

export function OrgProvider({ value, children }: { value: OrgInfo; children: React.ReactNode }) {
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg(): OrgInfo {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg deve ser usado dentro de OrgProvider');
  return ctx;
}

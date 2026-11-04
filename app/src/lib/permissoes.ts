// Perfis de acesso — fonte única de "quem pode o quê" na UI.
//
// A RLS do banco é quem de fato protege: toda escrita das tabelas de
// configuração passa por is_admin_of, e a leitura de faturamento também
// (20260731000002). O que este módulo resolve é a UX — sem ele os botões
// aparecem para o atendente e falham em silêncio.
//
// São 3 papéis (member_role): owner, admin e atendente. Owner e admin têm o
// mesmo alcance na aplicação; a diferença entre os dois é de titularidade, não
// de permissão.

import type { Database } from './supabase/database.types';

export type PapelMembro = Database['public']['Enums']['member_role'];

function ehAdmin(papel: PapelMembro): boolean {
  return papel === 'owner' || papel === 'admin';
}

export interface Permissoes {
  /** Plano contratado, faturas e cobrança. */
  verFaturamento: boolean;
  /** Editar e publicar o agente. Ver a configuração continua liberado. */
  editarAgente: boolean;
  /** Painel com a visão consolidada do negócio. */
  verPainel: boolean;
  /** Convidar, editar e remover membros da equipe. */
  gerenciarEquipe: boolean;
  /** Razão social, documento, endereço, integração do WhatsApp. */
  editarDadosNegocio: boolean;
  /** Vendas pendentes de aprovação e alertas de estoque (sino). */
  aprovarVendas: boolean;
  /**
   * A seção Desenvolvimento: o corpo cru de cada chamada ao sistema de gestão e
   * o cadastro do endereço e da chave desse sistema.
   *
   * É admin porque o corpo das requisições carrega CPF e CNPJ dos clientes — um
   * vendedor não precisa ver o documento dos clientes dos outros para
   * trabalhar. A RLS de `erp_chamadas` diz o mesmo (`is_admin_of`); aqui é só a
   * UX acompanhando.
   */
  verDesenvolvimento: boolean;
}

export function permissoesDe(papel: PapelMembro): Permissoes {
  const admin = ehAdmin(papel);
  return {
    verFaturamento: admin,
    editarAgente: admin,
    verPainel: admin,
    gerenciarEquipe: admin,
    editarDadosNegocio: admin,
    aprovarVendas: admin,
    verDesenvolvimento: admin,
  };
}

/** Para onde mandar quem caiu numa rota que não pode ver. */
export const ROTA_INICIAL_SEM_PAINEL = '/conversas';

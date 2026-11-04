// Filtro por número em Conversas.
//
// O campo `conversations.wa_number_id` sempre existiu no banco, mas o
// mapeamento o jogava fora: a tela não tinha como saber por qual número cada
// conversa entrou. O teste trava que ele chega ao estado, inclusive nulo —
// conversa anterior à tabela de números não pode virar "de número nenhum" por
// engano e sumir da lista.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConversa } from '../src/lib/data/mappers.ts';
import type { Tables } from '../src/lib/supabase/database.types.ts';

function conversa(waNumberId: string | null): Tables<'conversations'> {
  return {
    id: 'c1', organization_id: 'org', contact_id: 'contato', assunto: 'WhatsApp',
    status: 'aberta', modo: 'ia', atendente_id: null, created_at: '2026-09-25T10:00:00Z',
    updated_at: '2026-09-25T10:00:00Z', resumida_em: null, wa_number_id: waNumberId,
  } as Tables<'conversations'>;
}

describe('conversa carrega o número', () => {
  test('mantém o número por onde a conversa entrou', () => {
    assert.equal(mapConversa(conversa('numero-1'), [], [], new Map()).waNumberId, 'numero-1');
  });

  test('conversa antiga, sem número, chega como nulo em vez de sumir', () => {
    assert.equal(mapConversa(conversa(null), [], [], new Map()).waNumberId, null);
  });
});

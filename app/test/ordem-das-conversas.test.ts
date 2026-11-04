// A lista de Conversas em ordem de quem falou por último.
//
// O sintoma que o Leonardo viu: ele mandou uma mensagem agora e a conversa
// continuou no meio da lista, abaixo de conversas de dias atrás.
//
// A causa: a consulta ordenava por `conversations.updated_at`, e **mensagem
// nova não edita a conversa** — aquela coluna só muda quando a linha da
// conversa é alterada (virar humano, encerrar, carimbar o número). Ou seja, a
// lista estava ordenada por "última vez que alguém mexeu na conversa", não por
// "última vez que alguém falou".
//
// O teste trava o que o mapeamento entrega: `ultimaMsgIso` é o instante da
// última mensagem, e é ele que a tela ordena. O campo `hora` não serve para
// isso — é texto ("Agora", "Ontem", "03/09").

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mapConversa } from '../src/lib/data/mappers.ts';
import type { Tables } from '../src/lib/supabase/database.types.ts';

const ORG = '11111111-1111-4111-8111-111111111111';

function conversa(id: string, updatedAt: string): Tables<'conversations'> {
  return {
    id, organization_id: ORG, contact_id: `contato-${id}`, assunto: 'WhatsApp',
    status: 'aberta', modo: 'ia', atendente_id: null, created_at: updatedAt,
    updated_at: updatedAt, resumida_em: null, wa_number_id: null,
  } as Tables<'conversations'>;
}

function mensagem(conversationId: string, createdAt: string, autor = 'cliente'): Tables<'messages'> {
  return {
    id: `msg-${conversationId}-${createdAt}`, organization_id: ORG, conversation_id: conversationId,
    autor, texto: 'oi', read: true, camp: false, created_at: createdAt, wamid: null, tipo: 'texto',
  } as unknown as Tables<'messages'>;
}

/** O que a tela faz para montar a lista. */
function emOrdemDaTela(conversas: { id: string; ultimaMsgIso: string | null }[]) {
  return [...conversas]
    .sort((a, b) => (b.ultimaMsgIso ?? '').localeCompare(a.ultimaMsgIso ?? ''))
    .map(c => c.id);
}

describe('ordem da lista de conversas', () => {
  test('quem falou por último fica em cima, mesmo com a conversa antiga', () => {
    // A conversa "velha" foi criada há duas semanas e nunca teve a linha
    // editada; a mensagem nova chegou agora. Pelo updated_at ela ficaria no fim.
    const velha = mapConversa(
      conversa('velha', '2026-09-01T12:00:00Z'),
      [mensagem('velha', '2026-09-13T18:00:00Z')], [], new Map(), [],
    );
    const recenteNaLinha = mapConversa(
      conversa('mexida-hoje', '2026-09-13T19:00:00Z'),
      [mensagem('mexida-hoje', '2026-09-03T10:00:00Z')], [], new Map(), [],
    );

    assert.deepEqual(emOrdemDaTela([recenteNaLinha, velha]), ['velha', 'mexida-hoje']);
  });

  test('a última mensagem manda, não a primeira', () => {
    const a = mapConversa(
      conversa('a', '2026-09-01T00:00:00Z'),
      [mensagem('a', '2026-09-01T09:00:00Z'), mensagem('a', '2026-09-13T20:00:00Z')], [], new Map(), [],
    );
    const b = mapConversa(
      conversa('b', '2026-09-01T00:00:00Z'),
      [mensagem('b', '2026-09-10T09:00:00Z')], [], new Map(), [],
    );

    assert.equal(a.ultimaMsgIso, '2026-09-13T20:00:00Z');
    assert.deepEqual(emOrdemDaTela([b, a]), ['a', 'b']);
  });

  test('conversa sem mensagem nenhuma não some da lista', () => {
    const vazia = mapConversa(conversa('vazia', '2026-09-05T00:00:00Z'), [], [], new Map(), []);

    assert.equal(vazia.ultimaMsgIso, '2026-09-05T00:00:00Z');
  });
});

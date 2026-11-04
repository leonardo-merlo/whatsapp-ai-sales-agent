// Troca o produto na tela (Atendimento ou Vendas), no mesmo padrão de
// /api/org/ativa: grava um cookie que escolhe, e o servidor confere contra os
// produtos que a empresa ativa contratou. Um produto não contratado é recusado.

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { membroAtivo } from '@/lib/data/org-ativa';
import { COOKIE_PRODUTO_ATIVO, ehProduto } from '@/lib/produtos';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  let body: { produto?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!ehProduto(body.produto)) {
    return Response.json({ error: 'Produto inválido' }, { status: 400 });
  }

  const membro = await membroAtivo(supabase, user.id);
  if (!membro) return Response.json({ error: 'Sem organização' }, { status: 403 });
  if (!membro.produtos.includes(body.produto)) {
    return Response.json({ error: 'Produto não contratado' }, { status: 403 });
  }

  (await cookies()).set(COOKIE_PRODUTO_ATIVO, body.produto, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return Response.json({ ok: true });
}

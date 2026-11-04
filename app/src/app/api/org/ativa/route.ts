// Troca a organização ativa do usuário.
//
// É uma rota, e não estado no navegador, porque quem monta as telas é Server
// Component: o servidor precisa saber a organização antes de renderizar. O
// cookie é gravado aqui, e a tela recarrega.
//
// A rota só aceita organização em que o usuário **é membro de verdade** — a
// checagem é contra o banco, não contra o que veio no corpo. Sem isso, o cookie
// viraria um campo livre onde qualquer um digitaria o id de outra empresa. (A
// RLS barraria a leitura de qualquer jeito, mas a tela quebraria feio em vez de
// recusar direito.)

import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { COOKIE_ORG_ATIVA, vinculosDoUsuario } from '@/lib/data/org-ativa';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Não autenticado' }, { status: 401 });

  let body: { organizationId?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!body.organizationId) {
    return Response.json({ error: 'Organização não informada' }, { status: 400 });
  }

  const vinculos = await vinculosDoUsuario(supabase, user.id);
  if (!vinculos.some(v => v.organizationId === body.organizationId)) {
    return Response.json({ error: 'Você não faz parte desta organização' }, { status: 403 });
  }

  (await cookies()).set(COOKIE_ORG_ATIVA, body.organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });

  return Response.json({ ok: true });
}

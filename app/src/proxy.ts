import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/cadastro', '/recuperar-senha'];
// Acessível logado OU deslogado: o link de recuperação chega sem sessão e a
// troca do código por sessão acontece no client já dentro da página.
const FREE_PATHS = ['/redefinir-senha', '/privacidade', '/termos-de-uso', '/exclusao-de-dados', '/conta-confirmada'];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Importante: não inserir lógica entre a criação do client e getUser() —
  // é esta chamada que renova o token da sessão.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(p => pathname.startsWith(p));

  if (FREE_PATHS.some(p => pathname.startsWith(p))) {
    return response;
  }

  // Raiz é a landing page pública; logado, a própria página manda para /painel.
  if (pathname === '/') {
    return response;
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/painel';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Tudo exceto assets estáticos, otimização de imagem, webhooks públicos,
    // rotas de cron, a API de parceiro em /api/v1 e os eventos que o ERP do cliente
    // manda em /api/integracoes (chamadas pela Vercel e por
    // sistemas externos, nunca por um usuário logado — cada uma tem a própria
    // autenticação por token).
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|api/v1|api/integracoes/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

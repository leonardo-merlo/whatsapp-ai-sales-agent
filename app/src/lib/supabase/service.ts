// Client Supabase com a service_role key — BYPASSA RLS por completo.
// Uso restrito a rotas server-only sem sessão de usuário (ex.: webhook do
// WhatsApp, que recebe requisições da Meta, não de um usuário logado).
// NUNCA importar este arquivo em código que roda no browser ou em uma rota
// que já tem um usuário autenticado (use src/lib/supabase/server.ts nesse caso).

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export function createServiceClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada — necessária para rotas que bypassam RLS.');
  }
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

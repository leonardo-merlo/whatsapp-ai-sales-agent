// Notificações por e-mail para eventos em que a IA para de responder e uma
// pessoa precisa assumir. Chamado só de rotas server-side com client service_role.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { sendEmail } from './send-email';

// E-mails do owner e dos admins da org: quem foi convidado tem invite_email;
// quem já criou conta tem o e-mail no auth.users (via admin API).
async function emailsDosAdmins(supabase: SupabaseClient<Database>, orgId: string): Promise<string[]> {
  const { data: membros } = await supabase
    .from('organization_members')
    .select('user_id, invite_email, role, ativo')
    .eq('organization_id', orgId)
    .in('role', ['owner', 'admin'])
    .eq('ativo', true);

  const emails = new Set<string>();
  for (const m of membros ?? []) {
    if (m.user_id) {
      const { data } = await supabase.auth.admin.getUserById(m.user_id);
      if (data.user?.email) { emails.add(data.user.email); continue; }
    }
    if (m.invite_email) emails.add(m.invite_email);
  }
  return [...emails];
}

export async function notificarConversaPrecisaDeHumano(
  supabase: SupabaseClient<Database>,
  orgId: string,
  contatoNome: string,
  motivo: string,
): Promise<void> {
  try {
    const [{ data: org }, para] = await Promise.all([
      supabase.from('organizations').select('nome').eq('id', orgId).maybeSingle(),
      emailsDosAdmins(supabase, orgId),
    ]);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const negocio = org?.nome ?? 'seu negócio';

    await sendEmail({
      to: para,
      subject: `${contatoNome} aguarda atendimento humano no WhatsApp`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#15181e">
          <h2 style="font-size:18px">Uma conversa precisa de você</h2>
          <p style="font-size:14px;line-height:1.6">
            O agente de IA de <strong>${negocio}</strong> parou de responder a conversa com
            <strong>${contatoNome}</strong> e ela aguarda uma pessoa.
          </p>
          <p style="font-size:14px;line-height:1.6"><strong>Motivo:</strong> ${motivo}</p>
          <p style="margin:24px 0">
            <a href="${appUrl}/conversas"
               style="background:#1a56db;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:bold">
              Abrir conversas
            </a>
          </p>
          <p style="font-size:12px;color:#8a94a3">Você recebe este aviso por ser administrador da conta.</p>
        </div>`,
    });
  } catch (err) {
    // Notificação nunca derruba o atendimento.
    console.error('Erro ao notificar transferência por e-mail:', err instanceof Error ? err.message : err);
  }
}

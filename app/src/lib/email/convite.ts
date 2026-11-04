// E-mail de convite para a equipe (S4).
//
// O convite já existia no banco (`organization_members.invite_email`), mas
// ninguém era avisado: o admin precisava mandar o link por conta própria. Aqui
// sai um e-mail com o link de cadastro. Quem entra com o mesmo e-mail é ligado
// ao convite pelo `claim_member_invite`, depois de confirmar o e-mail (o
// "Confirm email" do Supabase fecha a brecha de alguém se cadastrar com o
// e-mail de outra pessoa).
//
// O link não leva o e-mail na URL: dado pessoal em query string fica em log.

import { sendEmail } from './send-email';

export interface DadosDoConvite {
  para: string;
  nomeDoConvidado: string;
  nomeDaEmpresa: string;
  appUrl: string;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function montarEmailDeConvite(d: DadosDoConvite): { subject: string; html: string } {
  const link = `${d.appUrl.replace(/\/$/, '')}/cadastro`;
  return {
    subject: `Convite para a equipe de ${d.nomeDaEmpresa} no Wappia`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#15181e">
        <h2 style="font-size:18px">Olá, ${escapar(d.nomeDoConvidado)}!</h2>
        <p style="font-size:14px;line-height:1.6">
          Você foi convidado para a equipe de <strong>${escapar(d.nomeDaEmpresa)}</strong> no Wappia.
          Crie sua conta com este e-mail: <strong>${escapar(d.para)}</strong>.
        </p>
        <p style="margin:24px 0">
          <a href="${link}" style="background:#17a55a;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:bold">
            Criar conta
          </a>
        </p>
        <p style="font-size:12px;color:#8a94a3">Se você não esperava este convite, ignore esta mensagem.</p>
      </div>`,
  };
}

export async function enviarEmailDeConvite(d: DadosDoConvite): Promise<boolean> {
  const { subject, html } = montarEmailDeConvite(d);
  return sendEmail({ to: [d.para], subject, html });
}

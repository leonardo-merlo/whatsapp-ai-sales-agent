// Envio de e-mail transacional via Resend (HTTP puro, sem SDK).
// Sem RESEND_API_KEY configurada, apenas loga e retorna false — nada quebra;
// isso permite desenvolver e testar o fluxo antes de plugar a chave.

interface SendEmailParams {
  to: string[];
  subject: string;
  html: string;
}

export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Wappia <onboarding@resend.dev>';

  if (to.length === 0) return false;
  if (!apiKey) {
    console.log(`[e-mail desativado — sem RESEND_API_KEY] para=${to.join(', ')} assunto="${subject}"`);
    return false;
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!resp.ok) {
    console.error(`Erro ao enviar e-mail (Resend ${resp.status}):`, await resp.text());
    return false;
  }
  return true;
}

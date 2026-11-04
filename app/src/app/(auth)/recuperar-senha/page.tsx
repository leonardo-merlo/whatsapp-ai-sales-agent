'use client'; // formulário interativo de recuperação de senha

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AuthCard, AuthField, AuthButton } from '@/components/auth/auth-card';

export default function RecuperarSenhaPage() {
  const [email, setEmail] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!email.trim() || !email.includes('@')) {
      setErro('Informe o e-mail da sua conta.');
      return;
    }
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    // Sempre mostra sucesso — não revela se o e-mail existe ou não.
    setLoading(false);
    setEnviado(true);
  }

  if (enviado) {
    return (
      <AuthCard title="Verifique seu e-mail" subtitle={`Se existir uma conta para ${email.trim()}, enviamos um link para redefinir a senha.`}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Abra o link no e-mail para criar uma senha nova. Não chegou? Confira o spam ou tente de novo em alguns minutos.
        </p>
        <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13.5, textDecoration: 'none', textAlign: 'center' }}>Voltar para o login</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Recuperar senha" subtitle="Enviamos um link para o seu e-mail — sem complicação">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AuthField label="E-mail da conta" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@suaempresa.com.br" autoComplete="email" />
        {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
        <AuthButton loading={loading}>Enviar link de recuperação</AuthButton>
      </form>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
        Lembrou a senha?{' '}
        <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Entrar</Link>
      </p>
    </AuthCard>
  );
}

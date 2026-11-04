'use client'; // formulário interativo de login

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AuthCard, AuthField, AuthButton } from '@/components/auth/auth-card';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!email.trim() || !senha) {
      setErro('Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    if (error) {
      setLoading(false);
      setErro(error.message === 'Invalid login credentials'
        ? 'E-mail ou senha incorretos.'
        : 'Não foi possível entrar. Tente novamente.');
      return;
    }
    router.push('/painel');
    router.refresh();
  }

  return (
    <AuthCard title="Entrar" subtitle="Acesse o painel do seu agente">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AuthField label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@suaempresa.com.br" autoComplete="email" />
        <AuthField label="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
        {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
        <AuthButton loading={loading}>Entrar</AuthButton>
      </form>
      <Link href="/recuperar-senha" style={{ color: 'var(--text3)', fontWeight: 600, fontSize: 13, textDecoration: 'none', textAlign: 'center' }}>Esqueci minha senha</Link>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
        Ainda não tem conta?{' '}
        <Link href="/cadastro" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Criar conta grátis</Link>
      </p>
    </AuthCard>
  );
}

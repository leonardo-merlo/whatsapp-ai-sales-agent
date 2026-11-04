'use client'; // formulário interativo de cadastro

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AuthCard, AuthField, AuthButton } from '@/components/auth/auth-card';
import { ForcaSenha } from '@/components/auth/forca-senha';
import { SENHA_MIN, traduzirErroSenha } from '@/lib/auth/forca-senha';

export default function CadastroPage() {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);
  const [aguardandoEmail, setAguardandoEmail] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!nome.trim()) { setErro('Informe seu nome.'); return; }
    if (!email.trim()) { setErro('Informe seu e-mail.'); return; }
    if (senha.length < SENHA_MIN) { setErro(`A senha precisa de pelo menos ${SENHA_MIN} caracteres.`); return; }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: senha,
      // O link do e-mail de confirmação cai numa tela própria ("conta
      // confirmada, faça login"), e não na página inicial.
      options: { data: { nome: nome.trim() }, emailRedirectTo: `${window.location.origin}/conta-confirmada` },
    });

    if (error) {
      setLoading(false);
      // A política real de senha (tamanho mínimo, senha vazada) é do Supabase e
      // responde em inglês — traduzimos antes de mostrar.
      const erroDeSenha = traduzirErroSenha(error.message);
      setErro(error.message.includes('already registered')
        ? 'Este e-mail já tem uma conta. Faça login.'
        : erroDeSenha ?? 'Não foi possível criar a conta. Tente novamente.');
      return;
    }

    if (data.session) {
      // Confirmação de e-mail desativada: segue direto para criar o negócio
      router.push('/setup');
      router.refresh();
    } else {
      // Confirmação de e-mail ativada no projeto Supabase
      setLoading(false);
      setAguardandoEmail(true);
    }
  }

  if (aguardandoEmail) {
    return (
      <AuthCard title="Confirme seu e-mail" subtitle={`Enviamos um link de confirmação para ${email.trim()}`}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Abra o link no e-mail para ativar sua conta. Depois é só fazer login e configurar seu agente.
        </p>
        <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13.5, textDecoration: 'none', textAlign: 'center' }}>Ir para o login</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Criar conta" subtitle="Comece grátis — configure seu agente em minutos">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <AuthField label="Seu nome" value={nome} onChange={e => setNome(e.target.value)} placeholder="Como você quer ser chamado" autoComplete="name" />
        <AuthField label="E-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@suaempresa.com.br" autoComplete="email" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AuthField label="Senha" type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder={`Mínimo ${SENHA_MIN} caracteres`} autoComplete="new-password" />
          <ForcaSenha senha={senha} />
        </div>
        {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
        <AuthButton loading={loading}>Criar conta</AuthButton>
      </form>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text3)', textAlign: 'center' }}>
        Já tem conta?{' '}
        <Link href="/login" style={{ color: 'var(--primary)', fontWeight: 600, textDecoration: 'none' }}>Entrar</Link>
      </p>
    </AuthCard>
  );
}

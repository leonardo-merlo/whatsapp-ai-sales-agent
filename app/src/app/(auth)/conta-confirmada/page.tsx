import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';

// Para onde o link do e-mail de confirmação leva (emailRedirectTo do cadastro).
// Quando a pessoa chega aqui o Supabase já confirmou o e-mail; falta só entrar.
export default function ContaConfirmadaPage() {
  return (
    <AuthCard title="Conta confirmada" subtitle="Seu e-mail foi confirmado.">
      <Link href="/login" style={{ background: 'var(--primary)', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', padding: '11px 16px', fontSize: 14, fontWeight: 700, textAlign: 'center', textDecoration: 'none' }}>
        Fazer login
      </Link>
    </AuthCard>
  );
}

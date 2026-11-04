'use client'; // lê o token do link e troca por sessão só no envio da senha nova

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { AuthCard, AuthField, AuthButton } from '@/components/auth/auth-card';
import { ForcaSenha } from '@/components/auth/forca-senha';
import { SENHA_MIN, traduzirErroSenha } from '@/lib/auth/forca-senha';

// O link do e-mail chega com um token_hash na URL. Guardamos esse token sem
// usá-lo e só o trocamos por sessão quando a pessoa envia a senha nova — é isso
// que impede scanners de e-mail e pré-visualizações de "gastar" o link antes da
// hora (a causa do "link inválido ou expirado" mesmo clicando na hora).
export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<'checando' | 'pronto' | 'invalido'>('checando');
  // Guardado em ref (não é usado na renderização, só no envio da senha) — evita
  // um setState síncrono no efeito ao ler o token da URL.
  const tokenHashRef = useRef<string | null>(null);
  const [senha, setSenha] = useState('');
  const [confirma, setConfirma] = useState('');
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const th = params.get('token_hash');
    const type = params.get('type');
    if (th && type === 'recovery') {
      tokenHashRef.current = th;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- transição pós-mount ao ler o token da URL (só existe no browser)
      setEstado('pronto');
      return;
    }

    // Sem token_hash na URL: pode ser o fluxo antigo, onde a sessão já foi
    // criada ao abrir o link. Se existir sessão, liberamos o formulário.
    const supabase = createClient();
    let cancelado = false;
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelado) setEstado(user ? 'pronto' : 'invalido');
    });
    return () => { cancelado = true; };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (senha.length < SENHA_MIN) { setErro(`A senha precisa de pelo menos ${SENHA_MIN} caracteres.`); return; }
    if (senha !== confirma) { setErro('As senhas não conferem.'); return; }
    setLoading(true);
    const supabase = createClient();

    // Só agora — no clique real da pessoa — o token vira sessão.
    if (tokenHashRef.current) {
      const { error: otpError } = await supabase.auth.verifyOtp({ token_hash: tokenHashRef.current, type: 'recovery' });
      if (otpError) {
        setLoading(false);
        setEstado('invalido');
        return;
      }
    }

    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      setLoading(false);
      // A política real de senha (tamanho mínimo, senha vazada) é do Supabase e
      // responde em inglês — traduzimos antes de mostrar.
      const erroDeSenha = traduzirErroSenha(error.message);
      setErro(error.message.includes('different from the old')
        ? 'A senha nova precisa ser diferente da anterior.'
        : erroDeSenha ?? 'Não foi possível salvar a senha. Tente novamente.');
      return;
    }
    router.push('/painel');
    router.refresh();
  }

  if (estado === 'checando') {
    return (
      <AuthCard title="Redefinir senha" subtitle="Validando seu link…">
        <span style={{ fontSize: 13.5, color: 'var(--text3)' }}>Um instante…</span>
      </AuthCard>
    );
  }

  if (estado === 'invalido') {
    return (
      <AuthCard title="Link inválido ou expirado" subtitle="Links de recuperação valem por pouco tempo, por segurança">
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.5 }}>
          Peça um link novo e abra-o assim que chegar.
        </p>
        <Link href="/recuperar-senha" style={{ background: 'var(--primary)', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>Pedir novo link</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Criar senha nova" subtitle="Escolha uma senha que você não use em outros lugares">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AuthField label="Senha nova" type="password" value={senha} onChange={e => setSenha(e.target.value)} placeholder={`Mínimo ${SENHA_MIN} caracteres`} autoComplete="new-password" />
          <ForcaSenha senha={senha} />
        </div>
        <AuthField label="Repita a senha" type="password" value={confirma} onChange={e => setConfirma(e.target.value)} placeholder="A mesma senha de novo" autoComplete="new-password" />
        {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
        <AuthButton loading={loading}>Salvar senha nova</AuthButton>
      </form>
    </AuthCard>
  );
}

'use client'; // renderizado dentro dos formulários de auth, que são interativos

import { avaliarSenha, SENHA_MIN, type NivelSenha } from '@/lib/auth/forca-senha';

const CORES: Record<NivelSenha, string> = {
  fraca: 'var(--red-t)',
  media: 'var(--amber-t)',
  forte: 'var(--green-t)',
};

const BLOCOS: Record<NivelSenha, number> = { fraca: 1, media: 2, forte: 3 };

export function ForcaSenha({ senha }: { senha: string }) {
  const { nivel, rotulo, dica } = avaliarSenha(senha);
  const cor = CORES[nivel];
  const preenchidos = senha.length > 0 ? BLOCOS[nivel] : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {senha.length > 0 && (
        <>
          {/* A barra é decoração: quem lê o nível é o texto logo abaixo. */}
          <div aria-hidden="true" style={{ display: 'flex', gap: 4 }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i < preenchidos ? cor : 'var(--border2)' }} />
            ))}
          </div>
          <span role="status" style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.45 }}>
            Força da senha: <strong style={{ color: cor, fontWeight: 700 }}>{rotulo}</strong>. {dica}
          </span>
        </>
      )}
      <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.45 }}>
        Exigimos no mínimo {SENHA_MIN} caracteres. A força acima é só uma orientação — quem valida
        de verdade é o servidor, quando você salva.
      </span>
    </div>
  );
}

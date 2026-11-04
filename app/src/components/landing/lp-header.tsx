'use client';
// Client component: precisa do listener de scroll do window para o header
// virar "flutuante" (fundo translúcido + blur) depois que a página rola.

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export default function LpHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`lp-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="lp-wrap lp-header-inner">
        <Link href="/" className="lp-logo" aria-label="Wappia — início">
          <span className="lp-logo-mark">
            <Image src="/brand/wappia-verde.png" alt="" width={40} height={32} priority style={{ height: 30, width: 'auto' }} />
          </span>
          Wappia
        </Link>
        <nav className="lp-nav">
          <Link href="/login" className="lp-btn lp-btn--ghost lp-btn--sm">Entrar</Link>
          <Link href="/cadastro" className="lp-btn lp-btn--primary lp-btn--sm">Criar conta grátis</Link>
        </nav>
      </div>
    </header>
  );
}

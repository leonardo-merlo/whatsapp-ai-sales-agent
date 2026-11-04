'use client'; // banner de consentimento: decisão do usuário guardada em localStorage

import { useEffect, useState } from 'react';
import Link from 'next/link';

const STORAGE_KEY = 'wappia-cookie-consent';

export default function CookieConsent() {
  // Só decide o que mostrar depois de montar, para não divergir do HTML do servidor.
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    // localStorage não existe no SSR; decidir só após montar é o padrão que evita
    // divergência de hidratação — o setState aqui é intencional.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(STORAGE_KEY)) setVisivel(true);
    } catch {}
  }, []);

  function decidir(valor: 'all' | 'essential') {
    try { localStorage.setItem(STORAGE_KEY, valor); } catch {}
    setVisivel(false);
  }

  if (!visivel) return null;

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 9998, display: 'flex', justifyContent: 'center', pointerEvents: 'none' }}>
      <div style={{ pointerEvents: 'auto', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,.18)', padding: '14px 18px', maxWidth: 720, width: '100%', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', animation: 'cm-pop .2s ease' }}>
      <span style={{ flex: 1, minWidth: 240, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
        Usamos cookies essenciais para manter você conectado e a plataforma funcionando. Ao continuar, você concorda com a nossa{' '}
        <Link href="/privacidade" style={{ color: 'var(--primary-t)', fontWeight: 600 }}>Política de Privacidade</Link>.
      </span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={() => decidir('essential')} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 8, padding: '8px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hs">Só essenciais</button>
        <button onClick={() => decidir('all')} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 8, padding: '8px 16px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }} className="hp">Aceitar</button>
      </div>
      </div>
    </div>
  );
}

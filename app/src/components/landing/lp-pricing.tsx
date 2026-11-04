'use client';
// Client component: o toggle Mensal/Anual precisa de estado. Os planos (e os preços)
// vêm do servidor — este componente só alterna a exibição mensal x anual.

import Link from 'next/link';
import { useState } from 'react';
import type { Plano } from '@/lib/types';

const brl = (centavos: number) => 'R$ ' + Math.round(centavos / 100).toLocaleString('pt-BR');

function Check() {
  return <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
}

export default function LpPricing({ planos }: { planos: Plano[] }) {
  const [anual, setAnual] = useState(false);

  // "Meses grátis" no anual, calculado do plano em destaque (verdade a partir dos dados).
  const ref = planos[1] ?? planos[0];
  // Com um plano só (a vitrine desde 29/09), ele é o destaque e não leva o selo
  // de "mais escolhido", que só faz sentido comparando.
  const destaque = planos.length === 1 ? 0 : 1;
  const mesesGratis = ref && ref.precoCentavos > 0 && ref.precoAnualCentavos > 0
    ? Math.round(12 - ref.precoAnualCentavos / ref.precoCentavos)
    : 0;

  return (
    <>
      <div className="lp-toggle" role="tablist" aria-label="Ciclo de cobrança" data-r>
        <span className="lp-toggle-thumb" data-anual={anual} aria-hidden="true" />
        <button
          type="button" role="tab" aria-selected={!anual}
          className={`lp-toggle-opt${!anual ? ' is-active' : ''}`}
          onClick={() => setAnual(false)}
        >
          Mensal
        </button>
        <button
          type="button" role="tab" aria-selected={anual}
          className={`lp-toggle-opt${anual ? ' is-active' : ''}`}
          onClick={() => setAnual(true)}
        >
          Anual
          {mesesGratis > 0 && <span className="lp-toggle-save">{mesesGratis} meses grátis</span>}
        </button>
      </div>

      <div className="lp-planos" style={planos.length === 1 ? { gridTemplateColumns: 'minmax(0, 400px)', justifyContent: 'center' } : undefined}>
        {planos.map((p, i) => {
          const mesEquiv = p.precoAnualCentavos > 0 ? p.precoAnualCentavos / 12 : p.precoCentavos;
          const preco = anual ? brl(mesEquiv) : p.preco;
          return (
            <div key={p.key} className={`lp-plano${i === destaque ? ' destaque' : ''}`} data-r style={{ ['--i' as string]: i + 1 }}>
              {i === destaque && planos.length > 1 && <span className="tag">Mais escolhido</span>}
              <h3>{p.nome}</h3>
              <div className="lp-preco-wrap">
                <div key={anual ? 'a' : 'm'} className="lp-preco">{preco}<small>/mês</small></div>
                <div className="lp-preco-note">
                  {anual && p.precoAnualCentavos > 0
                    ? `Cobrado ${brl(p.precoAnualCentavos)} por ano`
                    : 'Cobrança mensal, sem fidelidade'}
                </div>
              </div>
              <ul>
                <li><Check />{p.atend}</li>
                <li><Check />{p.msg}</li>
                <li><Check />Agenda, campanhas e etiquetas</li>
              </ul>
              <Link href="/cadastro" className={`lp-btn ${i === destaque ? 'lp-btn--accent' : 'lp-btn--primary'}`}>Começar grátis</Link>
            </div>
          );
        })}
      </div>
    </>
  );
}

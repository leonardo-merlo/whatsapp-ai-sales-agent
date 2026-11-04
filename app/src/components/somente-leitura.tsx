'use client'; // o papel do membro vive no contexto client (useOrg)

import { useOrg } from '@/lib/org-context';
import { permissoesDe } from '@/lib/permissoes';

/**
 * Deixa a tela visível mas intocável para quem não pode editar.
 *
 * O bloqueio é um `fieldset` desabilitado: o próprio navegador desativa todo
 * input, textarea, select e button descendente. É a única forma de cobrir uma
 * tela grande sem espalhar um `disabled` por dezenas de campos — e sem risco de
 * esquecer um.
 */
export default function SomenteLeitura({ ativo, aviso, children }: {
  ativo: boolean;
  aviso: string;
  children: React.ReactNode;
}) {
  if (!ativo) return <>{children}</>;
  return (
    <div>
      <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '11px 16px', background: 'var(--amber-b)', borderBottom: '1px solid var(--border)', fontSize: 13, color: 'var(--text2)' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="var(--amber-t)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
          <rect x="3" y="11" width="18" height="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        {aviso}
      </div>
      <fieldset disabled style={{ border: 'none', margin: 0, padding: 0, minInlineSize: 0 }}>
        {children}
      </fieldset>
    </div>
  );
}

/** Envelope pronto da tela Agente: atendente vê a configuração, mas não mexe. */
export function AgenteSomenteLeitura({ children }: { children: React.ReactNode }) {
  const { memberRole } = useOrg();
  const podeEditar = permissoesDe(memberRole).editarAgente;
  return (
    <SomenteLeitura ativo={!podeEditar} aviso="Você está vendo a configuração do agente em modo leitura. Só o dono e os administradores podem editar.">
      {children}
    </SomenteLeitura>
  );
}

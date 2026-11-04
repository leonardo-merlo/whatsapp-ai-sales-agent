export const AVC = ['#1a56db', '#0d9488', '#d97706', '#dc2626', '#7c3aed', '#16a34a'];

export function iniciais(nome: string): string {
  const p = nome.replace(/\./g, '').split(' ').filter(x => x.length > 2);
  if (p.length === 0) return nome.slice(0, 2).toUpperCase();
  return (p[0][0] + (p[p.length - 1] || p[0])[0]).toUpperCase();
}

// Hash simples e estável para escolher cor de avatar a partir do uuid
export function avatarBg(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return AVC[Math.abs(h) % AVC.length];
}

export function statusBadge(s: string): { bg: string; color: string } {
  const m: Record<string, [string, string]> = {
    Ativo: ['var(--green-b)', 'var(--green-t)'], Inativo: ['var(--gray-b)', 'var(--gray-t)'],
    Ativa: ['var(--green-b)', 'var(--green-t)'], Encerrada: ['var(--gray-b)', 'var(--gray-t)'],
    Agendada: ['var(--blue-b)', 'var(--blue-t)'],
  };
  const v = m[s] || ['var(--gray-b)', 'var(--gray-t)'];
  return { bg: v[0], color: v[1] };
}

export function fmtNum(n: number): string { return n.toLocaleString('pt-BR'); }

// Máscara progressiva de telefone BR: só dígitos, (DD) DDDD-DDDD ou (DD) DDDDD-DDDD.
export function formatTelefone(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 11);
  const len = digits.length;
  if (len === 0) return '';
  if (len <= 2) return `(${digits}`;
  if (len <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (len <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

// Como o contato aparece na lista: o telefone, ou o nome de usuário do WhatsApp
// quando a Meta não mandou o número (BSUID).
export function identificacaoDoContato(c: { telefone: string; usuarioWhatsApp?: string }): string {
  if (c.telefone) return c.telefone;
  return c.usuarioWhatsApp ? `@${c.usuarioWhatsApp}` : 'sem telefone';
}

// Converte o telefone digitado no painel para o formato que a Cloud API espera
// (só dígitos, com DDI). Contatos criados pelo webhook já chegam nesse formato;
// os digitados à mão vêm como "(11) 98142-4321".

export function normalizarTelefoneWhatsApp(telefone: string): string | null {
  const digitos = telefone.replace(/\D/g, '');
  if (digitos.length < 10) return null;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length > 15) return null;
  return digitos;
}

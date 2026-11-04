import { permanentRedirect } from 'next/navigation';

/**
 * A seção mudou de nome para Conhecimento (ela engloba Empresa, Produtos e
 * Agente, e tudo ali é o que a IA sabe). O endereço antigo continua de pé:
 * existe link para `/agente` guardado em favorito, no onboarding e no painel.
 *
 * A query vem junto porque `/agente?testar=1` é o caminho que o setup usa para
 * abrir o simulador logo depois do cadastro — perder o `testar=1` seria perder
 * a primeira conversa de teste de quem acabou de entrar.
 */
export default async function AgenteRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (Array.isArray(valor)) valor.forEach(v => query.append(chave, v));
    else if (valor !== undefined) query.set(chave, valor);
  }
  const busca = query.toString();
  permanentRedirect(busca ? `/conhecimento?${busca}` : '/conhecimento');
}

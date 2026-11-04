import { redirect } from 'next/navigation';
import DesenvolvimentoSection from '@/components/sections/desenvolvimento';
import { papelDoUsuario } from '@/lib/data/papel-servidor';
import { secaoEstaOculta } from '@/lib/data/secao-servidor';
import { abaDoSlug } from '@/lib/desenvolvimento-tabs';
import { cartoesDosFluxos } from '@/lib/fluxo/cartoes';
import { permissoesDe, ROTA_INICIAL_SEM_PAINEL } from '@/lib/permissoes';

/** Cada aba tem endereço próprio, como em Configurações: recarregar a página e
 *  mandar o link para o desenvolvedor do cliente caem na aba certa. */
export default async function DesenvolvimentoAbaPage({ params }: { params: Promise<{ aba: string }> }) {
  const { aba } = await params;
  // O guard vale nas duas rotas: a URL da aba é tão digitável quanto a da raiz.
  const papel = await papelDoUsuario();
  if (papel && !permissoesDe(papel).verDesenvolvimento) redirect(ROTA_INICIAL_SEM_PAINEL);
  // Integração com sistema de gestão é do Wappia Vendas.
  if (await secaoEstaOculta('desenvolvimento')) redirect('/conversas');

  const key = abaDoSlug(aba);
  // Endereço que não existe vira a raiz da seção, e não um 404 — mesma escolha
  // de Configurações: quem digitou errado ou guardou link antigo se vira melhor
  // com a tela aberta do que com uma porta fechada.
  if (!key) redirect('/desenvolvimento');

  return (
    <DesenvolvimentoSection
      abaInicial={key}
      cartoesDoFluxo={key === 'fluxo' ? cartoesDosFluxos() : undefined}
    />
  );
}

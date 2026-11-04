import { redirect } from 'next/navigation';
import ConfigSection from '@/components/sections/config';
import { papelDoUsuario } from '@/lib/data/papel-servidor';
import { abaDoSlug, caminhoDaAba, configTabsPara } from '@/lib/config-tabs';
import { ROTA_INICIAL_SEM_PAINEL } from '@/lib/permissoes';

/** Cada aba de Configurações tem endereço próprio: recarregar a página, voltar
 *  pelo navegador e mandar o link para alguém passaram a cair na aba certa. */
export default async function ConfiguracoesAbaPage({ params }: { params: Promise<{ aba: string }> }) {
  const { aba } = await params;
  const papel = await papelDoUsuario();
  // `null` = não deu para saber o papel (mesmo caso de antes: a página abre e
  // quem barra é a RLS). Não é lista vazia — lista vazia manda embora.
  const abasVisiveis = papel ? configTabsPara(papel) : null;
  if (abasVisiveis && abasVisiveis.length === 0) redirect(ROTA_INICIAL_SEM_PAINEL);

  const key = abaDoSlug(aba);
  // Endereço que não existe (ou que este papel não pode ver) vira a primeira
  // aba permitida, e não um 404: a pessoa digitou errado ou guardou um link
  // antigo — mostrar Configurações é mais útil do que uma porta fechada.
  if (!key || (abasVisiveis && !abasVisiveis.some(t => t.key === key))) {
    redirect(caminhoDaAba(abasVisiveis?.[0]?.key ?? 'negocio'));
  }

  return <ConfigSection abaInicial={key} />;
}

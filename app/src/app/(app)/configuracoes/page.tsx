import { redirect } from 'next/navigation';
import { papelDoUsuario } from '@/lib/data/papel-servidor';
import { caminhoDaAba, configTabsPara } from '@/lib/config-tabs';
import { ROTA_INICIAL_SEM_PAINEL } from '@/lib/permissoes';

/**
 * `/configuracoes` continua sendo um endereço válido — ele manda para a
 * primeira aba que a pessoa pode ver.
 *
 * Cada aba tem endereço próprio desde 14/09. Antes todas dividiam esta URL, e
 * dar F5 em Equipe devolvia a pessoa a Dados do negócio: qual aba estava aberta
 * vivia só na memória do navegador.
 */
export default async function ConfiguracoesPage() {
  const papel = await papelDoUsuario();
  const abas = papel ? configTabsPara(papel) : null;
  if (abas && abas.length === 0) redirect(ROTA_INICIAL_SEM_PAINEL);
  redirect(caminhoDaAba(abas?.[0]?.key ?? 'negocio'));
}

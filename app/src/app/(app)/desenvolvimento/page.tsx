import { redirect } from 'next/navigation';
import DesenvolvimentoSection from '@/components/sections/desenvolvimento';
import { papelDoUsuario } from '@/lib/data/papel-servidor';
import { secaoEstaOculta } from '@/lib/data/secao-servidor';
import { permissoesDe, ROTA_INICIAL_SEM_PAINEL } from '@/lib/permissoes';

/** `/desenvolvimento` é a aba Chamadas: é a tela que se abre dezenas de vezes
 *  por dia durante a homologação, então ela fica no endereço curto. */
export default async function DesenvolvimentoPage() {
  // Esconder o item no menu não basta: a URL continua digitável, e esta seção
  // mostra o corpo cru das requisições, com CPF e CNPJ dos clientes dentro.
  const papel = await papelDoUsuario();
  if (papel && !permissoesDe(papel).verDesenvolvimento) redirect(ROTA_INICIAL_SEM_PAINEL);
  // Integração com sistema de gestão é do Wappia Vendas.
  if (await secaoEstaOculta('desenvolvimento')) redirect('/conversas');
  return <DesenvolvimentoSection abaInicial="chamadas" />;
}

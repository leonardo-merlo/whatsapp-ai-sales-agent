import { redirect } from 'next/navigation';
import PainelSection from '@/components/sections/painel';
import { papelDoUsuario } from '@/lib/data/papel-servidor';
import { permissoesDe, ROTA_INICIAL_SEM_PAINEL } from '@/lib/permissoes';

export default async function PainelPage() {
  const papel = await papelDoUsuario();
  if (papel && !permissoesDe(papel).verPainel) redirect(ROTA_INICIAL_SEM_PAINEL);
  return <PainelSection />;
}

import { redirect } from 'next/navigation';
import AgendaSection from '@/components/sections/agenda';
import { secaoEstaOculta } from '@/lib/data/secao-servidor';

export default async function AgendaPage() {
  // A Agenda some do menu quando a organização não marca horário com ninguém
  // (uma distribuidora, por exemplo). Some da URL junto, senão fica uma tela
  // órfã que só quem digitou o endereço encontra.
  if (await secaoEstaOculta('agenda')) redirect('/conversas');
  return <AgendaSection />;
}

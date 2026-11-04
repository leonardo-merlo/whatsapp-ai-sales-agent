import { redirect } from 'next/navigation';

/** A seção virou Desenvolvimento em 20/09. O endereço antigo continua de pé
 *  porque já circulou — em link de conversa e na barra de endereços de quem
 *  usava a tela todo dia. */
export default function IntegracaoPage() {
  redirect('/desenvolvimento');
}

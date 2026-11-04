// O aviso que o vendedor recebe no número copiloto.
//
// **No fluxo automático de 13/09 o vendedor não age: ele é informado.** O
// orçamento já saiu ao cliente com itens e valores; o aviso existe para ele
// saber que aconteceu, não para pedir que faça algo. Esse detalhe muda o texto
// do template — ver `../whatsapp/templates.ts`, onde o template antigo
// (`orcamento_rascunho_pronto`, que mandava "aplique o desconto e envie ao
// cliente") ficou fora do conjunto padrão justamente porque faria o vendedor
// mandar um segundo orçamento.
//
// **Nada aqui derruba nada.** Sem copiloto cadastrado, sem telefone do vendedor
// ou com o template ainda não criado na Meta, a função registra o motivo e sai.
// O aviso ao vendedor é importante; o orçamento do cliente é mais.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { Orcamento } from '../erp/contrato';
import { reais } from '../erp/mensagem-do-orcamento';
import { enviarTemplateNaConversa } from '../whatsapp/template-na-conversa';
import type { VendedorDoNumero } from './ferramentas/tipos';

type Client = SupabaseClient<Database>;

export interface MotivoDeNaoAvisar {
  avisado: false;
  motivo: 'sem-copiloto' | 'sem-telefone-do-vendedor' | 'sem-vendedor' | 'falha-no-envio';
  detalhe?: string;
}

export type ResultadoDoAviso = { avisado: true; conversationId: string | null } | MotivoDeNaoAvisar;

/** O número copiloto da organização — o único que fala com a equipe. */
export async function numeroCopiloto(supabase: Client, orgId: string) {
  const { data } = await supabase
    .from('wa_numbers')
    .select('id, phone_number_id')
    .eq('organization_id', orgId)
    .eq('papel', 'copiloto')
    .eq('ativo', true)
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function avisarVendedorDoOrcamento(
  supabase: Client,
  dados: {
    orgId: string;
    orcamento: Orcamento;
    nomeDoCliente: string;
    vendedor: VendedorDoNumero | null | undefined;
  },
): Promise<ResultadoDoAviso> {
  const { orgId, orcamento, nomeDoCliente, vendedor } = dados;

  if (!vendedor) return { avisado: false, motivo: 'sem-vendedor' };
  if (!vendedor.telefoneWhatsapp?.trim()) {
    console.warn(`Vendedor ${vendedor.nome} sem WhatsApp cadastrado — o aviso do orçamento não tem para onde ir.`);
    return { avisado: false, motivo: 'sem-telefone-do-vendedor' };
  }

  const copiloto = await numeroCopiloto(supabase, orgId);
  if (!copiloto) {
    // Enquanto o chip do copiloto não existir, isto é o esperado. Fica no log
    // para não virar silêncio.
    console.warn(`Organização ${orgId} sem número copiloto — o aviso do orçamento ${orcamento.id} não foi enviado.`);
    return { avisado: false, motivo: 'sem-copiloto' };
  }

  const numeroDoOrcamento = orcamento.numero ?? orcamento.id;
  const valor = reais(orcamento.valor_total);

  const resultado = await enviarTemplateNaConversa(supabase, {
    orgId,
    waNumberId: copiloto.id,
    phoneNumberId: copiloto.phone_number_id,
    telefone: vendedor.telefoneWhatsapp.trim(),
    nome: vendedor.nome,
    template: {
      nome: 'orcamento_enviado_ao_cliente',
      valores: {
        vendedor: vendedor.nome,
        orcamento: numeroDoOrcamento,
        cliente: nomeDoCliente || 'cliente',
        valor,
      },
    },
    // O que o vendedor lê no painel. O link entra quando existe: no fluxo
    // automático ele não é mais obrigatório, mas continua útil para conferir.
    textoNaConversa: [
      `Orçamento ${numeroDoOrcamento} para ${nomeDoCliente || 'cliente'} saiu pelo WhatsApp, no valor de ${valor}.`,
      'O cliente já recebeu os itens e os valores.',
      orcamento.link ? `Abrir no sistema: ${orcamento.link}` : '',
    ].filter(Boolean).join('\n'),
  });

  if (!resultado.enviado) {
    return { avisado: false, motivo: 'falha-no-envio', detalhe: resultado.erro };
  }
  return { avisado: true, conversationId: resultado.conversationId };
}

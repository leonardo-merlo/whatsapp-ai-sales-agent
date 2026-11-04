// Disparo de campanha: um template aprovado para uma lista de contatos.
//
// **Até 25/09 o botão "Disparar agora" não enviava nada**: gravava a campanha
// com a estimativa de alcance no lugar dos disparos. E se enviasse, seria
// texto livre, que a Meta recusa fora da janela de 24 horas — justamente o
// público de uma campanha. Agora sai template, contato a contato, e o número
// gravado é o que a Meta aceitou.
//
// Cada envio passa por enviarTemplateNaConversa: fica na conversa do contato,
// e uma recusa deixa a nota do sistema ao lado em vez de sumir.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { LIMITE_POR_DISPARO, publicoDoDisparo, type FiltrosDoPublico } from './publico';
import { enviarTemplateNaConversa } from '../whatsapp/template-na-conversa';
import { preencherCorpo, type VariavelDoTemplate } from '../whatsapp/regras-de-template';

type Client = SupabaseClient<Database>;

export type ValorDaVariavel = { tipo: 'texto'; valor: string } | { tipo: 'nome' };

export interface PedidoDeDisparo {
  orgId: string;
  nome: string;
  categoriaNome: string | null;
  waNumberId: string;
  templateId: string;
  variaveis: ValorDaVariavel[];
  filtros: FiltrosDoPublico;
}

export type ResultadoDoDisparo =
  | { ok: true; campanhaId: string; enviados: number; falhas: number }
  | { ok: false; erro: string };

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || 'cliente';
}

/** Falha de pagamento vale para todos os próximos: não adianta insistir. */
function ehFalhaDePagamento(erro: string | undefined): boolean {
  return /13104[24]/.test(erro ?? '');
}

export async function dispararCampanha(supabase: Client, pedido: PedidoDeDisparo): Promise<ResultadoDoDisparo> {
  const { data: template } = await supabase
    .from('wa_templates').select('*')
    .eq('id', pedido.templateId).eq('organization_id', pedido.orgId)
    .maybeSingle();
  if (!template) return { ok: false, erro: 'Template não encontrado.' };
  if (template.status !== 'APPROVED') return { ok: false, erro: `O template ${template.nome} ainda não foi aprovado pela Meta.` };
  if (template.oculto) return { ok: false, erro: `O template ${template.nome} está escondido.` };

  const { data: numero } = await supabase
    .from('wa_numbers').select('id, phone_number_id, telefone, waba_id')
    .eq('id', pedido.waNumberId).eq('organization_id', pedido.orgId).eq('ativo', true)
    .maybeSingle();
  if (!numero) return { ok: false, erro: 'Número não encontrado.' };
  // Template é da conta do WhatsApp: pelo número de outra conta a Meta não acha o nome.
  if (numero.waba_id !== template.waba_id) return { ok: false, erro: 'Este template é de outra conta do WhatsApp.' };

  const esperadas = (template.variaveis as unknown as VariavelDoTemplate[]).length;
  if (pedido.variaveis.length !== esperadas) return { ok: false, erro: 'Preencha todas as variáveis.' };
  if (pedido.variaveis.some(v => v.tipo === 'texto' && !v.valor.trim())) return { ok: false, erro: 'Preencha todas as variáveis.' };

  const { data: contatos } = await supabase
    .from('contacts').select('id, nome, telefone, bairro, status')
    .eq('organization_id', pedido.orgId);
  const publico = publicoDoDisparo(contatos ?? [], pedido.filtros);
  if (!publico.length) return { ok: false, erro: 'Nenhum contato com WhatsApp nesse público.' };
  if (publico.length > LIMITE_POR_DISPARO) {
    return { ok: false, erro: `Esse público tem ${publico.length} contatos. O limite por disparo é ${LIMITE_POR_DISPARO}.` };
  }

  const { data: categoria } = pedido.categoriaNome
    ? await supabase.from('campaign_categories').select('id')
      .eq('organization_id', pedido.orgId).eq('nome', pedido.categoriaNome).maybeSingle()
    : { data: null };

  const { data: campanha, error } = await supabase.from('campaigns').insert({
    organization_id: pedido.orgId,
    nome: pedido.nome,
    tipo: 'imediato',
    status: 'ativa',
    remetente: numero.telefone ?? '',
    wa_template_id: template.id,
    wa_number_id: numero.id,
    categoria_id: categoria?.id ?? null,
    filtro_bairro: pedido.filtros.bairro,
    filtro_status: pedido.filtros.status,
    disparos_count: 0,
  }).select('id').single();
  if (error || !campanha) return { ok: false, erro: 'Não foi possível criar a campanha.' };

  let enviados = 0;
  let falhas = 0;
  for (const [i, contato] of publico.entries()) {
    const valores = pedido.variaveis.map(v => (v.tipo === 'nome' ? primeiroNome(contato.nome) : v.valor.trim()));
    const r = await enviarTemplateNaConversa(supabase, {
      orgId: pedido.orgId,
      waNumberId: numero.id,
      phoneNumberId: numero.phone_number_id,
      telefone: contato.whatsapp,
      nome: contato.nome,
      contatoId: contato.id,
      template: { nome: template.nome, valores },
      textoNaConversa: preencherCorpo(template.corpo, valores),
      camp: true,
    });
    if (r.enviado) {
      enviados++;
    } else {
      falhas++;
      if (ehFalhaDePagamento(r.erro)) {
        // O resto também seria recusado; conta como falha sem tentar.
        falhas += publico.length - i - 1;
        break;
      }
    }
  }

  await supabase.from('campaigns')
    .update({ disparos_count: enviados, falhas_count: falhas })
    .eq('id', campanha.id);
  return { ok: true, campanhaId: campanha.id, enviados, falhas };
}

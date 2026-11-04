// Eventos de status do pedido: a Distribuidora Exemplo chama este endereço a cada mudança (contrato v5, aba "Eventos de status").
//
//   POST https://www.wappia.com.br/api/integracoes/exemplo/eventos
//   X-Distribuidora Exemplo-Assinatura: sha256=<HMAC-SHA256 do corpo cru com o segredo combinado>
//   { "evento_id", "tipo_evento", "ocorrido_em", "pedido_id", "cliente_id"?, "dados": {...} }
//   O status do pedido sai do tipo_evento: um campo "status" no corpo é ignorado (enxugado do contrato em 28/10).
//
//   200 { "recebido": true }   qualquer outra resposta significa "reenviem"
//
// O evento é guardado sempre (`erp_eventos`, o extrato) e projetado no pedido (`erp_pedidos`, o saldo) quando o pedido
// é nosso. Repetido (`evento_id` já visto) responde 200 sem gravar nem avisar de novo. Mais velho que o estado de agora
// não faz o status andar para trás. O aviso ao cliente ou ao vendedor sai depois da resposta, pelo `after()`.

import { createHmac, timingSafeEqual } from 'crypto';
import { after } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { lerEvento, projetar } from '@/lib/erp/eventos-do-pedido';
import { avisarStatusDoPedido } from '@/lib/erp/avisar-status-do-pedido';

export const runtime = 'nodejs';

const CODIGO_DUPLICATA = '23505';

function assinaturaConfere(corpo: string, cabecalho: string | null, segredo: string): boolean {
  if (!cabecalho?.startsWith('sha256=')) return false;
  const esperada = Buffer.from(createHmac('sha256', segredo).update(corpo, 'utf8').digest('hex'), 'utf8');
  const recebida = Buffer.from(cabecalho.slice('sha256='.length).trim().toLowerCase(), 'utf8');
  return recebida.length === esperada.length && timingSafeEqual(recebida, esperada);
}

export async function POST(request: Request) {
  const segredo = process.env.EXEMPLO_EVENTOS_SEGREDO;
  const orgId = process.env.EXEMPLO_ORG_ID;
  if (!segredo || !orgId) {
    console.error('EXEMPLO_EVENTOS_SEGREDO ou EXEMPLO_ORG_ID não configurado: recusando o evento.');
    return Response.json({ recebido: false, erro: 'Integração não configurada no servidor.' }, { status: 500 });
  }

  const corpo = await request.text();
  if (!assinaturaConfere(corpo, request.headers.get('x-exemplo-assinatura'), segredo)) {
    return Response.json({ recebido: false, erro: 'Assinatura inválida.' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(corpo);
  } catch {
    return Response.json({ recebido: false, erro: 'Corpo inválido: esperado um objeto JSON.' }, { status: 400 });
  }
  const lido = lerEvento(json);
  if (!lido.ok) return Response.json({ recebido: false, erro: lido.erro }, { status: 400 });
  const evento = lido.evento;

  const supabase = createServiceClient();
  const { data: pedido } = await supabase.from('erp_pedidos')
    .select('id, organization_id, conversation_id, contact_id, wa_number_id, status, status_ocorrido_em, pagamento_link')
    .eq('organization_id', orgId).eq('erp_pedido_id', evento.pedidoId).maybeSingle();

  const { data: gravado, error } = await supabase.from('erp_eventos').insert({
    organization_id: orgId,
    evento_id: evento.eventoId,
    tipo_evento: evento.tipo,
    status: evento.status,
    ocorrido_em: evento.ocorridoEm,
    pedido_id: evento.pedidoId,
    cliente_id: evento.clienteId,
    pedido_uuid: pedido?.id ?? null,
    dados: evento.dados as never,
    payload: evento.bruto as never,
  }).select('id').maybeSingle();
  if (error) {
    // Repetição é a retentativa deles: 200 faz ela parar, e o cliente não recebe o aviso duas vezes.
    if (error.code === CODIGO_DUPLICATA) return Response.json({ recebido: true, duplicado: true });
    console.error('Erro ao gravar evento do pedido:', error.message);
    return Response.json({ recebido: false, erro: 'Não foi possível registrar o evento.' }, { status: 500 });
  }

  // Pedido que não é nosso (ou ainda não chegou): fica no extrato, sem mexer em nada.
  if (!pedido) return Response.json({ recebido: true, aplicado: false });

  const { avanca, mudanca } = projetar(pedido, evento);
  if (Object.keys(mudanca).length) {
    const { error: erroPedido } = await supabase.from('erp_pedidos').update(mudanca as never).eq('id', pedido.id);
    if (erroPedido) {
      console.error('Erro ao atualizar o pedido com o evento:', erroPedido.message);
      return Response.json({ recebido: false, erro: 'Não foi possível atualizar o pedido.' }, { status: 500 });
    }
  }
  if (avanca && gravado?.id) await supabase.from('erp_eventos').update({ aplicado_em: new Date().toISOString() }).eq('id', gravado.id);
  // Evento fora de ordem não avisa: o cliente não pode ler "em separação" depois de "saiu para entrega".
  if (avanca) {
    after(async () => {
      const r = await avisarStatusDoPedido(supabase, pedido, evento);
      if (!r.enviado) console.warn(`Aviso do evento ${evento.eventoId} (${evento.tipo}) não saiu: ${r.motivo}`);
    });
  }
  return Response.json({ recebido: true, aplicado: avanca });
}

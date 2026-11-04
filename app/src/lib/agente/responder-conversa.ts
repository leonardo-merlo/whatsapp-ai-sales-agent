// Tudo que acontece DEPOIS de a mensagem do cliente estar gravada: conferir se
// a IA deve responder, gerar a resposta, gravar e enviar pelo WhatsApp.
//
// Estava dentro do laço do webhook. Saiu daqui porque a fase 4 precisa rodar
// exatamente este trecho de dois jeitos — dentro do request da Meta (como
// sempre foi) ou depois da resposta, pelo `after()`. Um trecho só, chamado de
// dois lugares, é o que garante que ligar a fila não muda o comportamento.
//
// Nunca lança: quem chama pelo `after()` já respondeu 200 e não teria o que
// fazer com um erro.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { gerarRespostaIA } from './gerar-resposta';
import { sendWhatsAppMessage, type DestinoWhatsApp } from '../whatsapp/send-message';
import { buscarLimitesEUsoDaOrg } from '../planos/limites';
import { notificarConversaPrecisaDeHumano } from '../email/notificacoes';
import { checarLimiteDaConversa, LIMITE_RESPOSTAS_IA_POR_HORA } from '../rate-limit';
import { buscarConfigDoAgente } from './config-do-numero';
import { MODELO_IA } from './log-uso';
import { abrirTurno, fecharTurno, novoRastreio, type FimDoTurno, type OrigemDoTurno } from './rastreio/rastreio';
import { aplicarSombra } from './rastreio/gravar-sombra';
import { usaPipelineV2 } from '../v2/pipeline';
import { usaMaquina } from './maquina/chave';
import { conduzirOrcamento } from './maquina/executores';
import { instrucaoDaListaConfirmada, orcamentoDepoisDaLista, pedidoV2Aberto, responderPedidoV2Aberto, TEXTO_DA_LISTA_CONFIRMADA } from '../v2/integracao-v1';

type Client = SupabaseClient<Database>;

export interface ParamsResponder {
  orgId: string;
  conversationId: string;
  /** Nome do contato, usado nos avisos por e-mail para o dono do negócio. */
  contatoNome: string;
  /** Para quem a resposta vai: o telefone do cliente (formato da Cloud API) ou,
   *  sem ele, o BSUID. */
  destino: DestinoWhatsApp;
  /** Número por onde a conversa entrou — é por ele que a resposta sai. */
  phoneNumberId: string;
  /** Quem disparou esta execução, para a ficha do turno. Padrão: `webhook`. */
  origem?: OrigemDoTurno;
}

/** O que o cliente recebe quando a empresa passa do teto do plano. Fixo no
 *  código: a IA não escreve esta frase. */
export const AVISO_AO_CLIENTE_LIMITE_DO_PLANO = 'Aguarde, vou verificar uma informação com o time.';

/** Um aviso em aberto por empresa: com várias conversas chegando depois do
 *  teto, um item por conversa enterraria o sino. */
async function avisarLimiteNoSino(supabase: Client, orgId: string, maxMsgsMes: number): Promise<void> {
  try {
    const { data: existente } = await supabase
      .from('notificacoes').select('id')
      .eq('organization_id', orgId).eq('tipo', 'limite_do_plano').eq('status', 'pendente')
      .limit(1).maybeSingle();
    if (existente) return;
    const { error } = await supabase.from('notificacoes').insert({
      organization_id: orgId,
      tipo: 'limite_do_plano',
      titulo: 'Limite do plano atingido',
      corpo: `A IA chegou a ${maxMsgsMes.toLocaleString('pt-BR')} mensagens este mês. As conversas novas estão indo para a equipe.`,
      status: 'pendente',
    });
    if (error) console.error('Limite do plano: falha ao criar notificação', error.message);
  } catch (err) {
    console.error('Limite do plano: falha ao criar notificação', err instanceof Error ? err.message : err);
  }
}

export async function responderConversaComIA(supabase: Client, params: ParamsResponder): Promise<void> {
  const { orgId, conversationId, contatoNome, destino, phoneNumberId } = params;

  // O modo é lido aqui, e não recebido pronto, de propósito: quando isto roda
  // pelo `after()`, um atendente pode ter assumido a conversa no intervalo
  // entre a mensagem chegar e a resposta ser gerada.
  const { data: conversa } = await supabase
    .from('conversations').select('modo, wa_number_id').eq('id', conversationId).maybeSingle();
  if (conversa?.modo !== 'ia') return; // um humano já assumiu — a IA não responde

  // O número da conversa decide o roteiro. Sem número, ou sem roteiro próprio
  // para ele, vale a configuração da empresa toda — o comportamento de sempre.
  const cfg = await buscarConfigDoAgente(supabase, orgId, conversa.wa_number_id);
  if (!cfg?.ativo) return;

  try {
    const limites = await buscarLimitesEUsoDaOrg(supabase, orgId);
    if (limites.statusAssinatura === 'inadimplente' || limites.statusAssinatura === 'cancelada') {
      await supabase.from('conversations').update({ modo: 'humano' }).eq('id', conversationId);
      await supabase.from('messages').insert({
        organization_id: orgId, conversation_id: conversationId, autor: 'sys',
        texto: 'Assinatura pendente de pagamento — atendimento manual necessário', read: true,
      });
      await notificarConversaPrecisaDeHumano(supabase, orgId, contatoNome, 'A assinatura está pendente de pagamento, então a IA não respondeu.');
      return;
    }
    if (limites.msgsUsadasMes >= limites.maxMsgsMes) {
      // **Duas saídas, e a diferença é de produto, não de código.** No
      // autoatendimento quem está do outro lado é o dono do negócio, e mandar a
      // conversa para ele é o certo. Num piloto B2B (Distribuidora Exemplo) não há ninguém
      // olhando o painel: o vendedor está na rua, e "mandar para um humano"
      // vira o cliente falando sozinho — provavelmente no melhor dia de vendas,
      // que é justamente quando o volume passa. Ver a migration `20260914000003`.
      if (limites.aoEstourarLimite === 'avisar') {
        // A IA continua. O aviso entra na conversa uma vez por dia, não a cada
        // mensagem: um `sys` por resposta viraria ruído e esconderia o resto.
        const desdeOntem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: jaAvisou } = await supabase
          .from('messages').select('id')
          .eq('conversation_id', conversationId).eq('autor', 'sys')
          .like('texto', 'Limite de mensagens do plano ultrapassado%')
          .gte('created_at', desdeOntem).limit(1).maybeSingle();
        if (!jaAvisou) {
          await supabase.from('messages').insert({
            organization_id: orgId, conversation_id: conversationId, autor: 'sys',
            texto: `Limite de mensagens do plano ultrapassado este mês (${limites.msgsUsadasMes} de ${limites.maxMsgsMes}) — a IA continua respondendo, como combinado no contrato.`,
            read: true,
          });
          await notificarConversaPrecisaDeHumano(
            supabase, orgId, contatoNome,
            `O limite de mensagens do plano foi ultrapassado este mês (${limites.msgsUsadasMes} de ${limites.maxMsgsMes}). A IA continua respondendo — reveja o plano.`,
          );
        }
      } else {
        // S3 (29/09): o cliente não fica no vácuo. Sai uma frase fixa, escrita
        // aqui e não pela IA, uma vez por conversa; depois a conversa vai para
        // uma pessoa e a clínica é avisada pelo sino e por e-mail.
        const { data: jaAvisouCliente } = await supabase
          .from('messages').select('id')
          .eq('conversation_id', conversationId).eq('autor', 'ia').eq('texto', AVISO_AO_CLIENTE_LIMITE_DO_PLANO)
          .limit(1).maybeSingle();
        await supabase.from('conversations').update({ modo: 'humano' }).eq('id', conversationId);
        await supabase.from('messages').insert([
          ...(jaAvisouCliente ? [] : [{
            organization_id: orgId, conversation_id: conversationId, autor: 'ia' as const,
            texto: AVISO_AO_CLIENTE_LIMITE_DO_PLANO, read: true,
          }]),
          {
            organization_id: orgId, conversation_id: conversationId, autor: 'sys' as const,
            texto: 'Limite de mensagens do plano atingido este mês — atendimento manual necessário', read: true,
          },
        ]);
        await avisarLimiteNoSino(supabase, orgId, limites.maxMsgsMes);
        await notificarConversaPrecisaDeHumano(supabase, orgId, contatoNome, 'O limite de mensagens do plano foi atingido este mês, então a IA pediu para o cliente aguardar.');
        if (!jaAvisouCliente) {
          try {
            await sendWhatsAppMessage(orgId, destino, AVISO_AO_CLIENTE_LIMITE_DO_PLANO, phoneNumberId);
          } catch (err) {
            console.error('Erro ao enviar aviso de limite do plano via WhatsApp:', err instanceof Error ? err.message : err);
          }
        }
        return;
      }
    }
  } catch (err) {
    // Falha aberta: erro de infraestrutura ao consultar limites não deve travar o atendimento.
    console.error('Erro ao consultar limites de plano:', err instanceof Error ? err.message : err);
  }

  // Teto de respostas automáticas nesta conversa. Direciona, não bloqueia:
  // a IA para de responder e a conversa vai para uma pessoa, no mesmo
  // padrão da transferência por gatilho. O cliente recebe um último aviso
  // para não ficar no vácuo.
  const limiteConversa = await checarLimiteDaConversa(supabase, conversationId);
  if (limiteConversa.estourou) {
    const aviso = 'Vou chamar um atendente para continuar com você por aqui. Em instantes alguém assume esta conversa.';
    await supabase.from('conversations').update({ modo: 'humano' }).eq('id', conversationId);
    await supabase.from('messages').insert([
      { organization_id: orgId, conversation_id: conversationId, autor: 'ia' as const, texto: aviso, read: true },
      {
        organization_id: orgId, conversation_id: conversationId, autor: 'sys' as const,
        texto: `Limite de ${LIMITE_RESPOSTAS_IA_POR_HORA} respostas automáticas por hora atingido nesta conversa — atendimento manual necessário`,
        read: true,
      },
    ]);
    await notificarConversaPrecisaDeHumano(
      supabase, orgId, contatoNome,
      `A conversa atingiu ${limiteConversa.respostasNaUltimaHora} respostas automáticas em uma hora, então a IA parou de responder.`,
    );
    try {
      await sendWhatsAppMessage(orgId, destino, aviso, phoneNumberId);
    } catch (err) {
      console.error('Erro ao enviar aviso de limite via WhatsApp:', err instanceof Error ? err.message : err);
    }
    return;
  }

  // **A ficha desta execução** (`agente_turnos`). Abre antes do motor e fecha
  // depois; tudo nela é best-effort e nada nela muda o que o cliente recebe.
  // A sombra da máquina de estados roda só no roteiro de vendas.
  const rastreio = novoRastreio(params.origem ?? 'webhook');
  await abrirTurno(supabase, rastreio, {
    orgId, conversationId, waNumberId: conversa.wa_number_id, modelo: MODELO_IA,
  });
  // MAQUINA_ORCAMENTO=ligado: o código conduz as etapas do orçamento e a sombra
  // não roda (a máquina É o estado; comparar com ela mesma não diz nada).
  const comMaquina = usaMaquina(cfg.roteiro);
  const fechar = async (fim: FimDoTurno, silencio = false) => {
    let sombra: FimDoTurno['sombra'] = null;
    const houveExecucao = fim.status !== 'descartado' && fim.status !== 'erro';
    if (cfg.roteiro === 'vendas' && !comMaquina && (houveExecucao || rastreio.chamadasErp.length > 0)) {
      sombra = await aplicarSombra(supabase, rastreio, {
        orgId, conversationId,
        contactId: rastreio.entrada?.contactId ?? null,
        waNumberId: conversa.wa_number_id,
        silencio,
        resposta: fim.resposta ?? '',
        nomeGuardado: (rastreio.estadoAntes?.erp_cliente_nome as string | null | undefined) ?? null,
      });
    }
    await fecharTurno(supabase, rastreio, { ...fim, sombra });
  };

  let resposta = '';
  let transferirParaAtendente = false;
  // A máquina já disse ao cliente "Vou passar para um atendente": passa, seja qual for o `fallback_mode`.
  let transferenciaDaMaquina = false;
  let mensagensDoSistema: string[] | undefined;
  let silencioPelaInstrucao: true | undefined;
  try {
    let naoResponder: string | undefined;
    // PIPELINE_VERSION=v2 (só vendas): com um pedido de itens aberto na v2, a mensagem vai para ela.
    // Quando o cliente confirma a lista, a v1 segue no mesmo turno para preço e orçamento
    // (só com V2_ORCAMENTO=ligado; senão a conversa para na lista, sem chamar a IA).
    // Sem pedido aberto, é a v1 de sempre (CPF/CNPJ, cadastro, região), que chama levantar_itens.
    let instrucaoDaV2 = '';
    let respondeuPelaV2 = false;
    // A máquina conduz a conversa inteira até a lista confirmada. Null: a
    // conversa já estava na v2 antes da chave ligar, e segue pelo caminho de antes.
    const daMaquina = comMaquina ? await conduzirOrcamento(supabase, orgId, conversationId, rastreio) : null;
    if (daMaquina) {
      resposta = daMaquina.resposta;
      naoResponder = daMaquina.naoResponder;
      transferirParaAtendente = !!daMaquina.transferir;
      transferenciaDaMaquina = transferirParaAtendente;
      respondeuPelaV2 = true;
    } else if (usaPipelineV2(cfg.roteiro)) {
      const aberto = await pedidoV2Aberto(supabase, orgId, conversationId);
      if (aberto) {
        const v2 = await responderPedidoV2Aberto(supabase, orgId, conversationId, aberto.id);
        if (v2.confirmados && orcamentoDepoisDaLista()) instrucaoDaV2 = instrucaoDaListaConfirmada(v2.confirmados);
        else {
          resposta = v2.confirmados ? TEXTO_DA_LISTA_CONFIRMADA : v2.texto;
          transferirParaAtendente = false;
          respondeuPelaV2 = true;
        }
      }
    }
    if (!respondeuPelaV2) {
      ({ resposta, transferirParaAtendente, naoResponder, mensagensDoSistema, silencioPelaInstrucao } = await gerarRespostaIA(supabase, orgId, conversationId, rastreio, instrucaoDaV2));
    }
    if (naoResponder) {
      console.log(`Motor: conversa ${conversationId} sem resposta desta vez (${naoResponder})`);
      await fechar({ status: 'descartado', erro: naoResponder });
      return;
    }
  } catch (err) {
    console.error('Erro ao gerar resposta da IA:', err instanceof Error ? err.message : err);
    await fechar({ status: 'erro', erro: err instanceof Error ? err.message : String(err) });
    return;
  }

  // Resposta vazia acontece num caso só: a fala do modelo ficou velha (chegou
  // mensagem nova enquanto ele pensava), mas as ferramentas já criaram algo no
  // mundo — um orçamento — e o texto com os valores continua valendo. Aí sai só
  // ele, logo abaixo.
  // Silêncio de propósito (vendas, fora de pedido de orçamento): uma linha do
  // sistema na conversa. Ela não vai ao WhatsApp; serve para o vendedor ver que
  // a IA leu e escolheu não responder, e para a varredura de mensagem sem
  // resposta não tentar de novo — ela só age quando a última fala é do cliente.
  if (silencioPelaInstrucao) {
    await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: conversationId, autor: 'sys',
      texto: 'A IA não respondeu: pela instrução do agente, esta mensagem não pedia resposta.', read: true,
    });
  }

  if (resposta) {
    const { error: respError } = await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: conversationId, autor: 'ia', texto: resposta, read: true,
    });
    if (respError) console.error('Erro ao gravar resposta da IA:', respError.message);
  }

  const transferiu = transferirParaAtendente && (cfg.fallback_mode === 'transferir' || transferenciaDaMaquina);
  if (transferiu) {
    await supabase.from('conversations').update({ modo: 'humano', atendente_id: cfg.fallback_atendente_id }).eq('id', conversationId);
    await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: conversationId, autor: 'sys', read: true,
      texto: transferenciaDaMaquina ? 'Conversa transferida para atendente: a IA não entendeu o cliente 3 vezes na mesma pergunta do orçamento' : 'Conversa transferida para atendente',
    });
    await notificarConversaPrecisaDeHumano(supabase, orgId, contatoNome, transferenciaDaMaquina
      ? 'A IA não entendeu o cliente três vezes seguidas na mesma pergunta do orçamento.'
      : 'A IA identificou um assunto que precisa de uma pessoa (gatilho de intervenção).');
  }

  if (resposta) {
    try {
      await sendWhatsAppMessage(orgId, destino, resposta, phoneNumberId);
    } catch (err) {
      console.error('Erro ao enviar resposta via WhatsApp:', err instanceof Error ? err.message : err);
    }
  }

  // As mensagens escritas pelo CÓDIGO (itens e valores de um orçamento) saem
  // DEPOIS da resposta do modelo, nesta ordem: primeiro a moldura que ele
  // escreveu ("segue seu orçamento"), depois os números. Elas são gravadas na
  // conversa como fala da IA — para o cliente e para quem abre o painel, é uma
  // conversa só.
  //
  // Gravar antes de enviar, e não depois: se o envio falhar, o painel mostra o
  // que a IA tentou dizer em vez de um buraco. E o envio de uma não interrompe
  // a próxima.
  for (const texto of mensagensDoSistema ?? []) {
    const { error } = await supabase.from('messages').insert({
      organization_id: orgId, conversation_id: conversationId, autor: 'ia', texto, read: true,
    });
    if (error) console.error('Erro ao gravar mensagem do sistema:', error.message);
    try {
      await sendWhatsAppMessage(orgId, destino, texto, phoneNumberId);
    } catch (err) {
      console.error('Erro ao enviar mensagem do sistema via WhatsApp:', err instanceof Error ? err.message : err);
    }
  }

  const foiAoCliente = [resposta, ...(mensagensDoSistema ?? [])].filter(Boolean).join('\n\n');
  await fechar({
    status: silencioPelaInstrucao ? 'silencio'
      : transferiu ? 'transferiu'
      : 'respondeu',
    resposta: foiAoCliente || null,
  }, !!silencioPelaInstrucao);
}

// Motor de IA em produção: gera a resposta do agente para uma conversa real
// (chamado pelo webhook do WhatsApp, nunca pelo simulador — o simulador
// transmite texto livre em streaming; aqui precisamos do resultado completo
// pra gravar no banco e enviar de volta pelo WhatsApp).

import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import { buildSystemPrompt } from '../simulador/build-prompt';
import { logAiUsage, MODELO_IA } from './log-uso';
import { registrarVendaPendente } from './registrar-venda';
import { registrarAgendamentoIA } from './registrar-agendamento';
import {
  buscarLembretePendente, instrucaoDoLembrete, LINHA_DO_FORMATO_DO_LEMBRETE, registrarRespostaDoLembrete,
  type ConfirmacaoDoLembrete,
} from '../agenda/lembrete';
import { midiaAindaSendoLida } from './midia-do-cliente';
import { ferramentasDoRoteiro } from './ferramentas';
import { citouOutroDocumento } from './documento-na-mensagem';
import { pareceRotuloPicado, pareceTextoFragmentado } from './texto-fragmentado';
import type { PerfilContato } from '../types';
import { gravarEntrada, marcar, turnoIdGravado, type Rastreio } from './rastreio/rastreio';
import { documentoCitado } from './documento-na-mensagem';
import { FERRAMENTAS_ATE_O_CADASTRO, consertosDoCadastro, soAteOCadastro } from './so-ate-o-cadastro';
import { silencioPermitido } from './silencio';
import { SEPARAR_FORMULARIO_DAS_FERRAMENTAS } from './interruptor-duas-fases';
import { systemDoPedido } from './cache-de-prompt';
import { usaFiscal } from './fiscal';
import { usaPipelineV2 } from '../v2/pipeline';
import { INSTRUCAO_DA_V2 } from '../v2/integracao-v1';
import { CABECALHO_DA_LISTA } from './ferramentas/confirmar-itens';
import { lerSaidaDoSerializador, pedidoDoSerializador, textoParaOCliente } from './serializar-resposta';
import { dataBRemSP, hojeEmSP } from '../fuso';

type Client = SupabaseClient<Database>;

// Teto de tokens de saída do motor. Uma mensagem de WhatsApp mais o JSON do
// structured output cabem em 400 — o 1024 anterior só pagava uma folga que
// quase nunca era usada. O JSON só passa disso num caso raro (questionário
// longo completando junto com atualização de perfil); quando passa, a resposta
// vem cortada e não dá para fazer parse, então repetimos UMA vez com folga.
// Sai mais barato do que deixar o cliente sem resposta nenhuma.
const MAX_TOKENS_RESPOSTA = 400;

/**
 * O formulário com tudo neutro, para o resgate sem formulário preencher só o
 * campo `resposta`.
 *
 * Os valores são os mesmos que o modelo devolve quando não houve desfecho
 * nenhum — nada é "desligado" aqui, só não afirmado. Um turno resgatado passa
 * pelo resto da função exatamente como um turno em que o cliente só perguntou
 * uma coisa e foi respondido.
 */
const FORMULARIO_NEUTRO = {
  resposta: '',
  transferir_para_atendente: false,
  questionario_completo: false,
  respostas: [] as { pergunta: string; resposta: string }[],
  resultado: 'nenhum' as const,
  itens_vendidos: [] as { produto: string; quantidade: number }[],
  agendamento_data: '',
  agendamento_hora: '',
  agendamento_servico: '',
  agendamento_remarcacao: false,
  atualizacao_perfil: {
    preferencias: [] as string[],
    dados_chave: [] as { rotulo: string; valor: string }[],
    ultimo_interesse: '',
    observacoes: '',
  },
};

/** As ferramentas que DESCOBREM quem é o cliente no sistema da empresa. Elas
 *  rodam antes das que dependem de saber (preço e orçamento), porque são elas
 *  que escrevem o contexto que as travas dessas outras leem. */
const FERRAMENTAS_QUE_DESCOBREM_O_CLIENTE = new Set(['consultar_cliente', 'cadastrar_cliente']);
const MAX_TOKENS_RESPOSTA_FOLGA = 1024;
/** Folga quando o corte veio no meio de uma ferramenta: a lista do `confirmar_itens`
 *  cresce com o pedido (~70 tokens por item), e 15 itens já passam de 1024 (007:m09,
 *  comparativo de 02/10). Só se paga o que o modelo escreve, não o teto. */
const MAX_TOKENS_FERRAMENTA_FOLGA = 4096;

/** No lugar da seção de formato, quando a resposta sai em texto puro. */
const FORMATO_DO_RESGATE = '\n\n## Formato da resposta\nEscreva só o texto da mensagem para o cliente, em texto normal, '
  + 'no máximo 4 frases curtas. Não use JSON, não use crases de código e não escreva nomes de campos.';

// Tetos do laço de ferramentas. São dois porque param coisas diferentes: o de
// voltas impede o modelo de girar em falso (pedir a mesma consulta sem parar),
// e o de tempo impede que consultas lentas ao sistema do cliente somem até
// estourar o request. Quem chega no teto não fica sem resposta: a última volta
// sai com `tool_choice: none`, então o modelo é obrigado a falar com o cliente
// com o que já descobriu.
const MAX_VOLTAS_DE_FERRAMENTA = 6;
const TEMPO_MAXIMO_DO_LACO_MS = 45_000;

interface RespostaIA {
  resposta: string;
  transferirParaAtendente: boolean;
  /** Mensagens escritas pelo CÓDIGO, para sair ao cliente logo depois da
   *  resposta do modelo e exatamente como estão. É por aqui que os valores de
   *  um orçamento chegam ao cliente sem passar pelo modelo. */
  mensagensDoSistema?: string[];
  /** Presente quando o motor decidiu não responder agora. `resposta` vem vazia,
   *  e quem chama não grava nem envia nada. */
  naoResponder?: 'ja-respondida' | 'chegou-mensagem-nova' | 'midia-sendo-lida' | 'humano-respondeu';
  /** No roteiro de vendas, o modelo devolveu resposta vazia de propósito: a
   *  instrução do painel manda ficar em silêncio fora de pedido de orçamento.
   *  Quem chama marca isso na conversa, senão a varredura de mensagem sem
   *  resposta acharia que houve falha e tentaria de novo. */
  silencioPelaInstrucao?: true;
}

const NAO_RESPONDER = (motivo: NonNullable<RespostaIA['naoResponder']>): RespostaIA =>
  ({ resposta: '', transferirParaAtendente: false, naoResponder: motivo });

/**
 * `rastreio` é a ficha desta execução (`agente_turnos`). Opcional, e só
 * ESCRITO aqui: marca o caminho, as ferramentas e o prompt. Nenhuma decisão do
 * motor lê o que está nele — com ou sem ele, a resposta sai a mesma.
 */
export async function gerarRespostaIA(
  supabase: Client, orgId: string, conversationId: string, rastreio?: Rastreio,
  /** Texto a mais no system (a v2 avisa aqui que a lista acabou de ser confirmada). */
  instrucaoExtra = '',
): Promise<RespostaIA> {
  // Quem é este cliente, e por qual número ele falou? O contato dá (a) o
  // contexto do dia em todas as conversas dele e (b) os resumos anteriores; o
  // número decide qual roteiro o agente segue — vazio significa o da empresa
  // toda, que é o comportamento de sempre.
  const { data: conv } = await supabase
    .from('conversations')
    .select('contact_id, wa_number_id, erp_cliente_id, erp_cliente_nome, erp_cliente_desde_mensagem')
    .eq('id', conversationId).single();
  const contactId = conv?.contact_id ?? null;

  const waNumberId = conv?.wa_number_id ?? null;
  const { systemPrompt, welcomeMsg, roteiro, produtosPorIndice, usaListaDigitada } =
    await buildSystemPrompt(supabase, orgId, waNumberId);

  // A diferença entre os dois produtos, e não uma regra a mais: no **Wappia
  // Atendimento** a IA substitui o atendente, então quando um humano responde
  // ela se cala — falar por cima seria dizer a mesma coisa duas vezes. No
  // **Wappia Vendas** ela não substitui ninguém: faz o cadastro e o rascunho do
  // orçamento, trabalho que o vendedor não vai fazer pelo celular. Se a fala
  // dele desligasse a IA, uma mensagem sobre outro assunto (ou mandada sem
  // querer) pararia o orçamento no meio. Decisão do Leonardo em 2026-09-13.
  const iaSegueMesmoComHumano = roteiro === 'vendas';

  // Cada vendedor, uma memória (decisão do Leonardo em 2026-09-10): quando o
  // mesmo cliente fala com dois vendedores, a IA de cada um só enxerga o que
  // aconteceu no número dele. Vale para as mensagens e para os resumos.
  // Registro sem número (anterior à separação) vale para todos. No Wappia
  // Atendimento, com um número só, isso não filtra nada — é o mesmo de antes.
  const doMesmoNumero = (numeroDoRegistro: string | null) =>
    !waNumberId || !numeroDoRegistro || numeroDoRegistro === waNumberId;

  // A ficha do cliente (preferências, último interesse, observações) é uma só
  // por contato e não sabe de qual conversa veio cada fato. Por isso ela entra
  // no prompt só no número de atendimento da empresa: no número de um vendedor,
  // mostrar a ficha seria contar à IA do João o que o cliente disse ao Pedro.
  let mostrarPerfilNoPrompt = true;
  // Quem é o dono do número. No Wappia Vendas é o `codigo_erp` dele que vai ao
  // sistema do cliente como `vendedor_id` em toda cotação e todo orçamento.
  let vendedorDoNumero: { memberId: string; nome: string; codigoErp: string; telefoneWhatsapp: string } | null = null;
  if (waNumberId) {
    const { data: numero } = await supabase.from('wa_numbers').select('papel, member_id').eq('id', waNumberId).maybeSingle();
    mostrarPerfilNoPrompt = !numero || numero.papel === 'atendimento';
    if (numero?.member_id) {
      const { data: membro } = await supabase
        .from('organization_members').select('id, nome, codigo_erp, telefone_whatsapp')
        .eq('id', numero.member_id).maybeSingle();
      if (membro) {
        vendedorDoNumero = {
          memberId: membro.id,
          nome: membro.nome,
          codigoErp: membro.codigo_erp ?? '',
          telefoneWhatsapp: membro.telefone_whatsapp ?? '',
        };
      }
    }
  }

  let contatoNome = '';
  let contatoTelefone: string | null = null;
  // O documento do cadastro em uso, para saber se o cliente acabou de citar outro.
  let documentoDoContato: string | null = null;
  let resumosAnteriores: { data: string; resumo: string }[] = [];
  let convIdsDoContato = [conversationId];
  let perfilAtual: PerfilContato = { preferencias: [], dadosChave: [], ultimoInteresse: '', observacoes: '', atualizadoEm: null };
  if (contactId) {
    const [contato, historicoResumos, convsDoContato] = await Promise.all([
      supabase.from('contacts').select('nome, telefone, perfil, documento').eq('id', contactId).maybeSingle(),
      // Busca 10 e filtra por número aqui, em vez de pedir 3 direto: com o
      // filtro, os 3 mais recentes do banco podem ser todos de outro vendedor.
      supabase.from('contact_history').select('data, resumo, wa_number_id').eq('contact_id', contactId).eq('canal', 'IA').order('data', { ascending: false }).limit(10),
      supabase.from('conversations').select('id, wa_number_id').eq('contact_id', contactId),
    ]);
    contatoNome = contato.data?.nome ?? '';
    contatoTelefone = contato.data?.telefone ?? null;
    documentoDoContato = contato.data?.documento ?? null;
    const perfilRaw = (contato.data?.perfil as Partial<PerfilContato> | null) ?? {};
    perfilAtual = {
      preferencias: Array.isArray(perfilRaw.preferencias) ? perfilRaw.preferencias : [],
      dadosChave: Array.isArray(perfilRaw.dadosChave) ? perfilRaw.dadosChave : [],
      ultimoInteresse: perfilRaw.ultimoInteresse ?? '',
      observacoes: perfilRaw.observacoes ?? '',
      atualizadoEm: perfilRaw.atualizadoEm ?? null,
    };
    // Onde a IA vai só até o cadastro, o resumo de um atendimento anterior não
    // entra: cada orçamento começa pelo documento, e um resumo que diz "pediu
    // orçamento, o vendedor retorna com valores" faz o modelo achar que essa
    // etapa já foi resolvida. Medido em 21/09 (`test/bancada/primeira-resposta-vendas.mts`):
    // com o resumo, 4 de 6 respostas erradas; sem ele, 11 de 11 certas. A
    // instrução do painel já mandava pedir o documento e não foi o bastante.
    const usaResumos = !consertosDoCadastro(orgId, roteiro);
    resumosAnteriores = (historicoResumos.data ?? [])
      .filter(h => usaResumos && h.resumo && doMesmoNumero(h.wa_number_id))
      .slice(0, 3);
    const convsDoMesmoNumero = (convsDoContato.data ?? []).filter(c => doMesmoNumero(c.wa_number_id));
    if (convsDoMesmoNumero.length) convIdsDoContato = convsDoMesmoNumero.map(c => c.id);
  }

  // S5: lembrete de consulta que o paciente ainda não respondeu. Só no roteiro
  // de atendimento. Sem lembrete pendente, prompt e formato saem como antes.
  const lembretePendente = contactId && roteiro === 'atendimento'
    ? await buscarLembretePendente(supabase, orgId, contactId)
    : null;

  // Contexto do dia: mensagens do cliente desde a meia-noite (horário de
  // Brasília, UTC-3) em qualquer conversa dele NESTE número, não só as últimas
  // 20 desta conversa.
  //
  // As 40 MAIS RECENTES, viradas para a ordem cronológica. Pedir em ordem
  // crescente com limite pegava as 40 primeiras do dia: a partir da 41ª a IA
  // deixaria de ver o que o cliente acabou de escrever.
  const inicioDoDia = `${hojeEmSP()}T00:00:00-03:00`;
  const { data: historicoRecente } = await supabase
    .from('messages')
    .select('id, autor, texto, created_at')
    .in('conversation_id', convIdsDoContato)
    .gte('created_at', inicioDoDia)
    .order('created_at', { ascending: false })
    .limit(40);
  const historico = [...(historicoRecente ?? [])].reverse();

  const ehPrimeiraMensagem = historico.length === 1;

  const conversaveis = historico.filter(m => m.autor === 'cliente' || m.autor === 'ia' || m.autor === 'humano');

  // No roteiro de vendas, as falas do vendedor que estão DEPOIS da última
  // mensagem do cliente saem da conversa e viram contexto no prompt. Duas
  // razões: a Anthropic recusa conversa terminando no assistente, e a IA
  // precisa saber o que ele já disse para não repetir.
  const falasDoVendedorNoFim: string[] = [];
  if (iaSegueMesmoComHumano) {
    while (conversaveis.length && conversaveis[conversaveis.length - 1].autor === 'humano') {
      falasDoVendedorNoFim.unshift(conversaveis.pop()!.texto);
    }
  }

  const messages = conversaveis.map(m => ({
    role: (m.autor === 'cliente' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.texto,
  }));

  // Histórico terminando na IA ou num atendente significa que outra resposta
  // chegou antes desta — acontece quando duas mensagens do cliente chegam
  // quase juntas. Não há o que responder, e mandar assim à Anthropic dá erro
  // 400 (ela não aceita a conversa terminando no assistente).
  if (!messages.length || messages[messages.length - 1].role === 'assistant') {
    return NAO_RESPONDER('ja-respondida');
  }
  const idUltimaDoCliente = conversaveis[conversaveis.length - 1].id;

  // Foto ou áudio ainda sendo lido: quem está lendo responde quando terminar, e a
  // resposta já cobre a mídia e o que veio depois dela ("quanto custa isso?").
  if (conversaveis.some(m => m.autor === 'cliente' && midiaAindaSendoLida(m.texto, m.created_at))) {
    return NAO_RESPONDER('midia-sendo-lida');
  }

  // **O silêncio é decidido aqui, pelo código, antes de chamar a IA** — só na
  // organização que vai até o cadastro (Distribuidora Exemplo). Deixar a decisão com o
  // modelo falhou duas vezes em 21/09: ele respondeu um "bom dia" com a pergunta
  // da conversa anterior, e calou num "quero um orçamento". Aqui a regra é fixa
  // (`silencio.ts`): sem palavra de orçamento, sem pergunta recente da IA, a
  // mensagem nem chega ao modelo. Também sai mais barato.
  const ultimaDaIa = [...conversaveis].reverse().find(m => m.autor === 'ia') ?? null;
  const indiceDaUltimaDaCasa = conversaveis.map(m => m.autor).findLastIndex(a => a !== 'cliente');
  const falaDoClienteAgora = conversaveis.slice(indiceDaUltimaDaCasa + 1).map(m => m.texto).join('\n');
  const minutosDesdeAFalaDaIa = ultimaDaIa ? (Date.now() - new Date(ultimaDaIa.created_at).getTime()) / 60_000 : null;
  if (soAteOCadastro(orgId, roteiro) && silencioPermitido({
    falaDoCliente: falaDoClienteAgora,
    ultimaFalaDaIa: ultimaDaIa?.texto ?? null,
    minutosDesdeAFalaDaIa,
    usouFerramenta: false,
  })) {
    marcar(rastreio, 'silencio_decidido_pelo_codigo');
    if (rastreio) rastreio.entrada = { mensagemId: idUltimaDoCliente, roteiro, system: '', mensagens: [], falaDoCliente: falaDoClienteAgora, contactId };
    return { resposta: '', transferirParaAtendente: false, silencioPelaInstrucao: true };
  }

  const instrucaoDoVendedor = falasDoVendedorNoFim.length
    ? `\n## O vendedor já escreveu ao cliente\n${falasDoVendedorNoFim.map(t => `- "${t}"`).join('\n')}\nNão repita o que ele disse e não comente que ele escreveu. Siga o seu trabalho: o cadastro e o orçamento.`
    : '';

  // O cliente já identificado no sistema do cliente entra no prompt como fato
  // da conversa. Duas razões para ele aparecer aqui, e não só no contexto das
  // ferramentas: o modelo para de pedir o CPF de novo a cada mensagem, e para
  // de anunciar "vou consultar seu cadastro" quando o cadastro já foi
  // consultado. O código continua sendo quem garante o id na hora de criar o
  // orçamento — o prompt é o conforto, não a trava.
  // **O cliente acabou de citar outro documento?** Em 20/09 ele escreveu "na
  // verdade esse orçamento é para o outro cnpj, 45.723.174/0001-10" e o agente
  // ignorou: não consultou o cadastro e cotou com o cliente antigo, que seguia
  // guardado na conversa. A exceção estava escrita no prompt abaixo e o modelo
  // passou por cima — por isso a decisão saiu do texto e virou código.
  const trocouDeDocumento = citouOutroDocumento(
    conversaveis[conversaveis.length - 1].texto,
    documentoDoContato,
  );

  const instrucaoClienteDoErp = trocouDeDocumento
    ? '\n## O cliente citou OUTRO documento\nO CPF/CNPJ desta mensagem não é o do cadastro que '
      + 'estava em uso. Use consultar_cliente com o documento novo ANTES de qualquer outra coisa: '
      + 'não cote preço, não crie orçamento e não use o cliente anterior.'
    : conv?.erp_cliente_id && consertosDoCadastro(orgId, roteiro)
    // Só o FATO, sem ordem nenhuma. Quem decide se pergunta o CNPJ de novo é a
    // instrução do painel: na Distribuidora Exemplo, cada orçamento começa pelo documento,
    // porque o mesmo WhatsApp compra por mais de uma empresa. Em 21/09 o texto
    // abaixo ("não peça o CPF de novo") fez a IA pular direto para o produto.
    ? `\n## Cadastro já consultado nesta conversa\ncliente_id: ${conv.erp_cliente_id}`
      + `${conv.erp_cliente_nome ? ` — ${conv.erp_cliente_nome}` : ''}`
    : conv?.erp_cliente_id
    ? `\n## O cliente já está identificado no sistema\ncliente_id: ${conv.erp_cliente_id}`
      + `${conv.erp_cliente_nome ? ` — ${conv.erp_cliente_nome}` : ''}\n`
      + 'Não peça o CPF ou CNPJ de novo e não consulte o cadastro outra vez, a menos que ele diga '
      + 'que o pedido é para outra empresa.'
    : '';

  const instrucaoBoasVindas = ehPrimeiraMensagem && welcomeMsg
    ? `\n## Primeira mensagem da conversa\nEsta é a primeira mensagem desta conversa. Comece sua
resposta com um tom de boas-vindas seguindo esta ideia: "${welcomeMsg}" — e responda também à
mensagem do cliente abaixo, caso ela contenha algo além de uma saudação.`
    : '';

  const partesMemoria: string[] = [];
  if (contatoNome) partesMemoria.push(`Nome do cliente: ${contatoNome}.`);
  if (resumosAnteriores.length) {
    partesMemoria.push(`Resumos de atendimentos anteriores (do mais recente):\n${resumosAnteriores
      .map(h => `- [${dataBRemSP(h.data)}] ${h.resumo}`)
      .join('\n')}`);
  }
  const linhasPerfil: string[] = [];
  if (perfilAtual.preferencias.length) linhasPerfil.push(`Preferências: ${perfilAtual.preferencias.join('; ')}`);
  if (perfilAtual.dadosChave.length) linhasPerfil.push(`Dados: ${perfilAtual.dadosChave.map(d => `${d.rotulo}=${d.valor}`).join('; ')}`);
  if (perfilAtual.ultimoInteresse) linhasPerfil.push(`Último interesse: ${perfilAtual.ultimoInteresse}`);
  if (perfilAtual.observacoes) linhasPerfil.push(`Observações: ${perfilAtual.observacoes}`);
  // A ficha continua sendo lida acima mesmo quando não aparece no prompt: é
  // sobre ela que a atualização de perfil faz o merge no fim, e sem ela o que
  // o cliente contou antes seria apagado.
  if (linhasPerfil.length && mostrarPerfilNoPrompt) partesMemoria.push(`Perfil do cliente:\n${linhasPerfil.join('\n')}`);
  const memoriaSection = partesMemoria.length
    ? `\n## O que já sabemos deste cliente\n${partesMemoria.join('\n')}\nUse isso para personalizar o atendimento (pode chamar pelo nome), mas confirme dados importantes em vez de assumir que nada mudou.`
    : '';

  // Tudo que vem antes da seção de formato. Separado só para a fase 1 das duas
  // fases trocar o formato; o `system` de sempre é este texto mais a seção de
  // JSON, byte a byte como antes.
  const cabecalhoDoSystem = `${systemPrompt}${memoriaSection}${instrucaoClienteDoErp}${instrucaoDoVendedor}${instrucaoBoasVindas}${lembretePendente ? instrucaoDoLembrete(lembretePendente) : ''}${usaPipelineV2(roteiro) ? INSTRUCAO_DA_V2 : roteiro === 'vendas' && usaFiscal(orgId) ? INSTRUCAO_DO_FISCAL : ''}${instrucaoExtra}`;
  const systemComFormulario = `${cabecalhoDoSystem}

## Formato da resposta
Responda em JSON com os campos:
- "resposta": o texto que será enviado ao cliente pelo WhatsApp, seguindo todas as instruções acima.
- "transferir_para_atendente": true somente quando a mensagem do cliente se encaixa em uma regra da seção
  "Regras automáticas" cuja ação é direcionar para um humano; false em qualquer outro caso.
- "questionario_completo": true somente quando você já coletou, nesta conversa, as respostas de TODOS os
  itens obrigatórios da seção "Qualificação do cliente"; false enquanto faltar algum.
- "respostas": lista do que o cliente já respondeu de cada item da qualificação, no formato
  {"pergunta","resposta"} — inclua só os itens que ele de fato respondeu (lista vazia se nenhum ainda).
- "resultado": o desfecho concretizado — "venda", "agendamento" ou "contato"; ou "nenhum" se ainda não houve.
- "itens_vendidos": quando o resultado for "venda", o que o cliente fechou, no formato
  {"produto","quantidade"} — use o nome do produto EXATAMENTE como aparece na seção "Produtos e
  serviços" acima e nunca invente um item que não esteja lá. Se ele fechou sem especificar produto,
  devolva lista vazia. Não informe valores: quem calcula o preço é o sistema.
- "agendamento_data": quando o resultado for "agendamento" e o cliente já confirmou dia e horário, a data no
  formato AAAA-MM-DD; caso contrário, string vazia. Só marque dentro da disponibilidade e nunca num horário reservado.
- "agendamento_hora": o horário confirmado no formato HH:MM; string vazia se não houver agendamento fechado.
- "agendamento_servico": o serviço combinado para o agendamento; string vazia se não se aplica.
- "agendamento_remarcacao": true somente quando este horário SUBSTITUI um agendamento que o cliente
  já tinha (ele pediu para mudar/adiar/antecipar); false quando é um horário novo, que se soma aos
  que ele já tem.${lembretePendente ? LINHA_DO_FORMATO_DO_LEMBRETE : ''}
- "atualizacao_perfil": fatos NOVOS ou atualizados sobre o cliente que valem lembrar em futuros atendimentos
  (preferências, dados importantes, o que ele está buscando agora, observações úteis). Só inclua o que
  apareceu NESTA conversa; deixe listas vazias e strings vazias quando não houver novidade. Não repita o
  que já está listado em "Perfil do cliente", se essa seção aparecer acima.

Mantenha "resposta" no tamanho de uma mensagem de WhatsApp: no máximo 4 frases curtas.`;

  // **Onde a IA vai só até o cadastro (Distribuidora Exemplo), ela responde em texto puro,
  // sem o formulário.** O formulário junto com as ferramentas faz a Anthropic
  // devolver erro 500 em cerca de 1/3 dos pedidos (medido em 20/09; cada um
  // sozinho, 0 em 60), e em 21/09 as 5 mensagens reais depois do deploy caíram
  // todas no resgate. Lá o formulário não carregava nada: venda, agenda,
  // questionário e transferência estão fora do prompt de vendas. O texto que
  // volta é embrulhado no formulário neutro logo na saída de `chamarModelo`,
  // então o resto da função não sabe da diferença. O que se perde é a
  // atualização automática da ficha do contato.
  const emTextoPuro = consertosDoCadastro(orgId, roteiro);
  const system = emTextoPuro
    ? systemComFormulario.replace(/\n\n## Formato da resposta[\s\S]*$/, FORMATO_DO_RESGATE)
    : systemComFormulario;

  // As ferramentas deste roteiro. No Wappia Atendimento a lista é VAZIA, e aí
  // o campo `tools` não é enviado: a requisição sai idêntica à de antes do
  // laço, e o laço dá uma volta só — a mesma chamada única de sempre.
  //
  // `mensagensDoSistema` é um array vivo: as ferramentas de preço e orçamento
  // empurram nele o texto com os valores, já montado pelo código. Ele sai ao
  // cliente **depois** da resposta do modelo, e o modelo sabe disso — é assim
  // que nenhum valor passa pela escrita dele.
  const mensagensDoSistema: string[] = [];
  const ctxFerramentas = {
    supabase, orgId, conversationId, contactId, waNumberId, roteiro, usaListaDigitada,
    contatoNome, contatoTelefone,
    vendedor: vendedorDoNumero,
    // O que a conversa já descobriu no sistema do cliente. Sem isto, o
    // `cliente_id` achado na primeira mensagem não sobrevive até a mensagem em
    // que o cliente confirma o pedido — foi o que derrubou o teste de 14/09.
    // Quando o cliente acaba de citar OUTRO documento, o id guardado deixa de
    // ser oferecido: sem ele, `consultar_preco` e `criar_orcamento` batem na
    // trava que já existe e mandam consultar o cadastro antes. É a regra velha
    // valendo, e não uma nova.
    erpClienteId: trocouDeDocumento ? null : (conv?.erp_cliente_id ?? null),
    erpClienteNome: trocouDeDocumento ? null : (conv?.erp_cliente_nome ?? null),
    // Anular os dois campos acima não bastava: o modelo ainda tinha o id
    // anterior em mãos e o mandava na chamada, onde ele ganhava do contexto.
    // Com esta marca, `clienteIdDaChamada` ignora o id do modelo até a consulta
    // nova responder. Ver `memoria-do-erp.ts`.
    documentoTrocado: trocouDeDocumento,
    // **A trava de "identificou agora" nasce ligada quando o cadastro já foi
    // descoberto respondendo a ESTA MESMA mensagem.**
    //
    // Até 21/09 ela era só um booleano em memória, e por isso valia dentro de
    // uma execução do motor. Em 20/09 às 21:06 isso falhou em produção: a
    // Anthropic devolveu 500, a execução morreu depois de consultar o cadastro,
    // e a varredura refez o turno. Para a execução nova o cliente "já estava
    // identificado desde antes" — e a cotação saiu sem o cliente final ter
    // confirmado nada.
    //
    // Com a mensagem gravada na conversa, a pergunta deixa de ser "descobri
    // nesta execução?" e passa a ser "descobri respondendo a esta mesma
    // mensagem?", que é o que a regra sempre quis dizer. Conversa antiga tem
    // NULL e se comporta como antes.
    clienteIdentificadoAgora: !!conv?.erp_cliente_desde_mensagem
      && conv.erp_cliente_desde_mensagem === idUltimaDoCliente,
    mensagemId: idUltimaDoCliente,
    mensagensDoSistema,
    rastreio,
    // O fiscal (`fiscal.ts`) conta as linhas do pedido a partir daqui: o que o
    // cliente escreveu depois da última lista ou orçamento que o sistema mandou.
    falasDoPedido: falasDesdeAUltimaLista(conversaveis),
    fiscal: { avisouEsquecidos: false },
  };
  const fiscal = usaFiscal(orgId);
  const pipelineV2 = usaPipelineV2(roteiro);
  // Na Distribuidora Exemplo, por enquanto, só até o cadastro. Ver `so-ate-o-cadastro.ts`.
  const ferramentas = soAteOCadastro(orgId, roteiro)
    ? ferramentasDoRoteiro(roteiro, { produtosPorIndice, fiscal, pipelineV2 })
        .filter(f => FERRAMENTAS_ATE_O_CADASTRO.includes(f.definicao.name))
    : ferramentasDoRoteiro(roteiro, { produtosPorIndice, fiscal, pipelineV2 });
  const ferramentaPorNome = new Map(ferramentas.map(f => [f.definicao.name, f]));

  // **Duas fases: o laço sem formulário, e o formulário sem ferramentas.** Ver
  // `interruptor-duas-fases.ts`. Só no roteiro de vendas e só com a chave
  // ligada. O atendimento nunca entra aqui: sem ferramentas, a requisição dele
  // continua sendo a de sempre.
  //
  // Onde vale "até o cadastro" (`emTextoPuro`), nada muda: lá a chamada já sai
  // sem formulário desde 21/09 (30 de 30 sem 500 na bancada) e continua assim.
  // As duas fases valem para o resto do roteiro de vendas.
  const duasFases = SEPARAR_FORMULARIO_DAS_FERRAMENTAS && roteiro === 'vendas' && ferramentas.length > 0 && !emTextoPuro;
  const systemDaChamada = duasFases
    ? `${cabecalhoDoSystem}\n\n## Formato da resposta\nEscreva só a mensagem que será enviada ao cliente pelo WhatsApp, em texto puro: sem JSON, sem aspas em volta, sem título e sem comentar ferramentas ou sistemas. No máximo 4 frases curtas.`
    : system;

  // A ficha: o que entrou e o estado das travas antes da primeira chamada.
  if (rastreio) {
    if (emTextoPuro) marcar(rastreio, 'texto_puro');
    if (trocouDeDocumento) marcar(rastreio, 'trocou_documento');
    if (duasFases) marcar(rastreio, 'duas_fases');
    rastreio.estadoAntes = {
      erp_cliente_id: conv?.erp_cliente_id ?? null,
      erp_cliente_nome: conv?.erp_cliente_nome ?? null,
      erp_cliente_desde_mensagem: conv?.erp_cliente_desde_mensagem ?? null,
      cliente_identificado_agora: ctxFerramentas.clienteIdentificadoAgora,
      documento_trocado: trocouDeDocumento,
      documento_citado: documentoCitado(conversaveis[conversaveis.length - 1].texto),
    };
    // O system que foi de fato à Anthropic: com as duas fases, é o de texto puro.
    rastreio.entrada = { mensagemId: idUltimaDoCliente, roteiro, system: systemDaChamada, mensagens: messages, falaDoCliente: falaDoClienteAgora, contactId };
    await gravarEntrada(supabase, rastreio);
  }

  const client = new Anthropic();
  // A conversa cresce dentro do laço (cada volta acrescenta o pedido do modelo
  // e o que a ferramenta respondeu), então ela é uma variável, não o `messages`
  // de cima.
  const conversa: Anthropic.MessageParam[] = [...messages];

  // **A ferramenta que esta volta é OBRIGADA a chamar**, ou `null`.
  //
  // Todas as travas escritas até 20/09 eram negativas — "não faça X quando o
  // estado diz Y" — e uma delas falhou de um jeito que nenhuma proibição
  // resolve. Às 22:35 o cliente trocou de CNPJ, o código detectou, anulou o
  // cadastro guardado e injetou no prompt "use consultar_cliente ANTES de
  // qualquer outra coisa". O modelo respondeu *"já mando o orçamento pra
  // WAPPIA TESTE 2 LTDA"* **sem chamar ferramenta nenhuma**: o nome estava no
  // histórico da conversa (o cliente o digitara três horas antes) e ele o
  // tratou como fato consultado.
  //
  // Contra isso não existe instrução: enquanto responder de cabeça for uma
  // opção, o histórico continua sendo mais barato que a consulta. `tool_choice`
  // com o nome da ferramenta tira a opção — a API devolve a chamada, e o modelo
  // só volta a escrever depois de ler o que o sistema respondeu.
  //
  // **Só na primeira volta.** Obrigar em todas faria o laço consultar o mesmo
  // cadastro para sempre.
  const FERRAMENTA_DO_CADASTRO = 'consultar_cliente';
  const ferramentaObrigatoria = trocouDeDocumento && ferramentaPorNome.has(FERRAMENTA_DO_CADASTRO)
    ? FERRAMENTA_DO_CADASTRO
    : null;

  const chamarModelo = async (
    maxTokens: number, podeUsarFerramenta: boolean, obrigar: string | null = null, avisoNoFim = '',
  ): Promise<Anthropic.Message> => {
    const r = await chamarModeloCru(maxTokens, podeUsarFerramenta, obrigar, avisoNoFim);
    return emTextoPuro ? embrulharTextoNoFormulario(r) : r;
  };

  const chamarModeloCru = (
    maxTokens: number, podeUsarFerramenta: boolean, obrigar: string | null, avisoNoFim: string,
  ) => client.messages.create({
    model: MODELO_IA,
    max_tokens: maxTokens,
    // Com a chave do cache (`cache-de-prompt.ts`), a parte fixa vai num bloco
    // marcado; sem ela, o mesmo texto único de sempre.
    system: systemDoPedido(orgId, systemPrompt, `${systemDaChamada}${avisoNoFim}`),
    messages: conversa,
    ...(ferramentas.length
      ? {
          tools: ferramentas.map(f => f.definicao) as Anthropic.Tool[],
          // Esgotado o teto, a última volta proíbe ferramenta em vez de cortar
          // a conversa: o modelo responde com o que já tem em mãos.
          ...(obrigar
            ? { tool_choice: { type: 'tool' as const, name: obrigar } }
            : podeUsarFerramenta ? {} : { tool_choice: { type: 'none' as const } }),
        }
      : {}),
    // Na fase 1 das duas fases o formulário NÃO vai: é a combinação dele com
    // as ferramentas que estoura em 500.
    ...(emTextoPuro || duasFases ? {} : { output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            resposta: { type: 'string' },
            transferir_para_atendente: { type: 'boolean' },
            questionario_completo: { type: 'boolean' },
            respostas: {
              type: 'array',
              items: {
                type: 'object',
                properties: { pergunta: { type: 'string' }, resposta: { type: 'string' } },
                required: ['pergunta', 'resposta'],
                additionalProperties: false,
              },
            },
            resultado: { type: 'string', enum: ['venda', 'agendamento', 'contato', 'nenhum'] },
            itens_vendidos: {
              type: 'array',
              items: {
                type: 'object',
                properties: { produto: { type: 'string' }, quantidade: { type: 'integer' } },
                required: ['produto', 'quantidade'],
                additionalProperties: false,
              },
            },
            agendamento_data: { type: 'string' },
            agendamento_hora: { type: 'string' },
            agendamento_servico: { type: 'string' },
            agendamento_remarcacao: { type: 'boolean' },
            ...(lembretePendente ? { confirmacao_agendamento: { type: 'string', enum: ['sim', 'nao', 'nenhuma'] } } : {}),
            atualizacao_perfil: {
              type: 'object',
              properties: {
                preferencias: { type: 'array', items: { type: 'string' } },
                dados_chave: {
                  type: 'array',
                  items: { type: 'object', properties: { rotulo: { type: 'string' }, valor: { type: 'string' } }, required: ['rotulo', 'valor'], additionalProperties: false },
                },
                ultimo_interesse: { type: 'string' },
                observacoes: { type: 'string' },
              },
              required: ['preferencias', 'dados_chave', 'ultimo_interesse', 'observacoes'],
              additionalProperties: false,
            },
          },
          required: ['resposta', 'transferir_para_atendente', 'questionario_completo', 'respostas', 'resultado', 'itens_vendidos', 'agendamento_data', 'agendamento_hora', 'agendamento_servico', 'agendamento_remarcacao', 'atualizacao_perfil', ...(lembretePendente ? ['confirmacao_agendamento'] : [])],
          additionalProperties: false,
        },
      },
    } }),
  });

  // Confirmado contra a API de verdade em 2026-09-13: `output_config.format`
  // e `tools` convivem no mesmo request. Quando o modelo quer uma ferramenta,
  // ele devolve `stop_reason: 'tool_use'` e nenhum texto; quando termina,
  // devolve o JSON do formato. Por isso não existe uma ferramenta
  // "responder_ao_cliente": a resposta final continua vindo pelo mesmo lugar
  // de antes, e o código que faz o parse não mudou.
  //
  // **Convivem, mas brigam.** Medido em 20/09 contra a API de verdade, com o
  // retry do SDK desligado: os dois no mesmo request estouram em 500 num terço
  // das requisições; cada um sozinho, zero em 90. Ver
  // `test/bancada/erro-500-formato-e-ferramentas.mts`. A separação definitiva
  // ainda não foi feita; o que existe abaixo é o plano B.
  const usos: Anthropic.Usage[] = [];
  const comecouEm = Date.now();
  let response: Anthropic.Message;

  /**
   * **Responder sem o formulário, em vez de não responder.**
   *
   * Cada 500 deixava o cliente final sem mensagem nenhuma, até a varredura
   * refazer o turno minutos depois. Esta chamada troca o modo de falha: sai
   * **sem formulário e sem ferramentas**, que é a forma que a bancada não
   * conseguiu quebrar em 90 tentativas. Vem texto puro — e texto puro é
   * exatamente o que o cliente precisa.
   *
   * O que se perde são os METADADOS daquele turno: não registra venda, não
   * fecha questionário, não atualiza a ficha. Perder isso é incomparavelmente
   * melhor do que o cliente falar sozinho.
   *
   * As ferramentas que já rodaram no laço **não rodam de novo**: esta chamada
   * não as leva. E `mensagensDoSistema` continua de pé — um orçamento que já
   * saiu para o sistema do cliente chega ao cliente do mesmo jeito.
   */
  const resgatarSemFormulario = async (): Promise<Anthropic.Message> => {
    // **A seção "Formato da resposta" sai do system deste resgate.** Ela manda
    // "responda em JSON com os campos...", e sem o formato estruturado o modelo
    // obedecia e escrevia o formulário como texto. Em 21/09 12:22 isso deixou um
    // cliente sem resposta nas três tentativas seguidas: o motor recusa, com
    // razão, mandar o formulário ao WhatsApp.
    const systemDoResgate = system.replace(/\n\n## Formato da resposta[\s\S]*$/, FORMATO_DO_RESGATE);
    const r = await client.messages.create({
      model: MODELO_IA,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: systemDoPedido(orgId, systemPrompt, systemDoResgate),
      messages: conversa,
    }) as Anthropic.Message;
    usos.push(r.usage);
    const bloco = r.content.find(b => b.type === 'text');
    let resposta = bloco && bloco.type === 'text' ? bloco.text.trim() : '';
    // Mesmo sem a instrução, o hábito (e um formulário no histórico do dia)
    // pode puxar o modelo para o JSON. Se a mensagem está dentro dele, é ela que
    // sai; se o campo está vazio, não há o que mandar.
    if (pareceFormularioCru(resposta)) resposta = respostaDentroDoFormulario(resposta);
    if (!resposta) throw new Error('Resgate sem formulário também não devolveu texto utilizável.');
    // Devolvido no formato que o resto da função espera, com os metadados
    // neutros: assim nada abaixo daqui precisa saber que houve resgate.
    return {
      ...r,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ ...FORMULARIO_NEUTRO, resposta }) }],
    } as Anthropic.Message;
  };

  /** Erro que vale o plano B: quebrou do lado deles. Um 400 é pedido
   *  malformado nosso, e tem que aparecer em vez de ser contornado. */
  const ehFalhaDeServidor = (err: unknown): boolean => {
    const status = (err as { status?: number } | null)?.status;
    return typeof status === 'number' && status >= 500;
  };

  let usouFerramentaNestaResposta = false;
  let resgatado = false;
  for (let volta = 0; ; volta++) {
    const podeUsarFerramenta = volta < MAX_VOLTAS_DE_FERRAMENTA
      && Date.now() - comecouEm < TEMPO_MAXIMO_DO_LACO_MS;

    const obrigarNestaVolta = volta === 0 ? ferramentaObrigatoria : null;
    if (obrigarNestaVolta) marcar(rastreio, 'ferramenta_obrigatoria');
    if (!podeUsarFerramenta) marcar(rastreio, 'limite_de_voltas');

    try {
      response = await chamarModelo(MAX_TOKENS_RESPOSTA, podeUsarFerramenta, obrigarNestaVolta);
    } catch (err) {
      if (!ehFalhaDeServidor(err)) throw err;
      console.error('Anthropic falhou com erro de servidor; respondendo sem o formulário.');
      marcar(rastreio, 'resgate_500');
      response = await resgatarSemFormulario();
      resgatado = true;
      break;
    }
    usos.push(response.usage);
    if (response.stop_reason === 'max_tokens') {
      marcar(rastreio, 'max_tokens');
      // Com ferramenta disponível, o corte pode ter sido no meio dela, e nem
      // sempre dá para ver: em texto puro o bloco cortado já saiu reembrulhado
      // como texto (`embrulharTextoNoFormulario`), e às vezes o corte vem antes
      // de o bloco começar (05/10, 007:m09 e 006:m05 da Distribuidora Exemplo).
      const podeSerFerramenta = (ferramentas.length > 0 && podeUsarFerramenta)
        || response.content.some(bloco => bloco.type === 'tool_use');
      response = await chamarModelo(podeSerFerramenta ? MAX_TOKENS_FERRAMENTA_FOLGA : MAX_TOKENS_RESPOSTA_FOLGA, podeUsarFerramenta, obrigarNestaVolta);
      usos.push(response.usage);
    }

    // A saída em JSON com schema às vezes volta picada em fronteira de token
    // ("O cad as tro foi fe i to"), e o cliente lê isso. É artefato do modelo,
    // não do nosso código — ver `texto-fragmentado.ts`. Uma segunda tentativa
    // resolve; se a segunda vier igual, segue como veio, porque é melhor uma
    // frase estranha do que nenhuma resposta.
    if (response.stop_reason !== 'tool_use' && respostaSaiuPicada(response, duasFases)) {
      console.error('Resposta do modelo veio fragmentada; pedindo de novo.');
      marcar(rastreio, 'repetiu_texto_picado');
      response = await chamarModelo(MAX_TOKENS_RESPOSTA_FOLGA, podeUsarFerramenta, obrigarNestaVolta);
      usos.push(response.usage);
    }
    // `!podeUsarFerramenta` significa que esta volta saiu com `tool_choice:
    // none`, e a API não devolve `tool_use` nesse caso. A checagem está aqui
    // como trava: se algum dia devolvesse, o laço giraria para sempre.
    if (response.stop_reason !== 'tool_use' || !podeUsarFerramenta) break;

    // Todos os resultados voltam numa MESMA mensagem do usuário. Separar em
    // várias ensina o modelo a parar de pedir ferramentas em paralelo.
    const pedidos = response.content.filter(b => b.type === 'tool_use');

    // **Uma de cada vez, e as do cadastro primeiro.**
    //
    // Até 20/09 isto era um `Promise.all`, e foi ele que anulou as duas travas
    // escritas naquele dia. O modelo pede várias ferramentas na mesma resposta,
    // e as travas leem um contexto que a ferramenta do lado ainda está
    // escrevendo. As janelas ficaram gravadas em `erp_chamadas`:
    //
    //     17:35:48.515 ──► 17:35:49.074   consultar_cliente   documento NOVO
    //     17:35:48.655 ──► 17:35:48.935   cotar               cliente_id VELHO
    //
    // `cotar` começou e terminou dentro da consulta e cotou o cadastro
    // anterior. `clienteIdentificadoAgora` só é marcado quando a consulta
    // responde — tarde demais para quem já leu. O mesmo padrão se repetiu às
    // 17:36:23, com `cotar` correndo ao lado de `cadastrar_cliente`.
    //
    // Serializar resolve a leitura suja; ordenar resolve o resto. Quem
    // DESCOBRE quem é o cliente roda antes de quem DEPENDE de saber, e aí as
    // travas que já existem voltam a valer — sem regra nova e sem pedir nada ao
    // modelo. O custo é algumas centenas de milissegundos por volta.
    //
    // A ordem dos RESULTADOS continua sendo a dos pedidos: quem muda é a ordem
    // de execução. O `sort` é estável, então ferramentas do mesmo peso mantêm a
    // ordem em que o modelo as pediu.
    const primeiro = (nome: string) => (FERRAMENTAS_QUE_DESCOBREM_O_CLIENTE.has(nome) ? 0 : 1);
    const porId = new Map<string, Anthropic.ToolResultBlockParam>();

    for (const pedido of [...pedidos].sort((a, b) => primeiro(a.name) - primeiro(b.name))) {
      const ferramenta = ferramentaPorNome.get(pedido.name);
      if (!ferramenta) {
        porId.set(pedido.id, { type: 'tool_result' as const, tool_use_id: pedido.id, is_error: true,
          content: `A ferramenta "${pedido.name}" não existe.` });
        continue;
      }
      const comecouAFerramenta = Date.now();
      const chamadasAntes = rastreio?.chamadasErp.length ?? 0;
      const anotar = (ok: boolean) => rastreio?.ferramentas.push({
        nome: pedido.name,
        entrada: pedido.input ?? {},
        ok,
        duracao_ms: Date.now() - comecouAFerramenta,
        erp_chamadas: (rastreio?.chamadasErp ?? []).slice(chamadasAntes).map(c => c.id),
      });
      try {
        const saida = await ferramenta.executar((pedido.input ?? {}) as Record<string, unknown>, ctxFerramentas);
        porId.set(pedido.id, { type: 'tool_result' as const, tool_use_id: pedido.id, content: saida });
        anotar(true);
      } catch (err) {
        anotar(false);
        // Ferramenta que estoura não derruba a conversa: o modelo lê o erro e
        // decide o que dizer. O texto é instrução, não desabafo — sem ele o
        // modelo tende a inventar o resultado que não conseguiu consultar.
        console.error(`Ferramenta ${pedido.name} falhou:`, err instanceof Error ? err.message : err);
        porId.set(pedido.id, { type: 'tool_result' as const, tool_use_id: pedido.id, is_error: true,
          content: 'A consulta falhou. Não invente o resultado: diga que vai confirmar e retornar.' });
      }
    }

    const resultados: Anthropic.ToolResultBlockParam[] = pedidos.map(p => porId.get(p.id)!);
    usouFerramentaNestaResposta = true;

    conversa.push({ role: 'assistant', content: response.content });
    conversa.push({ role: 'user', content: resultados });
  }

  // **Silêncio não vale depois de consultar ou cadastrar.** A instrução do
  // painel pode mandar a IA ficar calada fora de pedido de orçamento — mas se
  // ela usou ferramenta nesta resposta, o cliente está no meio do fluxo e
  // mandou um dado. Medido em 21/09: depois de consultar um CNPJ sem cadastro,
  // e depois de receber o endereço, ela devolveu resposta vazia e o cliente
  // ficou sem retorno. Uma chamada a mais, sem ferramenta, pedindo o texto.
  //
  // E não vale também quando o cliente fala de orçamento ou responde uma
  // pergunta recente da IA — ver `silencio.ts`. Em 21/09 ela calou em "quero um
  // orçamento", e decidir isso não pode ser só do modelo.
  const podeCalar = silencioPermitido({
    falaDoCliente: falaDoClienteAgora,
    ultimaFalaDaIa: ultimaDaIa?.texto ?? null,
    minutosDesdeAFalaDaIa,
    usouFerramenta: usouFerramentaNestaResposta,
  });
  if (roteiro === 'vendas' && !podeCalar && response.stop_reason !== 'max_tokens'
    && !(duasFases ? textoDaFase1(response) : respostaDoFormulario(response)).trim()) {
    console.error('Resposta vazia onde o silêncio não vale; pedindo o texto ao cliente.');
    marcar(rastreio, 'pediu_texto_de_novo');
    // O aviso vai no SYSTEM, e o formulário vazio NÃO entra na conversa. Em
    // 21/09 10:59 ele entrou como fala da IA, o modelo o imitou e o cliente
    // recebeu o JSON cru, com as crases de código em volta.
    response = await chamarModelo(MAX_TOKENS_RESPOSTA_FOLGA, false, null,
      '\n\n## Atenção nesta resposta\nO campo "resposta" NÃO pode ficar vazio: o cliente está falando de '
      + 'orçamento ou respondendo você. Escreva nele a mensagem para o cliente, em texto normal.');
    usos.push(response.usage);
  }

  // **Fase 2 das duas fases: o formulário, sem ferramentas e sem histórico.**
  //
  // A fase 1 terminou em texto puro. Aqui ele vira o mesmo JSON que o resto da
  // função sempre leu, e nada abaixo precisa saber que houve duas fases. Se a
  // fase 2 falhar de qualquer jeito — 500, 400, JSON quebrado —, o cliente
  // recebe o texto da fase 1 com os metadados neutros: perder a ficha daquele
  // turno é incomparavelmente melhor que perder a resposta.
  //
  // Resgate e resposta cortada não passam por aqui: o resgate já devolve o
  // formato de sempre, e a resposta cortada cai no erro de sempre logo abaixo.
  if (duasFases && !resgatado && response.stop_reason !== 'max_tokens') {
    const mensagemDaFase1 = textoDaFase1(response);

    let texto = mensagemDaFase1;
    let perfil = FORMULARIO_NEUTRO.atualizacao_perfil;
    // Fase 1 vazia é silêncio (ou falha que o resto da função já trata): não há
    // o que serializar, e o formulário neutro com a resposta vazia segue o
    // mesmo caminho de uma resposta vazia no modo de uma chamada só.
    if (mensagemDaFase1) try {
      const falaDoCliente = conversaveis
        .slice(conversaveis.map(m => m.autor).lastIndexOf('ia') + 1)
        .filter(m => m.autor === 'cliente')
        .map(m => m.texto)
        .join('\n');
      const r2 = await client.messages.create(
        pedidoDoSerializador(MODELO_IA, { falaDoCliente, mensagemDaFase1, fichaAtual: linhasPerfil }),
      ) as Anthropic.Message;
      usos.push(r2.usage);
      const saida = lerSaidaDoSerializador(r2);
      if (saida) {
        const escolha = textoParaOCliente(mensagemDaFase1, saida.copia);
        if (!escolha.usouACopia) {
          console.error('Serializador divergiu da mensagem da fase 1; valeu a original.');
          marcar(rastreio, 'serializador_divergiu');
        }
        texto = escolha.texto;
        perfil = saida.perfil;
      } else {
        console.error('Serializador não devolveu formulário legível; metadados neutros.');
        marcar(rastreio, 'serializador_ilegivel');
      }
    } catch (err) {
      marcar(rastreio, 'serializador_falhou');
      console.error('Serializador falhou; respondendo com a fase 1 e metadados neutros:',
        err instanceof Error ? err.message : err);
    }

    response = {
      ...response,
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify({ ...FORMULARIO_NEUTRO, resposta: texto, atualizacao_perfil: perfil }) }],
    } as Anthropic.Message;
  }

  // O .catch aqui blinda o caso de a promise ficar órfã se o parse abaixo lançar.
  const logPromise = Promise.all(
    usos.map(usage => logAiUsage(supabase, {
      orgId, origem: 'motor', model: MODELO_IA, usage, conversationId, turnoId: turnoIdGravado(rastreio),
    })),
  ).catch(() => { /* best-effort */ });

  // JSON cortado no meio não dá pra recuperar: melhor falhar com um erro que
  // aponta a causa do que estourar um SyntaxError genérico no parse abaixo.
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Resposta da IA truncada pelo limite de tokens — JSON incompleto.');
  }

  // Agrupamento de mensagens seguidas. Se o cliente escreveu de novo enquanto
  // o modelo pensava, esta resposta já nasceu velha: responde só o que ele
  // disse antes. Ela é descartada, e a tarefa da mensagem nova responde tudo
  // de uma vez. Não existe espera: a primeira mensagem sai tão rápido quanto
  // antes, e só a resposta que ia sair atropelada é jogada fora.
  //
  // A checagem fica AQUI, antes de gravar venda, agendamento e ficha: essas
  // gravações pertencem à resposta que o cliente vai receber, e descartar o
  // texto depois de gravar deixaria um agendamento que ninguém confirmou.
  // No atendimento, `humano` entra na mesma checagem: o atendente respondeu
  // pelo painel (ou, com a coexistência, pelo celular) enquanto o modelo
  // pensava, e mandar a resposta agora daria duas falas da casa seguidas. No
  // vendas isso não vale — ver `iaSegueMesmoComHumano` lá em cima.
  const autoresQueAtropelam: ('cliente' | 'humano')[] = iaSegueMesmoComHumano ? ['cliente'] : ['cliente', 'humano'];
  const { data: ultimaFala } = await supabase
    .from('messages')
    .select('id, autor')
    .in('conversation_id', convIdsDoContato)
    .in('autor', autoresQueAtropelam)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rastreio) {
    rastreio.estadoDepois = {
      erp_cliente_id: ctxFerramentas.erpClienteId ?? null,
      cliente_identificado_agora: ctxFerramentas.clienteIdentificadoAgora ?? false,
      documento_trocado: ctxFerramentas.documentoTrocado ?? false,
    };
  }
  if (ultimaFala && ultimaFala.id !== idUltimaDoCliente) {
    marcar(rastreio, 'resposta_velha_descartada');
    await logPromise;
    // Com uma exceção: se as ferramentas já criaram alguma coisa **no mundo**
    // (um orçamento no sistema do cliente), o texto com os valores não pode ser
    // jogado fora junto com a resposta velha. O orçamento existe; o cliente
    // precisa recebê-lo. Some só a fala do modelo, que de fato ficou velha.
    if (mensagensDoSistema.length) {
      return { resposta: '', transferirParaAtendente: false, mensagensDoSistema };
    }
    return NAO_RESPONDER(ultimaFala.autor === 'humano' ? 'humano-respondeu' : 'chegou-mensagem-nova');
  }

  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') throw new Error('Resposta da IA sem conteúdo de texto.');
  const parsed = JSON.parse(textBlock.text) as {
    resposta: string;
    transferir_para_atendente: boolean;
    questionario_completo: boolean;
    respostas: { pergunta: string; resposta: string }[];
    resultado: 'venda' | 'agendamento' | 'contato' | 'nenhum';
    itens_vendidos: { produto: string; quantidade: number }[];
    agendamento_data: string;
    agendamento_hora: string;
    agendamento_servico: string;
    agendamento_remarcacao: boolean;
    confirmacao_agendamento?: ConfirmacaoDoLembrete;
    atualizacao_perfil: {
      preferencias: string[];
      dados_chave: { rotulo: string; valor: string }[];
      ultimo_interesse: string;
      observacoes: string;
    };
  };

  // **O formulário nunca vai ao cliente.** Em 21/09 10:59 o campo `resposta`
  // chegou com o próprio JSON dentro, entre crases de código, e o cliente o
  // recebeu no WhatsApp. Melhor não mandar nada — a varredura tenta de novo.
  if (pareceFormularioCru(parsed.resposta)) {
    await logPromise;
    marcar(rastreio, 'formulario_cru_recusado');
    throw new Error('A resposta da IA veio com o formulário dentro; nada foi enviado ao cliente.');
  }

  // Quando o questionário fica completo, grava as respostas na ficha do contato —
  // uma vez por conversa (histórico = uma resposta por conversa). Best-effort.
  if (parsed.questionario_completo && parsed.respostas.length > 0 && contactId) {
    try {
      const { data: existente } = await supabase
        .from('questionnaire_responses').select('id, resultado').eq('conversation_id', conversationId).limit(1).maybeSingle();
      const resultado = parsed.resultado !== 'nenhum' ? parsed.resultado : null;
      if (!existente) {
        await supabase.from('questionnaire_responses').insert({
          organization_id: orgId,
          contact_id: contactId,
          conversation_id: conversationId,
          respostas: parsed.respostas as never,
          resultado,
        });
      } else if (resultado && !existente.resultado) {
        // O desfecho quase sempre é decidido DEPOIS de o questionário fechar: o
        // cliente responde tudo e só então pede contato, agenda ou compra. Sem
        // este update o "sim" nunca chegaria à ficha, e toda resposta de
        // questionário ficaria gravada com desfecho vazio.
        await supabase.from('questionnaire_responses')
          .update({ resultado, respostas: parsed.respostas as never })
          .eq('id', existente.id);
      }
    } catch { /* não derruba a resposta se a gravação falhar */ }
  }

  // Venda fechada → registra como pendente de aprovação para o dono dar baixa no
  // estoque pelo sino. Fica FORA do `if (questionario_completo)` acima de
  // propósito: a maioria dos negócios não configura pergunta obrigatória, e
  // amarrar a venda ao questionário significaria nunca registrar venda nenhuma.
  if (parsed.resultado === 'venda' && Array.isArray(parsed.itens_vendidos) && parsed.itens_vendidos.length > 0) {
    await registrarVendaPendente(supabase, {
      orgId,
      conversationId,
      contactId,
      contatoNome,
      itens: parsed.itens_vendidos,
    });
  }

  // Agendamento confirmado pela IA → grava na agenda. Quando é remarcação, o
  // horário antigo é cancelado no mesmo passo (ver registrar-agendamento.ts).
  if (parsed.resultado === 'agendamento' && parsed.agendamento_data && parsed.agendamento_hora && contactId) {
    await registrarAgendamentoIA(supabase, {
      orgId,
      conversationId,
      contactId,
      contatoNome,
      data: parsed.agendamento_data,
      hora: parsed.agendamento_hora,
      servico: parsed.agendamento_servico,
      remarcacao: parsed.agendamento_remarcacao === true,
    });
  }

  // Resposta ao lembrete: o código grava, o modelo só classifica.
  if (lembretePendente && (parsed.confirmacao_agendamento === 'sim' || parsed.confirmacao_agendamento === 'nao')) {
    await registrarRespostaDoLembrete(supabase, {
      orgId, lembrete: lembretePendente, resposta: parsed.confirmacao_agendamento, contatoNome,
    });
  }

  // Merge determinístico do perfil: une preferências sem duplicar, faz upsert
  // de dadosChave por rótulo (case-insensitive), e só sobrescreve
  // ultimoInteresse/observacoes quando a IA de fato mandou algo novo.
  if (contactId && parsed.atualizacao_perfil) {
    try {
      const up = parsed.atualizacao_perfil;
      const mudou = up.preferencias.length > 0 || up.dados_chave.length > 0 || up.ultimo_interesse.trim() !== '' || up.observacoes.trim() !== '';
      if (mudou) {
        const preferencias = Array.from(new Set([...perfilAtual.preferencias, ...up.preferencias].map(s => s.trim()).filter(Boolean)));
        const dadosMap = new Map(perfilAtual.dadosChave.map(d => [d.rotulo.toLowerCase(), d]));
        for (const d of up.dados_chave) {
          if (!d.rotulo.trim()) continue;
          // Picote não entra na ficha. Ela volta ao prompt na resposta
          // seguinte, então gravar " C NP J" aqui é ensinar lixo ao modelo da
          // próxima vez — foi o que aconteceu em 20/09.
          if (pareceRotuloPicado(d.rotulo)) {
            console.error(`Rótulo picado descartado da ficha: ${JSON.stringify(d.rotulo)}`);
            continue;
          }
          dadosMap.set(d.rotulo.toLowerCase(), { rotulo: d.rotulo, valor: d.valor });
        }
        const novoPerfil: PerfilContato = {
          preferencias,
          dadosChave: Array.from(dadosMap.values()),
          ultimoInteresse: up.ultimo_interesse.trim() || perfilAtual.ultimoInteresse,
          observacoes: up.observacoes.trim() || perfilAtual.observacoes,
          atualizadoEm: new Date().toISOString(),
        };
        await supabase.from('contacts').update({ perfil: novoPerfil as never }).eq('id', contactId);
      }
    } catch { /* atualização de perfil é best-effort, não derruba a resposta */ }
  }

  await logPromise;

  // O campo só aparece quando existe: sem ele, o objeto devolvido é byte a byte
  // o mesmo de antes do bloco C, e nenhum teste do Atendimento precisa mudar.
  const resultado: RespostaIA = {
    resposta: parsed.resposta,
    transferirParaAtendente: parsed.transferir_para_atendente,
  };
  if (mensagensDoSistema.length) resultado.mensagensDoSistema = mensagensDoSistema;
  if (roteiro === 'vendas' && !parsed.resposta.trim() && !mensagensDoSistema.length && podeCalar) {
    resultado.resposta = '';
    resultado.silencioPelaInstrucao = true;
  }
  return resultado;
}

/** O texto parece JSON ou bloco de código, e não uma mensagem de WhatsApp? */
export function pareceFormularioCru(texto: string): boolean {
  const t = texto.trim();
  return t.startsWith('```') || t.startsWith('{') || /"resposta"\s*:/.test(t);
}

/**
 * Uma resposta em texto puro, no formato que o resto do motor espera: o texto
 * vai para o campo `resposta` do formulário neutro. Pedido de ferramenta passa
 * como veio, porque o laço precisa dos blocos `tool_use`. Se o modelo escreveu
 * o formulário mesmo sem ser pedido, vale a mensagem de dentro dele.
 */
function embrulharTextoNoFormulario(r: Anthropic.Message): Anthropic.Message {
  if (r.stop_reason === 'tool_use') return r;
  let resposta = r.content
    .map(b => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  if (pareceFormularioCru(resposta)) resposta = respostaDentroDoFormulario(resposta);
  return {
    ...r,
    content: [{ type: 'text', text: JSON.stringify({ ...FORMULARIO_NEUTRO, resposta }) }],
  } as Anthropic.Message;
}

/** A mensagem escrita dentro de um formulário que veio como texto (com ou sem as
 *  crases de código), ou vazio se não der para ler ou o campo estiver vazio. */
function respostaDentroDoFormulario(texto: string): string {
  const semCrases = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    const { resposta } = JSON.parse(semCrases) as { resposta?: unknown };
    return typeof resposta === 'string' ? resposta.trim() : '';
  } catch {
    return '';
  }
}

/**
 * O texto que a fase 1 das duas fases escreveu. Se o modelo escreveu o
 * formulário mesmo sem ser pedido (o histórico e o hábito puxam), vale a
 * mensagem de dentro dele, como no texto puro de "até o cadastro". JSON cru
 * nunca é a mensagem.
 */
function textoDaFase1(response: Anthropic.Message): string {
  const texto = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
  return pareceFormularioCru(texto) ? respostaDentroDoFormulario(texto) : texto;
}

/** O campo `resposta` do JSON desta volta, ou vazio se não der para ler. */
function respostaDoFormulario(response: Anthropic.Message): string {
  const bloco = response.content.find(b => b.type === 'text');
  if (!bloco || bloco.type !== 'text') return '';
  try {
    const { resposta } = JSON.parse(bloco.text) as { resposta?: string };
    return typeof resposta === 'string' ? resposta : '';
  } catch {
    return '';
  }
}

/** O campo `resposta` do JSON desta volta parece picado? Lê sem derrubar nada:
 *  JSON quebrado ou resposta ausente não é assunto desta checagem — quem trata
 *  disso é o parse lá embaixo, com a mensagem de erro certa. */
function respostaSaiuPicada(response: Anthropic.Message, textoPuro = false): boolean {
  const bloco = response.content.find(b => b.type === 'text');
  if (!bloco || bloco.type !== 'text') return false;
  // Na fase 1 das duas fases não existe JSON: o texto é a própria mensagem.
  if (textoPuro) return pareceTextoFragmentado(bloco.text);
  try {
    const { resposta } = JSON.parse(bloco.text) as { resposta?: string };
    return typeof resposta === 'string' && pareceTextoFragmentado(resposta);
  } catch {
    return false;
  }
}

/**
 * Com o fiscal ligado, a confirmação da lista passa pela ferramenta. Medido na
 * primeira rodada paga (02/10): sem esta seção, em 4 de 5 mensagens a IA
 * cumpriu a instrução do painel ("produtos e quantidades confirmados pelo
 * cliente") escrevendo a lista ela mesma, e o fiscal nem rodou. A instrução do
 * painel não muda: ela vale para a produção, onde a chave está desligada.
 */
const INSTRUCAO_DO_FISCAL = `

## Confirmação da lista
Para confirmar os produtos e as quantidades com o cliente, chame SEMPRE a ferramenta confirmar_itens com todos os itens que ele pediu (inclusive os que você não achou, sem código). É ela que manda a lista ao cliente. NUNCA escreva a lista de itens na sua resposta: escreva só uma frase curta antes dela. Item em dúvida (não sabe a espessura, a marca, o tamanho) vai na mesma chamada, SEM código: o sistema põe na lista as opções que servem e pergunta ao cliente. Não pergunte você antes da lista.`;

/** As mensagens que o sistema escreve (lista do fiscal, orçamento, consulta de preço). */
const MENSAGEM_DO_SISTEMA = new RegExp(`^(?:${CABECALHO_DA_LISTA}|Orçamento(?: \S+)?\n\n|Consulta de preço\n\n)`);

/** O que o cliente escreveu depois da última lista ou orçamento enviado pelo sistema. */
function falasDesdeAUltimaLista(conversaveis: { autor: string; texto: string }[]): string {
  const inicio = conversaveis.map(m => m.autor === 'ia' && MENSAGEM_DO_SISTEMA.test(m.texto)).lastIndexOf(true);
  return conversaveis.slice(inicio + 1).filter(m => m.autor === 'cliente').map(m => m.texto).join('\n');
}

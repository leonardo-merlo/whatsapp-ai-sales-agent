// Monta o system prompt do simulador a partir da configuração do agente
// (ai_agent_config) e do conhecimento do negócio (business_*) de uma org.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import type { NumeroNaTela, RascunhoDaTela } from './rascunho';
import { mapConhecimentoOrg } from '../data/mappers';
import { buscarConfigsSeparadas, combinarComOPadrao } from '../agente/config-do-numero';
import { horariosLivres } from '../agenda/slots';
import type { Sucessos, TipoSucesso } from '../types';
import { buscarProdutosPorGrupo, catalogoParaPrompt } from '../catalogo/consultar';
import { fmtDiaISO, hojeEmSP } from '../fuso';
import { soAteOCadastro } from '../agente/so-ate-o-cadastro';
import { ehSaude, lerDadosDeSaude, REGRAS_DA_SAUDE, secaoDeConveniosEValores } from '../saude';

type Client = SupabaseClient<Database>;

const SUCESSO_LABEL: Record<TipoSucesso, string> = {
  venda: 'venda concluída',
  agendamento: 'agendamento feito',
  contato: 'contato registrado para retorno',
};

const TOM_FRASE: Record<Database['public']['Enums']['agente_tom'], string> = {
  simpatico: 'Seu tom de voz é simpático e acolhedor, com uma linguagem calorosa.',
  direto: 'Seu tom de voz é direto e objetivo, sem rodeios.',
  formal: 'Seu tom de voz é formal e educado, tratando o cliente com cordialidade e respeito.',
  descontraido: 'Seu tom de voz é descontraído e informal, como uma conversa leve entre amigos.',
};

const DIA_SEMANA_LABEL = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * Quantos produtos ainda cabem inteiros no prompt.
 *
 * Acima disso vai só o índice, e a IA consulta o resto pela ferramenta. O
 * número é generoso de propósito: o objetivo não é economizar o máximo, é não
 * deixar a lista longa demais para o modelo escolher dentro dela. Quem já está
 * no ar tem menos de 40 itens e não muda de comportamento.
 *
 * Referência medida em 13/09 contra a API, com o catálogo da Distribuidora Exemplo: 1055
 * produtos inteiros custam 34.816 tokens por mensagem; só o índice, 6.747.
 */
export const MAX_PRODUTOS_NO_PROMPT = 40;

function ddmm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

/** @param waNumberId Número por onde a conversa entrou. Com ele, vale o roteiro
 *  daquele número quando existe um; sem ele (o simulador), vale o da empresa.
 *  @param rascunho O que está na tela Conhecimento, salvo ou não. Só o
 *  simulador passa; ele toma o lugar do que está gravado nos mesmos campos.
 *  @param numeroNaTela O que está na tela do número escolhido (só o simulador). */
export async function buildSystemPrompt(
  supabase: Client,
  orgId: string,
  waNumberId?: string | null,
  rascunho?: RascunhoDaTela | null,
  numeroNaTela?: NumeroNaTela | null,
): Promise<{
  systemPrompt: string;
  welcomeMsg: string;
  roteiro: string;
  produtosPorIndice: boolean;
  usaListaDigitada: boolean;
}> {
  const hojeISO = hojeEmSP();

  const [org, configs, prices, hours, faqs, perguntas, gatilhos, diasLivres] = await Promise.all([
    supabase.from('organizations').select('nome, nome_fantasia, descricao, endereco, telefone, segmento, dados_saude').eq('id', orgId).single(),
    buscarConfigsSeparadas(supabase, orgId, waNumberId),
    supabase.from('business_prices').select('*').eq('organization_id', orgId),
    supabase.from('business_hours').select('*').eq('organization_id', orgId),
    supabase.from('business_faqs').select('*').eq('organization_id', orgId),
    supabase.from('business_qualification_questions').select('*').eq('organization_id', orgId),
    supabase.from('business_triggers').select('*').eq('organization_id', orgId),
    horariosLivres(supabase, orgId, hojeISO),
  ]);

  const gravado = mapConhecimentoOrg({
    prices: prices.data ?? [],
    hours: hours.data ?? [],
    faqs: faqs.data ?? [],
    perguntas: perguntas.data ?? [],
    gatilhos: gatilhos.data ?? [],
  });
  const conhecimento = rascunho
    ? { precos: rascunho.precos, horario: rascunho.horario ?? gravado.horario, faqs: rascunho.faqs, perguntas: rascunho.perguntas, gatilhos: rascunho.gatilhos }
    : gravado;

  const orgRow = org.data && rascunho
    ? {
      ...org.data, nome_fantasia: rascunho.nomeNegocio, descricao: rascunho.descricaoNegocio,
      endereco: rascunho.endereco || null, dados_saude: (rascunho.dadosSaude ?? org.data.dados_saude) as unknown as Json,
    }
    : org.data;
  // O que está na tela troca cada linha ANTES da junção: o padrão pelo que está
  // na tela do padrão, e o número pelo que está na tela do número. Roteiro e o
  // resto seguem do banco. Sem nada da tela, é a mesma junção do WhatsApp.
  const padrao = configs.padrao && rascunho
    ? {
      ...configs.padrao,
      tom: rascunho.tom,
      prompt: rascunho.agentPrompt,
      limitacoes: rascunho.limitacoes,
      welcome_msg: rascunho.welcomeMsg,
      info_adicional: rascunho.infoAdicional,
      sucessos: rascunho.sucessos as unknown as Json,
    }
    : configs.padrao;
  const campos = numeroNaTela?.campos ?? null;
  const linhaDoNumero = configs.doNumero ?? (campos && padrao ? { ...padrao, wa_number_id: waNumberId ?? null } : null);
  const doNumero = linhaDoNumero && campos
    ? {
      ...linhaDoNumero,
      tom: campos.tom,
      prompt: campos.prompt,
      limitacoes: campos.limitacoes,
      welcome_msg: campos.welcomeMsg,
      info_adicional: campos.infoAdicional,
    }
    : linhaDoNumero;
  const c = waNumberId ? combinarComOPadrao(doNumero, padrao) : padrao;
  const ateOCadastro = soAteOCadastro(orgId, c?.roteiro ?? 'atendimento');

  const partes: string[] = [];

  // O cliente conhece o negócio pelo nome fantasia — a razão social só aparece
  // na cobrança e soaria estranha numa conversa de WhatsApp.
  const nomeExibicao = orgRow?.nome_fantasia || orgRow?.nome || 'um negócio';
  partes.push(`Você é o agente de atendimento no WhatsApp de "${nomeExibicao}".`);

  // S8: clínica. As regras vêm logo depois da identidade, antes de qualquer
  // instrução do painel: o que está no topo do prompt vence. Só no roteiro de
  // atendimento; número de vendas não é consultório.
  const clinica = ehSaude(orgRow?.segmento) && (c?.roteiro ?? 'atendimento') === 'atendimento';
  if (clinica) partes.push(REGRAS_DA_SAUDE);

  // Vem antes de tudo: é o contexto que faz a IA entender que negócio é esse e
  // quais diferenciais usar para sustentar preço em vez de só informar valores.
  if (orgRow?.descricao) {
    partes.push(`\n## Sobre o negócio\n${orgRow.descricao}\n\nUse os diferenciais acima quando o cliente comparar preço, hesitar ou pedir desconto — em vez de apenas repetir o valor.`);
  }

  partes.push(`\n## Tom de voz\n${TOM_FRASE[c?.tom ?? 'simpatico']}`);
  if (c?.prompt) partes.push(`\n## Instrução principal\n${c.prompt}`);
  if (c?.limitacoes) partes.push(`\n## Limitações e restrições\n${c.limitacoes}`);

  // **Consulte primeiro, escreva depois** — o conserto do que o primeiro teste
  // real mostrou em 14/09: o Haiku anunciava a consulta e encerrava a resposta
  // sem chamar a ferramenta ("deixa eu buscar esses produtos", "vou processar o
  // orçamento agora"). Foram quatro mensagens do cliente até chegar na cotação,
  // quando uma bastava.
  //
  // A forma do texto é deliberada, e vem da lição já registrada do projeto:
  // poucos passos, número em vez de adjetivo, e proibição com as palavras
  // exatas que ele usou. "Seja objetivo" não muda nada; "estas frases estão
  // proibidas" muda.
  if ((c?.roteiro ?? 'atendimento') === 'vendas') {
    partes.push(`\n## Como você trabalha (vale acima de qualquer instrução acima)
1. Consulte primeiro, escreva depois. NUNCA anuncie que vai buscar, consultar, verificar ou processar:
   chame a ferramenta e só escreva quando tiver o resultado na mão.
2. Estas frases estão proibidas: "deixa eu buscar", "vou consultar", "vou verificar", "vou processar",
   "um momento", "já te retorno com isso", "aguarde". Se você ia escrever uma delas, chame a
   ferramenta em vez disso.
3. Use quantas ferramentas precisar na MESMA resposta.${ateOCadastro ? '' : ` Identificar o cliente, achar os produtos e
   consultar o preço podem sair todos de uma vez.`}
4. Peça no máximo 1 informação por mensagem, e só a que falta para o próximo passo.`);
  }

  // ── O que é do roteiro de ATENDIMENTO, e só dele ──
  //
  // Agenda, qualificação, regras de transferência e mensagem de fechamento
  // descrevem o trabalho de um atendente: descobrir o que o cliente quer,
  // marcar horário, passar para uma pessoa. Num número de VENDAS elas não só
  // não ajudam — atrapalham. Medido numa conversa de verdade em 14/09: com o
  // questionário no prompt, a IA parava para perguntar "é retirada ou entrega,
  // e em qual cidade?" antes de cotar, e o orçamento não saía nunca. A agenda
  // é pior ainda: lista horários livres de consultório para quem está
  // comprando vergalhão.
  //
  // É a mesma separação que o Leonardo desenhou para a tela em 14/09 — "muda
  // só o que é específico do roteiro; atendimento: agenda, qualificação,
  // quando passar para uma pessoa". Aqui ela vale para o prompt.
  const soAtendimento = (c?.roteiro ?? 'atendimento') !== 'vendas';

  // ── Produtos: quem decide é o TAMANHO, não o roteiro ──
  //
  // Até 14/09 a regra era o roteiro: vendas usava o catálogo importado, e
  // atendimento usava a lista digitada da aba Empresa. Isso amarrava duas
  // coisas que não têm relação. **Uma clínica com 400 procedimentos tem o mesmo
  // problema da Distribuidora Exemplo**: a lista inteira no prompt custa caro em toda
  // mensagem, e quanto mais longa, mais o modelo erra escolhendo dentro dela.
  //
  // A regra passou a ser aritmética:
  //
  //   poucos itens  → a lista INTEIRA entra no prompt, como sempre foi;
  //   muitos itens  → entra só o ÍNDICE, e a IA consulta pela ferramenta.
  //
  // O teto está em `MAX_PRODUTOS_NO_PROMPT`. Abaixo dele nada muda para
  // ninguém que já está no ar — e é por isso que o corte é generoso: é melhor
  // deixar um cliente de 40 itens exatamente como estava do que economizar
  // tokens que ninguém sentiu falta.
  // Organização que por enquanto vai só até o cadastro (`so-ate-o-cadastro.ts`):
  // sem ferramenta de catálogo, o índice no prompt só convidaria o modelo a
  // falar de produto que ele não consegue abrir.
  const catalogoGravado = ateOCadastro ? null : await catalogoParaPrompt(supabase, orgId);
  // O simulador lê o dicionário e as regras que estão na tela, salvos ou não.
  const catalogo = catalogoGravado && rascunho?.textosDoCatalogo
    ? { ...catalogoGravado, ...rascunho.textosDoCatalogo }
    : catalogoGravado;
  // **Vendas COM catálogo não vê a lista digitada.** Ela não tem código, e sem
  // código o sistema do cliente não cota nada: oferecê-la ao modelo é oferecer
  // o que ninguém consegue orçar. Numa conversa de teste em 14/09 foi assim que
  // a IA propôs um prego da lista digitada e o ERP casou com outro — PREGO
  // 22 X 48 no lugar do 17 X 21, que é o erro que o projeto mais teme.
  //
  // **Vendas SEM catálogo continua vendo**, que é a decisão do C6 e segue
  // valendo: catálogo vazio nunca pode virar "a empresa não vende nada".
  const usaListaDigitada = soAtendimento || !catalogo;
  const digitados = usaListaDigitada && !ateOCadastro ? conhecimento.precos : [];
  const totalDeProdutos = digitados.length + (catalogo?.produtos ?? 0);
  const porIndice = totalDeProdutos > MAX_PRODUTOS_NO_PROMPT;

  // Catálogo pequeno vai INTEIRO, linha por linha, como a lista digitada
  // sempre foi. Sem isto, uma organização com dez produtos importados e nenhum
  // digitado ficaria sem seção de produto nenhuma no prompt — o pior dos dois
  // mundos: pequena demais para o índice valer a pena, e invisível para a IA.
  const linhasDoCatalogo = !porIndice && catalogo
    ? await buscarProdutosPorGrupo(supabase, orgId, catalogo.grupos.map(g => g.codigo))
    : null;

  if (porIndice) {
    const assuntos: string[] = [];
    if (catalogo) {
      assuntos.push(...catalogo.grupos.map(g => `- ${g.codigo} — ${g.nome}`));
    }
    // A lista digitada não tem assuntos: o índice dela são os próprios nomes,
    // sem descrição, observação nem estoque. Os nomes são curtos; o que pesava
    // no prompt eram os três campos longos de cada item.
    if (digitados.length) {
      assuntos.push(...digitados.map(p => `- ${p.proc}`));
    }
    partes.push(`\n## Catálogo de produtos
A empresa tem ${totalDeProdutos} produto(s). Você NÃO tem o catálogo de cor e NUNCA deve citar código,
descrição ou preço de memória: para falar de qualquer produto, chame a ferramenta buscar_produtos com o
assunto (ou com um pedaço do nome) e escolha só entre as linhas que ela devolver.

Assuntos e itens do catálogo:
${assuntos.join('\n')}`);
    if (catalogo?.dicionario) {
      partes.push(`\n### Como o cliente escreve e como o catálogo registra\n${catalogo.dicionario}`);
    }
    if (catalogo?.regras) {
      partes.push(`\n### Quando perguntar em vez de escolher\n${catalogo.regras}`);
    }
  } else if (digitados.length || linhasDoCatalogo?.produtos.length) {
    const doCatalogo = (linhasDoCatalogo?.produtos ?? []).map(p => {
      const preco = p.preco === null || p.preco === undefined
        ? 'preço não informado'
        : `R$ ${p.preco.toFixed(2).replace('.', ',')}`;
      return `- ${p.descricao} (código ${p.codigo}): ${preco}${p.unidade ? ` / ${p.unidade}` : ''}`;
    });
    partes.push(`\n## Produtos e serviços\n${[...doCatalogo, ...digitados.map(p => {
      const linhas = [`- ${p.proc}: ${p.valor}`];
      if (p.descricao) linhas.push(`  ${p.descricao}`);
      // Com controle de estoque ligado, o número manda: evita a IA prometer
      // produto esgotado. Sem controle, sobra a nota livre ("sob encomenda").
      if (p.controlaEstoque) {
        linhas.push(p.estoqueQtd === null || p.estoqueQtd === undefined
          ? '  Estoque: não informado'
          : p.estoqueQtd > 0
            ? `  Estoque: ${p.estoqueQtd} disponível(is)`
            : '  Estoque: ESGOTADO — não prometa entrega; ofereça alternativa ou anote o contato para avisar quando chegar');
      } else if (p.estoque) {
        linhas.push(`  Disponibilidade: ${p.estoque}`);
      }
      if (p.observacoes) linhas.push(`  Obs.: ${p.observacoes}`);
      return linhas.join('\n');
    })].join('\n')}`);
  }
  if (clinica) partes.push(secaoDeConveniosEValores(lerDadosDeSaude(orgRow?.dados_saude)));
  if (conhecimento.horario.length) {
    partes.push(`\n## Horário de funcionamento\n${conhecimento.horario.map(h => `- ${h.dia}: ${h.hora}`).join('\n')}`);
  }
  if (orgRow?.endereco) {
    partes.push(`\n## Localização\n${orgRow.endereco}`);
  }

  const hojeLabel = fmtDiaISO(hojeISO, { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!soAtendimento) {
    // Vendas não agenda nada: a seção inteira sai.
  } else if (diasLivres.length) {
    const labelDia = (iso: string) => {
      const dt = new Date(`${iso}T12:00:00`);
      return `${DIA_SEMANA_LABEL[dt.getDay()]} ${ddmm(iso)}`;
    };
    const linhasDias = diasLivres.map(dia => {
      const trechos = dia.janelas.map(j => j.grupo
        ? `livre das ${j.inicio} às ${j.fim} (aula em grupo, vagas abertas)`
        : `horários livres: ${j.horasLivres.join(', ')}`);
      return `- ${labelDia(dia.data)}: ${trechos.join('; ')}`;
    });
    partes.push(`\n## Agenda e disponibilidade\nHoje é ${hojeLabel}. Estes são os ÚNICOS horários livres para agendar — ofereça apenas horários desta lista e nunca invente ou confirme um horário que não esteja aqui:\n${linhasDias.join('\n')}\n\nAo fechar um agendamento, confirme com o cliente a data, o horário e o serviço.`);
  } else {
    partes.push(`\n## Agenda e disponibilidade\nHoje é ${hojeLabel}. No momento não há horários livres para agendar nos próximos dias. Não confirme nenhum agendamento; ofereça anotar o contato para retornar.`);
  }
  if (conhecimento.faqs.length) {
    partes.push(`\n## Dúvidas frequentes\n${conhecimento.faqs.map(f => `P: ${f.q}\nR: ${f.a}`).join('\n\n')}`);
  }
  const cfgSucessos = (c?.sucessos as unknown as Sucessos | null) ?? null;
  const objetivosAtivos = cfgSucessos ? (Object.keys(SUCESSO_LABEL) as TipoSucesso[]).filter(k => cfgSucessos[k]?.ativo) : [];
  if (soAtendimento && conhecimento.perguntas.length && objetivosAtivos.length) {
    const blocos = objetivosAtivos.map(obj => {
      const qs = conhecimento.perguntas.filter(p => p.objetivo === obj);
      if (!qs.length) return '';
      return `Para ${SUCESSO_LABEL[obj]}:\n${qs.map(p => `- ${p.pergunta}${p.obrigatoria ? ' (obrigatória — pergunte sempre até obter a resposta)' : ' (opcional — pergunte no máximo uma vez)'}`).join('\n')}`;
    }).filter(Boolean);
    if (blocos.length) {
      partes.push(`\n## Qualificação do cliente\nAntes de concretizar cada objetivo abaixo, procure descobrir estas informações (sem interrogar de uma vez):\n${blocos.join('\n\n')}`);
    }
  }
  const regrasAtivas = soAtendimento ? conhecimento.gatilhos.filter(g => g.ativo) : [];
  if (regrasAtivas.length) {
    partes.push(`\n## Regras automáticas (prioridade máxima)\nAntes de responder, verifique estas regras. Se a mensagem do cliente se encaixar em alguma delas, siga a ação correspondente — elas têm prioridade sobre as demais instruções:\n${regrasAtivas.map(g => {
      const acao = g.acao === 'responder' && g.mensagem
        ? `responda exatamente com esta mensagem: "${g.mensagem}"`
        : 'trate como um caso de "direcionar para um humano" (avise que vai chamar um atendente e transfira a conversa)';
      return `- Quando ${g.gatilho}: ${acao}.`;
    }).join('\n')}`);
  }

  if (c?.info_adicional) {
    partes.push(`\n## Informações adicionais\n${c.info_adicional}`);
  }

  const sucessos = soAtendimento ? ((c?.sucessos as unknown as Sucessos | null) ?? null) : null;
  if (sucessos) {
    const ativos = (Object.keys(SUCESSO_LABEL) as TipoSucesso[]).filter(k => sucessos[k]?.ativo && sucessos[k]?.mensagem);
    if (ativos.length) {
      partes.push(`\n## Como concluir o atendimento\nQuando já tiver as informações obrigatórias acima, conduza o cliente para um destes desfechos e, ao concretizá-lo, envie a mensagem de fechamento correspondente:\n${ativos.map(k => `- ${SUCESSO_LABEL[k]}: "${sucessos[k].mensagem}"`).join('\n')}`);
    }
  }

  partes.push('\nResponda sempre em português do Brasil, em tom natural de WhatsApp: numa única mensagem, curta, sem formatação markdown (não use **negrito**, listas com `-` ou `#`). Quando a resposta tiver mais de uma ideia, separe em parágrafos curtos com uma linha em branco entre eles, para não virar um bloco de texto único e difícil de ler.');

  // O roteiro sai junto porque o motor decide por ele o que fazer quando um
  // humano já falou: no atendimento a IA se cala, no vendas ela continua.
  // `produtosPorIndice` sai junto porque é ele que decide se a ferramenta de
  // busca precisa existir nesta conversa: sem índice no prompt, a lista inteira
  // já está lá e a ferramenta não teria o que acrescentar.
  return {
    systemPrompt: partes.join('\n'),
    welcomeMsg: c?.welcome_msg ?? '',
    roteiro: c?.roteiro ?? 'atendimento',
    produtosPorIndice: porIndice,
    // Sai junto para a ferramenta enxergar a MESMA lista que o prompt anunciou.
    // Se os dois divergirem, o modelo pede um produto que o índice mostrou e a
    // busca jura que não existe.
    usaListaDigitada,
  };
}

import type { CadastroDoErp } from './erp/cadastro-do-contato';
import type { DadosDeSaude, DadosDeSaudeNaTela } from './saude';

/** Como ler o catálogo: a gíria do cliente (dicionário) e quando perguntar em vez de escolher (regras). */
export interface TextosDoCatalogo { dicionario: string; regras: string; }

/** Produto ou serviço do catálogo (business_prices).
 *  `id` é o id da linha no banco — presente em quem já foi salvo, ausente em
 *  item novo ainda não gravado. É o que permite `sale_items` apontar para o
 *  produto: o salvamento atualiza a linha existente em vez de recriá-la.
 *  `estoque` (texto livre) segue sendo só nota de disponibilidade; a baixa
 *  automática usa `estoqueQtd`, e só quando `controlaEstoque` está ligado. */
export interface Preco {
  id?: string;
  proc: string;
  valor: string;
  descricao?: string;
  observacoes?: string;
  estoque?: string;
  controlaEstoque?: boolean;
  estoqueQtd?: number | null;
  estoqueMinimo?: number | null;
}
export interface HorarioDia { dia: string; hora: string; cor?: string; }
export interface Faq { q: string; a: string; }
export interface Pergunta { pergunta: string; obrigatoria: boolean; objetivo: TipoSucesso; }
export interface Gatilho { gatilho: string; ativo: boolean; acao: 'transferir' | 'responder'; mensagem: string; }
export type Tom = 'simpatico' | 'direto' | 'formal' | 'descontraido';

/**
 * Abas da seção Conhecimento (o menu passou a chamá-la assim; a tela continua
 * sendo a do agente).
 *
 * `empresa` = os fatos do negócio (nome, descrição, horário, localização,
 * dúvidas). Valem para TODOS os números, sempre, em qualquer roteiro.
 *
 * `produtos` = a lista que o agente consulta. **Saiu de dentro de Empresa em
 * 15/09**: com 1.105 itens ela é a maior coisa da tela, e ficar no meio dos
 * outros campos empurrava horário e dúvidas para fora do alcance — quem ia
 * conferir um produto rolava por tudo antes de chegar nele.
 *
 * `agente` = como o agente se comporta. É aqui que mora o seletor de número.
 *
 * **A aba se chamava "atendimento" até 14/09, e o nome era o problema:**
 * Atendimento é também o nome de um dos três roteiros (atendimento, vendas,
 * copiloto). A mesma palavra servindo de nome de aba e de comportamento fazia
 * a tela parecer dizer que os campos ali só valiam para números de
 * atendimento — que era exatamente a dúvida do Leonardo ao usar a tela.
 */
export type AgenteTabKey = 'empresa' | 'produtos' | 'agente';

export type TipoSucesso = 'venda' | 'agendamento' | 'contato';
export interface SucessoConfig { ativo: boolean; mensagem: string; }
export type Sucessos = Record<TipoSucesso, SucessoConfig>;

export const SUCESSOS_PADRAO: Sucessos = {
  venda: { ativo: false, mensagem: 'Perfeito! 🎉 Seu pedido está confirmado. Nossa equipe já vai dar sequência. Muito obrigado pela preferência!' },
  agendamento: { ativo: false, mensagem: 'Prontinho! ✅ Seu agendamento está confirmado. Você vai receber um lembrete antes do horário. Até lá!' },
  contato: { ativo: false, mensagem: 'Obrigado! 😊 Recebi seus dados e nossa equipe entra em contato em breve.' },
};

export interface Historico { id: string; data: string; canal: string; resumo: string; }
export interface ProximoCompromisso { data: string; hora: string; servico: string; atendente: string; }
export interface RespostaItem { pergunta: string; resposta: string; }
export interface QuestionarioResposta { id: string; data: string; resultado: TipoSucesso | null; respostas: RespostaItem[]; }
export interface DadoChave { rotulo: string; valor: string; }
export interface PerfilContato {
  preferencias: string[];
  dadosChave: DadoChave[];
  ultimoInteresse: string;
  observacoes: string;
  atualizadoEm: string | null;
}
export const PERFIL_VAZIO: PerfilContato = { preferencias: [], dadosChave: [], ultimoInteresse: '', observacoes: '', atualizadoEm: null };
export interface Contato {
  /** Vazio quando o cliente escreveu com nome de usuário e a Meta não mandou o
   *  número (BSUID). Aí quem identifica na tela é `usuarioWhatsApp`. */
  id: string; nome: string; telefone: string; bairro: string;
  usuarioWhatsApp?: string;
  status: 'Ativo' | 'Inativo'; responsavel: string;
  ultimoContato: string;
  diasSemContato: number;
  proximoCompromisso: ProximoCompromisso | null;
  cpf: string; nascimento: string; email: string;
  /** Quem este contato é no sistema de gestão do cliente. Os três só existem no
   *  Wappia Vendas; numa organização de Atendimento ficam vazios para sempre.
   *  Não são editáveis na ficha: quem os escreve é a IA, a partir do que a
   *  consulta e o cadastro devolveram. */
  erpClienteId: string; documento: string;
  erpCadastro: CadastroDoErp | null;
  /** Todos os cadastros deste contato no sistema de gestao, mais recente
   *  primeiro. Um comprador que atende por duas empresas tem dois. */
  erpCadastros: CadastroDoErp[];
  historico: Historico[]; origem: string;
  customFields: Record<string, string>;
  labelIds: string[];
  questionarios: QuestionarioResposta[];
  perfil: PerfilContato;
}

export interface CustomFieldDef { key: string; label: string; }

/** Item vendido dentro de uma venda pendente de aprovação.
 *  `produtoId` nulo = a IA citou algo que não existe no catálogo; nesse caso não
 *  há baixa de estoque possível e o dono precisa conferir. */
export interface VendaItem {
  produtoId: string | null;
  nome: string;
  quantidade: number;
  valorUnitCentavos: number;
  controlaEstoque: boolean;
  estoqueAtual: number | null;
}

export interface Notificacao {
  id: string;
  tipo: 'venda_baixa_estoque' | 'estoque_minimo' | 'numero_pagamento_falhou' | 'template_nao_aprovado' | 'template_recategorizado'
    | 'limite_do_plano' | 'consulta_desmarcada' | 'aviso_nao_enviado' | 'erp_formato_novo';
  titulo: string;
  corpo: string;
  criadaEm: string;
  lida: boolean;
  saleId: string | null;
  contatoNome: string | null;
  itens: VendaItem[];
}

export interface Label { id: string; nome: string; cor: string; }

export interface RespostaPronta { id: string; titulo: string; texto: string; }

export interface Msg {
  id?: string;
  from: 'ia' | 'cliente' | 'humano' | 'nota' | 'sys';
  text: string; time?: string; read?: boolean; camp?: boolean;
  /** `messages.tipo`: 'texto', 'imagem', 'audio'… Foto e áudio chegam como texto
   *  (descrição e transcrição), e é o tipo que avisa quem lê. */
  tipo?: string;
}
export interface Conversa {
  id: string; mun: string; assunto: string; hora: string;
  /** Quando foi a última mensagem, em ISO. É por ela que a lista se ordena — o
   *  `hora` acima é texto ("Agora", "Ontem", "03/09") e não serve para ordenar.
   *  Nulo em conversa sem mensagem nenhuma. */
  ultimaMsgIso: string | null;
  unread: number; excedida: boolean; status: 'aberta' | 'encerrada';
  modo: 'ia' | 'humano'; atendente: string; tags: string[]; labelIds: string[]; msgs: Msg[];
  /** Por qual número a conversa entrou. Nulo em conversa anterior à tabela
   *  de números (20260908000002), que o banco nunca preencheu. */
  waNumberId: string | null;
}

/** Número conectado, no mínimo que o filtro de Conversas precisa. */
export interface NumeroDaOrg {
  id: string;
  telefone: string | null;
  papel: 'atendimento' | 'vendedor' | 'copiloto';
  ativo: boolean;
  /** Conta do WhatsApp do número: é ela que diz quais templates ele pode enviar. */
  wabaId: string | null;
}

export interface AgendaItem {
  id: string | null; // null = ainda não salvo no banco
  data: string; hora: string; cliente: string; servico: string; atendente: string;
  // Duração em minutos. null = herda da janela de disponibilidade que cobre o
  // horário; preenchida quando o usuário arrasta a altura do bloco na agenda.
  duracaoMin: number | null;
}

// Bloco de disponibilidade da agenda. tipo 'semanal' usa diaSemana (0=Dom..6=Sáb);
// tipo 'data' usa data (ISO). Uma linha com parentId é um override de uma
// ocorrência específica de uma recorrência (edição/cancelamento "só neste dia").
export interface Disponibilidade {
  id: string;
  atendenteId: string | null;
  tipo: 'semanal' | 'data';
  diaSemana: number | null;
  data: string | null;
  horaInicio: string;
  horaFim: string;
  parentId: string | null;
  cancelado: boolean;
  capacidade: number | null;
  duracaoMin: number | null;
}

export interface Campanha {
  id: string;
  nome: string; modelo: string; categoria: string; data: string;
  disparos: string; taxa: string; status: 'Ativa' | 'Agendada' | 'Encerrada';
  /** Envios que a Meta recusou. 0 em campanha anterior ao disparo de verdade. */
  falhas: number;
}

/** Template da Meta, do catálogo (wa_templates). Só APPROVED pode ser escolhido para envio. */
export interface Template {
  id: string;
  nome: string;
  categoria: string;
  corpo: string;
  status: string;
  variaveis: { nome: string; exemplo: string }[];
  wabaId: string;
  /** Escondido no Wappia: fora das listas de escolha, ainda aprovado na Meta. */
  oculto: boolean;
}

export interface Plano { key: string; nome: string; preco: string; precoCentavos: number; precoAnualCentavos: number; atend: string; msg: string; /** false = fora da vitrine; assinatura antiga continua valendo. */ visivel: boolean; }
export interface Fatura { id: string; valor: string; vencimento: string; status: 'pago' | 'pendente' | 'vencido'; pagoEm: string | null; }

// Resumo da assinatura ativa da org (null = período de teste). Governa o texto
// de "próxima cobrança / vale até" e o botão de cancelar na tela de plano.
export interface AssinaturaInfo {
  metodoPagamento: 'PIX' | 'CREDIT_CARD' | null;
  intervalo: 'mensal' | 'anual' | null;
  renovaAutomatico: boolean;
  validoAte: string | null; // DD/MM/YYYY
}

export interface Agente {
  id: string; // organization_members.id
  nome: string; cargo: string; online: boolean; ativo: boolean;
  pendente: boolean; // convite enviado, pessoa ainda não criou conta
  /** Entra no painel? `false` = só cadastrada (para o número do vendedor ter
   *  dono), sem login e sem ocupar vaga de atendente no plano. */
  acessaPainel: boolean;
  precos: Preco[]; horario: HorarioDia[]; faqs: Faq[]; conhecimento: string;
}

export interface PainelStats {
  dias: { dia: string; valor: number; hoje: boolean }[];
  horas: { hora: string; valor: number }[];
  tipos: { tipo: string; valor: number }[];
  interagindo: { d7: number; d30: number; d90: number };
  novosContatos: { d7: number; d30: number; d90: number };
  /** Vendas confirmadas (baixa aprovada), em centavos. */
  valorVendas: { d7: number; d30: number; d90: number };
  /** Quantidade de vendas confirmadas no período. */
  qtdVendas: { d7: number; d30: number; d90: number };
  /** Top 5 produtos por unidades vendidas nos últimos 90 dias. */
  produtosVendidos: { nome: string; unidades: number; valorCentavos: number }[];
  /** Conversas que a IA passou para uma pessoa nos últimos 30 dias. */
  transferencias30d: number;
}

/** Dados reais carregados do Supabase no layout do app e usados
 *  para semear o estado inicial do reducer. */
export interface InitialData {
  painel: PainelStats;
  contatos: Contato[];
  customFieldDefs: CustomFieldDef[];
  labels: Label[];
  respostasProntas: RespostaPronta[];
  conversas: Conversa[];
  agendaItens: AgendaItem[];
  disponibilidades: Disponibilidade[];
  campanhas: Campanha[];
  templates: Template[];
  campCategorias: string[];
  agentesData: Agente[];
  planos: Plano[];
  planoAtual: string;
  assinatura: AssinaturaInfo | null;
  faturas: Fatura[];
  msgsUsadasMes: number;
  cl: { razao: string; fantasia: string; cnpj: string; endereco: string; telefone: string; descricao: string };
  /** Convênios e valor da consulta (S8). Só aparecem em empresa de saúde. */
  dadosSaude: DadosDeSaude;
  /** Dicionário e regras do catálogo (`catalogo_config`). Da empresa, não do número. */
  textosDoCatalogo: TextosDoCatalogo;
  waNumber: string;
  /** A org tem número ligado à Cloud API (organizations.wa_phone_number_id). */
  waConectado: boolean;
  numeros: NumeroDaOrg[];
  notificacoes: Notificacao[];
  agente: {
    ativo: boolean;
    welcomeMsg: string;
    agentPrompt: string;
    limitacoes: string;
    tom: Tom;
    fallbackMode: 'mensagem' | 'atendente';
    fallbackMsg: string;
    fallbackAtendente: string;
    horarioVinculaAgenda: boolean;
    notifNova: boolean; notifExcedido: boolean; notifResumo: boolean;
    precos: Preco[];
    faqs: Faq[];
    perguntas: Pergunta[];
    gatilhos: Gatilho[];
    sucessos: Sucessos;
    infoAdicional: string;
    horario: HorarioDia[];
  };
}

export interface ToastData {
  msg: string;
  action?: { label: string; run: () => void };
}

export interface AppState {
  toast: ToastData | null;
  // agente
  agenteAtivo: boolean;
  welcomeMsg: string;
  agentPrompt: string;
  limitacoes: string;
  tom: Tom;
  precos: Preco[];
  faqs: Faq[];
  openFaq: number | null;
  perguntas: Pergunta[];
  gatilhos: Gatilho[];
  sucessos: Sucessos;
  infoAdicional: string;
  fallbackMode: 'mensagem' | 'atendente';
  fallbackMsg: string;
  fallbackAtendente: string;
  confirmSalvarOpen: boolean;
  confirmSalvarTexto: string;
  horarioModalOpen: boolean;
  horarioEdit: HorarioDia[];
  horarioVinculaAgenda: boolean;
  agenteTab: AgenteTabKey;
  // agenda
  agendaWeekOffset: number;
  agendaItens: AgendaItem[];
  disponibilidades: Disponibilidade[];
  agendaModalSel: number | 'new' | null;
  agendaModalBuffer: AgendaItem | null;
  agendaModalConfirm: 'reagendar' | 'cancelar' | null;
  // contatos
  contatos: Contato[];
  contatoSel: string | null;
  contatoBuffer: Contato | null;
  customFieldDefs: CustomFieldDef[];
  labels: Label[];
  respostasProntas: RespostaPronta[];
  fStatus: string; fOrigem: string; busca: string;
  fInativos: boolean;
  fLabel: string;
  // conversas
  conversas: Conversa[];
  convTab: 'abertas' | 'encerradas' | 'nova';
  convSel: string | null;
  msgTab: 'mensagem' | 'notas' | 'ia';
  draft: string;
  soExcedidas: boolean;
  fConvLabel: string;
  /** 'Todos', 'sem-numero' ou o id de wa_numbers. */
  fConvNumero: string;
  novaContato: string;
  novaModelo: string;
  fichaConvOpen: boolean;
  // campanhas
  campanhas: Campanha[];
  templates: Template[];
  campView: 'lista' | 'wizard';
  wizStep: number;
  wizNome: string;
  wizRemetente: string;
  wizModelo: string;
  wizCategoria: string;
  pubBairro: string; pubStatus: string;
  campCategorias: string[];
  campFiltroCategoria: string; campFiltroStatus: string; campOrdenar: string;
  gerenciarCategoriasOpen: boolean;
  novaCategoriaTexto: string;
  // config
  configTab: 'negocio' | 'whatsapp' | 'templates' | 'plano' | 'uso' | 'agentes' | 'campos' | 'respostas' | 'notif';
  cl: { razao: string; fantasia: string; cnpj: string; endereco: string; telefone: string; descricao: string; };
  /** Convênios e valor da consulta na tela; gravam com o Salvar principal. */
  dadosSaude: DadosDeSaudeNaTela;
  textosDoCatalogo: TextosDoCatalogo;
  waNumber: string;
  waConectado: boolean;
  numeros: NumeroDaOrg[];
  notificacoes: Notificacao[];
  planos: Plano[];
  planoAtual: string;
  assinatura: AssinaturaInfo | null;
  faturas: Fatura[];
  msgsUsadasMes: number;
  notifNova: boolean; notifExcedido: boolean; notifResumo: boolean;
  dark: boolean;
  agentesData: Agente[];
  agenteModalSel: number | null;
  agenteModalTab: 'visao' | 'agenda' | 'editar';
  agenteModalBuffer: Agente | null;
  // layout
  sidebarCollapsed: boolean;
  // painel
  painelPeriodo: '7d' | '30d' | '90d';
  painelStats: PainelStats;
  // campanhas
}

// A aba Agente quando se está configurando UM número.
//
// **O que esta tela resolve, em uma frase:** a tela do Agente misturava "o que
// a empresa é" com "como cada número se comporta", e usava a palavra
// Atendimento para duas coisas diferentes — o nome de uma aba e o nome de um
// roteiro. Desde 14/09 são duas abas com nomes que não colidem: **Empresa** (os
// fatos do negócio, que valem para todos os números) e **Agente** (o
// comportamento, que é o que o seletor de número governa).
//
// Três decisões moram aqui, e as três vieram de usar a tela:
//
// 1. **O número guarda só o que foi mudado.** Campo em branco segue o padrão.
//    Sem isso, dar configuração própria a um número zerava tom de voz,
//    boas-vindas e transferência — e com sete vendedores seria preencher sete
//    vezes a mesma coisa. A junção em si mora em `agente/config-do-numero.ts`,
//    porque quem precisa dela primeiro é o motor.
//
// 2. **Papel e roteiro viraram um controle só.** Antes o papel (`wa_numbers.papel`)
//    era declarado em Configurações → Integração e o roteiro
//    (`ai_agent_config.roteiro`) aqui — e havia um aviso amarelo para quando os
//    dois discordavam. Aviso que existe para cobrir incoerência é sinal de
//    desenho errado: agora é uma escolha só, gravada nos dois lugares.
//
// 3. **O catálogo saiu daqui.** Ele é da empresa, não do vendedor, e mora na
//    aba Empresa junto com os produtos digitados. O cartão do vendedor só diz
//    onde ele está.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types';
import type { PapelDoNumero } from './numeros-whatsapp';

type Client = SupabaseClient<Database>;

export type RoteiroDoNumero = 'atendimento' | 'vendas' | 'copiloto';
export type Tom = Database['public']['Enums']['agente_tom'];

export const ROTULO_ROTEIRO: Record<RoteiroDoNumero, string> = {
  atendimento: 'Atendimento',
  vendas: 'Vendas',
  copiloto: 'Copiloto (só avisos)',
};

/** O papel do número e o roteiro da IA são a mesma escolha, dita de dois jeitos.
 *  Esta é a tradução, e é a única que existe no projeto. */
export const PAPEL_DO_ROTEIRO: Record<RoteiroDoNumero, PapelDoNumero> = {
  atendimento: 'atendimento',
  vendas: 'vendedor',
  copiloto: 'copiloto',
};

/** O roteiro que combina com o papel do número, para a configuração nascer
 *  coerente em vez de nascer sempre 'atendimento'. */
export function roteiroPadraoDoPapel(papel: PapelDoNumero): RoteiroDoNumero {
  if (papel === 'vendedor') return 'vendas';
  if (papel === 'copiloto') return 'copiloto';
  return 'atendimento';
}

export interface NumeroConfiguravel {
  id: string;
  telefone: string | null;
  papel: PapelDoNumero;
  /** O roteiro já gravado. `null` quando o número ainda não tem configuração
   *  própria — e aí vale a da empresa toda. */
  roteiro: RoteiroDoNumero | null;
  memberId: string | null;
  ativo: boolean;
}

export interface MembroDaEquipe {
  id: string;
  nome: string;
  codigoErp: string;
  telefoneWhatsapp: string;
  /** Quem não acessa o painel foi **cadastrado**, não convidado: existe para o
   *  número ter dono e para o orçamento sair com o vendedor certo. */
  acessaPainel: boolean;
}

/** Os campos que um número pode ter próprios. Vazio = herdado. */
export interface CamposDoAgente {
  prompt: string;
  limitacoes: string;
  infoAdicional: string;
  welcomeMsg: string;
  /** `null` = herdado. */
  tom: Tom | null;
}

export interface AgenteDoNumero {
  roteiro: RoteiroDoNumero;
  ativo: boolean;
  /** O que ESTE número respondeu. Campo vazio significa herdado. */
  proprio: CamposDoAgente;
  /** O que vale quando o número não responde — o padrão de todos os números.
   *  É o que a tela mostra em cinza ao lado de "herdado". */
  padrao: CamposDoAgente;
  /** Dono do número (`wa_numbers.member_id`). */
  memberId: string | null;
  /** Existe configuração própria deste número, ou ele ainda herda tudo? */
  temConfigPropria: boolean;
}

const CAMPOS_VAZIOS: CamposDoAgente = {
  prompt: '', limitacoes: '', infoAdicional: '', welcomeMsg: '', tom: null,
};

function camposDaLinha(linha: {
  prompt: string | null; limitacoes: string | null; info_adicional: string | null;
  welcome_msg: string | null; tom: Tom | null;
}): CamposDoAgente {
  return {
    prompt: linha.prompt ?? '',
    limitacoes: linha.limitacoes ?? '',
    infoAdicional: linha.info_adicional ?? '',
    welcomeMsg: linha.welcome_msg ?? '',
    tom: linha.tom ?? null,
  };
}

export async function listarNumerosConfiguraveis(supabase: Client, orgId: string): Promise<NumeroConfiguravel[]> {
  const [numeros, configs] = await Promise.all([
    supabase.from('wa_numbers').select('id, telefone, papel, member_id, ativo')
      .eq('organization_id', orgId).order('created_at'),
    supabase.from('ai_agent_config').select('wa_number_id, roteiro').eq('organization_id', orgId),
  ]);
  if (numeros.error) throw numeros.error;

  const roteiroPorNumero = new Map(
    (configs.data ?? []).filter(c => c.wa_number_id).map(c => [c.wa_number_id!, c.roteiro as RoteiroDoNumero]),
  );

  return (numeros.data ?? []).map(n => ({
    id: n.id,
    telefone: n.telefone,
    papel: n.papel,
    roteiro: roteiroPorNumero.get(n.id) ?? null,
    memberId: n.member_id,
    ativo: n.ativo,
  }));
}

export async function listarMembrosDaEquipe(supabase: Client, orgId: string): Promise<MembroDaEquipe[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, nome, codigo_erp, telefone_whatsapp, acessa_painel')
    .eq('organization_id', orgId).eq('ativo', true).order('nome');
  if (error) throw error;
  return (data ?? []).map(m => ({
    id: m.id,
    nome: m.nome,
    codigoErp: m.codigo_erp ?? '',
    telefoneWhatsapp: m.telefone_whatsapp ?? '',
    acessaPainel: m.acessa_painel,
  }));
}

export async function carregarAgenteDoNumero(
  supabase: Client,
  orgId: string,
  numero: NumeroConfiguravel,
): Promise<AgenteDoNumero> {
  const [proprioRow, padraoRow] = await Promise.all([
    supabase.from('ai_agent_config').select('*')
      .eq('organization_id', orgId).eq('wa_number_id', numero.id).maybeSingle(),
    supabase.from('ai_agent_config').select('*')
      .eq('organization_id', orgId).is('wa_number_id', null).maybeSingle(),
  ]);

  const padrao = padraoRow.data ? camposDaLinha(padraoRow.data) : CAMPOS_VAZIOS;

  if (!proprioRow.data) {
    return {
      roteiro: roteiroPadraoDoPapel(numero.papel),
      ativo: true,
      proprio: CAMPOS_VAZIOS,
      padrao,
      memberId: numero.memberId,
      temConfigPropria: false,
    };
  }

  return {
    roteiro: (proprioRow.data.roteiro as RoteiroDoNumero) ?? 'atendimento',
    ativo: proprioRow.data.ativo,
    proprio: camposDaLinha(proprioRow.data),
    padrao,
    memberId: numero.memberId,
    temConfigPropria: true,
  };
}

export interface SalvarAgenteDoNumero {
  /** Ausente quer dizer **não mexi nisto**: quem decide papel e roteiro é a
   *  tela de Integração WhatsApp, e a tela do agente não os toca mais. */
  roteiro?: RoteiroDoNumero;
  ativo: boolean;
  /** Só o que foi mudado. Campo vazio grava vazio, e vazio quer dizer herdado. */
  proprio: CamposDoAgente;
  /** Dono do número. Ausente quer dizer não mexi — o dono também é escolhido
   *  em Integração WhatsApp. */
  memberId?: string | null;
  /** Código do vendedor no sistema do cliente. Ausente quer dizer não mexi —
   *  o código é da PESSOA e se edita em Configurações → Equipe. */
  codigoErp?: string;
  telefoneWhatsapp?: string;
}

export async function salvarAgenteDoNumero(
  supabase: Client,
  orgId: string,
  numero: NumeroConfiguravel,
  dados: SalvarAgenteDoNumero,
): Promise<void> {
  // **Não dá para usar `upsert` aqui**, e o motivo é sutil: o índice que garante
  // uma configuração por número é PARCIAL (`WHERE wa_number_id IS NOT NULL`,
  // migration `20260908000003`), porque a linha da empresa toda tem número nulo
  // e são muitas. O Postgres não consegue inferir um índice parcial a partir de
  // `ON CONFLICT (wa_number_id)` — devolve `42P10` — e o PostgREST não tem como
  // mandar a condição junto. O `upsert` falhava sempre, e o botão "Salvar este
  // número" só dizia "erro, tente de novo".
  // Sem roteiro no pedido, vale o que já está gravado. E se o número ainda não
  // tem linha própria, o roteiro nasce do papel dele — nascer sempre
  // 'atendimento' rebaixaria um número de vendedor calado.
  const roteiro = dados.roteiro ?? numero.roteiro ?? roteiroPadraoDoPapel(numero.papel);
  const campos = {
    roteiro,
    ativo: dados.ativo,
    prompt: dados.proprio.prompt,
    limitacoes: dados.proprio.limitacoes,
    info_adicional: dados.proprio.infoAdicional,
    welcome_msg: dados.proprio.welcomeMsg,
    tom: dados.proprio.tom,
  };

  const { data: existente } = await supabase
    .from('ai_agent_config').select('id')
    .eq('organization_id', orgId).eq('wa_number_id', numero.id).maybeSingle();

  const { error } = existente
    ? await supabase.from('ai_agent_config').update(campos).eq('id', existente.id)
    : await supabase.from('ai_agent_config')
        .insert({ organization_id: orgId, wa_number_id: numero.id, ...campos });
  if (error) throw error;

  // O papel do número acompanha o roteiro, sempre. São a mesma escolha: é isto
  // que apaga o aviso amarelo de "os dois discordam" em vez de explicá-lo.
  const papel = PAPEL_DO_ROTEIRO[roteiro];
  // Dono só existe em número de vendedor. Nos outros papéis o número é da
  // empresa, e um dono pendurado ali esconderia conversa de quem deveria ver.
  const dono = papel === 'vendedor' ? (dados.memberId ?? numero.memberId) : null;
  // Quem não mandou nem roteiro nem dono não quis mexer no número — e escrever
  // por conta própria em `wa_numbers` seria a tela do agente desfazendo o que
  // foi decidido em Integração.
  const mexeuNoNumero = dados.roteiro !== undefined || dados.memberId !== undefined;
  if (mexeuNoNumero && (papel !== numero.papel || dono !== numero.memberId)) {
    const { error: erroNumero } = await supabase
      .from('wa_numbers').update({ papel, member_id: dono }).eq('id', numero.id);
    if (erroNumero) throw erroNumero;
  }

  if (dono && (dados.codigoErp !== undefined || dados.telefoneWhatsapp !== undefined)) {
    const camposDoMembro: { codigo_erp?: string | null; telefone_whatsapp?: string | null } = {};
    if (dados.codigoErp !== undefined) camposDoMembro.codigo_erp = dados.codigoErp.trim() || null;
    if (dados.telefoneWhatsapp !== undefined) camposDoMembro.telefone_whatsapp = dados.telefoneWhatsapp.trim() || null;
    const { error: erroMembro } = await supabase
      .from('organization_members').update(camposDoMembro).eq('id', dono);
    if (erroMembro) throw erroMembro;
  }
}

/** Dicionário e regras do catálogo. São da EMPRESA, não do número: quem lê o
 *  catálogo do jeito certo lê igual em todos os vendedores. */
export async function salvarTextosDoCatalogo(
  supabase: Client,
  orgId: string,
  textos: { dicionario: string; regras: string },
): Promise<void> {
  const { error } = await supabase.from('catalogo_config').upsert({
    organization_id: orgId,
    dicionario: textos.dicionario,
    regras: textos.regras,
  }, { onConflict: 'organization_id' });
  if (error) throw error;
}

/**
 * Cadastra alguém da equipe **sem convidar**: sem e-mail, sem login, sem vaga
 * de atendente no plano.
 *
 * Os sete vendedores da Distribuidora Exemplo não vão entrar no painel. Eles precisam
 * existir por três motivos, e só três: o número tem que ter dono, o orçamento
 * tem que sair com o código do vendedor, e o copiloto tem que saber para qual
 * WhatsApp avisar. Convidar por e-mail, que era o único caminho, criaria sete
 * logins que ninguém usaria — e cada um ocuparia uma vaga do plano.
 */
export async function cadastrarMembroSemLogin(
  supabase: Client,
  orgId: string,
  dados: { nome: string; cargo: string; codigoErp: string; telefoneWhatsapp: string },
): Promise<MembroDaEquipe> {
  const { data, error } = await supabase
    .from('organization_members')
    .insert({
      organization_id: orgId,
      role: 'atendente',
      nome: dados.nome.trim(),
      cargo: dados.cargo.trim(),
      codigo_erp: dados.codigoErp.trim() || null,
      telefone_whatsapp: dados.telefoneWhatsapp.trim() || null,
      ativo: true,
      acessa_painel: false,
    })
    .select('id, nome, codigo_erp, telefone_whatsapp, acessa_painel')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    nome: data.nome,
    codigoErp: data.codigo_erp ?? '',
    telefoneWhatsapp: data.telefone_whatsapp ?? '',
    acessaPainel: data.acessa_painel,
  };
}

/**
 * Quem é este número: o que ele faz e de quem ele é.
 *
 * **É a tela de Integração WhatsApp que chama isto**, e é lá que a escolha
 * mora desde 14/09. A régua: Integração responde *quais números existem, o que
 * cada um faz e de quem é*; a tela do agente responde *como a IA fala*. Antes
 * a escolha morava na tela do agente, e quem conectava um número tinha que ir
 * a outro lugar para dizer o que ele era.
 *
 * Grava nos dois lugares porque papel e roteiro são a mesma escolha dita de
 * dois jeitos (`PAPEL_DO_ROTEIRO`) — e continua sendo **uma** escolha, num
 * lugar só, que é o que impede os dois de discordarem.
 *
 * O que ela **não** toca: nenhum campo de texto do agente. Trocar o papel de
 * um número não pode apagar a instrução que alguém escreveu nele.
 */
export async function definirPapelDoNumero(
  supabase: Client,
  orgId: string,
  numero: NumeroConfiguravel,
  escolha: { roteiro: RoteiroDoNumero; memberId: string | null },
): Promise<void> {
  // Copiloto é um só por empresa. `avisarVendedorDoOrcamento` pega o primeiro
  // que encontra, então um segundo nunca seria usado, e quem o cadastrou
  // ficaria procurando por que aquele número não avisa ninguém.
  //
  // A trava vem **antes** de qualquer escrita: o índice do banco recusaria a
  // linha de `wa_numbers` depois de o roteiro já ter sido gravado em
  // `ai_agent_config`, e aí os dois ficariam discordando — exatamente o que
  // esta função existe para impedir.
  if (escolha.roteiro === 'copiloto') {
    const { data: jaExiste } = await supabase
      .from('wa_numbers').select('telefone')
      .eq('organization_id', orgId).eq('papel', 'copiloto').neq('id', numero.id)
      .limit(1).maybeSingle();
    if (jaExiste) {
      throw new Error(
        `Esta empresa já tem um número copiloto (${jaExiste.telefone ?? 'sem telefone cadastrado'}). `
        + 'Troque o papel dele antes de definir outro.',
      );
    }
  }

  const { data: existente } = await supabase
    .from('ai_agent_config').select('id')
    .eq('organization_id', orgId).eq('wa_number_id', numero.id).maybeSingle();

  // `upsert` continua fora de questão aqui: o índice é parcial e o Postgres
  // devolve 42P10 (o mesmo motivo detalhado em `salvarAgenteDoNumero`).
  const { error } = existente
    ? await supabase.from('ai_agent_config').update({ roteiro: escolha.roteiro }).eq('id', existente.id)
    : await supabase.from('ai_agent_config')
        .insert({ organization_id: orgId, wa_number_id: numero.id, roteiro: escolha.roteiro });
  if (error) throw error;

  const papel = PAPEL_DO_ROTEIRO[escolha.roteiro];
  const dono = papel === 'vendedor' ? escolha.memberId : null;
  const { error: erroNumero } = await supabase
    .from('wa_numbers').update({ papel, member_id: dono }).eq('id', numero.id);
  if (erroNumero) throw erroNumero;
}

/**
 * Edita alguém da equipe.
 *
 * O código no sistema e o WhatsApp de aviso **são da pessoa**, não do número —
 * sempre foram, no banco (`organization_members`). O que faltava era um lugar
 * para editá-los: dava para preenchê-los ao cadastrar e nunca mais, e quem
 * fosse **convidado** não tinha onde preencher código nenhum. Agora a Equipe
 * edita os dois para qualquer pessoa, com ou sem login.
 */
export async function atualizarMembro(
  supabase: Client,
  orgId: string,
  memberId: string,
  dados: { nome?: string; cargo?: string; codigoErp?: string; telefoneWhatsapp?: string },
): Promise<void> {
  const campos: {
    nome?: string; cargo?: string;
    codigo_erp?: string | null; telefone_whatsapp?: string | null;
  } = {};
  if (dados.nome !== undefined) campos.nome = dados.nome.trim();
  if (dados.cargo !== undefined) campos.cargo = dados.cargo.trim();
  if (dados.codigoErp !== undefined) campos.codigo_erp = dados.codigoErp.trim() || null;
  if (dados.telefoneWhatsapp !== undefined) campos.telefone_whatsapp = dados.telefoneWhatsapp.trim() || null;
  if (Object.keys(campos).length === 0) return;

  const { error } = await supabase
    .from('organization_members').update(campos)
    .eq('id', memberId).eq('organization_id', orgId);
  if (error) throw error;
}

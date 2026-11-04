// O transporte: uma requisição ao sistema do cliente, com timeout, retentativa
// e a tradução do erro dele para o nosso vocabulário.
//
// Está separado das operações porque a política de erro é **uma só** e as
// operações são quatro. Se cada uma decidisse quando repetir, uma delas
// repetiria um 4xx mais cedo ou mais tarde — e repetir um "criar orçamento"
// recusado é exatamente como se cria o orçamento duplicado que a tabela de
// idempotência existe para impedir.
//
// A regra, em uma frase: **repete só quando o pedido não chegou ou o servidor
// caiu.** 5xx, 429 e erro de rede repetem; 4xx não repete, porque repetir um
// pedido que o outro lado entendeu e recusou só produz o mesmo "não" mais três
// vezes. A única exceção é o `REQUISICAO_EM_ANDAMENTO` da Distribuidora Exemplo, que quer
// dizer "ainda estou gravando a sua chave, espere" — e aí repetir é o que o
// contrato deles manda fazer.

import { CAMINHOS_PADRAO, type CaminhosDoErp, type OperacaoDeSync, type OperacaoDoErp } from './caminhos';
import { ERRO_REQUISICAO_EM_ANDAMENTO, type ErroDoErp } from './contrato';
import type { RegistroDaChamada } from './registro-de-chamadas';

/** Quanto esperamos por uma resposta. A Meta reenvia a mensagem quando o nosso
 *  webhook demora, então o tempo aqui não é só conforto — é o que decide se a
 *  conversa vira duas. */
export const TIMEOUT_MS = 8_000;

/** Três tentativas no total, com estas esperas entre elas. Curtas de propósito:
 *  o laço de ferramentas do motor tem teto de tempo, e uma operação que insiste
 *  por meio minuto come o orçamento inteiro do atendimento. */
const ESPERAS_MS = [1_000, 3_000];

export type MotivoDeFalha =
  /** O outro lado entendeu e disse não (4xx de regra de negócio). */
  | 'recusado'
  /** Não existe (404 na consulta de cliente). Não é falha: é resposta. */
  | 'nao_encontrado'
  /** Chave inválida ou sem permissão. Problema nosso, não do cliente final. */
  | 'credencial'
  /** Caiu, demorou ou a rede falhou — depois de todas as tentativas. */
  | 'indisponivel';

export type ResultadoDoErp<T> =
  | { ok: true; dados: T }
  | { ok: false; motivo: MotivoDeFalha; codigo: string; mensagem: string; campo?: string | null };

export interface ConexaoComOErp {
  enderecoBase: string;
  token: string;
  /**
   * Onde mora cada operação no sistema deste cliente.
   *
   * **Opcional de propósito, e é o que mantém o comportamento antigo como
   * padrão:** conexão sem caminhos — que é o caso de todo teste e de toda
   * organização que não configurou nada — bate exatamente nos mesmos endereços
   * de sempre (`CAMINHOS_PADRAO`, em `caminhos.ts`).
   *
   * O que é configurável é o ENDEREÇO. O formato do corpo continua em
   * `operacoes/*.ts`, e isso está dito na tela de quem edita.
   */
  caminhos?: CaminhosDoErp;
  /**
   * Chamado uma vez por chamada concluída, depois de todas as retentativas.
   *
   * Opcional de propósito: o transporte não conhece Supabase, e uma conexão sem
   * observador — que é o caso de todo teste — se comporta exatamente como antes
   * de este campo existir. Quem quer registrar monta a conexão com ele (ver
   * `registro-de-chamadas.ts`).
   *
   * **Nunca lança:** o que estourar aqui dentro é engolido, porque uma falha no
   * registro não pode derrubar a venda que estava sendo feita.
   */
  observador?: (registro: RegistroDaChamada) => void;
}

export interface PedidoAoErp {
  metodo: 'GET' | 'POST';
  /**
   * Qual das quatro é. Quem manda é a operação, não o endereço — é o que faz o
   * registro na tela de Chamadas continuar dizendo "Criar orçamento" depois que
   * a Distribuidora Exemplo trocar o caminho dela.
   *
   * Os syncs (`sync_produtos`, `sync_regioes`) não têm caminho padrão: quem
   * os chama passa sempre `caminho`.
   */
  operacao: OperacaoDoErp | OperacaoDeSync;
  /** Endereço explícito, que atropela a configuração. Existe para quem chama o
   *  transporte fora das quatro operações do contrato. */
  caminho?: string;
  corpo?: unknown;
  /** Vai no cabeçalho `Idempotency-Key`. Só as operações que criam mandam. */
  chaveDeIdempotencia?: string;
}

function esperar(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/** A Distribuidora Exemplo manda `DOCUMENTO_INVALIDO` e `campos: ["nome"]`; o simulador
 *  manda `documento_invalido` e `campo: "nome"`. O resto do código compara com
 *  as constantes minúsculas de `contrato.ts`, então a normalização é aqui — um
 *  lugar só, em vez de um `toLowerCase()` espalhado por cada comparação. */
function erroDoCorpo(corpo: unknown): { codigo: string; mensagem: string; campo?: string | null } {
  const erro = (corpo as ErroDoErp | null)?.erro;
  if (erro && typeof erro.codigo === 'string') {
    const campo = erro.campo ?? (Array.isArray(erro.campos) ? erro.campos[0] : null) ?? null;
    return { codigo: erro.codigo.toLowerCase(), mensagem: erro.mensagem ?? erro.codigo, campo };
  }
  return { codigo: 'resposta_inesperada', mensagem: 'O sistema respondeu num formato que não conhecemos.' };
}

export async function chamarErp<T>(conexao: ConexaoComOErp, pedido: PedidoAoErp): Promise<ResultadoDoErp<T>> {
  // A resolução do endereço acontece num lugar só. Se cada operação resolvesse
  // o seu, a quinta operação a ser escrita esqueceria de olhar a configuração —
  // e falharia só no cliente que tivesse configurado alguma coisa.
  const operacaoDoContrato = pedido.operacao as OperacaoDoErp;
  const caminho = pedido.caminho ?? conexao.caminhos?.[operacaoDoContrato] ?? CAMINHOS_PADRAO[operacaoDoContrato];
  const url = `${conexao.enderecoBase.replace(/\/+$/, '')}${caminho}`;
  const cabecalhos: Record<string, string> = {
    // Os dois cabecalhos de proposito: a Distribuidora Exemplo documenta X-API-Key e aceita
    // Bearer como sinonimo, e outros ERPs so entendem Bearer. Mandar ambos
    // custa nada e evita um if por cliente.
    'x-api-key': conexao.token,
    authorization: `Bearer ${conexao.token}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  if (pedido.chaveDeIdempotencia) cabecalhos['idempotency-key'] = pedido.chaveDeIdempotencia;

  let ultimaFalha = { codigo: 'indisponivel', mensagem: 'O sistema não respondeu.' };

  // O registro é montado ao longo do laço e disparado uma vez só, no desfecho.
  // `idas` conta as tentativas de verdade, e não o índice: é ele que diz, na
  // tela, que houve retentativa.
  const comecou = Date.now();
  let idas = 0;
  let ultimoStatus: number | null = null;
  let ultimoCorpo: unknown = null;

  /** O desfecho, registrado e devolvido de uma vez só. Passa por aqui todo
   *  `return` desta função — é isso que garante que nenhuma chamada escape do
   *  registro quando alguém acrescentar um caso novo. */
  function desfecho(resultado: ResultadoDoErp<T>): ResultadoDoErp<T> {
    if (conexao.observador) {
      try {
        conexao.observador({
          metodo: pedido.metodo,
          operacao: pedido.operacao,
          caminho,
          requisicao: pedido.corpo ?? null,
          statusHttp: ultimoStatus,
          resposta: ultimoCorpo,
          ok: resultado.ok,
          motivo: resultado.ok ? null : resultado.motivo,
          codigo: resultado.ok ? null : resultado.codigo,
          mensagem: resultado.ok ? null : resultado.mensagem,
          tentativas: idas,
          duracaoMs: Date.now() - comecou,
          chaveDeIdempotencia: pedido.chaveDeIdempotencia ?? null,
        });
      } catch (err) {
        console.error('Observador da chamada ao ERP estourou:', err);
      }
    }
    return resultado;
  }

  for (let tentativa = 0; tentativa < ESPERAS_MS.length + 1; tentativa++) {
    if (tentativa > 0) await esperar(ESPERAS_MS[tentativa - 1]);
    idas++;

    let resposta: Response;
    try {
      resposta = await fetch(url, {
        method: pedido.metodo,
        headers: cabecalhos,
        body: pedido.corpo === undefined ? undefined : JSON.stringify(pedido.corpo),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // Timeout e queda de rede: o pedido pode nem ter chegado. Repete.
      ultimaFalha = {
        codigo: 'sem_resposta',
        mensagem: err instanceof Error ? err.message : 'Falha de rede.',
      };
      continue;
    }

    let corpo: unknown = null;
    try { corpo = await resposta.json(); } catch { corpo = null; }
    ultimoStatus = resposta.status;
    ultimoCorpo = corpo;

    if (resposta.ok) return desfecho({ ok: true, dados: corpo as T });

    if (resposta.status === 401 || resposta.status === 403) {
      const e = erroDoCorpo(corpo);
      return desfecho({ ok: false, motivo: 'credencial', ...e });
    }
    if (resposta.status === 404) {
      const e = erroDoCorpo(corpo);
      return desfecho({ ok: false, motivo: 'nao_encontrado', ...e });
    }
    if (resposta.status >= 400 && resposta.status < 500 && resposta.status !== 429) {
      const e = erroDoCorpo(corpo);
      // A única exceção à regra de não repetir 4xx, e ela vem escrita no
      // contrato da Distribuidora Exemplo: a mesma Idempotency-Key ainda está sendo
      // gravada do lado deles, e a instrução é esperar e repetir. Repetir aqui
      // não duplica nada — é justamente a chave que garante isso.
      if (e.codigo === ERRO_REQUISICAO_EM_ANDAMENTO) {
        ultimaFalha = e;
        continue;
      }
      // O outro lado entendeu e recusou. Repetir produziria o mesmo "não".
      return desfecho({ ok: false, motivo: 'recusado', ...e });
    }

    // 429 e 5xx: repete.
    ultimaFalha = erroDoCorpo(corpo);
  }

  return desfecho({ ok: false, motivo: 'indisponivel', ...ultimaFalha });
}

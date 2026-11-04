// O que foi pedido ao sistema do cliente, e o que ele respondeu.
//
// **Por que isto existe.** Durante a homologação, o desenvolvedor do cliente
// precisa conferir se o cadastro que a IA criou foi gravado com os dados
// certos. Sem este registro, a única forma é alguém abrir o log do servidor — e
// aí a conferência inteira passa pelo Leonardo.
//
// **O desenho: um observador, não um `await`.** `chamarErp` é transporte e não
// conhece Supabase; se ele gravasse direto, o transporte passaria a depender do
// banco e os testes das quatro operações precisariam de um dublê de Supabase
// para rodar. Em vez disso, a conexão carrega um observador opcional, e quem
// monta a conexão decide se quer gravar. Conexão sem observador — que é o caso
// de todo teste — se comporta exatamente como antes.
//
// **Gravar nunca pode quebrar a chamada.** O insert é disparado sem `await` e
// com o erro engolido no `catch`: se o registro falhar, o orçamento do cliente
// não pode falhar junto. Perder uma linha de log é aceitável; perder uma venda
// não é.

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types';
import type { MotivoDeFalha } from './cliente-http';
import { avisosDaResposta, type AvisoDoErp } from './avisos';

type Client = SupabaseClient<Database>;

/** Os fatos de uma chamada já concluída — depois de todas as retentativas. */
export interface RegistroDaChamada {
  metodo: string;
  /** Qual das quatro operações é. Vem do pedido, e não deduzida do caminho:
   *  desde que o caminho é configurável (20/09), deduzir faria o rótulo e o
   *  filtro da tela sumirem em silêncio no dia em que um cliente trocasse o
   *  endereço de uma operação. Opcional para quem chama o transporte fora das
   *  quatro — aí vale a dedução de sempre. */
  operacao?: string;
  caminho: string;
  /** O corpo enviado. Os cabeçalhos NÃO entram: é neles que a chave viaja. */
  requisicao: unknown;
  /** Nulo quando a requisição nem chegou (timeout, DNS, conexão recusada). */
  statusHttp: number | null;
  resposta: unknown;
  ok: boolean;
  motivo: MotivoDeFalha | null;
  codigo: string | null;
  mensagem: string | null;
  tentativas: number;
  duracaoMs: number;
  chaveDeIdempotencia: string | null;
}

/** Onde a chamada aconteceu. Tudo opcional: uma chamada disparada por uma tela
 *  de teste não tem conversa nem contato. */
export interface OndeAconteceu {
  orgId: string;
  conversationId?: string | null;
  contactId?: string | null;
  waNumberId?: string | null;
  /** A execução do motor que fez a chamada (`agente_turnos`). */
  turnoId?: string | null;
}

/**
 * O nome de negócio de cada caminho do contrato.
 *
 * Fica aqui, e não espalhado nas operações, porque a tela precisa de um rótulo
 * estável mesmo quando a Distribuidora Exemplo trocar o caminho — e porque o transporte,
 * que é quem dispara o registro, só conhece o caminho.
 */
const NOME_DA_OPERACAO: Record<string, string> = {
  '/clientes/consulta': 'consultar_cliente',
  '/clientes/novo': 'criar_cliente',
  '/cotacoes': 'cotar',
  '/orcamentos': 'criar_orcamento',
};

export function operacaoDoCaminho(caminho: string): string {
  const conhecida = NOME_DA_OPERACAO[caminho];
  if (conhecida) return conhecida;
  // Caminho que ainda não tem nome de negócio (a Distribuidora Exemplo ainda vai definir os
  // das operações 3 e 4): entra pelo próprio caminho, limpo, em vez de sumir.
  return caminho.replace(/^\/+/, '').replace(/\.php$/, '') || 'desconhecida';
}

/** Rótulo legível da operação, para a tela. */
export const ROTULO_DA_OPERACAO: Record<string, string> = {
  consultar_cliente: 'Consultar cadastro',
  criar_cliente: 'Criar cliente',
  cotar: 'Consultar preço',
  criar_orcamento: 'Criar orçamento',
  sync_produtos: 'Sincronizar produtos',
  sync_regioes: 'Sincronizar regiões',
};

/**
 * Um observador que grava cada chamada em `erp_chamadas`.
 *
 * O `supabase` precisa ser um client `service_role`: a tabela não tem policy de
 * escrita nenhuma, de propósito — nenhuma sessão de usuário grava ali.
 */
export function observadorQueGrava(
  supabase: Client,
  onde: OndeAconteceu,
  /** Avisado com o id da linha, para a ficha do turno apontar para ela. */
  aoRegistrar?: (registro: RegistroDaChamada, id: string) => void,
): (registro: RegistroDaChamada) => void {
  return registro => {
    // O id nasce aqui para quem observa (o rastreio) poder apontar para a
    // linha sem esperar o insert, que continua sem `await`.
    const id = randomUUID();
    try { aoRegistrar?.(registro, id); } catch { /* o rastreio nunca derruba a chamada */ }
    void supabase
      .from('erp_chamadas')
      .insert({
        id,
        organization_id: onde.orgId,
        operacao: registro.operacao ?? operacaoDoCaminho(registro.caminho),
        metodo: registro.metodo,
        caminho: registro.caminho,
        // O corpo já veio de `JSON.stringify`/`response.json()`, então é Json de
        // fato — o cast só informa isso ao TypeScript, que só conhece `unknown`.
        requisicao: (registro.requisicao ?? null) as Json,
        status_http: registro.statusHttp,
        resposta: (registro.resposta ?? null) as Json,
        ok: registro.ok,
        motivo: registro.motivo,
        codigo: registro.codigo,
        mensagem: registro.mensagem,
        tentativas: registro.tentativas,
        duracao_ms: registro.duracaoMs,
        chave_idempotencia: registro.chaveDeIdempotencia,
        conversation_id: onde.conversationId ?? null,
        contact_id: onde.contactId ?? null,
        wa_number_id: onde.waNumberId ?? null,
        ...(onde.turnoId ? { turno_id: onde.turnoId } : {}),
      })
      .then(({ error }) => {
        // Só loga. Uma falha aqui não pode derrubar a conversa do cliente.
        if (error) console.error('Falha ao registrar a chamada ao ERP:', error.message);
      });
    registrarAvisos(supabase, onde.orgId, registro);
  };
}

/** Os avisos de formato (`avisos.ts`), pelo mesmo princípio: sem `await`, e
 *  nenhum erro daqui chega à conversa ou ao sync. */
export function registrarAvisos(supabase: Client, orgId: string, registro: RegistroDaChamada): void {
  if (!registro.ok) return;
  let avisos: AvisoDoErp[];
  try {
    avisos = avisosDaResposta(orgId, registro.operacao ?? operacaoDoCaminho(registro.caminho), registro.resposta);
  } catch (err) {
    console.error('Falha ao ler os avisos do ERP:', err instanceof Error ? err.message : String(err));
    return;
  }
  if (!avisos.length) return;
  void Promise.resolve(supabase.rpc('registrar_avisos_erp', { p_org: orgId, p_avisos: avisos as unknown as Json }))
    .then(({ error }) => {
      if (error) console.error('Falha ao registrar os avisos do ERP:', error.message);
    })
    .catch((err: unknown) => console.error('Falha ao registrar os avisos do ERP:', err instanceof Error ? err.message : String(err)));
}

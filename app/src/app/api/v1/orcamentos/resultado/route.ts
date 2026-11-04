// Operação 5 do contrato: o sistema do cliente avisa o desfecho de um orçamento
// que a IA criou como rascunho. É a única direção em que eles falam com a gente
// — as outras quatro operações somos nós chamando eles.
//
// Endpoint público e não-autenticado por sessão, no mesmo padrão do webhook do
// Asaas: um token estático em variável de ambiente, comparado em tempo
// constante. Sem usuário logado, então o client é o service_role.
//
// Contrato mínimo aceito hoje:
//
//   POST /api/v1/orcamentos/resultado
//   Authorization: Bearer <ORCAMENTOS_API_TOKEN>
//   { "evento_id": "...", "orcamento_id": "...", "status": "aprovado",
//     "ocorrido_em": "2026-09-08T14:30:00-03:00", ...qualquer outro campo }
//
//   200 {"ok":true,"evento_id":"...","duplicado":false}
//
// Só `evento_id` e `orcamento_id` são obrigatórios. Todo o resto do corpo é
// guardado cru: o contrato de campos da Distribuidora Exemplo ainda não fechou, e recusar
// um campo que a gente não previu seria trocar dado por rigidez.
//
// **Idempotente por `evento_id`**: reenviar o mesmo evento responde 200 e não
// grava de novo. Sem isso, uma retentativa do lado deles contaria o mesmo
// desfecho duas vezes.

import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/service';

export const runtime = 'nodejs';

// Postgres: violação de índice único — aqui só pode ser o evento repetido.
const CODIGO_DUPLICATA = '23505';

function tokenConfere(recebido: string | null, esperado: string): boolean {
  if (!recebido) return false;
  const recebidoBuf = Buffer.from(recebido, 'utf8');
  const esperadoBuf = Buffer.from(esperado, 'utf8');
  if (recebidoBuf.length !== esperadoBuf.length) return false;
  return timingSafeEqual(recebidoBuf, esperadoBuf);
}

function tokenDoCabecalho(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
}

/** String não vazia com um teto de tamanho — o corpo vem de fora. */
function textoObrigatorio(valor: unknown, limite = 200): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > limite) return null;
  return limpo;
}

function textoOpcional(valor: unknown, limite = 200): string | null {
  if (typeof valor !== 'string') return null;
  const limpo = valor.trim();
  if (!limpo || limpo.length > limite) return null;
  return limpo;
}

/** Data ISO; qualquer coisa que não seja data vira nulo em vez de erro — o
 *  desfecho importa mais do que o carimbo de hora estar bem formado. */
function dataOpcional(valor: unknown): string | null {
  const texto = textoOpcional(valor, 64);
  if (!texto) return null;
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

export async function POST(request: Request) {
  const token = process.env.ORCAMENTOS_API_TOKEN;
  // Enquanto existe um cliente só, a organização vem por variável de ambiente.
  // Credencial por organização é item do bloco C (não existe tabela de
  // integrações), e trocar isso depois não muda o contrato visto de fora.
  const orgId = process.env.ORCAMENTOS_ORG_ID;
  if (!token || !orgId) {
    console.error('ORCAMENTOS_API_TOKEN ou ORCAMENTOS_ORG_ID não configurado — recusando.');
    return Response.json({ error: 'Integração não configurada no servidor.' }, { status: 500 });
  }

  if (!tokenConfere(tokenDoCabecalho(request), token)) {
    return Response.json({ error: 'Token inválido.' }, { status: 401 });
  }

  let corpo: Record<string, unknown>;
  try {
    const bruto: unknown = await request.json();
    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('não é objeto');
    corpo = bruto as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Corpo inválido: esperado um objeto JSON.' }, { status: 400 });
  }

  const eventoId = textoObrigatorio(corpo.evento_id);
  const orcamentoId = textoObrigatorio(corpo.orcamento_id);
  if (!eventoId || !orcamentoId) {
    return Response.json(
      { error: 'Campos obrigatórios: evento_id e orcamento_id (texto não vazio, até 200 caracteres).' },
      { status: 400 },
    );
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from('orcamento_eventos').insert({
    organization_id: orgId,
    evento_id: eventoId,
    orcamento_id: orcamentoId,
    status: textoOpcional(corpo.status, 64),
    ocorrido_em: dataOpcional(corpo.ocorrido_em),
    payload: corpo as never,
  });

  if (error) {
    // Repetição não é erro: é a retentativa deles chegando de novo. Responder
    // 200 é o que faz a retentativa parar.
    if (error.code === CODIGO_DUPLICATA) {
      return Response.json({ ok: true, evento_id: eventoId, duplicado: true });
    }
    console.error('Erro ao gravar evento de orçamento:', error.message);
    return Response.json({ error: 'Não foi possível registrar o evento.' }, { status: 500 });
  }

  return Response.json({ ok: true, evento_id: eventoId, duplicado: false });
}

// Operação 1 do contrato: existe cliente com este CPF/CNPJ?
//
// Um arquivo por operação, e não um "cliente do ERP" com quatro métodos: o
// fluxo comercial ainda está sendo validado com o time da Distribuidora Exemplo, e trocar
// uma operação não pode obrigar a mexer nas outras.
//
// **É POST, e não GET.** O documento da Distribuidora Exemplo de 17/09 manda o documento no
// corpo, e eles têm razão: CPF e CNPJ em query string param em log de proxy e
// de servidor sem ninguém pedir.
//
// "Não encontrado" **não é erro**: volta `200 {"encontrado": false}`, e é o
// caminho previsto que leva ao cadastro. O `404` do simulador antigo continua
// aceito porque é a mesma resposta dita de outro jeito.

import type { ClienteDoErp, EnderecoDoErp, FormaDePagamentoDoErp } from '../contrato';
import { chamarErp, type ConexaoComOErp, type ResultadoDoErp } from '../cliente-http';

export function soDigitos(documento: string): string {
  return (documento ?? '').replace(/\D/g, '');
}

/** O que a Distribuidora Exemplo devolve. Fica aqui, e não em `contrato.ts`, porque é a
 *  forma DELES — `contrato.ts` guarda a nossa, que o simulador também fala. */
interface RespostaDaConsulta {
  encontrado?: boolean;
  cliente_id?: string | null;
  tipo_pessoa?: string | null;
  /** A classificação fiscal do cadastro. Não é `tipo_pessoa`: aquele diz PF ou
   *  PJ, estes dizem o que o comercial classificou. Não vêm em cadastro novo. */
  tipo_cliente?: string | null;
  segmento?: string | null;
  nome?: string | null;
  /** O contato do CADASTRO — que não é o WhatsApp por onde a pessoa escreveu.
   *  A Distribuidora Exemplo ainda não confirmou se devolve os dois; quando devolver, eles
   *  entram na ficha do contato, e enquanto não devolver nada é apagado. */
  telefone?: string | null;
  email?: string | null;
  inscricao_estadual?: string | null;
  contribuinte_icms?: boolean | null;
  endereco?: Partial<EnderecoDoErp> | null;
  vendedor_id?: string | null;
  situacao?: string | null;
  empresas?: string[] | null;
  /** Ainda não vem (pedido na v3 do contrato). Sem ele, presumimos que dá. */
  pode_faturar?: boolean | null;
  credito_disponivel?: boolean | null;
  formas_pagamento?: Partial<FormaDePagamentoDoErp>[] | null;
  /** O formato antigo, do simulador: `{ cliente: {...} }`. */
  cliente?: ClienteDoErp | null;
}

/** Traduz a resposta da Distribuidora Exemplo para o nosso vocabulário.
 *
 *  `podeFaturar` é derivado de `situacao`, e existe separado de propósito:
 *  bloqueado **cota** e não **fatura**, então quem consulta isto no orçamento
 *  está lendo o campo errado. Enquanto a consulta deles não devolver
 *  `pode_faturar`, um cadastro ATIVO é tratado como apto — que é o que era
 *  verdade antes de o campo existir. */
export function clienteDaResposta(r: RespostaDaConsulta): ClienteDoErp {
  const endereco = r.endereco ?? null;
  const situacao = r.situacao ?? 'ATIVO';
  const bloqueado = String(situacao).toUpperCase() === 'BLOQUEADO';

  return {
    id: String(r.cliente_id ?? ''),
    nome: r.nome ?? '',
    tipo: r.tipo_pessoa
      ? (String(r.tipo_pessoa).toUpperCase().startsWith('J') ? 'PJ' : 'PF')
      : undefined,
    tipo_cliente: r.tipo_cliente ?? null,
    segmento: r.segmento ?? null,
    telefone: r.telefone ?? null,
    email: r.email ?? null,
    inscricao_estadual: r.inscricao_estadual ?? null,
    contribuinte_icms: r.contribuinte_icms ?? null,
    endereco: endereco
      ? {
          logradouro: endereco.logradouro ?? '',
          numero: endereco.numero ?? '',
          complemento: endereco.complemento ?? null,
          bairro: endereco.bairro ?? null,
          cidade: endereco.cidade ?? '',
          uf: endereco.uf ?? '',
          cep: endereco.cep ?? '',
        }
      : null,
    cidade: endereco?.cidade ?? null,
    uf: endereco?.uf ?? null,
    vendedor_id: r.vendedor_id ?? null,
    empresas: r.empresas ?? undefined,
    situacao,
    podeFaturar: r.pode_faturar ?? (r.credito_disponivel === false ? false : !bloqueado),
    motivo_bloqueio: null,
    ...(Array.isArray(r.formas_pagamento) ? { formas_pagamento: formasDaResposta(r.formas_pagamento) } : {}),
  };
}

const numeroOuNulo = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Só as linhas com código; o que faltar fica neutro (indisponível, sem limite). */
export function formasDaResposta(formas: Partial<FormaDePagamentoDoErp>[]): FormaDePagamentoDoErp[] {
  return formas
    .filter(f => !!f && typeof f.codigo === 'string' && f.codigo.trim() !== '')
    .map(f => ({
      codigo: f.codigo!.trim(),
      descricao: String(f.descricao ?? f.codigo).trim(),
      forma: String(f.forma ?? '').trim().toUpperCase(),
      parcelas: numeroOuNulo(f.parcelas) ?? 1,
      ...(f.tipo !== undefined ? { tipo: f.tipo ? String(f.tipo).trim().toUpperCase() : null } : {}),
      ...(f.bandeira !== undefined ? { bandeira: f.bandeira ? String(f.bandeira).trim().toUpperCase() : null } : {}),
      disponivel: f.disponivel === true,
      valor_minimo: numeroOuNulo(f.valor_minimo),
      valor_maximo: numeroOuNulo(f.valor_maximo),
    }));
}

export type ClienteConsultado = { encontrado: true; cliente: ClienteDoErp } | { encontrado: false };

export async function consultarClientePorDocumento(
  conexao: ConexaoComOErp,
  documento: string,
): Promise<ResultadoDoErp<ClienteConsultado>> {
  const limpo = soDigitos(documento);
  if (limpo.length !== 11 && limpo.length !== 14) {
    return {
      ok: false, motivo: 'recusado', codigo: 'documento_invalido',
      mensagem: 'O documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).', campo: 'documento',
    };
  }

  const r = await chamarErp<RespostaDaConsulta>(conexao, {
    metodo: 'POST',
    operacao: 'consultar_cliente',
    corpo: { documento: limpo },
  });

  if (!r.ok) {
    if (r.motivo === 'nao_encontrado') return { ok: true, dados: { encontrado: false } };
    return r;
  }

  const corpo = r.dados ?? {};
  // O formato antigo (`{ cliente: ... }` ou `{ cliente: null }`) continua
  // aceito: é o que o simulador falava antes de 17/09, e brigar por isso só
  // atrasaria a integração.
  if (corpo.cliente) return { ok: true, dados: { encontrado: true, cliente: corpo.cliente } };
  if (corpo.encontrado === false || !corpo.cliente_id) return { ok: true, dados: { encontrado: false } };

  return { ok: true, dados: { encontrado: true, cliente: clienteDaResposta(corpo) } };
}

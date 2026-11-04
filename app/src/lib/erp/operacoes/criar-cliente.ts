// Operação 2 do contrato: cadastrar o cliente que ainda não existe.
//
// **A classificação fiscal não é enviada.** A Distribuidora Exemplo aceita `tipo_cliente` e
// `segmento`, mas os dois vão em branco de propósito: o cadastro nasce pendente
// de classificação do lado deles e o comercial confere. A IA não tem como
// apurar isso numa conversa de WhatsApp, e errar ali estraga nota fiscal.
// Conclusão a que os dois lados chegaram separado, e que está escrita nos dois
// documentos.
//
// **Pessoa jurídica nasce BLOQUEADA, e isso é normal.** Bloqueado cota e não
// fatura — ver `situacao` em `../contrato.ts`. Não tratar como falha.
//
// **Endereço é obrigatório, completo.** Logradouro, número, cidade, UF e CEP.
// Cidade e UF sozinhas, que era o que a ferramenta mandava até 17/09, voltam
// `DADOS_OBRIGATORIOS_AUSENTES` sempre.
//
// Esta é uma das operações que CRIAM, então ela nunca é chamada direto: vai por
// dentro de `umaVezSo` (ver `../idempotencia.ts`).

import type { ClienteDoErp, EnderecoDoErp, FormaDePagamentoDoErp } from '../contrato';
import { chamarErp, type ConexaoComOErp, type ResultadoDoErp } from '../cliente-http';
import { formasDaResposta, soDigitos } from './consultar-cliente';

export interface DadosDoCadastro {
  documento: string;
  nome: string;
  telefone?: string | null;
  email?: string | null;
  inscricaoEstadual?: string | null;
  endereco: EnderecoDoErp;
  /** Quando a entrega é em outra cidade. Sem isso, vale o endereço de cobrança. */
  cidadeEntrega?: string | null;
  ufEntrega?: string | null;
  /** Código do vendedor dono do número por onde o cliente escreveu. */
  vendedorId?: string | null;
}

interface RespostaDoCadastro {
  cliente_criado?: boolean;
  cliente_id?: string | null;
  situacao?: string | null;
  empresas?: Array<{ empresa?: string }> | string[] | null;
  /** Aviso, não bloqueio: `false` não impede nada e `null` quer dizer que a
   *  lista não pôde ser lida — "não sei" não é "não atende". */
  regiao_atendida?: boolean | null;
  /** Desde 14/10 o cadastro já volta com as formas liberadas (as mesmas da consulta). */
  formas_pagamento?: Partial<FormaDePagamentoDoErp>[] | null;
  /** O formato antigo, do simulador. */
  cliente?: ClienteDoErp | null;
}

/** Campos do endereço que a Distribuidora Exemplo recusa se vierem vazios. Conferir aqui
 *  evita gastar uma ida ao ERP para receber de volta a lista do que faltou. */
const OBRIGATORIOS: Array<[keyof EnderecoDoErp, string]> = [
  ['logradouro', 'a rua'],
  ['numero', 'o número'],
  ['cidade', 'a cidade'],
  ['uf', 'o estado'],
  ['cep', 'o CEP'],
];

export async function criarCliente(
  conexao: ConexaoComOErp,
  dados: DadosDoCadastro,
  chaveDeIdempotencia: string,
): Promise<ResultadoDoErp<ClienteDoErp>> {
  const documento = soDigitos(dados.documento);
  if (documento.length !== 11 && documento.length !== 14) {
    return {
      ok: false, motivo: 'recusado', codigo: 'documento_invalido',
      mensagem: 'O documento precisa ter 11 dígitos (CPF) ou 14 (CNPJ).', campo: 'documento',
    };
  }
  if (!dados.nome?.trim()) {
    return { ok: false, motivo: 'recusado', codigo: 'nome_invalido', mensagem: 'Nome obrigatório.', campo: 'nome' };
  }

  const endereco = dados.endereco ?? ({} as EnderecoDoErp);
  const faltando = OBRIGATORIOS.filter(([campo]) => !String(endereco[campo] ?? '').trim());
  if (faltando.length) {
    return {
      ok: false, motivo: 'recusado', codigo: 'dados_obrigatorios_ausentes',
      mensagem: `Falta ${faltando.map(([, rotulo]) => rotulo).join(', ')} do endereço.`,
      campo: `endereco.${faltando[0][0]}`,
    };
  }

  const cep = soDigitos(endereco.cep);
  if (cep.length !== 8) {
    return {
      ok: false, motivo: 'recusado', codigo: 'endereco_invalido',
      mensagem: 'O CEP precisa ter 8 dígitos.', campo: 'endereco.cep',
    };
  }
  const uf = String(endereco.uf).trim().toUpperCase();
  if (uf.length !== 2) {
    return {
      ok: false, motivo: 'recusado', codigo: 'endereco_invalido',
      mensagem: 'O estado precisa ter 2 letras.', campo: 'endereco.uf',
    };
  }

  const r = await chamarErp<RespostaDoCadastro>(conexao, {
    metodo: 'POST',
    operacao: 'criar_cliente',
    chaveDeIdempotencia,
    corpo: {
      documento,
      nome: dados.nome.trim(),
      inscricao_estadual: dados.inscricaoEstadual ?? null,
      telefone: dados.telefone ?? null,
      email: dados.email ?? null,
      // tipo_cliente e segmento ficam FORA: ver o cabeçalho deste arquivo.
      endereco: {
        logradouro: endereco.logradouro.trim(),
        numero: String(endereco.numero).trim(),
        complemento: endereco.complemento ?? '',
        bairro: endereco.bairro ?? '',
        cidade: endereco.cidade.trim(),
        uf,
        cep,
      },
      cidade_entrega: dados.cidadeEntrega ?? null,
      uf_entrega: dados.ufEntrega ?? null,
      vendedor_id: dados.vendedorId ?? null,
    },
  });

  if (!r.ok) return r;

  const corpo = r.dados ?? {};
  if (corpo.cliente?.id) return { ok: true, dados: corpo.cliente };
  if (!corpo.cliente_id) {
    return {
      ok: false, motivo: 'recusado', codigo: 'resposta_sem_cliente',
      mensagem: 'O sistema respondeu sem o cadastro do cliente.',
    };
  }

  const situacao = corpo.situacao ?? 'ATIVO';
  const empresas = Array.isArray(corpo.empresas)
    ? corpo.empresas.map(e => (typeof e === 'string' ? e : (e?.empresa ?? ''))).filter(Boolean)
    : undefined;

  return {
    ok: true,
    dados: {
      id: String(corpo.cliente_id),
      nome: dados.nome.trim(),
      documento,
      tipo: documento.length === 14 ? 'PJ' : 'PF',
      telefone: dados.telefone ?? null,
      email: dados.email ?? null,
      inscricao_estadual: dados.inscricaoEstadual ?? null,
      endereco: { ...endereco, uf, cep },
      cidade: endereco.cidade,
      uf,
      // O que foi enviado, devolvido: a resposta do cadastro não repete o
      // endereço de entrega, e quem abre a ficha depois precisa saber que ele
      // existe — é o que decide frete e praça.
      cidade_entrega: dados.cidadeEntrega ?? null,
      uf_entrega: dados.ufEntrega ?? null,
      vendedor_id: dados.vendedorId ?? null,
      empresas,
      situacao,
      // Cadastro novo de PJ nasce bloqueado. Ele COTA; o que ele não faz é
      // faturar, e isso só importa no pedido.
      podeFaturar: String(situacao).toUpperCase() !== 'BLOQUEADO',
      motivo_bloqueio: null,
      ...(Array.isArray(corpo.formas_pagamento) ? { formas_pagamento: formasDaResposta(corpo.formas_pagamento) } : {}),
    },
  };
}

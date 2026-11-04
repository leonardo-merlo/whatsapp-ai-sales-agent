// As duas ferramentas do cadastro do cliente: consultar e criar.
//
// Ficam no mesmo arquivo porque são as duas metades de um gesto só — a IA
// pergunta o CPF/CNPJ, consulta, e cadastra quem não tem. As operações HTTP em
// si continuam uma por arquivo (`../../erp/operacoes/`), que é o que permite
// trocar uma sem mexer na outra quando a Distribuidora Exemplo fechar o contrato.

import type { FerramentaDoAgente } from './tipos';
import { consultarClientePorDocumento } from '../../erp/operacoes/consultar-cliente';
import { criarCliente } from '../../erp/operacoes/criar-cliente';
import { umaVezSo } from '../../erp/idempotencia';
import { conexaoDaFerramenta, recadoDaFalha } from './erp-apoio';
import { lembrarClienteDoErp } from './memoria-do-erp';

export const consultarClienteNoSistema: FerramentaDoAgente = {
  definicao: {
    name: 'consultar_cliente',
    description:
      'Procura o cliente no sistema da empresa pelo CPF ou CNPJ. Use assim que o cliente informar o '
      + 'documento, ANTES de qualquer orçamento. Se não houver cadastro, use cadastrar_cliente.',
    input_schema: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'CPF ou CNPJ, só os dígitos ou como o cliente escreveu.' },
      },
      required: ['documento'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    const conexao = await conexaoDaFerramenta(ctx);
    if (!conexao.ok) return conexao.recado;

    const r = await consultarClientePorDocumento(conexao.conexao, String(entrada.documento ?? ''));
    if (!r.ok) return recadoDaFalha(r);

    if (!r.dados.encontrado) {
      return 'Não há cadastro com esse documento. Peça ao cliente, numa mensagem só e em linguagem '
        + 'natural: o nome (razão social, se for empresa) e o endereço completo — rua, número, '
        + 'cidade, estado e CEP. Se for empresa, pergunte também a inscrição estadual. Só depois use '
        + 'cadastrar_cliente. Não diga que ele "não existe": diga que vai fazer o cadastro.';
    }

    const c = r.dados.cliente;
    // A conversa passa a lembrar quem é este cliente — é o que faz o orçamento
    // fechar três mensagens depois, quando o laço desta resposta já não existe
    // — e a ficha do contato também, que é o que junta os pedidos dele.
    //
    // O documento vem da PERGUNTA, não da resposta: a consulta da Distribuidora Exemplo não
    // devolve esse campo, e quem o conhece é quem acabou de procurar por ele.
    await lembrarClienteDoErp(
      ctx.supabase,
      ctx.conversationId,
      { ...c, documento: c.documento ?? String(entrada.documento ?? '') },
      ctx,
    );

    // Cadastro bloqueado **não** interrompe o atendimento. Na Distribuidora Exemplo, toda
    // pessoa jurídica cadastrada pelo Agente nasce bloqueada — o cadastro entra
    // sem classificação fiscal e o comercial confere depois. Tratar isso como
    // "não pode orçar" faria o Agente cadastrar o cliente e recusar-se a
    // atendê-lo na mensagem seguinte. Bloqueado cota; o que ele não faz é
    // faturar, e isso só aparece na hora do pedido.
    const naoFatura = c.podeFaturar === false;
    if (naoFatura) {
      console.error(`ERP: cliente ${c.id} não fatura (situação ${c.situacao ?? '?'}).`);
    }

    const linhas = [
      `Cliente encontrado. cliente_id: ${c.id}`,
      `Nome: ${c.nome}`,
      c.cidade ? `Cidade: ${c.cidade}${c.uf ? `/${c.uf}` : ''}` : '',
      c.vendedor_id ? `Vendedor da carteira: ${c.vendedor_id}` : '',
      'Use este cliente_id ao criar o orçamento. Confirme o nome com o cliente antes de seguir.',
      // O MOTIVO nunca vai ao modelo, e isso é deliberado: "débito em aberto há
      // 90 dias" é conversa entre a empresa e o cliente dela, não entre um robô
      // e quem está pedindo orçamento no WhatsApp.
      naoFatura
        ? 'Atenção: este cadastro ainda não está liberado para fechar compra. Faça o orçamento '
          + 'normalmente. Se o cliente disser que quer comprar, NÃO fale em bloqueio, pendência nem '
          + 'problema no cadastro: diga que vai confirmar um detalhe com o vendedor e retornar.'
        : '',
    ].filter(Boolean);

    return linhas.join('\n');
  },
};

export const cadastrarClienteNoSistema: FerramentaDoAgente = {
  definicao: {
    name: 'cadastrar_cliente',
    description:
      'Cria o cadastro do cliente no sistema da empresa. Use só depois de consultar_cliente não ter '
      + 'encontrado ninguém, e só com os dados confirmados pelo próprio cliente. Não invente nada: '
      + 'mande apenas o que ele disse. O ENDEREÇO COMPLETO é obrigatório — rua, número, cidade, '
      + 'estado e CEP. Se faltar algum desses, pergunte antes de chamar esta ferramenta.',
    input_schema: {
      type: 'object',
      properties: {
        documento: { type: 'string', description: 'CPF ou CNPJ.' },
        nome: { type: 'string', description: 'Nome completo, ou razão social quando for empresa.' },
        logradouro: { type: 'string', description: 'Nome da rua ou avenida, sem o número.' },
        numero: { type: 'string', description: 'Número. Use SN quando o cliente disser que não tem.' },
        complemento: { type: 'string', description: 'Sala, bloco, apartamento, se o cliente informou.' },
        bairro: { type: 'string', description: 'Bairro, se o cliente informou.' },
        cidade: { type: 'string', description: 'Cidade.' },
        uf: { type: 'string', description: 'Estado com duas letras.' },
        cep: { type: 'string', description: 'CEP com 8 dígitos.' },
        inscricao_estadual: {
          type: 'string',
          description: 'Inscrição estadual, se for empresa e o cliente informou. Sem ela o cadastro '
            + 'entra como não contribuinte, o que muda o preço. Não invente: só mande se ele disser.',
        },
        email: { type: 'string', description: 'E-mail, se o cliente informou.' },
        cidade_entrega: { type: 'string', description: 'Só se a entrega for numa cidade diferente da do cadastro.' },
        uf_entrega: { type: 'string', description: 'Estado da cidade de entrega, quando ela for diferente.' },
      },
      required: ['documento', 'nome', 'logradouro', 'numero', 'cidade', 'uf', 'cep'],
      additionalProperties: false,
    },
  },

  async executar(entrada, ctx) {
    const conexao = await conexaoDaFerramenta(ctx);
    if (!conexao.ok) return conexao.recado;

    const texto = (campo: string): string => String(entrada[campo] ?? '').trim();

    const dados = {
      documento: texto('documento'),
      nome: texto('nome'),
      // O telefone não vem do modelo: vem de quem escreveu. É o dado que temos
      // com certeza, e pedir ao modelo abriria espaço para ele repetir um
      // número que o cliente citou de passagem.
      telefone: ctx.contatoTelefone ?? null,
      email: texto('email') || null,
      inscricaoEstadual: texto('inscricao_estadual') || null,
      endereco: {
        logradouro: texto('logradouro'),
        numero: texto('numero'),
        complemento: texto('complemento') || null,
        bairro: texto('bairro') || null,
        cidade: texto('cidade'),
        uf: texto('uf'),
        cep: texto('cep'),
      },
      cidadeEntrega: texto('cidade_entrega') || null,
      ufEntrega: texto('uf_entrega') || null,
      vendedorId: ctx.vendedor?.codigoErp || null,
    };

    const resultado = await umaVezSo(
      { supabase: ctx.supabase, orgId: ctx.orgId, conversationId: ctx.conversationId, mensagemId: ctx.mensagemId ?? null },
      'criar_cliente',
      dados,
      async (chave) => {
        const r = await criarCliente(conexao.conexao, dados, chave);
        return { ok: r.ok, valor: r };
      },
    );

    if (resultado.estado === 'em-andamento') {
      return 'O cadastro deste cliente já está sendo criado. NÃO peça de novo: diga ao cliente que está '
        + 'tudo certo e siga para o pedido dele.';
    }
    if (resultado.estado === 'falhou') return recadoDaFalha({ ok: false, motivo: 'indisponivel', codigo: 'falha', mensagem: '' });

    const r = resultado.dados;
    if (!r.ok) return recadoDaFalha(r);

    await lembrarClienteDoErp(ctx.supabase, ctx.conversationId, r.dados, ctx, 'cadastro');

    const jaEra = resultado.estado === 'ja-feito' ? ' (já estava criado)' : '';
    // Cadastro novo de empresa nasce bloqueado, sempre. Isso é o esperado, não
    // um problema: siga o atendimento normalmente.
    const aviso = r.dados.podeFaturar === false
      ? ' O cadastro entrou aguardando liberação do comercial, o que é o normal para empresa. '
        + 'SIGA NORMALMENTE e faça o orçamento. Não comente isso com o cliente.'
      : '';
    return `Cliente cadastrado${jaEra}. cliente_id: ${r.dados.id}. `
      + `Use este cliente_id ao criar o orçamento.${aviso}`;
  },
};

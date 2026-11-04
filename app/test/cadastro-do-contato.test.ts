// O que fica guardado na ficha do contato quando a IA identifica ou cadastra o
// cliente no sistema de gestão.
//
// **Estes testes não tocam o banco de propósito.** A regra difícil aqui não é
// gravar — é gravar sem apagar: uma consulta que volta magra não pode zerar o
// que a consulta anterior descobriu. Com a regra numa função pura, cada
// armadilha vira uma asserção em vez de uma conferência manual na tela.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cadastroDoCliente, cadastroGuardado, cadastrosGuardados, mesclarCadastroDoErp, mesclarNaLista,
  MAX_CADASTROS_NA_FICHA,
  type CadastroDoErp,
} from '@/lib/erp/cadastro-do-contato';
import type { ClienteDoErp } from '@/lib/erp/contrato';

const RELOGIO = new Date('2026-09-20T15:00:00.000Z');

const CLIENTE_COMPLETO: ClienteDoErp = {
  id: 'Z06586/01',
  nome: 'METALURGICA EXEMPLO LTDA',
  documento: '12345678000190',
  tipo: 'PJ',
  telefone: '3733331234',
  email: 'compras@exemplo.com.br',
  inscricao_estadual: '0821234560',
  contribuinte_icms: true,
  endereco: {
    logradouro: 'Rua das Palmeiras', numero: '77', complemento: 'Galpao 3',
    bairro: 'Centro', cidade: 'Jundiai', uf: 'MG', cep: '36880000',
  },
  cidade: 'Jundiai',
  uf: 'MG',
  vendedor_id: 'V-07',
  empresas: ['EXEMPLO CENTRO', 'CORTE DOBRA CENTRO'],
  situacao: 'BLOQUEADO',
  podeFaturar: false,
};

describe('o cadastro que vai para a ficha', () => {
  test('leva os campos do contrato, e só os preenchidos', () => {
    const cadastro = cadastroDoCliente(CLIENTE_COMPLETO, 'consulta', RELOGIO);

    assert.equal(cadastro.cliente_id, 'Z06586/01');
    assert.equal(cadastro.nome, 'METALURGICA EXEMPLO LTDA');
    assert.equal(cadastro.inscricao_estadual, '0821234560');
    assert.equal(cadastro.contribuinte_icms, true);
    assert.equal(cadastro.situacao, 'BLOQUEADO');
    assert.equal(cadastro.vendedor_id, 'V-07');
    assert.deepEqual(cadastro.empresas, ['EXEMPLO CENTRO', 'CORTE DOBRA CENTRO']);
    assert.equal(cadastro.endereco?.cidade, 'Jundiai');
    assert.equal(cadastro.atualizado_em, '2026-09-20T15:00:00.000Z');
    assert.equal(cadastro.origem, 'consulta');

    // Classificação fiscal não veio: não entra como null, some.
    assert.ok(!('tipo_cliente' in cadastro), 'campo vazio não vira chave nula');
    assert.ok(!('segmento' in cadastro));
  });

  test('o documento entra no item, só dígitos', () => {
    // ⚠️ Esta expectativa MUDOU em 20/09, e a mudança é deliberada. De manhã o
    // documento ficava fora, com o argumento de que `contacts.documento` já
    // guardava. A lista de cadastros derrubou o argumento na mesma tarde: a
    // coluna guarda o documento do cadastro ATUAL, e os outros da lista
    // ficariam sem o campo que mais os identifica. Não é duplicação — é um dado
    // por item.
    const cadastro = cadastroDoCliente(
      { ...CLIENTE_COMPLETO, documento: '12.345.678/0001-90' }, 'consulta', RELOGIO,
    );
    assert.equal(cadastro.documento, '12345678000190');
  });

  test('`false` é valor, não é vazio', () => {
    // A armadilha clássica do `if (valor)`: um cliente não contribuinte de ICMS
    // some da ficha, e é justamente ele que muda o preço final.
    const cadastro = cadastroDoCliente(
      { ...CLIENTE_COMPLETO, contribuinte_icms: false }, 'consulta', RELOGIO,
    );
    assert.equal(cadastro.contribuinte_icms, false);
  });
});

describe('gravar sem apagar', () => {
  const antes = cadastroDoCliente(CLIENTE_COMPLETO, 'cadastro', RELOGIO);

  test('consulta magra não apaga o que a anterior descobriu', () => {
    // O caso real: a consulta da Distribuidora Exemplo não devolve e-mail nem telefone, e o
    // cadastro devolve. Se a consulta seguinte gravasse por cima, o contato
    // perderia os dois — e ninguém saberia dizer quando.
    const consultaMagra = cadastroDoCliente(
      { id: 'Z06586/01', nome: 'METALURGICA EXEMPLO LTDA', situacao: 'ATIVO' },
      'consulta',
      new Date('2026-09-21T10:00:00.000Z'),
    );

    const junto = mesclarCadastroDoErp(antes, consultaMagra);

    assert.equal(junto.email, 'compras@exemplo.com.br', 'o e-mail sobreviveu');
    assert.equal(junto.telefone, '3733331234', 'o telefone sobreviveu');
    assert.equal(junto.inscricao_estadual, '0821234560');
    assert.deepEqual(junto.empresas, ['EXEMPLO CENTRO', 'CORTE DOBRA CENTRO']);
    // E o que mudou, mudou: liberaram o cadastro.
    assert.equal(junto.situacao, 'ATIVO');
    assert.equal(junto.atualizado_em, '2026-09-21T10:00:00.000Z');
    assert.equal(junto.origem, 'consulta');
  });

  test('o endereço mescla campo a campo', () => {
    const semComplemento = cadastroDoCliente(
      {
        id: 'Z06586/01',
        endereco: {
          logradouro: 'Rua das Palmeiras', numero: '77', complemento: null,
          bairro: null, cidade: 'Jundiai', uf: 'MG', cep: '36880111',
        },
      },
      'consulta',
      RELOGIO,
    );

    const junto = mesclarCadastroDoErp(antes, semComplemento);

    assert.equal(junto.endereco?.complemento, 'Galpao 3', 'o complemento não foi apagado');
    assert.equal(junto.endereco?.bairro, 'Centro');
    assert.equal(junto.endereco?.cep, '36880111', 'o CEP novo entrou');
  });

  test('lista vazia não apaga a lista que havia', () => {
    const semEmpresas = cadastroDoCliente({ id: 'Z06586/01', empresas: [] }, 'consulta', RELOGIO);
    const junto = mesclarCadastroDoErp(antes, semEmpresas);
    assert.deepEqual(junto.empresas, ['EXEMPLO CENTRO', 'CORTE DOBRA CENTRO']);
  });

  test('sem nada guardado antes, o merge é o cadastro novo', () => {
    const junto = mesclarCadastroDoErp(null, antes);
    assert.deepEqual(junto, antes);
  });

  test('o que estava guardado não é alterado pelo merge', () => {
    // Quem chama grava o resultado; mexer no que leu é como um bug vira dois.
    const original = JSON.stringify(antes);
    mesclarCadastroDoErp(antes, cadastroDoCliente({ id: 'OUTRO/01' }, 'consulta', RELOGIO));
    assert.equal(JSON.stringify(antes), original);
  });
});

describe('o que volta do banco pode ser qualquer coisa', () => {
  test('nulo, lista e valor solto viram "não havia nada"', () => {
    assert.equal(cadastroGuardado(null), null);
    assert.equal(cadastroGuardado(undefined), null);
    assert.equal(cadastroGuardado([]), null);
    assert.equal(cadastroGuardado('texto'), null);
    assert.equal(cadastroGuardado(7), null);
  });

  test('objeto volta como está', () => {
    const guardado: CadastroDoErp = { cliente_id: 'X/01' };
    assert.deepEqual(cadastroGuardado(guardado), guardado);
  });
});

describe('cliente diferente não mescla — o vazamento de 20/09', () => {
  // O bug, na frase mais curta: o contato consultou um CNPJ, cadastrou outro, e
  // o cadastro novo apareceu na tela com `tipo_cliente` e `contribuinte_icms`
  // do anterior. A Distribuidora Exemplo não devolve esses campos ao CRIAR, e a regra de
  // "nulo não apaga" os herdou de um cliente que não era aquele. Errar
  // classificação fiscal é errar ICMS.
  const primeiro = cadastroDoCliente(
    { id: 'Z00003/01', documento: '45723174000110', nome: 'WAPPIA TESTE HOMOLOGACAO LTDA',
      tipo_cliente: 'CONSUMIDOR_FINAL', segmento: 'CONSUMIDOR_FINAL', contribuinte_icms: false },
    'consulta', RELOGIO,
  );

  test('o cadastro novo não herda a classificação fiscal do anterior', () => {
    const segundo = cadastroDoCliente(
      { id: 'Z00004/01', documento: '44455566000183', nome: 'WAPPIA TESTE 2 LTDA', situacao: 'BLOQUEADO' },
      'cadastro', RELOGIO,
    );

    const junto = mesclarCadastroDoErp(primeiro, segundo);

    assert.equal(junto.cliente_id, 'Z00004/01');
    assert.ok(!('tipo_cliente' in junto), 'tipo_cliente vazou do cliente anterior');
    assert.ok(!('segmento' in junto), 'segmento vazou do cliente anterior');
    assert.ok(!('contribuinte_icms' in junto), 'contribuinte_icms vazou do cliente anterior');
    assert.equal(junto.nome, 'WAPPIA TESTE 2 LTDA');
  });

  test('o MESMO cliente continua mesclando — a regra antiga não foi perdida', () => {
    const deNovo = cadastroDoCliente({ id: 'Z00003/01', situacao: 'ATIVO' }, 'consulta', RELOGIO);
    const junto = mesclarCadastroDoErp(primeiro, deNovo);
    assert.equal(junto.situacao, 'ATIVO');
    assert.equal(junto.nome, 'WAPPIA TESTE HOMOLOGACAO LTDA', 'o nome sobreviveu');
  });
});

describe('a lista de cadastros da ficha', () => {
  const a = cadastroDoCliente({ id: 'Z00003/01', documento: '45723174000110', nome: 'EMPRESA A' }, 'consulta', RELOGIO);
  const b = cadastroDoCliente({ id: 'Z00004/01', documento: '44455566000183', nome: 'EMPRESA B' }, 'cadastro', RELOGIO);

  test('cliente novo entra na frente, e o anterior fica', () => {
    // É o caso do comprador que atende por duas empresas — o primeiro teste
    // real do Leonardo, em 20/09.
    const lista = mesclarNaLista(mesclarNaLista([], a), b);
    assert.equal(lista.length, 2);
    assert.equal(lista[0].cliente_id, 'Z00004/01', 'o mais recente vem primeiro');
    assert.equal(lista[1].cliente_id, 'Z00003/01');
  });

  test('o mesmo cliente de novo atualiza no lugar, sem duplicar', () => {
    const lista = mesclarNaLista(mesclarNaLista([], a), b);
    const aDeNovo = cadastroDoCliente({ id: 'Z00003/01', situacao: 'ATIVO' }, 'consulta', RELOGIO);

    const depois = mesclarNaLista(lista, aDeNovo);

    assert.equal(depois.length, 2, 'não duplicou');
    assert.equal(depois[0].cliente_id, 'Z00003/01', 'quem foi usado agora volta para a frente');
    assert.equal(depois[0].nome, 'EMPRESA A', 'e mesclou em vez de substituir');
    assert.equal(depois[0].situacao, 'ATIVO');
  });

  test('cadastro sem cliente_id não entra', () => {
    assert.deepEqual(mesclarNaLista([a], { nome: 'sem id' }), [a]);
  });

  test('a lista tem teto, e o mais antigo sai', () => {
    let lista: ReturnType<typeof mesclarNaLista> = [];
    for (let i = 0; i < MAX_CADASTROS_NA_FICHA + 3; i++) {
      lista = mesclarNaLista(lista, cadastroDoCliente({ id: `Z${i}/01` }, 'consulta', RELOGIO));
    }
    assert.equal(lista.length, MAX_CADASTROS_NA_FICHA);
    assert.equal(lista[0].cliente_id, `Z${MAX_CADASTROS_NA_FICHA + 2}/01`);
  });

  test('lista do banco com lixo dentro é saneada', () => {
    assert.deepEqual(cadastrosGuardados(null), []);
    assert.deepEqual(cadastrosGuardados('texto'), []);
    assert.deepEqual(cadastrosGuardados([a, null, 'x', 7, b]), [a, b]);
  });
});

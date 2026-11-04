// Levanta o ERP fictício da Distribuidora Exemplo como servidor de verdade,
// para conversar com a IA sem nenhum sistema externo.
//
//   node --experimental-strip-types app/scripts/simulador-erp.mjs
//   node --experimental-strip-types app/scripts/simulador-erp.mjs --porta 4000 --falha lento
//
// Bandeiras úteis:
//   --falha fora-do-ar | chave-invalida | sem-credito | lento | instavel
//
// O mesmo simulador que os testes usam (src/lib/erp/simulador.ts), com o
// catálogo e os clientes de test/apoio/catalogo-exemplo.ts. Este arquivo é só
// a casca HTTP.

import { createServer } from 'node:http';
import { register } from 'node:module';

// O Node puro não completa a extensão `.ts` de um import sem extensão; o hook
// dos testes resolve isso, e precisa estar registrado antes do primeiro import.
register('../test/resolve-hook.mts', import.meta.url);
const { criarSimuladorExemplo } = await import('../src/lib/erp/simulador.ts');
const { PRODUTOS_EXEMPLO, CLIENTES_EXEMPLO } = await import('../test/apoio/catalogo-exemplo.ts');

function bandeira(nome, padrao = null) {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : padrao;
}

const porta = Number(bandeira('porta', '4000'));
const chave = bandeira('chave', 'chave-de-homologacao');
const falha = bandeira('falha', null);

const simulador = criarSimuladorExemplo({ produtos: PRODUTOS_EXEMPLO, clientes: CLIENTES_EXEMPLO, chave, falha });

createServer((req, res) => {
  let corpoBruto = '';
  req.on('data', pedaco => { corpoBruto += pedaco; });
  req.on('end', async () => {
    let corpo = null;
    try { corpo = corpoBruto ? JSON.parse(corpoBruto) : null; } catch { corpo = corpoBruto; }

    const cabecalhos = {};
    for (const [k, v] of Object.entries(req.headers)) cabecalhos[k.toLowerCase()] = String(v);

    const resposta = await simulador.responder({ metodo: req.method ?? 'GET', caminho: req.url ?? '/', cabecalhos, corpo });

    console.log(`${req.method} ${req.url} → ${resposta.status}`);
    res.writeHead(resposta.status, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(resposta.corpo, null, 2));
  });
}).listen(porta, () => {
  console.log(`ERP fictício da Distribuidora Exemplo em http://localhost:${porta}`);
  console.log(`  produtos: ${PRODUTOS_EXEMPLO.length}, clientes: ${CLIENTES_EXEMPLO.length}`);
  console.log(`  chave: ${chave}`);
  if (falha) console.log(`  simulando falha: ${falha}`);
});

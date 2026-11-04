'use client'; // vive dentro do painel do contato, que é client

// O cadastro deste contato no sistema de gestão da empresa.
//
// **Para quem este bloco existe.** Durante a homologação, quem abre a ficha não
// é o dono do negócio — é o desenvolvedor do sistema do cliente, conferindo se
// o cadastro que a IA criou gravou com os dados certos. Por isso os rótulos são
// os do contrato (inscrição estadual, contribuinte de ICMS, empresas do grupo) e
// não uma versão amigável deles: ele está comparando campo a campo com a
// documentação que tem na mão.
//
// **É somente leitura, e isso é a decisão.** O dono deste dado é o sistema de
// gestão. Um campo editável aqui criaria duas verdades para a mesma informação —
// e a nossa perderia na primeira consulta seguinte, sem avisar ninguém.
//
// Componente próprio, e não mais um trecho dentro de `painel-contato.tsx`:
// aquele arquivo já passa de 380 linhas, e isto aqui não compartilha estado
// nenhum com o resto da ficha.

import type { CadastroDoErp } from '@/lib/erp/cadastro-do-contato';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';
import SecaoRecolhivel from './secao-recolhivel';

const ROTULO = { fontSize: 11, fontWeight: 600, color: 'var(--text3)' };
const VALOR = { fontSize: 13, color: 'var(--text)', wordBreak: 'break-word' as const };

/** `BLOQUEADO` não é problema: pessoa jurídica cadastrada pelo Agente nasce
 *  assim, porque o cadastro entra sem classificação fiscal e o comercial
 *  confere. Bloqueado **cota**; o que ele não faz é faturar. Por isso a cor é
 *  âmbar (atenção) e não vermelha (erro). */
function coresDaSituacao(situacao: string): { bg: string; cor: string } {
  return situacao.toUpperCase() === 'BLOQUEADO'
    ? { bg: 'var(--amber-b)', cor: 'var(--amber-t)' }
    : { bg: 'var(--green-b)', cor: 'var(--green-t)' };
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
      <span style={ROTULO}>{rotulo}</span>
      <span style={VALOR}>{valor}</span>
    </div>
  );
}

function enderecoEmUmaLinha(endereco: CadastroDoErp['endereco']): string {
  if (!endereco) return '';
  const rua = [endereco.logradouro, endereco.numero].filter(Boolean).join(', ');
  const praca = [endereco.cidade, endereco.uf].filter(Boolean).join('/');
  return [rua, endereco.complemento, endereco.bairro, praca, endereco.cep]
    .map(p => String(p ?? '').trim()).filter(Boolean).join(' · ');
}

export default function CadastroDoErpDoContato({ clienteId, documento, cadastro, cadastros }: {
  clienteId: string;
  documento: string;
  cadastro: CadastroDoErp | null;
  /** Todos os cadastros, mais recente primeiro. Vazia em ficha antiga, gravada
   *  antes de a lista existir — aí vale o `cadastro` sozinho. */
  cadastros: CadastroDoErp[];
}) {
  // Sem id e sem cadastro o contato nunca foi identificado — e aí o bloco não
  // existe, em vez de existir vazio. Numa organização do Wappia Atendimento é
  // sempre este o caso.
  if (!clienteId && !cadastro?.cliente_id) return null;

  // A lista é a fonte; o cadastro avulso é a reserva para a ficha gravada antes
  // de a lista existir. Sem essa reserva, quem foi identificado de manhã ficaria
  // com a ficha vazia à tarde.
  const lista = cadastros.length ? cadastros : (cadastro ? [cadastro] : []);
  if (!lista.length) return null;

  return (
    <SecaoRecolhivel id="sistema-de-gestao" titulo="Dados do ERP" contagem={lista.length > 1 ? lista.length : undefined}>

      {/* Mais de um cadastro é o comprador que atende por duas empresas — caso
          comum numa distribuidora. O primeiro da lista é o que a conversa está
          usando agora, e é o único que leva selo. */}
      {lista.map((item, i) => (
        <Cartao
          key={item.cliente_id ?? i}
          cadastro={item}
          documentoDaFicha={documento}
          emUso={i === 0 && (!clienteId || item.cliente_id === clienteId)}
        />
      ))}
    </SecaoRecolhivel>
  );
}

function Cartao({ cadastro: c, documentoDaFicha, emUso }: {
  cadastro: CadastroDoErp;
  documentoDaFicha: string;
  emUso: boolean;
}) {
  const id = c.cliente_id ?? '';
  const situacao = (c.situacao ?? '').trim();
  const cores = coresDaSituacao(situacao);
  const endereco = enderecoEmUmaLinha(c.endereco);
  const entrega = [c.cidade_entrega, c.uf_entrega].filter(Boolean).join('/');
  // Cadastro gravado antes de o documento entrar no item cai no da ficha.
  const documento = c.documento || documentoDaFicha;

  // A ordem segue a da conferência: primeiro quem é, depois o que muda imposto,
  // depois onde entrega, depois como falar com ele.
  const linhas: [string, string | undefined | null][] = [
    ['Razão social', c.nome],
    ['Documento', documento],
    ['Tipo de cliente', c.tipo_cliente],
    ['Segmento', c.segmento],
    ['Inscrição estadual', c.inscricao_estadual],
    ['Contribuinte de ICMS', c.contribuinte_icms === null || c.contribuinte_icms === undefined ? null : (c.contribuinte_icms ? 'Sim' : 'Não')],
    ['Endereço', endereco],
    ['Entrega em', entrega],
    ['Vendedor da carteira', c.vendedor_id],
    ['Empresas do grupo', c.empresas?.join(', ')],
    ['E-mail no cadastro', c.email],
    ['Telefone no cadastro', c.telefone],
  ];
  const preenchidas = linhas.filter(([, valor]) => String(valor ?? '').trim() !== '');

  return (
      <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            <span style={ROTULO}>Código do cliente</span>
            <span style={{ ...VALOR, fontWeight: 700, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{id || '—'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {emUso && (
              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 9px', background: 'var(--primary-soft)', color: 'var(--primary-t)' }}>
                em uso
              </span>
            )}
            {situacao && (
              <span style={{ fontSize: 11, fontWeight: 600, borderRadius: 'var(--r-pill)', padding: '2px 9px', background: cores.bg, color: cores.cor }}>
                {situacao}
              </span>
            )}
          </div>
        </div>

        {preenchidas.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 9 }}>
            {preenchidas.map(([rotulo, valor]) => <Linha key={rotulo} rotulo={rotulo} valor={String(valor)} />)}
          </div>
        )}

        {/* Quem confere integração pergunta isto antes de qualquer outra coisa:
            de quando é este dado, e de qual das duas operações ele veio. */}
        <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          {c.atualizado_em
            ? `Lido do sistema de gestão em ${dataBRemSP(c.atualizado_em)} às ${horaEmSP(c.atualizado_em)}`
            : 'Lido do sistema de gestão'}
          {c.origem === 'cadastro' ? ', no cadastro feito pelo agente' : c.origem === 'consulta' ? ', numa consulta pelo documento' : ''}
          {'. Estes campos não se editam por aqui — quem os atualiza é o sistema de gestão.'}
        </span>
      </div>
  );
}

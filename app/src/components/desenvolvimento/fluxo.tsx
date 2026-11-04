'use client'; // lê a configuração e as últimas chamadas da organização ativa pelo navegador

// A aba Fluxo: o que o agente faz, em que ordem, e o que ele chama em cada
// passo. **Ela documenta — não configura e não governa o motor.** A fonte da
// verdade continua sendo o código; os cards chegam prontos do servidor
// (`lib/fluxo/cartoes.ts`) e esta tela só acrescenta o que é da organização: o
// caminho configurado e a última chamada real de cada operação.

import { useEffect, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';
import { ROTULO_DA_OPERACAO } from '@/lib/erp/registro-de-chamadas';
import type { OperacaoDoErp } from '@/lib/erp/caminhos';
import {
  destinoDaOperacao,
  exemploDaOperacao,
  fluxosDaOrganizacao,
  type ExemploReal,
  type PassoDeConversa,
  type RoteiroDoFluxo,
  ateOCadastro,
} from '@/lib/fluxo/passos';
import { soAteOCadastro } from '@/lib/agente/so-ate-o-cadastro';
import type { CampoDaFerramenta, CartaoDeSistema, CartoesDosFluxos } from '@/lib/fluxo/cartoes';
import { contextoDoFluxo, ultimaChamadaOkPorOperacao } from '@/lib/data/integracao-chamadas';

const OPERACOES_DO_FLUXO: OperacaoDoErp[] = ['consultar_cliente', 'criar_cliente', 'cotar', 'criar_orcamento'];

const TITULO_DO_ROTEIRO: Record<RoteiroDoFluxo, string> = {
  vendas: 'Números de vendas',
  atendimento: 'Números de atendimento',
};

function comoJson(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

const rotuloPequeno = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text3)', marginBottom: 6,
} as const;

function Selo({ texto, cor }: { texto: string; cor: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: cor, border: `1px solid ${cor}`, whiteSpace: 'nowrap' }}>
      {texto}
    </span>
  );
}

function Trecho({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={rotuloPequeno}>{titulo}</div>
      {children}
    </div>
  );
}

function Json({ valor }: { valor: unknown }) {
  return (
    <pre
      style={{
        margin: 0, padding: '10px 12px', borderRadius: 8,
        background: 'var(--bg)', border: '1px solid var(--border)',
        fontSize: 12, lineHeight: 1.55, color: 'var(--text)',
        overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 280,
      }}
    >
      {comoJson(valor)}
    </pre>
  );
}

function ListaDeCampos({ campos }: { campos: CampoDaFerramenta[] }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {campos.map(c => (
        <li key={c.nome} style={{ fontSize: 13, color: 'var(--text2)' }}>
          <code style={{ color: 'var(--text)' }}>{c.nome}</code>{' '}
          <span style={{ color: 'var(--text3)' }}>({c.tipo})</span>{' '}
          {c.obrigatorio
            ? <strong style={{ color: 'var(--text)' }}>obrigatório</strong>
            : <span style={{ color: 'var(--text3)' }}>opcional</span>}
          {c.descricao && <>: {c.descricao}</>}
          {c.subcampos && c.subcampos.length > 0 && (
            <div style={{ marginTop: 4 }}><ListaDeCampos campos={c.subcampos} /></div>
          )}
        </li>
      ))}
    </ul>
  );
}

const estiloDoCard = {
  borderRadius: 10, padding: '14px 16px', background: 'var(--surface)',
  border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 12,
} as const;

function CardDeConversa({ passo, numero }: { passo: PassoDeConversa; numero: number }) {
  return (
    <div style={estiloDoCard}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>{numero}</span>
        <Selo texto="Conversa" cor="var(--text3)" />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{passo.titulo}</span>
      </div>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>{passo.oQuePrecisaDescobrir}</p>
    </div>
  );
}

function CardDeSistema({
  cartao, numero, config, temIntegracao, ultimas,
}: {
  cartao: CartaoDeSistema;
  numero: number;
  config: unknown;
  temIntegracao: boolean;
  ultimas: Partial<Record<OperacaoDoErp, ExemploReal>>;
}) {
  const operacao = cartao.operacao;
  const titulo = operacao ? (ROTULO_DA_OPERACAO[operacao] ?? operacao) : 'Buscar no catálogo';
  const destino = operacao ? destinoDaOperacao(operacao, config) : null;
  const exemplo = operacao ? exemploDaOperacao(operacao, ultimas) : null;

  return (
    <div style={{ ...estiloDoCard, borderColor: 'var(--primary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text3)' }}>{numero}</span>
        <Selo texto="Sistema" cor="var(--primary)" />
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{titulo}</span>
        <code style={{ fontSize: 12, color: 'var(--text3)' }}>{cartao.ferramenta}</code>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
          {cartao.posicaoNaLista}º na lista da IA
        </span>
      </div>

      <Trecho titulo="Quando a IA usa">
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>{cartao.descricao}</p>
      </Trecho>

      <Trecho titulo="Campos">
        <ListaDeCampos campos={cartao.campos} />
      </Trecho>

      <Trecho titulo="Endereço">
        {destino ? (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>
            <code style={{ color: 'var(--text)' }}>
              {exemplo?.tipo === 'chamada' ? `${exemplo.chamada.metodo} ` : ''}{destino.caminho}
            </code>{' '}
            {destino.padrao ? '(padrão)' : '(configurado)'}
            {!temIntegracao && '. Nenhum sistema de gestão cadastrado.'}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)' }}>
            Não chama o sistema de gestão. Busca no catálogo cadastrado aqui.
          </p>
        )}
      </Trecho>

      {operacao && exemplo && (
        <Trecho titulo="Última chamada que deu certo">
          {exemplo.tipo === 'chamada' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                {dataBRemSP(exemplo.chamada.quando)} às {horaEmSP(exemplo.chamada.quando)} ·{' '}
                <code>{exemplo.chamada.caminho}</code>
              </span>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
                <div><div style={rotuloPequeno}>Enviado</div><Json valor={exemplo.chamada.requisicao} /></div>
                <div><div style={rotuloPequeno}>Recebido</div><Json valor={exemplo.chamada.resposta} /></div>
              </div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', padding: '10px 12px', borderRadius: 8, border: '1px dashed var(--border)' }}>
              Nenhuma chamada ainda. A primeira aparece aqui e na aba Chamadas.
            </p>
          )}
        </Trecho>
      )}

      {cartao.erros.length > 0 && (
        <Trecho titulo="Erros possíveis">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {cartao.erros.map(e => <code key={e} style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>{e}</code>)}
          </div>
        </Trecho>
      )}

      {cartao.avisoDoTexto && (
        <Trecho titulo="O que o cliente recebe">
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text)', padding: '10px 12px', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--border)' }}>
            {cartao.avisoDoTexto}
          </p>
        </Trecho>
      )}
    </div>
  );
}

export default function FluxoDoAgente({ cartoes }: { cartoes: CartoesDosFluxos }) {
  const { orgId } = useOrg();
  const [dados, setDados] = useState<{
    orgId: string;
    config: unknown;
    temIntegracao: boolean;
    roteiros: string[];
    ultimas: Partial<Record<OperacaoDoErp, ExemploReal>>;
  } | null>(null);
  const carregando = dados?.orgId !== orgId;

  useEffect(() => {
    let ativo = true;
    const supabase = createClient();
    Promise.all([
      contextoDoFluxo(supabase, orgId),
      ultimaChamadaOkPorOperacao(supabase, orgId, OPERACOES_DO_FLUXO),
    ]).then(([contexto, ultimas]) => {
      if (ativo) setDados({ orgId, ...contexto, ultimas });
    });
    return () => { ativo = false; };
  }, [orgId]);

  if (carregando || !dados) {
    return <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>Carregando…</div>;
  }

  const fluxos = fluxosDaOrganizacao(dados.roteiros);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 780 }}>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
          A IA segue os passos de sistema nesta ordem.
        </p>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
          Numa mesma resposta ela pode pular passos ou fazer vários de uma vez.
        </p>
        {soAteOCadastro(orgId, 'vendas') && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text)' }}>
            Por enquanto a IA vai só até o cadastro. Depois, o vendedor segue com o orçamento.
          </p>
        )}
        <p style={{ margin: 0, fontSize: 12, color: 'var(--text3)' }}>
          Esta tela só mostra. Nada aqui muda o agente.
        </p>
      </div>

      {fluxos.map(roteiro => {
        const lista = soAteOCadastro(orgId, roteiro) ? ateOCadastro(cartoes[roteiro]) : cartoes[roteiro];
        return (
          <div key={roteiro} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fluxos.length > 1 && (
              <h2 style={{ margin: '4px 0 0', fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{TITULO_DO_ROTEIRO[roteiro]}</h2>
            )}
            {lista.map((cartao, i) => cartao.tipo === 'conversa'
              ? <CardDeConversa key={cartao.id} passo={cartao} numero={i + 1} />
              : (
                <CardDeSistema
                  key={cartao.id}
                  cartao={cartao}
                  numero={i + 1}
                  config={dados.config}
                  temIntegracao={dados.temIntegracao}
                  ultimas={dados.ultimas}
                />
              ))}
          </div>
        );
      })}
    </div>
  );
}

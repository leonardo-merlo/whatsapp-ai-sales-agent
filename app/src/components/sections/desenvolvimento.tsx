'use client'; // lista, filtro e o detalhe que abre e fecha são interativos

// A seção Desenvolvimento, em quatro abas: **Chamadas**, tudo que saiu daqui para
// o sistema de gestão do cliente e tudo que voltou; **Fluxo**, o que o agente
// deveria fazer e em que ordem; **Medidas**, os produtos que o sistema não
// conseguiu medir pela descrição; e **Configuração**, onde o endereço e a chave
// desse sistema são cadastrados.
//
// O nome é Desenvolvimento, e não Integração, porque quem abre estas telas é
// quem está ligando os dois sistemas — não o dono do negócio.
//
// **Para quem ela existe.** Durante a homologação, quem mais usa esta tela não
// é o dono do negócio — é o desenvolvedor do sistema do cliente, conferindo se
// o cadastro que a IA criou gravou com os dados certos e descobrindo sozinho
// por que uma chamada falhou. Sem ela, essa conferência passa toda pelo
// Leonardo abrindo log de servidor.
//
// Por isso a tela mostra o **corpo cru** dos dois lados, e não um resumo
// bonitinho: o que ele precisa comparar é campo a campo com a documentação
// dele. A credencial nunca aparece — ela não é gravada.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { dataBRemSP, horaEmSP } from '@/lib/fuso';
import { ROTULO_DA_OPERACAO } from '@/lib/erp/registro-de-chamadas';
import ConfiguracaoErp from '@/components/desenvolvimento/configuracao-erp';
import AvisosDaIntegracao from '@/components/desenvolvimento/avisos-da-integracao';
import FluxoDoAgente from '@/components/desenvolvimento/fluxo';
import MedidasDoCatalogo from '@/components/desenvolvimento/medidas';
import type { CartoesDosFluxos } from '@/lib/fluxo/cartoes';
import {
  DESENVOLVIMENTO_TABS,
  caminhoDaAba,
  type DesenvolvimentoTabKey,
} from '@/lib/desenvolvimento-tabs';
import {
  listarChamadas,
  resumoDaIntegracao,
  enderecoDaIntegracao,
  ultimosSyncs,
  LIMITE_DE_CHAMADAS,
  type UltimoSync,
  type ChamadaAoErp,
  type FiltroDeDesfecho,
  type ResumoDaIntegracao,
} from '@/lib/data/integracao-chamadas';

const fmtNumero = new Intl.NumberFormat('pt-BR');

/** O que dizer sobre cada desfecho. O texto do motivo é para quem vai agir:
 *  `credencial` e `indisponivel` são problema nosso ou de infraestrutura;
 *  `recusado` é regra de negócio do outro lado. */
const EXPLICACAO_DO_MOTIVO: Record<string, string> = {
  recusado: 'O sistema entendeu e recusou — é regra de negócio, não falha técnica.',
  nao_encontrado: 'O sistema respondeu que não existe. É uma resposta, não um erro.',
  credencial: 'Chave de acesso inválida ou sem permissão. É configuração, não dado.',
  indisponivel: 'O sistema não respondeu depois de todas as tentativas.',
};

function rotuloDaOperacao(operacao: string): string {
  return ROTULO_DA_OPERACAO[operacao] ?? operacao;
}

function corDoDesfecho(chamada: ChamadaAoErp): string {
  if (chamada.ok) return 'var(--green, #16a34a)';
  if (chamada.motivo === 'recusado' || chamada.motivo === 'nao_encontrado') return 'var(--amber, #d97706)';
  return 'var(--red, #dc2626)';
}

function textoDoDesfecho(chamada: ChamadaAoErp): string {
  if (chamada.ok) return 'OK';
  if (chamada.motivo === 'nao_encontrado') return 'Não encontrado';
  if (chamada.motivo === 'recusado') return 'Recusado';
  if (chamada.motivo === 'credencial') return 'Credencial';
  return 'Sem resposta';
}

function quandoLegivel(iso: string): string {
  return `${dataBRemSP(iso)} às ${horaEmSP(iso)}`;
}

/** JSON legível. Corpo que não é objeto (ou que veio nulo) vira um traço em vez
 *  da string "null", que parece bug na tela. */
function comoJson(valor: unknown): string {
  if (valor === null || valor === undefined) return '—';
  try {
    return JSON.stringify(valor, null, 2);
  } catch {
    return String(valor);
  }
}

function Bloco({ titulo, conteudo }: { titulo: string; conteudo: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', marginBottom: 6 }}>
        {titulo}
      </div>
      <pre
        style={{
          margin: 0, padding: '10px 12px', borderRadius: 8,
          background: 'var(--bg)', border: '1px solid var(--border)',
          fontSize: 12, lineHeight: 1.55, color: 'var(--text)',
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          maxHeight: 320,
        }}
      >
        {conteudo}
      </pre>
    </div>
  );
}

const ROTULO_DO_SYNC: Record<UltimoSync['tipo'], string> = { produtos: 'Produtos', regioes: 'Regiões' };

/** O desfecho em poucas palavras. Lista parcial é aviso, não erro: o que veio
 *  foi gravado e nada foi desativado. */
function desfechoDoSync(s: UltimoSync): { texto: string; cor: string } {
  if (s.status !== 'aplicado') {
    const texto = s.status === 'recusado_por_seguranca' ? 'Recusado' : s.status === 'formato_invalido' ? 'Formato inválido' : 'Falhou';
    return { texto: `${texto}: ${s.motivo ?? ''}`, cor: 'var(--red-t)' };
  }
  const base = `${fmtNumero.format(s.gravados)} gravados${s.desativados ? `, ${fmtNumero.format(s.desativados)} desativados` : ''}`;
  if (s.falhasDoErp.length) {
    return { texto: `${base}. Lista parcial: ${s.falhasDoErp.length} falhas do sistema, nada desativado`, cor: 'var(--amber-t)' };
  }
  return { texto: base, cor: 'var(--text2)' };
}

function UltimosSyncs({ syncs }: { syncs: UltimoSync[] }) {
  return (
    <div style={{ padding: '12px 16px', marginBottom: 18, borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>
        Último sync
      </div>
      {syncs.map(s => {
        const desfecho = desfechoDoSync(s);
        return (
          <div key={s.tipo} style={{ fontSize: 13, lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text)' }}>{ROTULO_DO_SYNC[s.tipo]}</strong>
            <span style={{ color: 'var(--text3)' }}> · {quandoLegivel(s.quando)} · </span>
            <span style={{ color: desfecho.cor }}>{desfecho.texto}</span>
            {s.falhasDoErp.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 12, color: 'var(--text3)', cursor: 'pointer' }}>Ver falhas</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--text2)' }}>
                  {s.falhasDoErp.map(f => <li key={f} style={{ wordBreak: 'break-word' }}>{f}</li>)}
                </ul>
              </details>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ChamadasTab() {
  const { orgId } = useOrg();
  const [filtro, setFiltro] = useState<FiltroDeDesfecho>('todas');
  const [sinal, setSinal] = useState(0);
  const atualizar = useCallback(() => setSinal(n => n + 1), []);
  const [aberta, setAberta] = useState<string | null>(null);

  // Mesmo padrão de `uso-ia`: o resultado carrega a chave da busca que o
  // produziu, e "carregando" é derivado disso — nada de setState para marcar
  // loading no corpo do efeito.
  const chave = `${filtro}|${sinal}`;
  const [resultado, setResultado] = useState<{
    chave: string;
    chamadas: ChamadaAoErp[];
    resumo: ResumoDaIntegracao;
    endereco: { enderecoBase: string; ativo: boolean } | null;
    syncs: UltimoSync[];
  } | null>(null);
  const carregando = resultado?.chave !== chave;

  useEffect(() => {
    let ativo = true;
    const supabase = createClient();
    Promise.all([
      listarChamadas(supabase, orgId, filtro),
      resumoDaIntegracao(supabase, orgId),
      enderecoDaIntegracao(supabase, orgId),
      ultimosSyncs(supabase, orgId),
    ]).then(([chamadas, resumo, endereco, syncs]) => {
      if (ativo) setResultado({ chave, chamadas, resumo, endereco, syncs });
    });
    return () => { ativo = false; };
  }, [orgId, filtro, chave]);

  const chamadas = carregando ? [] : (resultado?.chamadas ?? []);
  const resumo = carregando ? null : (resultado?.resumo ?? null);
  const endereco = resultado?.endereco ?? null;
  const syncs = resultado?.syncs ?? [];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button
          type="button"
          onClick={atualizar}
          className="hs"
          style={{
            padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--surface)', color: 'var(--text)', fontSize: 13, cursor: 'pointer',
          }}
        >
          Atualizar
        </button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 20px', maxWidth: 680 }}>
        Tudo que o agente pediu ao sistema de gestão e tudo que ele respondeu. O corpo das
        requisições aparece como foi enviado, para conferência campo a campo.{' '}
        <strong style={{ color: 'var(--text)' }}>A chave de acesso não é gravada</strong> e nunca
        aparece aqui.
      </p>

      {endereco && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '10px 14px', marginBottom: 16, borderRadius: 10,
            background: 'var(--surface)', border: '1px solid var(--border)',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text3)' }}>Sistema configurado:</span>
          <code style={{ fontSize: 12.5, color: 'var(--text)' }}>{endereco.enderecoBase}</code>
          <span
            style={{
              fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 999,
              color: endereco.ativo ? 'var(--green, #16a34a)' : 'var(--text3)',
              border: `1px solid ${endereco.ativo ? 'var(--green, #16a34a)' : 'var(--border)'}`,
            }}
          >
            {endereco.ativo ? 'ativa' : 'desativada'}
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        {[
          { label: 'Chamadas', valor: resumo ? fmtNumero.format(resumo.total) : '—' },
          { label: 'Com falha', valor: resumo ? fmtNumero.format(resumo.falhas) : '—' },
          { label: 'Última', valor: resumo?.ultimaEm ? quandoLegivel(resumo.ultimaEm) : '—' },
        ].map(card => (
          <div
            key={card.label}
            style={{
              flex: '1 1 180px', padding: '12px 16px', borderRadius: 10,
              background: 'var(--surface)', border: '1px solid var(--border)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>
              {card.label}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{card.valor}</div>
          </div>
        ))}
      </div>

      {syncs.length > 0 && <UltimosSyncs syncs={syncs} />}

      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['todas', 'falhas'] as FiltroDeDesfecho[]).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className="hs"
            style={{
              padding: '6px 14px', borderRadius: 999, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${filtro === f ? 'var(--primary)' : 'var(--border)'}`,
              background: filtro === f ? 'var(--primary)' : 'var(--surface)',
              color: filtro === f ? 'var(--on-primary, #fff)' : 'var(--text2)',
            }}
          >
            {f === 'todas' ? 'Todas' : 'Só as que falharam'}
          </button>
        ))}
      </div>

      {carregando && (
        <div style={{ padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--text3)' }}>Carregando…</div>
      )}

      {!carregando && chamadas.length === 0 && (
        <div
          style={{
            padding: '32px 24px', borderRadius: 10, textAlign: 'center',
            background: 'var(--surface)', border: '1px dashed var(--border)',
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
            {filtro === 'falhas' ? 'Nenhuma chamada falhou.' : 'Nenhuma chamada ainda.'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6 }}>
            {filtro === 'falhas'
              ? 'Tudo que saiu daqui foi respondido sem erro.'
              : 'Assim que o agente consultar ou cadastrar alguém no sistema de gestão, aparece aqui.'}
          </div>
        </div>
      )}

      {!carregando && chamadas.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {chamadas.map(c => {
            const expandida = aberta === c.id;
            return (
              <div
                key={c.id}
                style={{
                  borderRadius: 10, overflow: 'hidden',
                  background: 'var(--surface)', border: '1px solid var(--border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setAberta(expandida ? null : c.id)}
                  className="hs"
                  aria-expanded={expandida}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                    padding: '12px 16px', border: 0, background: 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span
                    style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                      color: corDoDesfecho(c), border: `1px solid ${corDoDesfecho(c)}`, whiteSpace: 'nowrap',
                    }}
                  >
                    {textoDoDesfecho(c)}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                    {rotuloDaOperacao(c.operacao)}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                    {c.statusHttp === null ? 'sem resposta' : `HTTP ${c.statusHttp}`}
                    {c.tentativas > 1 && ` · ${c.tentativas} tentativas`}
                    {c.duracaoMs !== null && ` · ${fmtNumero.format(c.duracaoMs)} ms`}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                    {quandoLegivel(c.quando)}
                  </span>
                </button>

                {expandida && (
                  <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {!c.ok && (
                      <div
                        style={{
                          padding: '10px 12px', borderRadius: 8, fontSize: 13,
                          background: 'var(--bg)', border: `1px solid ${corDoDesfecho(c)}`,
                          color: 'var(--text)',
                        }}
                      >
                        <strong>{c.codigo ?? 'sem código'}</strong>
                        {c.mensagem && <> — {c.mensagem}</>}
                        {c.motivo && EXPLICACAO_DO_MOTIVO[c.motivo] && (
                          <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                            {EXPLICACAO_DO_MOTIVO[c.motivo]}
                          </div>
                        )}
                      </div>
                    )}

                    <div style={{ fontSize: 12, color: 'var(--text3)' }}>
                      <code>{c.metodo} {c.caminho}</code>
                      {c.chaveDeIdempotencia && <> · Idempotency-Key <code>{c.chaveDeIdempotencia}</code></>}
                    </div>

                    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                      <Bloco titulo="Enviado" conteudo={comoJson(c.requisicao)} />
                      <Bloco titulo="Recebido" conteudo={comoJson(c.resposta)} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {chamadas.length >= LIMITE_DE_CHAMADAS && (
            <p style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', margin: '8px 0 0' }}>
              Mostrando as {LIMITE_DE_CHAMADAS} chamadas mais recentes.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Mesma barra de abas de Configurações — as duas seções são da mesma família e
 *  não deveriam parecer telas de produtos diferentes. */
function AbaBar({ active, onSelect }: { active: DesenvolvimentoTabKey; onSelect: (k: DesenvolvimentoTabKey) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      {DESENVOLVIMENTO_TABS.map(t => {
        const sel = active === t.key;
        return (
          <button key={t.key} onClick={() => onSelect(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', color: sel ? 'var(--primary)' : 'var(--text3)', borderBottom: `2px solid ${sel ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export default function DesenvolvimentoSection({
  abaInicial = 'chamadas',
  cartoesDoFluxo,
}: {
  abaInicial?: DesenvolvimentoTabKey;
  /** Só a aba Fluxo usa: os cards são montados no servidor, porque as
   *  ferramentas do agente não podem ir ao navegador. */
  cartoesDoFluxo?: CartoesDosFluxos;
}) {
  const router = useRouter();
  // Quem diz qual aba está aberta é o endereço, e só ele: sem estado paralelo
  // não há como a barra apontar para uma aba e o conteúdo ser de outra.
  const aba = DESENVOLVIMENTO_TABS.find(t => t.key === abaInicial) ?? DESENVOLVIMENTO_TABS[0];

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>Desenvolvimento</span>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>{aba.label}</h1>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>{aba.desc}</span>
        </div>

        <AbaBar active={aba.key} onSelect={k => router.push(caminhoDaAba(k))} />

        {aba.key === 'chamadas' && <ChamadasTab />}
        {aba.key === 'fluxo' && cartoesDoFluxo && <FluxoDoAgente cartoes={cartoesDoFluxo} />}
        {aba.key === 'medidas' && <MedidasDoCatalogo />}
        {aba.key === 'configuracao' && (
          <>
            <AvisosDaIntegracao />
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '18px' }}>
              <ConfiguracaoErp />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

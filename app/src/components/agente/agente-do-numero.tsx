'use client'; // formulário com estado local — nada disso existe no servidor

// A aba Agente quando se está configurando UM número.
//
// **Esta tela responde uma pergunta só: como a IA fala neste número.** Quem o
// número é (o papel) e de quem ele é (o vendedor dono) passaram para
// Configurações → Integração WhatsApp em 15/09, e o código do vendedor no
// sistema e o WhatsApp de aviso para Configurações → Equipe — porque são dados
// **da pessoa**, não do número. Aqui ficou uma linha dizendo o que o número é
// hoje, com o caminho para mudar.
//
// O motivo é a régua do redesenho: *Integração responde quais números existem,
// o que cada um faz e de quem é; a tela do agente responde como a IA fala.*
// Enquanto as duas telas escreviam as mesmas colunas, salvar numa desfazia o
// que tinha sido decidido na outra. Por isso o `salvarAgenteDoNumero` daqui
// **omite** `roteiro`, `memberId`, `codigoErp` e `telefoneWhatsapp`: omitir é o
// jeito de dizer "não mexi nisto".
//
// **Herança à vista.** Todo campo em branco mostra o valor do padrão em cinza
// com a etiqueta "herdado" do lado, e só vira do número quando alguém escreve.
// Um campo que já foi escrito ganha o botão de voltar ao herdado. Sem isso,
// configurar sete vendedores significaria preencher sete vezes o mesmo tom de
// voz — e esquecer uma vez deixa um número diferente dos outros sem ninguém
// saber por quê.
//
// **Padrão vazio não inventa frase.** Quando o padrão não tem nada, o campo
// fica vazio de verdade: sem cinza e sem etiqueta. A frase de ajuda em cinza
// ocupava o lugar do valor e foi lida como se fosse a mensagem de boas-vindas.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useApp } from '@/lib/app-context';
import {
  carregarAgenteDoNumero, listarMembrosDaEquipe, salvarAgenteDoNumero,
  type AgenteDoNumero, type CamposDoAgente, type MembroDaEquipe, type NumeroConfiguravel,
  type RoteiroDoNumero, type Tom,
} from '@/lib/data/agente-do-numero';
import { resumoDoCatalogo, type ResumoDoCatalogo } from '@/lib/catalogo/consultar';

/** O que este número é, na frase curta que a tela mostra. O detalhe (e a
 *  troca) mora em Configurações → Integração WhatsApp. */
const DESCRICAO_DO_NUMERO: Record<RoteiroDoNumero, string> = {
  atendimento: 'Número de atendimento',
  vendas: 'Número de vendas',
  copiloto: 'Número copiloto (só avisos)',
};

const TONS: { key: Tom; label: string; emoji: string }[] = [
  { key: 'simpatico', label: 'Simpático', emoji: '😊' },
  { key: 'direto', label: 'Direto', emoji: '🎯' },
  { key: 'formal', label: 'Formal', emoji: '🎩' },
  { key: 'descontraido', label: 'Descontraído', emoji: '😎' },
];

const campo = {
  width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13.5, color: 'var(--text)',
  fontFamily: 'inherit', boxSizing: 'border-box' as const,
};

const rotulo = { fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' };
const ajuda = { fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 };

function Cartao({ titulo, descricao, children }: { titulo: string; descricao?: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>{titulo}</span>
        {descricao && <span style={ajuda}>{descricao}</span>}
      </div>
      {children}
    </div>
  );
}

/** A etiqueta que diz de onde veio o valor que está valendo neste campo. */
function SeloDeHeranca({ herdado, onVoltar }: { herdado: boolean; onVoltar: () => void }) {
  if (herdado) {
    return (
      <span style={{ fontSize: 10.5, fontWeight: 700, background: 'var(--gray-b)', color: 'var(--text3)', borderRadius: 'var(--r-pill)', padding: '2px 9px', flexShrink: 0 }}>
        herdado
      </span>
    );
  }
  return (
    <button
      onClick={onVoltar}
      title="Voltar a usar o valor do padrão"
      style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', padding: 2, flexShrink: 0 }}
    >
      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
      voltar ao herdado
    </button>
  );
}

/** Um campo de texto com herança: vazio mostra o valor do padrão como
 *  `placeholder`, que é a forma de "cinza" que o navegador já dá de graça — e
 *  que some no instante em que se digita, sem truque nenhum de foco.
 *
 *  **Padrão vazio não vira frase.** Quando não há o que herdar, o campo fica
 *  vazio e sem etiqueta: o cinza explicativo que ficava ali ("segue o padrão de
 *  todos os números") ocupa o lugar exato onde o valor apareceria, e foi lido
 *  como se fosse a mensagem de boas-vindas. */
function CampoHerdado({
  id, label, sub, valor, doPadrao, linhas, onChange,
}: {
  id: string; label: string; sub?: string; valor: string; doPadrao: string;
  linhas: number; onChange: (v: string) => void;
}) {
  const herdado = valor.trim() === '';
  const temPadrao = doPadrao.trim() !== '';
  // O selo aparece quando há algo a MOSTRAR (herdado && temPadrao, o cinza do
  // padrão) OU algo a DESFAZER (!herdado, o número tem texto próprio — voltar
  // ao herdado limpa isto, mesmo que o padrão esteja vazio). Sem o `!herdado`
  // aqui, um vendedor com boas-vindas própria e padrão vazio (o caso do
  // Leonardo em 14/09) ficava sem o botão de apagar o que escreveu.
  const mostrarSelo = !herdado || temPadrao;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 20 }}>
        <label style={rotulo} htmlFor={id}>{label}</label>
        {mostrarSelo && <SeloDeHeranca herdado={herdado} onVoltar={() => onChange('')} />}
      </div>
      <textarea
        id={id} value={valor} onChange={e => onChange(e.target.value)} rows={linhas}
        placeholder={temPadrao ? doPadrao : ''}
        style={{ ...campo, resize: 'vertical', lineHeight: 1.55 }}
      />
      {sub && <span style={ajuda}>{sub}</span>}
      {herdado && temPadrao && (
        <span style={{ ...ajuda, fontStyle: 'italic' }}>
          O texto em cinza é o do padrão de todos os números. Escreva aqui para valer só neste número.
        </span>
      )}
    </div>
  );
}

export default function AgenteDoNumeroPainel({ numero, onSalvo, onMudar }: {
  numero: NumeroConfiguravel;
  onSalvo?: () => void;
  /** Avisa o que está na tela deste número, para o simulador testar sem salvar. */
  onMudar?: (proprio: CamposDoAgente) => void;
}) {
  const org = useOrg();
  const { dispatch, showToast } = useApp();
  const router = useRouter();
  const supabase = useRef(createClient()).current;

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [dados, setDados] = useState<AgenteDoNumero | null>(null);
  const [membros, setMembros] = useState<MembroDaEquipe[]>([]);
  const [catalogo, setCatalogo] = useState<ResumoDoCatalogo | null>(null);

  // O componente é remontado a cada número (o pai passa `key={numero.id}`),
  // então `carregando` já nasce `true` e o efeito não precisa mexer nele antes
  // do primeiro await — `setState` síncrono dentro de efeito é renderização em
  // cascata.
  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const [config, equipe, resumo] = await Promise.all([
          carregarAgenteDoNumero(supabase, org.orgId, numero),
          listarMembrosDaEquipe(supabase, org.orgId),
          resumoDoCatalogo(supabase, org.orgId),
        ]);
        if (!ativo) return;
        setDados(config);
        setMembros(equipe);
        setCatalogo(resumo);
      } catch {
        if (ativo) showToast('Não foi possível carregar a configuração deste número');
      } finally {
        if (ativo) setCarregando(false);
      }
    })();
    return () => { ativo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numero.id, org.orgId]);

  const proprio = dados?.proprio;
  useEffect(() => {
    if (proprio) onMudar?.(proprio);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proprio]);

  function mudarCampo<K extends keyof CamposDoAgente>(chave: K, valor: CamposDoAgente[K]) {
    setDados(atual => (atual ? { ...atual, proprio: { ...atual.proprio, [chave]: valor } } : atual));
  }

  function irParaIntegracao() {
    dispatch({ type: 'SET', key: 'configTab', value: 'whatsapp' });
    router.push('/configuracoes');
  }

  async function handleSalvar() {
    if (!dados || salvando) return;
    setSalvando(true);
    try {
      // **Só o que esta tela edita.** `roteiro`, `memberId`, `codigoErp` e
      // `telefoneWhatsapp` vão de fora de propósito: ausentes querem dizer "não
      // mexi", e mandá-los daqui desfaria o que foi decidido em Integração.
      await salvarAgenteDoNumero(supabase, org.orgId, numero, {
        ativo: dados.ativo,
        proprio: dados.proprio,
      });
      setDados({ ...dados, temConfigPropria: true });
      showToast('Salvo — já vale nas conversas deste número');
      onSalvo?.();
    } catch {
      showToast('Erro ao salvar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando || !dados) {
    return <div style={{ padding: 24, fontSize: 13, color: 'var(--text3)' }}>Carregando a configuração deste número…</div>;
  }

  const tomEfetivo = dados.proprio.tom ?? dados.padrao.tom ?? 'simpatico';
  const dono = membros.find(m => m.id === dados.memberId) ?? null;
  const quemEle =
    DESCRICAO_DO_NUMERO[dados.roteiro]
    + (dados.roteiro === 'vendas' ? ` · ${dono ? dono.nome : 'sem vendedor definido'}` : '');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

      {/* Quem é este número: só o que ele é hoje, e o caminho para mudar. A
          escolha em si mora em Integração WhatsApp desde 15/09 — ter os dois
          lugares escrevendo as mesmas colunas era o que fazia um desfazer o
          outro. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 13px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--text2)' }}>
            <strong style={{ color: 'var(--text)' }}>{quemEle}</strong>
            {numero.telefone ? ` · ${numero.telefone}` : ''}
          </span>
          <button
            onClick={irParaIntegracao}
            style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}
          >
            mudar em Configurações → Integração WhatsApp
          </button>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
          <input type="checkbox" checked={dados.ativo} onChange={e => setDados({ ...dados, ativo: e.target.checked })} />
          A IA responde neste número
        </label>

        {!dados.temConfigPropria && (
          <span style={ajuda}>
            Este número ainda não tem nada próprio: hoje ele segue inteiro o padrão de todos os números.
            O que você escrever aqui passa a valer só para ele.
          </span>
        )}
      </div>

      {dados.roteiro === 'copiloto' ? (
        <Cartao titulo="Número copiloto" descricao="Não há o que configurar aqui.">
          <span style={ajuda}>
            O copiloto só <strong>recebe</strong> avisos: orçamento criado, cliente esperando retorno,
            sistema indisponível. Ninguém conversa com a IA por este número, então ele não tem tom de voz,
            instrução nem catálogo.
          </span>
        </Cartao>
      ) : (
        <>
          <Cartao
            titulo="Como a IA fala neste número"
            descricao="Campo em branco segue o padrão de todos os números. Escreva só o que muda aqui."
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <span style={rotulo}>Tom de voz</span>
                <SeloDeHeranca herdado={dados.proprio.tom === null} onVoltar={() => mudarCampo('tom', null)} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {TONS.map(t => {
                  const escolhido = tomEfetivo === t.key;
                  const herdado = dados.proprio.tom === null;
                  return (
                    <button key={t.key} onClick={() => mudarCampo('tom', t.key)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 7,
                        border: `1px solid ${escolhido ? 'var(--primary)' : 'var(--border)'}`,
                        background: escolhido && !herdado ? 'var(--primary-soft)' : 'var(--surface)',
                        color: escolhido ? 'var(--primary-t)' : 'var(--text3)',
                        opacity: escolhido && herdado ? 0.65 : 1,
                        borderRadius: 'var(--r-pill)', padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }} className="hs">
                      <span>{t.emoji}</span>
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <span style={ajuda}>
                A IA fala com o cliente neste número também — inclusive no de vendedor. O tom vale para
                as frases dela, não para os valores, que são escritos pelo sistema.
              </span>
            </div>

            <CampoHerdado
              id="prompt-do-numero" label="Instrução principal" valor={dados.proprio.prompt}
              doPadrao={dados.padrao.prompt} linhas={6} onChange={v => mudarCampo('prompt', v)}
              sub={dados.roteiro === 'vendas'
                ? 'Ela se apresenta como assistente do vendedor, nunca como o vendedor.'
                : 'A personalidade e as regras que guiam as respostas neste número.'}
            />

            <CampoHerdado
              id="limitacoes-do-numero" label="O que a IA não pode fazer" valor={dados.proprio.limitacoes}
              doPadrao={dados.padrao.limitacoes} linhas={5} onChange={v => mudarCampo('limitacoes', v)}
              sub="Escreva em frases, como você diria a um vendedor novo. Isto entra no prompt com prioridade sobre o resto."
            />

            <CampoHerdado
              id="boas-vindas-do-numero" label="Mensagem de boas-vindas" valor={dados.proprio.welcomeMsg}
              doPadrao={dados.padrao.welcomeMsg} linhas={2} onChange={v => mudarCampo('welcomeMsg', v)}
              sub="A ideia que a IA segue na primeira mensagem de cada conversa."
            />

            <CampoHerdado
              id="info-do-numero" label="Informações adicionais" valor={dados.proprio.infoAdicional}
              doPadrao={dados.padrao.infoAdicional} linhas={4} onChange={v => mudarCampo('infoAdicional', v)}
              sub="Qualquer coisa que a IA precise saber neste número e que não coube acima."
            />
          </Cartao>

          <Cartao titulo="O que vem da empresa, e não muda por número">
            <span style={ajuda}>
              <strong>Produtos</strong>
              {catalogo && catalogo.produtos > 0
                ? ` — ${catalogo.produtos.toLocaleString('pt-BR')} item(ns) no catálogo importado, mais os digitados.`
                : ' — a lista que a IA consulta.'}
              {' '}Eles têm aba própria. Horário, localização, dúvidas frequentes e a descrição do negócio
              estão na aba <strong>Empresa</strong>, e valem igual em todos os números: é o que a empresa
              é, não o que cada número faz.
            </span>
            {dados.roteiro === 'vendas' && (
              <span style={ajuda}>
                O <strong>código do vendedor no sistema</strong> e o <strong>WhatsApp</strong> para onde o
                copiloto avisa são dados da pessoa, e se editam em{' '}
                <strong>Configurações → Equipe</strong>.
              </span>
            )}
            {dados.roteiro === 'atendimento' && (
              <span style={ajuda}>
                O <strong>questionário</strong>, os <strong>desfechos</strong> e as regras de{' '}
                <strong>quando passar para uma pessoa</strong> ficam no padrão de todos os números —
                escolha &quot;O padrão de todos os números&quot; no seletor acima para editá-los.
              </span>
            )}
          </Cartao>
        </>
      )}

      {/* Salvar põe no ar, neste número e no padrão. O motor lê
          `ai_agent_config` ao vivo (`agente/config-do-numero.ts`); o botão
          Publicar saiu de vez em 29/09 (item 9). */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ ...ajuda, flex: 1, minWidth: 220 }}>
          O que vale neste número entra no ar assim que você salva.
        </span>
        <button
          onClick={handleSalvar} disabled={salvando}
          style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '10px 18px', fontSize: 13.5, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', flexShrink: 0 }}
          className="hp"
        >
          {salvando ? 'Salvando…' : 'Salvar e publicar este número'}
        </button>
      </div>
    </div>
  );
}

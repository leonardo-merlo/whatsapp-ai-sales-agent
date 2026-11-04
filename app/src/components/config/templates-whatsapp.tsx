'use client'; // lê o catálogo com o client do usuário (RLS) e mantém o formulário em estado local

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useApp } from '@/lib/app-context';
import {
  contarVariaveis, nomeDaCategoria, problemaNoTemplate, rotuloDoStatus, slugDoNome,
  type CategoriaDoTemplate,
} from '@/lib/whatsapp/regras-de-template';
import {
  FONTE_PRECOS_META, PRECOS_META_CONSULTADOS_EM, PRECO_POR_MENSAGEM_BRL,
  PRECO_SERVICO_BRL_A_PARTIR_DE_OUT_2026, SERVICO_GRATIS_POR_MES, reaisPorMensagem,
} from '@/lib/whatsapp/precos-meta';
import { modelosDoProduto } from '@/lib/whatsapp/templates';

interface LinhaTemplate {
  id: string;
  nome: string;
  categoria: string;
  corpo: string;
  status: string;
  motivo_rejeicao: string | null;
  origem: string;
  waba_id: string;
  oculto: boolean;
}

interface NumeroComWaba {
  id: string;
  telefone: string | null;
  waba_id: string | null;
  papel: string;
}

const campo = {
  background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)',
  padding: '9px 12px', fontSize: 13.5, color: 'var(--text)', width: '100%',
} as const;

const rotuloCampo = {
  fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em',
} as const;

function corDoStatus(status: string): { bg: string; t: string; bb: string } {
  if (status === 'APPROVED') return { bg: 'var(--green-b)', t: 'var(--green-t)', bb: 'var(--green-bb)' };
  if (status === 'REJECTED' || status === 'DISABLED' || status === 'PAUSED') return { bg: 'var(--red-b)', t: 'var(--red-t)', bb: 'var(--red-bb)' };
  return { bg: 'var(--amber-b)', t: 'var(--amber-t)', bb: 'var(--amber-bb)' };
}

function Pilula({ texto, bg, cor, borda }: { texto: string; bg: string; cor: string; borda: string }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, background: bg, color: cor, border: `1px solid ${borda}`, borderRadius: 'var(--r-pill)', padding: '1px 9px', flexShrink: 0 }}>
      {texto}
    </span>
  );
}

/** O mesmo cartão para template e sugestão: nome e etiquetas à esquerda, a
 *  ação (quando existe) à direita, o texto embaixo. */
function CartaoTemplate({ nome, corpo, etiquetas, acao, rodape, tracejado }: {
  nome: string; corpo: string; etiquetas: React.ReactNode; acao?: React.ReactNode; rodape?: React.ReactNode; tracejado?: boolean;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface2)', border: `1px ${tracejado ? 'dashed' : 'solid'} var(--border)`, borderRadius: 'var(--r-ctrl)', padding: '11px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', wordBreak: 'break-all' }}>{nome}</span>
        {etiquetas}
        {acao && <div style={{ marginLeft: 'auto' }}>{acao}</div>}
      </div>
      <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{corpo}</span>
      {rodape}
    </div>
  );
}

function BotaoPequeno({ onClick, ocupado, desativado, textoOcupado = 'Salvando…', children }: {
  onClick: () => void; ocupado: boolean; desativado?: boolean; textoOcupado?: string; children: React.ReactNode;
}) {
  return (
    <button onClick={onClick} disabled={ocupado || desativado} className="hs"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '5px 11px', fontSize: 12, fontWeight: 600, color: 'var(--text)', cursor: ocupado ? 'wait' : 'pointer' }}>
      {ocupado ? textoOcupado : children}
    </button>
  );
}

function EtiquetaCategoria({ categoria }: { categoria: string }) {
  return <Pilula texto={nomeDaCategoria(categoria)} bg="var(--gray-b)" cor="var(--gray-t)" borda="var(--gray-bb)" />;
}

function Regras() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px' }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>Antes de enviar</span>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.5 }}>
        <li>Depois que o cliente escreve, a IA responde livremente por 24 horas. Fora disso, só template aprovado.</li>
        <li>
          Template é cobrado pela Meta, na sua conta com ela, por mensagem entregue:
          Marketing {reaisPorMensagem(PRECO_POR_MENSAGEM_BRL.MARKETING)}, Utilidade {reaisPorMensagem(PRECO_POR_MENSAGEM_BRL.UTILITY)}.
          A Wappia não cobra por mensagem.
        </li>
        <li>
          A partir de 01/10/2026 a Meta também cobra as respostas dentro das 24 horas:
          {' '}{SERVICO_GRATIS_POR_MES.toLocaleString('pt-BR')} grátis por mês por número, depois {reaisPorMensagem(PRECO_SERVICO_BRL_A_PARTIR_DE_OUT_2026)} cada.
        </li>
        <li>Sem forma de pagamento cadastrada na Meta, o template não sai.</li>
        <li>Mandar template para quem não pediu contato derruba a qualidade do número e pode bloqueá-lo.</li>
        <li>A Meta pode mudar a categoria de um template, e o preço muda junto. Avisamos no sino.</li>
      </ul>
      <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>
        Preços da <a href={FONTE_PRECOS_META} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>Meta para o Brasil</a>, consultados em {PRECOS_META_CONSULTADOS_EM}.
      </span>
    </div>
  );
}

export default function TemplatesWhatsAppSection() {
  const { orgId, produtoAtivo } = useOrg();
  const { showToast } = useApp();
  const [templates, setTemplates] = useState<LinhaTemplate[] | null>(null);
  const [numeros, setNumeros] = useState<NumeroComWaba[]>([]);
  const [sinal, setSinal] = useState(0);
  const [atualizando, setAtualizando] = useState(false);

  const [nomeAmigavel, setNomeAmigavel] = useState('');
  const [categoria, setCategoria] = useState<CategoriaDoTemplate | ''>('');
  const [corpo, setCorpo] = useState('');
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [numeroId, setNumeroId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [pedindoModelo, setPedindoModelo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Sugestões abertas: o nome vira um cartão com o texto e o botão de enviar.
  const [abertas, setAbertas] = useState<string[]>([]);
  const [ocultando, setOcultando] = useState<string | null>(null);
  const [verEscondidos, setVerEscondidos] = useState(false);

  // Ao abrir a aba, busca na Meta o que cada conta já tem. Só lê. Sem isto o
  // catálogo não conhece o que foi criado à mão no painel da Meta, e a tela
  // sugere criar o que a conta já tem.
  const jaBuscou = useRef(false);
  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    setAtualizando(true);
    fetch('/api/templates/atualizar', { method: 'POST' })
      .catch(() => null)
      .finally(() => { setAtualizando(false); setSinal(s => s + 1); });
  }, []);

  useEffect(() => {
    let cancelado = false;
    const supabase = createClient();
    Promise.all([
      supabase.from('wa_templates')
        .select('id, nome, categoria, corpo, status, motivo_rejeicao, origem, waba_id, oculto')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false }),
      supabase.from('wa_numbers').select('id, telefone, waba_id, papel').eq('organization_id', orgId).eq('ativo', true),
    ]).then(([t, n]) => {
      if (cancelado) return;
      setTemplates(t.data ?? []);
      setNumeros(n.data ?? []);
    });
    return () => { cancelado = true; };
  }, [orgId, sinal]);

  // Tudo na tela é da conta do número escolhido: template é da conta do
  // WhatsApp e só vale para os números dela. O seletor só aparece quando há
  // mais de uma conta.
  const comWaba = useMemo(() => numeros.filter(n => n.waba_id), [numeros]);
  const variasWabas = new Set(comWaba.map(n => n.waba_id)).size > 1;
  const numeroEscolhido = numeroId || comWaba[0]?.id || '';
  const wabaEscolhida = comWaba.find(n => n.id === numeroEscolhido)?.waba_id ?? null;
  const daConta = (templates ?? []).filter(t => t.waba_id === wabaEscolhida);
  // Rascunho nunca foi à Meta: é sugestão, não template da conta.
  const naMeta = daConta.filter(t => t.status !== 'RASCUNHO');
  // Escondido continua aprovado na Meta; só sai das listas de escolha.
  const visiveis = naMeta.filter(t => !t.oculto);
  const escondidos = naMeta.filter(t => t.oculto);

  async function alternarOculto(id: string, oculto: boolean) {
    setOcultando(id);
    try {
      const resp = await fetch('/api/templates/ocultar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, oculto }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      if (!resp.ok) showToast(json.error ?? 'Não foi possível salvar.');
      else setSinal(s => s + 1);
    } finally {
      setOcultando(null);
    }
  }

  // Sugestões: os textos guardados para esta conta (rascunhos, como os da
  // Distribuidora Exemplo) e os modelos da Wappia que ela ainda não tem, só os do produto
  // na tela. Os de vendas só na conta com copiloto.
  const temCopiloto = comWaba.some(n => n.waba_id === wabaEscolhida && n.papel === 'copiloto');
  const sugestoes: { nome: string; corpo: string; categoria: string; enviar: () => Promise<void> }[] = [
    ...daConta.filter(t => t.status === 'RASCUNHO')
      .map(t => ({ nome: t.nome, corpo: t.corpo, categoria: t.categoria, enviar: () => enviarRascunho(t.id, t.nome) })),
    ...modelosDoProduto(produtoAtivo, temCopiloto)
      .filter(m => !daConta.some(t => t.nome === m.nome))
      .map(m => ({ nome: m.nome, corpo: m.corpo, categoria: m.categoria, enviar: () => pedirModelo(m.nome) })),
  ];

  function alternarSugestao(nome: string) {
    setAbertas(a => (a.includes(nome) ? a.filter(n => n !== nome) : [...a, nome]));
  }

  async function pedirModelo(nome: string) {
    setPedindoModelo(nome);
    try {
      const resp = await fetch('/api/templates/padrao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome, waNumberId: numeroEscolhido }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      showToast(resp.ok ? 'Enviado para a Meta.' : (json.error ?? 'Não foi possível enviar.'));
      if (resp.ok) {
        setAbertas(a => a.filter(n => n !== nome));
        setSinal(s => s + 1);
      }
    } finally {
      setPedindoModelo(null);
    }
  }

  async function enviarRascunho(id: string, nome: string) {
    setPedindoModelo(nome);
    try {
      const resp = await fetch('/api/templates/rascunho', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      showToast(resp.ok ? 'Enviado para a Meta.' : (json.error ?? 'Não foi possível enviar.'));
      if (resp.ok) {
        setAbertas(a => a.filter(n => n !== nome));
        setSinal(s => s + 1);
      }
    } finally {
      setPedindoModelo(null);
    }
  }

  const quantas = contarVariaveis(corpo) ?? 0;
  const exemplosVisiveis = Array.from({ length: quantas }, (_, i) => exemplos[i] ?? '');
  const slug = slugDoNome(nomeAmigavel);

  function inserirVariavel() {
    setCorpo(c => `${c}{{${quantas + 1}}}`);
  }

  async function atualizar() {
    setAtualizando(true);
    try {
      const resp = await fetch('/api/templates/atualizar', { method: 'POST' });
      const json = await resp.json().catch(() => ({})) as { error?: string; falhas?: string[] };
      if (!resp.ok) showToast(json.error ?? 'Não foi possível atualizar.');
      else if (json.falhas?.length) showToast(`Atualizado, com ${json.falhas.length} falha(s).`);
      else showToast('Templates atualizados.');
      setSinal(s => s + 1);
    } finally {
      setAtualizando(false);
    }
  }

  async function criar() {
    if (!categoria) { setErro('Escolha a categoria.'); return; }
    const problema = problemaNoTemplate({
      nome: slug, categoria, corpo: corpo.trim(),
      variaveis: exemplosVisiveis.map((exemplo, i) => ({ nome: `variavel_${i + 1}`, exemplo })),
    });
    if (problema) { setErro(problema); return; }
    setErro(null);
    setSalvando(true);
    try {
      const resp = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeAmigavel, categoria, corpo, exemplos: exemplosVisiveis, waNumberId: numeroEscolhido }),
      });
      const json = await resp.json().catch(() => ({})) as { error?: string };
      if (!resp.ok) { setErro(json.error ?? 'Não foi possível criar.'); return; }
      showToast('Enviado para a Meta.');
      setNomeAmigavel(''); setCategoria(''); setCorpo(''); setExemplos([]);
      setSinal(s => s + 1);
    } finally {
      setSalvando(false);
    }
  }

  if (!comWaba.length && templates !== null) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--text3)' }}>Conecte um número do WhatsApp para usar templates.</span>
        <Regras />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          Mensagens aprovadas pela Meta para falar com o cliente fora das 24 horas.
        </span>
        <button onClick={atualizar} disabled={atualizando} className="hs"
          style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '7px 13px', fontSize: 12.5, fontWeight: 600, color: 'var(--text)', cursor: atualizando ? 'wait' : 'pointer', flexShrink: 0 }}>
          {atualizando ? 'Atualizando…' : 'Atualizar status'}
        </button>
      </div>

      {variasWabas && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={rotuloCampo}>Número</label>
          <select value={numeroEscolhido} onChange={e => { setNumeroId(e.target.value); setAbertas([]); }} style={campo}>
            {comWaba.map(n => <option key={n.id} value={n.id}>{n.telefone ?? n.id}</option>)}
          </select>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Templates</span>
        {templates === null && <span style={{ fontSize: 13, color: 'var(--text3)' }}>Carregando…</span>}
        {templates !== null && visiveis.length === 0 && (
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>{atualizando ? 'Buscando na Meta…' : 'Este número ainda não tem templates.'}</span>
        )}
        {visiveis.map(t => {
          const cor = corDoStatus(t.status);
          return (
            <CartaoTemplate key={t.id} nome={t.nome} corpo={t.corpo}
              etiquetas={<>
                <Pilula texto={rotuloDoStatus(t.status)} bg={cor.bg} cor={cor.t} borda={cor.bb} />
                <EtiquetaCategoria categoria={t.categoria} />
              </>}
              acao={t.status === 'APPROVED' ? <BotaoPequeno onClick={() => alternarOculto(t.id, true)} ocupado={ocultando === t.id}>Esconder</BotaoPequeno> : undefined}
              rodape={t.status === 'REJECTED'
                ? <span style={{ fontSize: 12, color: 'var(--red-t)' }}>Motivo: {t.motivo_rejeicao ?? 'a Meta não informou'}</span>
                : undefined} />
          );
        })}
        {escondidos.length > 0 && (
          <>
            <button onClick={() => setVerEscondidos(v => !v)}
              style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
              {verEscondidos ? 'Ocultar escondidos' : `Escondidos (${escondidos.length})`}
            </button>
            {verEscondidos && escondidos.map(t => (
              <CartaoTemplate key={t.id} nome={t.nome} corpo={t.corpo}
                etiquetas={<Pilula texto="Escondido" bg="var(--gray-b)" cor="var(--gray-t)" borda="var(--gray-bb)" />}
                acao={<BotaoPequeno onClick={() => alternarOculto(t.id, false)} ocupado={ocultando === t.id}>Mostrar</BotaoPequeno>} />
            ))}
          </>
        )}
      </div>

      {sugestoes.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Sugestões</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {sugestoes.map(m => {
              const aberta = abertas.includes(m.nome);
              return (
                <button key={m.nome} onClick={() => alternarSugestao(m.nome)}
                  style={{ background: aberta ? 'var(--primary-soft)' : 'var(--surface)', border: `1px solid ${aberta ? 'var(--primary)' : 'var(--border)'}`, color: aberta ? 'var(--primary-t)' : 'var(--text2)', borderRadius: 'var(--r-pill)', padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-mono, monospace)' }}>
                  {m.nome}
                </button>
              );
            })}
          </div>
          {sugestoes.filter(m => abertas.includes(m.nome)).map(m => (
            <CartaoTemplate key={m.nome} nome={m.nome} corpo={m.corpo} tracejado
              etiquetas={<EtiquetaCategoria categoria={m.categoria} />}
              acao={
                <BotaoPequeno onClick={m.enviar} ocupado={pedindoModelo === m.nome} desativado={pedindoModelo !== null} textoOcupado="Enviando…">
                  Enviar para aprovação
                </BotaoPequeno>
              } />
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Novo template</span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={rotuloCampo}>Nome</label>
          <input value={nomeAmigavel} onChange={e => setNomeAmigavel(e.target.value)} placeholder="Ex.: Promoção de outubro" style={campo} />
          {slug && <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>Na Meta: {slug}</span>}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={rotuloCampo}>Categoria</label>
          <select value={categoria} onChange={e => setCategoria(e.target.value as CategoriaDoTemplate | '')} style={campo}>
            <option value="">Escolha</option>
            <option value="UTILITY">Utilidade: aviso sobre algo que o cliente já pediu</option>
            <option value="MARKETING">Marketing: promoção, novidade, convite</option>
          </select>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label style={rotuloCampo}>Texto</label>
            <button onClick={inserirVariavel} type="button" style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              + Variável
            </button>
          </div>
          <textarea value={corpo} onChange={e => setCorpo(e.target.value)} rows={4}
            placeholder="Olá, {{1}}! Temos uma novidade para você." style={{ ...campo, resize: 'vertical' }} />
        </div>

        {exemplosVisiveis.map((valor, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={rotuloCampo}>Exemplo de {`{{${i + 1}}}`}</label>
            <input value={valor} onChange={e => setExemplos(atual => {
              const novo = [...atual];
              novo[i] = e.target.value;
              return novo;
            })} placeholder="Obrigatório" style={campo} />
          </div>
        ))}

        <span style={{ fontSize: 12, color: 'var(--text3)' }}>Quem aprova é a Meta. Pode levar até 24 horas.</span>
        {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}

        <button onClick={criar} disabled={salvando} className="hp"
          style={{ alignSelf: 'flex-end', background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }}>
          {salvando ? 'Enviando…' : 'Enviar para aprovação'}
        </button>
      </div>

      <Regras />
    </div>
  );
}

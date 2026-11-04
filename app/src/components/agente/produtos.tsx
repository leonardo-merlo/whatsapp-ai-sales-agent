'use client'; // busca ao vivo, leitura de arquivo e estado de formulário

// **Uma seção Produtos só.**
//
// Até 14/09 havia duas, e as duas guardavam a mesma ideia: a lista "Produtos e
// serviços" da aba Empresa, digitada item a item, e o Catálogo do CSV, que
// aparecia no painel de um número de vendedor. As duas já eram da empresa — o
// catálogo nunca foi por vendedor —, mas o prompt usava uma OU a outra conforme
// o roteiro, e quem cadastrava produto tinha que saber em qual das duas telas
// estava para entender o que ia acontecer.
//
// Agora é uma seção, na aba Empresa, com duas formas de encher: **digitar**
// (poucos itens) ou **subir planilha** (muitos). No banco continuam duas
// tabelas, e isso é deliberado, não preguiça: `business_prices` guarda estoque
// e é apontada pelo histórico de vendas do Wappia Atendimento, que tem cliente
// pagante; `catalogo_produtos` guarda código e grupo do sistema do cliente.
// Fundir as duas quebraria o histórico de vendas para economizar uma tabela.
// O que o cliente vê é uma lista só, e é isso que importava.
//
// **A regra do prompt mudou junto, e essa é a parte que muda comportamento:**
// quem decide se a lista inteira vai para a IA passa a ser o TAMANHO, não o
// roteiro (ver `MAX_PRODUTOS_NO_PROMPT` em `lib/simulador/build-prompt.ts`).
//
// **Busca obrigatória.** Com 1055 itens numa lista só, sem busca não se acha
// nada — e uma tela onde não se acha nada é uma tela em que ninguém confere o
// que a IA vai dizer.
//
// **Tudo é tabela, desde 15/09.** Os itens digitados eram cartões altos, com
// descrição, observações e estoque sempre abertos: cinco itens já enchiam a
// tela e empurravam a tabela do arquivo para fora dela — foi por isso que o
// catálogo "não aparecia" antes de alguém buscar. Agora as duas listas têm a
// mesma cara (linha por item), e o que é longo mora atrás de "detalhes". Os
// digitados continuam editáveis e os do arquivo, só leitura: a planilha do
// sistema do cliente é que manda no preço dela.
//
// **Adicionar abre no topo.** O item novo nasce no fim da lista (é o que o
// reducer faz, e é a ordem que o banco guarda), mas aparece na primeira linha e
// já com o nome selecionado — no fim da lista ninguém via que algo aconteceu.

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useApp } from '@/lib/app-context';
import { useIsMobile } from '@/lib/use-is-mobile';
import { parseCSV } from '@/lib/csv';
import { lerCatalogoCSV, pareceCatalogoDeSistema } from '@/lib/catalogo/ler-csv';
import { importarCatalogo, NOME_DO_SYNC_DE_PRODUTOS } from '@/lib/catalogo/importar';
import { textoDasMedidas } from '@/lib/catalogo/moldes';
import {
  indiceDeGrupos, listarProdutosDoCatalogo, resumoDoCatalogo,
  type GrupoDoCatalogo, type ProdutoDoCatalogo, type ResumoDoCatalogo,
} from '@/lib/catalogo/consultar';
import { MAX_PRODUTOS_NO_PROMPT } from '@/lib/simulador/build-prompt';
import { fmtHoraRelativa } from '@/lib/data/mappers';
import type { Preco } from '@/lib/types';

const campo = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13.5, color: 'var(--text)',
  fontFamily: 'inherit', boxSizing: 'border-box' as const,
};
const ajuda = { fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 };
// O campo dentro da linha da tabela: a moldura é discreta para a lista continuar
// parecendo uma lista, e não um formulário com cem caixas.
const celula = {
  width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '6px 8px', fontSize: 12.5, color: 'var(--text)',
  fontFamily: 'inherit', boxSizing: 'border-box' as const,
};

function precoBR(valor: number | null): string {
  if (valor === null || valor === undefined) return '—';
  return `R$ ${valor.toFixed(2).replace('.', ',')}`;
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} role="switch" aria-checked={on}
      style={{ width: 38, height: 21, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, background: on ? 'var(--primary)' : 'var(--gray-b)', position: 'relative', transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 20 : 3, width: 15, height: 15, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.2)' }} />
    </button>
  );
}

export default function SecaoProdutos() {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  // `useState` com inicializador preguiçoso, e não `useRef().current`: o
  // cliente é criado uma vez só e a regra de refs do React não é violada (ler
  // `.current` durante a renderizacao).
  const [supabase] = useState(createClient);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [grupos, setGrupos] = useState<GrupoDoCatalogo[]>([]);
  const [doCatalogo, setDoCatalogo] = useState<ProdutoDoCatalogo[]>([]);
  // A coluna Medidas só existe para quem tem moldes (hoje, a Distribuidora Exemplo).
  const temMedidas = doCatalogo.some(p => p.molde);
  const [totalDoCatalogo, setTotalDoCatalogo] = useState(0);
  const [cortado, setCortado] = useState(false);
  const [buscandoNoCatalogo, setBuscandoNoCatalogo] = useState(true);
  const [resumo, setResumo] = useState<ResumoDoCatalogo | null>(null);
  const [errosDoCsv, setErrosDoCsv] = useState<string[]>([]);
  const [importando, setImportando] = useState(false);
  const [ajudaAberta, setAjudaAberta] = useState(false);
  // Quais linhas digitadas estão com os detalhes abertos, e quais acabaram de
  // ser criadas (essas vão para o topo). São índices da lista em memória, então
  // qualquer remoção os invalida — e aí os dois conjuntos são zerados.
  const [detalhesAbertos, setDetalhesAbertos] = useState<Set<number>>(() => new Set());
  const [recemAdicionados, setRecemAdicionados] = useState<number[]>([]);
  // O cursor vai para o produto recém-criado no instante em que o campo dele
  // aparece na tela — no `ref`, e não num efeito. Efeito que chama `setState`
  // para se desarmar provoca renderização em cascata (a regra
  // `react-hooks/set-state-in-effect` reclama com razão), e aqui não é preciso:
  // o alvo é usado uma vez e esquecido.
  const focarAoNascer = useRef<number | null>(null);
  const inputsDeNome = useRef(new Map<number, HTMLInputElement>());

  function registrarInputDeNome(i: number, el: HTMLInputElement | null) {
    if (!el) { inputsDeNome.current.delete(i); return; }
    inputsDeNome.current.set(i, el);
    if (focarAoNascer.current === i) {
      focarAoNascer.current = null;
      el.focus();
      el.select();
    }
  }

  const recarregarResumo = useCallback(async () => {
    const [r, g] = await Promise.all([
      resumoDoCatalogo(supabase, org.orgId),
      indiceDeGrupos(supabase, org.orgId),
    ]);
    setResumo(r);
    setGrupos(g);
  }, [supabase, org.orgId]);

  useEffect(() => {
    let vivo = true;
    Promise.all([
      resumoDoCatalogo(supabase, org.orgId),
      indiceDeGrupos(supabase, org.orgId),
      listarProdutosDoCatalogo(supabase, org.orgId, { limite: 50 }),
    ])
      .then(([r, g, pagina]) => {
        if (!vivo) return;
        setResumo(r);
        setGrupos(g);
        setDoCatalogo(pagina.produtos);
        setTotalDoCatalogo(pagina.total);
        setCortado(pagina.cortado);
      })
      .catch(() => { /* sem catálogo, a seção mostra só os digitados */ })
      .finally(() => { if (vivo) setBuscandoNoCatalogo(false); });
    return () => { vivo = false; };
  }, [supabase, org.orgId]);

  // A busca vai ao banco: com mil itens, filtrar no navegador exigiria trazer
  // mil itens a cada abertura da aba. Quem dispara é o evento de digitar, não
  // um efeito — e o atraso de um terço de segundo evita uma consulta por tecla.
  // A primeira página já vem no carregamento da aba: a lista aparece inteira
  // antes de alguém digitar, e busca e categoria só filtram o que já está lá.
  const buscar = useCallback((termo: string, grupoCodigo: string) => {
    setBuscandoNoCatalogo(true);
    listarProdutosDoCatalogo(supabase, org.orgId, { busca: termo, grupoCodigo, limite: 50 })
      .then(r => {
        setDoCatalogo(r.produtos);
        setTotalDoCatalogo(r.total);
        setCortado(r.cortado);
      })
      .catch(() => { /* a lista digitada continua aparecendo */ })
      .finally(() => setBuscandoNoCatalogo(false));
  }, [supabase, org.orgId]);

  const timerDaBusca = useRef<ReturnType<typeof setTimeout> | null>(null);
  function buscarComEspera(termo: string, grupoCodigo: string) {
    if (timerDaBusca.current) clearTimeout(timerDaBusca.current);
    timerDaBusca.current = setTimeout(() => buscar(termo, grupoCodigo), 350);
  }

  // ── importar ──
  // Um botão só, e o formato é reconhecido pelo cabeçalho. Dois botões seriam
  // dois lugares de novo, e quem errasse o botão teria a planilha lida torto.
  async function handleArquivo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;

    setImportando(true);
    setErrosDoCsv([]);
    try {
      const texto = await arquivo.text();

      if (pareceCatalogoDeSistema(texto)) {
        const { linhas, erros } = lerCatalogoCSV(texto);
        setErrosDoCsv(erros);
        if (!linhas.length) { showToast('Nenhum produto foi lido — confira o arquivo'); return; }
        const r = await importarCatalogo(supabase, org.orgId, linhas, arquivo.name);
        await recarregarResumo();
        buscar(busca, categoria);
        showToast(`${r.produtos} produto(s) em ${r.grupos} categoria(s) importados`
          + (r.desativados ? ` · ${r.desativados} saíram do catálogo` : ''));
        return;
      }

      // Lista simples: produto, preço, descrição, observações, estoque.
      const rows = parseCSV(texto)
        .filter(r => r.some(c => c.trim() !== ''))
        .filter(r => !(r[0] ?? '').trim().toLowerCase().startsWith('sep='));
      if (!rows.length) { showToast('A planilha está vazia'); return; }
      const primeira = rows[0].map(c => c.toLowerCase().trim());
      const temCabecalho = primeira.includes('produto') || primeira.includes('preço') || primeira.includes('preco');
      const dados = temCabecalho ? rows.slice(1) : rows;
      const novos: Preco[] = dados.map(r => {
        const estoqueTexto = r[4]?.trim() ?? '';
        const soNumero = /^\d+$/.test(estoqueTexto);
        return {
          proc: r[0]?.trim() ?? '',
          valor: r[1]?.trim() ?? '',
          descricao: r[2]?.trim() ?? '',
          observacoes: r[3]?.trim() ?? '',
          estoque: soNumero ? '' : estoqueTexto,
          controlaEstoque: soNumero,
          estoqueQtd: soNumero ? Number(estoqueTexto) : null,
          estoqueMinimo: null,
        };
      });
      dispatch({ type: 'SET', key: 'precos', value: novos });
      showToast(`${novos.length} produto(s) importado(s) — revise e clique em Salvar`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao importar a planilha');
    } finally {
      setImportando(false);
    }
  }

  function handleExportar() {
    const esc = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
    const linhas = [['Produto', 'Preço', 'Descrição', 'Observações', 'Estoque'].map(esc).join(';')];
    for (const p of state.precos) {
      const estoque = p.controlaEstoque
        ? (p.estoqueQtd === null || p.estoqueQtd === undefined ? '' : String(p.estoqueQtd))
        : (p.estoque ?? '');
      linhas.push([p.proc, p.valor, p.descricao ?? '', p.observacoes ?? '', estoque].map(esc).join(';'));
    }
    const blob = new Blob(['﻿' + linhas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'produtos.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function alternarDetalhes(i: number) {
    setDetalhesAbertos(atual => {
      const proximo = new Set(atual);
      if (proximo.has(i)) proximo.delete(i); else proximo.add(i);
      return proximo;
    });
  }

  function handleAdicionar() {
    const indiceNovo = state.precos.length;
    dispatch({ type: 'ADD_PRECO' });
    // Com um filtro ligado o item novo não casaria com nada e sumiria no ato
    // de nascer. Limpar é mais honesto que criar em silêncio.
    if (busca || categoria) { setBusca(''); setCategoria(''); buscar('', ''); }
    setRecemAdicionados(atual => [...atual, indiceNovo]);
    focarAoNascer.current = indiceNovo;
  }

  function handleRemover(i: number, p: Preco) {
    dispatch({ type: 'DEL_PRECO', i });
    // Remover renumera tudo o que vem depois: qualquer índice guardado aqui
    // passaria a apontar para outro produto. Zerar é mais barato que remapear.
    setDetalhesAbertos(new Set());
    setRecemAdicionados([]);
    showToast('Produto removido', { label: 'Desfazer', run: () => dispatch({ type: 'RESTORE_PRECO', i, value: p }) });
  }

  const termoBusca = busca.trim().toLowerCase();
  const casaComBusca = (p: Preco) =>
    !termoBusca || [p.proc, p.descricao ?? '', p.observacoes ?? ''].join(' ').toLowerCase().includes(termoBusca);
  // Item digitado não tem categoria, então filtrar por uma esconde todos: o
  // contrário (mostrá-los dentro de uma categoria à qual não pertencem) seria
  // dizer que eles estão lá.
  const digitadosFiltrados = categoria ? [] : state.precos.map((p, i) => ({ p, i })).filter(({ p }) => casaComBusca(p));
  // O que acabou de ser criado vem primeiro, do mais novo para o mais velho.
  const digitadosNaTela = [
    ...digitadosFiltrados.filter(x => recemAdicionados.includes(x.i))
      .sort((a, b) => recemAdicionados.indexOf(b.i) - recemAdicionados.indexOf(a.i)),
    ...digitadosFiltrados.filter(x => !recemAdicionados.includes(x.i)),
  ];

  const totalGeral = state.precos.length + (resumo?.produtos ?? 0);
  const porIndice = totalGeral > MAX_PRODUTOS_NO_PROMPT;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* ── cabeçalho: quantos são e como a IA usa ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxWidth: 560 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            Produtos {totalGeral > 0 && (
              <span style={{ fontWeight: 600, color: 'var(--text3)' }}>· {totalGeral.toLocaleString('pt-BR')}</span>
            )}
          </span>
          <span style={ajuda}>
            O que o agente consulta para responder o que você vende, a que preço, e os detalhes que os
            clientes perguntam. Digite os itens ou suba uma planilha — é a mesma lista.
          </span>
          {totalGeral > 0 && (
            <span style={{ ...ajuda, color: porIndice ? 'var(--amber-t)' : 'var(--text3)' }}>
              {porIndice
                ? `Como são mais de ${MAX_PRODUTOS_NO_PROMPT} itens, o agente não recebe a lista inteira: ele recebe o índice e consulta o produto quando precisa. Ele nunca cita produto que não esteja aqui.`
                : 'Poucos itens: a lista vai inteira para o agente, com descrição, observações e estoque.'}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', flexShrink: 0, width: isMobile ? '100%' : undefined }}>
          <input ref={arquivoRef} type="file" accept=".csv,text/csv" onChange={handleArquivo} style={{ display: 'none' }} />
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 2 }}>
            <button onClick={() => arquivoRef.current?.click()} disabled={importando}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: importando ? 'wait' : 'pointer' }} className="hs">
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              {importando ? 'Importando…' : 'Importar planilha'}
            </button>
            <button onClick={() => setAjudaAberta(o => !o)} title="Como deve ser a planilha" aria-label="Como deve ser a planilha"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: ajudaAberta ? 'var(--primary-soft)' : 'none', border: 'none', cursor: 'pointer', color: ajudaAberta ? 'var(--primary-t)' : 'var(--text3)', flexShrink: 0 }} className="hs">
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
            </button>
            {ajudaAberta && (
              <>
                <div onClick={() => setAjudaAberta(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: 0, width: 330, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', boxShadow: 'var(--sh-pop)', padding: 14, zIndex: 41, display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Como deve ser a planilha</span>
                  <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                    Um arquivo <strong>.csv</strong>. O formato é reconhecido pelo cabeçalho — você não
                    precisa escolher nada.
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Lista simples</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                      Produto · Preço · Descrição · Observações · Estoque (só o número).
                      Substitui os itens digitados.
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Catálogo do seu sistema</span>
                    <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                      Tem <code>codigo</code> e <code>grupo</code> no cabeçalho, mais{' '}
                      <code>grupo_nome</code>, <code>descricao</code>, <code>preco</code> e{' '}
                      <code>unidade</code>. A ordem das colunas não importa, e coluna que não
                      reconhecemos é guardada junto do produto. Produto que sair do arquivo novo é
                      desativado, nunca apagado.
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={handleExportar} disabled={state.precos.length === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: state.precos.length === 0 ? 'not-allowed' : 'pointer', opacity: state.precos.length === 0 ? 0.5 : 1 }} className="hs">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Exportar
          </button>
          <button onClick={handleAdicionar}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }} className="hp">
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
            Adicionar produto
          </button>
        </div>
      </div>

      {errosDoCsv.length > 0 && (
        <div style={{ background: 'var(--amber-b)', border: '1px solid var(--amber-bb)', color: 'var(--amber-t)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', fontSize: 12, lineHeight: 1.6, maxHeight: 180, overflow: 'auto' }}>
          <strong>{errosDoCsv.length} aviso(s) na planilha:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {errosDoCsv.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          {errosDoCsv.length > 20 && <span>…e mais {errosDoCsv.length - 20}.</span>}
        </div>
      )}

      {/* ── busca e categoria ──
          Elas filtram o que já está na tela: a lista aparece inteira sozinha, e
          digitar só a encurta. */}
      {totalGeral > 8 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text3)' }} width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); buscarComEspera(e.target.value, categoria); }}
              placeholder="Buscar por nome ou código — ex.: ENS, prego 17, CA50"
              aria-label="Buscar produto"
              style={{ ...campo, paddingLeft: 32 }}
            />
          </div>
          {grupos.length > 0 && (
            <select value={categoria} onChange={e => { setCategoria(e.target.value); buscar(busca, e.target.value); }} aria-label="Categoria"
              style={{ ...campo, width: 'auto', minWidth: 190, flexShrink: 0 }}>
              <option value="">Todas as categorias ({grupos.length})</option>
              {grupos.map(g => <option key={g.codigo} value={g.codigo}>{g.codigo} — {g.nome}</option>)}
            </select>
          )}
          {(busca || categoria) && (
            <button onClick={() => { setBusca(''); setCategoria(''); buscar('', ''); }}
              style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: 4, flexShrink: 0 }}>
              limpar
            </button>
          )}
        </div>
      )}

      {/* ── os itens digitados (editáveis) ──
          Mesma forma da tabela do arquivo, de propósito: são a mesma lista para
          quem lê, e a diferença que importa é só uma — estes se editam aqui. */}
      {state.precos.length > 0 && !categoria && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              Digitados por você · {state.precos.length.toLocaleString('pt-BR')} {state.precos.length === 1 ? 'item' : 'itens'}
            </span>
            <span style={ajuda}>Editáveis aqui mesmo — salve no botão do topo da tela.</span>
          </div>

          {digitadosNaTela.length === 0 ? (
            <span style={{ ...ajuda, padding: '6px 0' }}>Nenhum item digitado casa com esta busca.</span>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 400, borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600 }}>Produto</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap', width: 110 }}>Preço</th>
                    {!isMobile && <th style={{ padding: '6px 8px', fontWeight: 600, width: 150 }}>Estoque</th>}
                    <th style={{ padding: '6px 8px', width: 72 }}><span style={{ position: 'absolute', left: -9999 }}>Ações</span></th>
                  </tr>
                </thead>
                <tbody>
                  {digitadosNaTela.map(({ p, i }) => {
                    const aberto = detalhesAbertos.has(i);
                    const novo = recemAdicionados.includes(i);
                    return (
                      <Fragment key={i}>
                        <tr style={{ borderTop: '1px solid var(--border)', background: novo ? 'var(--primary-soft)' : 'transparent' }}>
                          <td style={{ padding: '4px 8px' }}>
                            <input
                              ref={el => registrarInputDeNome(i, el)}
                              value={p.proc} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'proc', v: e.target.value })}
                              placeholder="Produto ou serviço" aria-label="Produto ou serviço"
                              style={{ ...celula, fontWeight: 600 }}
                            />
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <input value={p.valor} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'valor', v: e.target.value })}
                              placeholder="R$ 0" aria-label="Preço"
                              style={{ ...celula, fontWeight: 700, textAlign: 'right' }} />
                          </td>
                          {!isMobile && (
                            <td style={{ padding: '7px 8px', color: 'var(--text3)', whiteSpace: 'nowrap' }}>
                              {p.controlaEstoque
                                ? `${p.estoqueQtd ?? 0} em estoque`
                                : (p.estoque?.trim() || '—')}
                            </td>
                          )}
                          <td style={{ padding: '4px 8px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                              <button onClick={() => alternarDetalhes(i)} title="Descrição, observações e estoque"
                                aria-label="Detalhes do produto" aria-expanded={aberto}
                                style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }} className="hs">
                                <svg style={{ transform: aberto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                              </button>
                              <button onClick={() => handleRemover(i, p)} title="Remover produto" aria-label="Remover produto"
                                style={{ background: 'none', border: 'none', color: 'var(--red-t)', cursor: 'pointer', display: 'flex', padding: 4, borderRadius: 6 }} className="hr">
                                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                        {aberto && (
                          <tr style={{ background: 'var(--surface2)' }}>
                            <td colSpan={isMobile ? 3 : 4} style={{ padding: '10px 8px 14px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <input value={p.descricao ?? ''} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'descricao', v: e.target.value })}
                                  placeholder="Descrição — o que é, para quem" aria-label="Descrição"
                                  style={{ ...campo, background: 'var(--surface)', color: 'var(--text2)' }} />
                                <textarea value={p.observacoes ?? ''} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'observacoes', v: e.target.value })} rows={2}
                                  placeholder="Observações — detalhes que os clientes perguntam (garantia, duração, materiais, formas de pagamento…)"
                                  aria-label="Observações"
                                  style={{ ...campo, background: 'var(--surface)', color: 'var(--text2)', resize: 'vertical', lineHeight: 1.5 }} />

                                {/* Estoque: serviço não tem, produto tem. Com o controle ligado o
                                    número é a fonte de verdade e a venda pode dar baixa nele;
                                    desligado, sobra só a nota livre ("sob encomenda"). */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px' }}>
                                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text2)' }}>Controlar estoque</span>
                                  <Toggle on={p.controlaEstoque ?? false} onClick={() => dispatch({ type: 'UPD_PRECO', i, k: 'controlaEstoque', v: !(p.controlaEstoque ?? false) })} />
                                  {p.controlaEstoque ? (
                                    <>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text3)' }}>
                                        Quantidade
                                        <input type="number" min={0} value={p.estoqueQtd ?? ''} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'estoqueQtd', v: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                                          style={{ width: 72, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, fontWeight: 700, color: 'var(--text)', textAlign: 'center' }} />
                                      </label>
                                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text3)' }}>
                                        Avisar quando chegar em
                                        <input type="number" min={0} value={p.estoqueMinimo ?? ''} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'estoqueMinimo', v: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
                                          style={{ width: 72, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text)', textAlign: 'center' }} />
                                      </label>
                                    </>
                                  ) : (
                                    <input value={p.estoque ?? ''} onChange={e => dispatch({ type: 'UPD_PRECO', i, k: 'estoque', v: e.target.value })}
                                      placeholder="Disponibilidade (ex.: sob encomenda)" aria-label="Disponibilidade"
                                      style={{ flex: 1, minWidth: 150, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text2)' }} />
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Categoria é do catálogo importado; item digitado não tem nenhuma. */}
      {categoria && state.precos.length > 0 && (
        <span style={ajuda}>
          Os {state.precos.length.toLocaleString('pt-BR')} itens digitados não têm categoria — escolha
          &quot;Todas as categorias&quot; para vê-los.
        </span>
      )}

      {totalGeral === 0 && (
        <span style={{ fontSize: 12.5, color: 'var(--text3)', padding: '8px 2px' }}>
          Nenhum produto ainda. Clique em <strong>Adicionar produto</strong> para digitar, ou em{' '}
          <strong>Importar planilha</strong> se você já tem a lista num arquivo.
        </span>
      )}

      {/* ── os itens do catálogo importado (só leitura) ── */}
      {resumo && resumo.produtos > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              {resumo.importadoNome === NOME_DO_SYNC_DE_PRODUTOS ? 'Do sistema de gestão' : 'Do arquivo importado'}
              {' '}· {resumo.produtos.toLocaleString('pt-BR')} itens em {resumo.grupos} categorias
            </span>
            {resumo.importadoEm && (
              <span style={ajuda}>
                atualizado {fmtHoraRelativa(resumo.importadoEm)}
                {resumo.importadoNome ? ` (${resumo.importadoNome})` : ''}
              </span>
            )}
          </div>

          <span style={ajuda}>
            {resumo.importadoNome === NOME_DO_SYNC_DE_PRODUTOS
              ? 'Atualizados todo dia pelo sistema de gestão.'
              : 'Estes vêm da planilha e são alterados subindo um arquivo novo — assim a planilha do seu sistema continua sendo a fonte de verdade do preço.'}
          </span>

          {doCatalogo.length === 0 ? (
            <span style={{ ...ajuda, padding: '6px 0' }}>
              {buscandoNoCatalogo ? 'Carregando…' : 'Nenhum item do arquivo casa com esta busca.'}
            </span>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--text3)' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 600, whiteSpace: 'nowrap' }}>Código</th>
                    <th style={{ padding: '6px 8px', fontWeight: 600 }}>Descrição</th>
                    {!isMobile && temMedidas && <th style={{ padding: '6px 8px', fontWeight: 600 }}>Medidas</th>}
                    {!isMobile && <th style={{ padding: '6px 8px', fontWeight: 600 }}>Categoria</th>}
                    <th style={{ padding: '6px 8px', fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap' }}>Preço</th>
                  </tr>
                </thead>
                <tbody>
                  {doCatalogo.map(p => (
                    <tr key={p.codigo} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="mono" style={{ padding: '7px 8px', whiteSpace: 'nowrap', color: 'var(--text3)' }}>{p.codigo}</td>
                      <td style={{ padding: '7px 8px' }}>
                        {p.descricao}
                        {isMobile && p.medidas && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 2 }}>{textoDasMedidas(p.medidas)}</div>}
                      </td>
                      {!isMobile && temMedidas && (
                        <td style={{ padding: '7px 8px', color: p.medidas ? 'var(--text2)' : 'var(--text3)' }}>
                          {p.medidas ? textoDasMedidas(p.medidas) : p.molde ? 'não lidas' : ''}
                        </td>
                      )}
                      {!isMobile && <td style={{ padding: '7px 8px', color: 'var(--text3)' }}>{p.grupoNome}</td>}
                      <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {precoBR(p.preco)}{p.unidade ? <span style={{ color: 'var(--text3)', fontWeight: 400 }}> / {p.unidade}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cortado && (
            <span style={ajuda}>
              Mostrando {doCatalogo.length} de {totalDoCatalogo.toLocaleString('pt-BR')}. Use a busca ou a
              categoria para chegar no item que você procura.
            </span>
          )}

          {/* O dicionário é da EMPRESA e fica junto do catálogo, não do
              vendedor: em `ai_agent_config` cada vendedor poderia traduzir a
              mesma gíria de um jeito, que é o erro que não pode acontecer num
              orçamento.
              **"Quando perguntar em vez de escolher" saiu daqui em 15/09** e
              foi para a aba Agente: aquilo não é vocabulário do catálogo, é o
              que a IA faz quando fica em dúvida. O dado continua no mesmo
              lugar (`catalogo_config.regras`), só a tela mudou. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 700 }}>Como ler este catálogo</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' }} htmlFor="dicionario">Como o cliente escreve</label>
              <textarea id="dicionario" value={state.textosDoCatalogo.dicionario} onChange={e => dispatch({ type: 'SET', key: 'textosDoCatalogo', value: { ...state.textosDoCatalogo, dicionario: e.target.value } })} rows={5}
                placeholder={'Ex.: "vara" = barra de 12 m de vergalhão.\n"ø 12.5" = CA50 1/2.\n"un" = peça.'}
                style={{ ...campo, resize: 'vertical', lineHeight: 1.5 }} />
              <span style={ajuda}>
                A gíria do cliente traduzida para o vocabulário do catálogo. É o que faz a IA entender{' '}
                <em>2 50x30 ch18</em> como <em>METALON 50X30X18</em>. O que ela faz quando um pedido casa
                com mais de um produto está na aba <strong>Agente</strong>.
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

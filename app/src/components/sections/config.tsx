'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-context';
import { useOrg } from '@/lib/org-context';
import ProdutosContratados from '@/components/config/produtos-contratados';
import { useIsMobile } from '@/lib/use-is-mobile';
import { iniciais, avatarBg } from '@/lib/ui-helpers';
import { salvarOrganizacao, toggleMembro, salvarMembro, adicionarMembro, addCampoCustomizado, removeCampoCustomizado, criarRespostaPronta, atualizarRespostaPronta, deletarRespostaPronta } from '@/lib/data/mutations';
import type { AppState, Preco, Faq } from '@/lib/types';
import { CONFIG_TABS, caminhoDaAba, configTabsPara, type ConfigTabKey } from '@/lib/config-tabs';
import { permissoesDe } from '@/lib/permissoes';
import { dataBRemSP } from '@/lib/fuso';
import { WhatsAppConnectButton } from '@/components/config/whatsapp-connect-button';
import UsoIASection from '@/components/config/uso-ia';
import NumerosWhatsAppSection from '@/components/config/numeros-whatsapp';
import TemplatesWhatsAppSection from '@/components/config/templates-whatsapp';
import { atualizarMembro, cadastrarMembroSemLogin, listarMembrosDaEquipe, type MembroDaEquipe } from '@/lib/data/agente-do-numero';
import { createClient } from '@/lib/supabase/client';

interface PagamentoAssinatura {
  invoiceId: string; valor: number; vencimento: string; planKey: string; metodo: 'PIX' | 'CREDIT_CARD';
  intervalo?: 'mensal' | 'anual'; credito?: number;
  qrCodeBase64?: string; copiaCola?: string; invoiceUrl?: string;
}

// R$ sem centavos (os planos são valores redondos): 14900 → "R$ 149".
function reais(centavos: number): string {
  return `R$ ${(centavos / 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
}

// Data (DD/MM/AAAA) de hoje + um período — usada para mostrar a validade logo
// após o pagamento, sem esperar um recarregamento da página.
function proximaData(intervalo: 'mensal' | 'anual'): string {
  const d = new Date();
  if (intervalo === 'anual') d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return dataBRemSP(d);
}

// Ordem dos planos, para bloquear downgrade no meio do período.
const PLANO_RANK: Record<string, number> = { basico: 1, unico: 1.5, profissional: 2, avancado: 3 };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ width: 40, height: 22, borderRadius: 'var(--r-pill)', border: 'none', cursor: 'pointer', background: on ? 'var(--primary)' : 'var(--border2)', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
      <span style={{ position: 'absolute', top: 2, left: 0, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,.2)', transform: on ? 'translateX(20px)' : 'translateX(2px)', transition: 'transform .15s' }} />
    </button>
  );
}

function CfgTabBar({ abas, active, onSelect, badges }: { abas: typeof CONFIG_TABS; active: ConfigTabKey; onSelect: (k: ConfigTabKey) => void; badges?: Partial<Record<ConfigTabKey, React.ReactNode>> }) {
  return (
    <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
      {abas.map(t => {
        const sel = active === t.key;
        return (
          <button key={t.key} onClick={() => onSelect(t.key)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', color: sel ? 'var(--primary)' : 'var(--text3)', borderBottom: `2px solid ${sel ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 }}>
            {t.label}
            {badges?.[t.key]}
          </button>
        );
      })}
    </div>
  );
}

function CfgTabPanel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: '18px' }}>
      {children}
    </div>
  );
}

// Fora do render de ConfigSection: declarado dentro do componente pai, o React recria essa
// função a cada tecla digitada e remonta o input/textarea, derrubando o foco a cada caractere.
function AgenteBufField({ k, label }: { k: 'nome' | 'cargo' | 'conhecimento'; label: string }) {
  const { state, dispatch } = useApp();
  const modalBuf = state.agenteModalBuffer;
  if (!modalBuf) return null;
  const multiline = k === 'conhecimento';
  const style = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)', resize: 'vertical' as const, minHeight: multiline ? 70 : undefined, width: '100%' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {multiline
        ? <textarea value={modalBuf[k] as string} onChange={e => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k, v: e.target.value })} style={style} rows={3} />
        : <input value={modalBuf[k] as string} onChange={e => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k, v: e.target.value })} style={style} />
      }
    </div>
  );
}

export default function ConfigSection({ abaInicial }: { abaInicial?: ConfigTabKey }) {
  const { state, dispatch, showToast } = useApp();
  const org = useOrg();
  const isMobile = useIsMobile();
  const router = useRouter();
  const { cl, planoAtual, agentesData, planos, faturas, msgsUsadasMes, assinatura } = state;
  const abasVisiveis = configTabsPara(org.memberRole);
  // **Quem manda é o endereço.** Cada aba tem URL própria desde 14/09; o estado
  // global continua existindo (o menu da sidebar e o mobile o usam), mas na
  // primeira renderização ele ainda está na aba antiga — usar o endereço aqui é
  // o que evita a tela piscar em "Dados do negócio" antes de trocar.
  const abaAtiva = abaInicial ?? state.configTab;
  const podeVerFaturamento = permissoesDe(org.memberRole).verFaturamento;
  // Mesma permissão dos outros dados do negócio: a escrita em wa_numbers é
  // is_admin_of no banco, e a tela não mostra select que falharia em silêncio.
  const podeEditarNumeros = permissoesDe(org.memberRole).editarDadosNegocio;

  const [planoConfirm, setPlanoConfirm] = useState<string | null>(null);
  const [metodoEscolhido, setMetodoEscolhido] = useState<'PIX' | 'CREDIT_CARD'>('PIX');
  const [intervalo, setIntervalo] = useState<'mensal' | 'anual'>('mensal');
  const [salvando, setSalvando] = useState(false);
  const [pagamento, setPagamento] = useState<PagamentoAssinatura | null>(null);
  const [pagamentoErro, setPagamentoErro] = useState('');
  const [pagamentoStatus, setPagamentoStatus] = useState<'pendente' | 'pago'>('pendente');
  const [cancelarConfirmOpen, setCancelarConfirmOpen] = useState(false);
  const [cancelarConfirmTexto, setCancelarConfirmTexto] = useState('');
  const [membroModalOpen, setMembroModalOpen] = useState(false);
  // **Duas formas de adicionar alguém, e a diferença não é de formulário: é de
  // conta.** Convidar cria um login e ocupa uma vaga de atendente no plano; só
  // cadastrar não faz nem uma coisa nem outra — a pessoa existe para o número
  // do vendedor ter dono, o orçamento sair com o código dela e o copiloto saber
  // para onde avisar. Os sete vendedores da Distribuidora Exemplo não vão fazer login.
  const [membroModo, setMembroModo] = useState<'convidar' | 'cadastrar'>('convidar');
  const [aoEstourarLimite, setAoEstourarLimite] = useState<'transferir' | 'avisar'>('transferir');
  const [membroForm, setMembroForm] = useState({ nome: '', cargo: '', email: '', role: 'atendente' as 'admin' | 'atendente', codigoErp: '', telefoneWhatsapp: '' });
  const [membroErr, setMembroErr] = useState('');
  const [novoCampo, setNovoCampo] = useState('');
  const [novaResposta, setNovaResposta] = useState({ titulo: '', texto: '' });
  const [salvandoResposta, setSalvandoResposta] = useState(false);
  // Código no sistema e WhatsApp são da PESSOA e moram em `organization_members`,
  // mas não cabem no `Agente` do estado global — daí a lista própria aqui. Ela
  // serve às duas abas: o seletor de dono em Integração e a edição na Equipe.
  const [equipeCompleta, setEquipeCompleta] = useState<MembroDaEquipe[]>([]);
  const [contatoDoMembro, setContatoDoMembro] = useState({ codigoErp: '', telefoneWhatsapp: '' });

  function trocarAba(k: ConfigTabKey) {
    dispatch({ type: 'SET', key: 'configTab', value: k });
    router.push(caminhoDaAba(k)); // o endereço acompanha a aba, para o F5 voltar aqui
  }

  useEffect(() => {
    let vivo = true;
    listarMembrosDaEquipe(createClient(), org.orgId)
      .then(lista => { if (vivo) setEquipeCompleta(lista); })
      // Lista secundária: a Equipe em si já veio do carregamento da página, e
      // uma falha aqui não pode derrubar a tela inteira de Configurações.
      .catch(() => { if (vivo) setEquipeCompleta([]); });
    return () => { vivo = false; };
  }, [org.orgId]);

  // O estado global segue o endereço — é dele que vivem o menu da sidebar e a
  // barra de abas do celular.
  useEffect(() => {
    if (abaInicial && abaInicial !== state.configTab) {
      dispatch({ type: 'SET', key: 'configTab', value: abaInicial });
    }
  }, [abaInicial, state.configTab, dispatch]);

  /** Cadastra sem login, sem e-mail e sem vaga do plano — e já mostra a pessoa
   *  nas duas listas, sem recarregar a página. */
  async function cadastrarPessoa(dados: { nome: string; cargo: string; codigoErp: string; telefoneWhatsapp: string }): Promise<MembroDaEquipe> {
    const membro = await cadastrarMembroSemLogin(createClient(), org.orgId, dados);
    setEquipeCompleta(lista => [...lista, membro].sort((a, b) => a.nome.localeCompare(b.nome)));
    dispatch({ type: 'ADD_MEMBRO', membro: {
      id: membro.id, nome: membro.nome, cargo: dados.cargo.trim(), online: false, ativo: true,
      pendente: false, acessaPainel: false, precos: [], horario: [], faqs: [], conhecimento: '',
    } });
    return membro;
  }

  /** Abre a ficha de alguém da equipe já com o código e o WhatsApp carregados. */
  function abrirEdicaoDoMembro(i: number) {
    const atual = equipeCompleta.find(m => m.id === agentesData[i].id);
    setContatoDoMembro({
      codigoErp: atual?.codigoErp ?? '',
      telefoneWhatsapp: atual?.telefoneWhatsapp ?? '',
    });
    dispatch({ type: 'OPEN_AGENTE_MODAL', i });
  }

  async function handleAdicionarResposta() {
    const titulo = novaResposta.titulo.trim();
    const texto = novaResposta.texto.trim();
    if (titulo.length < 2 || texto.length < 1 || salvandoResposta) return;
    setSalvandoResposta(true);
    try {
      const nova = await criarRespostaPronta(org.orgId, titulo, texto);
      dispatch({ type: 'ADD_RESPOSTA_PRONTA', resposta: nova });
      setNovaResposta({ titulo: '', texto: '' });
      showToast('Resposta pronta adicionada');
    } catch {
      showToast('Erro ao adicionar — tente novamente');
    } finally {
      setSalvandoResposta(false);
    }
  }

  async function handleSalvarResposta(id: string, titulo: string, texto: string) {
    try {
      await atualizarRespostaPronta(id, titulo.trim(), texto.trim());
    } catch {
      showToast('Erro ao salvar — tente novamente');
    }
  }

  async function handleRemoverResposta(id: string) {
    const anterior = state.respostasProntas.find(r => r.id === id);
    dispatch({ type: 'DEL_RESPOSTA_PRONTA', id });
    try {
      await deletarRespostaPronta(id);
      showToast('Resposta pronta removida');
    } catch {
      if (anterior) dispatch({ type: 'ADD_RESPOSTA_PRONTA', resposta: anterior });
      showToast('Erro ao remover — tente novamente');
    }
  }

  const plano = planos.find(p => p.key === planoAtual);
  const maxAtendentes = plano ? (parseInt(plano.atend) || 99) : 2; // trial: limite do plano Básico
  // **Quem não entra no painel não ocupa vaga.** O plano cobra acesso ao
  // sistema, e quem foi só cadastrado (vendedor com código e WhatsApp, sem
  // login) não tem acesso nenhum. A mesma regra vale no banco, no trigger
  // `check_limite_atendentes` — a tela só evita oferecer o que seria recusado.
  const atendentesAtivos = agentesData.filter(a => a.ativo && a.acessaPainel).length;
  const soCadastrados = agentesData.filter(a => a.ativo && !a.acessaPainel).length;
  // Sem trava de vagas desde 29/09 (decisão do Leonardo: com um plano só, o
  // limite de pessoas se decide depois, testando com os clientes). O banco
  // também não barra mais (migration 20260929000007). Para voltar, troque para
  // true aqui e restaure a função no banco.
  const VAGAS_TEM_LIMITE = false;
  const limiteAtingido = VAGAS_TEM_LIMITE && atendentesAtivos >= maxAtendentes;

  async function salvarAoEstourarLimite(valor: 'transferir' | 'avisar') {
    const anterior = aoEstourarLimite;
    setAoEstourarLimite(valor); // otimista: o clique responde na hora
    const { error } = await createClient()
      .from('organizations').update({ ao_estourar_limite: valor }).eq('id', org.orgId);
    if (error) {
      setAoEstourarLimite(anterior);
      showToast('Não foi possível salvar — tente novamente');
      return;
    }
    showToast(valor === 'avisar'
      ? 'Ao passar do limite, a IA continua respondendo e você é avisado'
      : 'Ao passar do limite, a IA para e a conversa vai para uma pessoa');
  }

  async function handleAdicionarMembro() {
    setMembroErr('');
    if (!membroForm.nome.trim()) { setMembroErr('Informe o nome.'); return; }
    if (membroModo === 'convidar' && (!membroForm.email.trim() || !membroForm.email.includes('@'))) {
      setMembroErr('Informe um e-mail válido.'); return;
    }
    if (salvando) return;
    setSalvando(true);
    try {
      if (membroModo === 'cadastrar') {
        await cadastrarPessoa({
          nome: membroForm.nome, cargo: membroForm.cargo,
          codigoErp: membroForm.codigoErp, telefoneWhatsapp: membroForm.telefoneWhatsapp,
        });
        showToast(`${membroForm.nome.trim()} cadastrado — sem login e sem ocupar vaga do plano`);
      } else {
        const novo = await adicionarMembro(org.orgId, {
          nome: membroForm.nome.trim(), cargo: membroForm.cargo.trim(),
          email: membroForm.email, role: membroForm.role,
        });
        dispatch({ type: 'ADD_MEMBRO', membro: novo });
        // O e-mail sai pelo servidor. Se falhar, o convite continua valendo e a
        // pessoa ainda pode se cadastrar com o mesmo e-mail.
        const envio = await fetch('/api/equipe/convite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memberId: novo.id }),
        }).then(r => r.json() as Promise<{ enviado?: boolean }>).catch(() => ({ enviado: false }));
        showToast(envio.enviado ? 'Convite enviado por e-mail' : 'Convite criado. O e-mail não saiu; avise a pessoa.');
      }
      setMembroModalOpen(false);
      setMembroForm({ nome: '', cargo: '', email: '', role: 'atendente', codigoErp: '', telefoneWhatsapp: '' });
    } catch (err) {
      setMembroErr(err instanceof Error ? err.message : 'Não foi possível adicionar. Tente novamente.');
    } finally {
      setSalvando(false);
    }
  }

  function setClField(k: keyof typeof cl, v: string) {
    dispatch({ type: 'SET', key: 'cl', value: { ...cl, [k]: v } });
  }

  async function handleSalvarNegocio() {
    if (salvando) return;
    setSalvando(true);
    try {
      await salvarOrganizacao(org.orgId, cl);
      showToast('Dados do negócio salvos');
    } catch {
      showToast('Erro ao salvar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  async function handleToggleMembro(i: number, k: 'online' | 'ativo') {
    const a = agentesData[i];
    dispatch({ type: 'TOGGLE_AGENTE_DATA', i, k });
    try {
      await toggleMembro(a.id, k, !a[k]);
    } catch (err) {
      dispatch({ type: 'TOGGLE_AGENTE_DATA', i, k });
      showToast(err instanceof Error ? err.message : 'Erro ao atualizar — tente novamente');
    }
  }

  async function handleSalvarMembro() {
    if (!state.agenteModalBuffer || salvando) return;
    const { id: membroId, nome: nomeDoMembro } = state.agenteModalBuffer;
    setSalvando(true);
    try {
      await salvarMembro(org.orgId, state.agenteModalBuffer);
      // Código e WhatsApp não passam por `salvarMembro` (ele só conhece o que
      // cabe no `Agente` do estado). São os dois campos que, até 14/09, só dava
      // para preencher na hora de cadastrar — e nunca, para quem foi convidado.
      await atualizarMembro(createClient(), org.orgId, membroId, {
        codigoErp: contatoDoMembro.codigoErp,
        telefoneWhatsapp: contatoDoMembro.telefoneWhatsapp,
      });
      setEquipeCompleta(lista => lista.map(m => (m.id === membroId
        ? { ...m, nome: nomeDoMembro, codigoErp: contatoDoMembro.codigoErp.trim(), telefoneWhatsapp: contatoDoMembro.telefoneWhatsapp.trim() }
        : m)));
      dispatch({ type: 'SALVAR_AGENTE_DATA' });
      showToast('Pessoa atualizada');
    } catch {
      showToast('Erro ao salvar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  async function handleMudarPlano(key: string) {
    if (salvando) return;
    setSalvando(true);
    setPagamentoErro('');
    try {
      const resp = await fetch('/api/asaas/assinar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: key, metodoPagamento: metodoEscolhido, intervalo }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Erro ao iniciar o pagamento');
      setPlanoConfirm(null);
      setPagamentoStatus('pendente');
      setPagamento({ ...data, planKey: key } as PagamentoAssinatura);
    } catch (err) {
      setPagamentoErro(err instanceof Error ? err.message : 'Erro ao iniciar o pagamento — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  // A escolha de "o que fazer ao passar do limite" vive na organização e não na
  // carga inicial das telas: é uma linha só, lida quando Configurações abre.
  useEffect(() => {
    let vivo = true;
    createClient()
      .from('organizations').select('ao_estourar_limite').eq('id', org.orgId).maybeSingle()
      .then(({ data }) => {
        if (vivo && data?.ao_estourar_limite === 'avisar') setAoEstourarLimite('avisar');
      });
    return () => { vivo = false; };
  }, [org.orgId]);

  useEffect(() => {
    if (!pagamento || pagamentoStatus === 'pago') return;
    const interval = setInterval(async () => {
      const resp = await fetch(`/api/asaas/fatura/${pagamento.invoiceId}`);
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.status === 'pago') {
        setPagamentoStatus('pago');
        showToast('Pagamento confirmado — plano ativado!');
        dispatch({ type: 'SET', key: 'planoAtual', value: pagamento.planKey });
        const iv = pagamento.intervalo ?? 'mensal';
        dispatch({ type: 'SET', key: 'assinatura', value: {
          metodoPagamento: pagamento.metodo,
          intervalo: iv,
          renovaAutomatico: pagamento.metodo === 'CREDIT_CARD',
          validoAte: proximaData(iv),
        } });
      }
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagamento, pagamentoStatus]);

  async function handleCancelarAssinatura() {
    if (salvando) return;
    setSalvando(true);
    try {
      const resp = await fetch('/api/asaas/cancelar', { method: 'POST' });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error ?? 'Erro ao cancelar');
      dispatch({ type: 'SET', key: 'assinatura', value: assinatura ? { ...assinatura, renovaAutomatico: false } : null });
      setCancelarConfirmOpen(false);
      setCancelarConfirmTexto('');
      showToast('Renovação cancelada — seu acesso continua até o fim do período');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Erro ao cancelar a assinatura — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  const modalBuf = state.agenteModalBuffer;
  const modalIdx = state.agenteModalSel;

  return (
    <section style={{ flex: 1, overflow: 'auto', padding: isMobile ? '18px 14px' : '24px 28px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 4 }}>
          {!isMobile && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>Configurações</span>}
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.3px' }}>{isMobile ? 'Configurações' : CONFIG_TABS.find(t => t.key === abaAtiva)?.label}</h1>
          <span style={{ fontSize: 13, color: 'var(--text3)' }}>{isMobile ? 'Dados do negócio, canal oficial, plano e preferências' : CONFIG_TABS.find(t => t.key === abaAtiva)?.desc}</span>
        </div>

        {isMobile && (
          <CfgTabBar abas={abasVisiveis} active={abaAtiva} onSelect={trocarAba}
            badges={{
              whatsapp: state.waConectado
                ? <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: 'var(--green-b)', color: 'var(--green-t)', borderRadius: 'var(--r-pill)', padding: '2px 10px' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'currentColor' }} />Conectado</span>
                : <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, background: 'var(--gray-b)', color: 'var(--gray-t)', border: '1px solid var(--gray-bb)', borderRadius: 'var(--r-pill)', padding: '2px 10px' }}><span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--border2)' }} />Não conectado</span>,
              plano: <span style={{ fontSize: 12, fontWeight: 600, background: 'var(--primary-soft)', color: 'var(--primary-t)', borderRadius: 'var(--r-pill)', padding: '2px 10px' }}>{plano?.nome ?? 'Período de teste'}</span>,
              agentes: <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>{VAGAS_TEM_LIMITE ? `${atendentesAtivos}/${maxAtendentes}` : atendentesAtivos}</span>,
            }} />
        )}

        {/* Dados do negócio */}
        {abaAtiva === 'negocio' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
              {([
                { k: 'razao' as const, label: 'Razão social', full: false },
                { k: 'cnpj' as const, label: 'CPF ou CNPJ', full: false },
                { k: 'endereco' as const, label: 'Endereço', full: true },
                { k: 'telefone' as const, label: 'Telefone fixo', full: false },
              ]).map(f => (
                <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(f.full ? { gridColumn: '1 / -1' } : {}) }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{f.label}</label>
                  <input value={cl[f.k]} onChange={e => setClField(f.k, e.target.value)} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                </div>
              ))}
            </div>
            <button onClick={handleSalvarNegocio} disabled={salvando} style={{ alignSelf: 'flex-end', background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">
              {salvando ? 'Salvando…' : 'Salvar dados'}
            </button>
          </div>
        </CfgTabPanel>
        )}
        {abaAtiva === 'negocio' && <div style={{ marginTop: 14 }}><ProdutosContratados /></div>}

        {/* WhatsApp */}
        {abaAtiva === 'whatsapp' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--primary-soft)', borderRadius: 'var(--r-ctrl)', padding: '14px 16px' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--primary-t)' }}>Conexão com o WhatsApp oficial do seu negócio</span>
              <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.55 }}>
                Seu agente vai atender pelo número oficial do seu negócio, sem risco de bloqueio.
                A conexão é feita em poucos cliques pelo login do Facebook, sem sair daqui.
              </span>
            </div>
            {/* Não existe "número principal". Uma conta tem vários números, e o
                que diferencia cada um é o papel dele, escolhido na lista
                abaixo. Por isso aqui só existem as duas formas de acrescentar
                um número, e o selo de conectado e o "Refazer conexão" moram no
                cartão de cada número, onde dizem de qual número se fala. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Número na Cloud API</span>
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                O número passa a ser só da IA. O WhatsApp comum deixa de funcionar nele, e o histórico
                que existia no aplicativo sai junto.
              </span>
              <WhatsAppConnectButton rotulo="Conectar número" />
            </div>
            {/* Coexistência: o número continua no celular de quem atende. É o
                caminho do número de vendedor — o app dele não sai do telefone. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{org.produtoAtivo === 'vendas' ? 'Número de vendedor' : 'Número com o app no celular'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                Conecta o número mantendo o WhatsApp Business no celular de quem atende. O aplicativo
                precisa ser aberto pelo menos uma vez a cada 13 dias. Grupos e chamadas seguem
                funcionando no celular, mas a IA não participa deles. Listas de transmissão param de
                funcionar.
              </span>
              <WhatsAppConnectButton coexistencia rotulo={org.produtoAtivo === 'vendas' ? 'Conectar número de vendedor' : 'Conectar mantendo o app'} />
            </div>

            {/* Quem é cada número. Com mais de um número na mesma empresa, é
                isto que diz qual deles atende o cliente final, qual é de um
                vendedor e qual só fala com a equipe. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Números conectados</span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                  O papel do número decide como a IA se comporta nele, e o dono decide de quem é a
                  carteira de conversas.
                </span>
              </div>
              <NumerosWhatsAppSection equipe={equipeCompleta} irParaEquipe={() => trocarAba('agentes')} podeEditar={podeEditarNumeros} showToast={showToast} />
            </div>
          </div>
        </CfgTabPanel>
        )}

        {/* Plano */}
        {abaAtiva === 'plano' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {!plano && (
              <div style={{ background: 'var(--green-b)', color: 'var(--green-t)', borderRadius: 'var(--r-ctrl)', padding: '12px 15px', fontSize: 12.5, lineHeight: 1.5 }}>
                Você está no <strong>período de teste gratuito</strong>. Escolha um plano abaixo quando quiser colocar o agente no ar.
              </div>
            )}
            {/* Usage */}
            {plano && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {(() => {
                  const maxAtend = parseInt(plano.atend) || 1;
                  const usoAtend = agentesData.filter(a => a.ativo).length;
                  const maxMsgs = parseInt(plano.msg.replace(/\D/g, '')) || 1;
                  return [
                    { label: 'Atendentes', uso: `${usoAtend}/${maxAtend}`, w: `${Math.min(Math.round((usoAtend / maxAtend) * 100), 100)}%` },
                    { label: 'Mensagens no mês', uso: `${msgsUsadasMes.toLocaleString('pt-BR')}/${plano.msg.replace('/mês', '')}`, w: `${Math.min(Math.round((msgsUsadasMes / maxMsgs) * 100), 100)}%` },
                  ];
                })().map(u => (
                  <div key={u.label} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '13px 15px', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)' }}>{u.label}</span><span style={{ fontSize: 12.5, fontWeight: 700 }}>{u.uso}</span></div>
                    <div style={{ height: 6, borderRadius: 'var(--r-pill)', background: 'var(--gray-b)', overflow: 'hidden' }}><div style={{ height: '100%', borderRadius: 'var(--r-pill)', background: 'var(--primary)', width: u.w }} /></div>
                  </div>
                ))}
              </div>
            )}
            {/* **O que acontece ao passar do limite de mensagens.**
                Era um comportamento só: a IA parava e a conversa ia para uma
                pessoa. Certo no autoatendimento, em que quem atende é o dono do
                negócio. Desastre num piloto B2B: o vendedor está na rua,
                ninguém olha o painel, e o cliente fica falando sozinho —
                justamente no dia de maior volume, que é quando o limite
                estoura. Ver a migration `20260914000003`. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '13px 15px' }}>
              <span style={{ fontSize: 12.5, fontWeight: 700 }}>Se passar do limite de mensagens</span>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8 }}>
                {([
                  ['transferir', 'A IA para e chama uma pessoa', 'Ninguém é atendido por robô acima do que foi contratado. É o padrão.'],
                  ['avisar', 'A IA continua e você é avisado', 'Para contrato com excedente: o atendimento não para, e o aviso vai por e-mail.'],
                ] as const).map(([k, label, desc]) => {
                  const sel = aoEstourarLimite === k;
                  return (
                    <div key={k} onClick={() => void salvarAoEstourarLimite(k)}
                      style={{ border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-soft)' : 'var(--surface)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: sel ? 'var(--primary-t)' : 'var(--text)' }}>{label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4 }}>{desc}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Status da assinatura ativa */}
            {assinatura && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: assinatura.renovaAutomatico ? 'var(--primary-soft)' : 'var(--amber-b)', color: assinatura.renovaAutomatico ? 'var(--primary-t)' : 'var(--amber-t)', borderRadius: 'var(--r-ctrl)', padding: '10px 14px', fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>
                {assinatura.renovaAutomatico
                  ? `Renova automaticamente — próxima cobrança em ${assinatura.validoAte ?? '—'}`
                  : assinatura.metodoPagamento === 'CREDIT_CARD'
                    ? `Assinatura cancelada — seu acesso vai até ${assinatura.validoAte ?? '—'}`
                    : `Plano pré-pago no Pix — vale até ${assinatura.validoAte ?? '—'}. Renove quando quiser.`}
              </div>
            )}
            {/* Escolha do intervalo */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 3 }}>
                {(['mensal', 'anual'] as const).map(iv => (
                  <button key={iv} onClick={() => setIntervalo(iv)}
                    style={{ border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '6px 16px', borderRadius: 'var(--r-pill)', background: intervalo === iv ? 'var(--surface)' : 'transparent', color: intervalo === iv ? 'var(--text)' : 'var(--text3)', boxShadow: intervalo === iv ? '0 1px 2px rgba(0,0,0,.08)' : 'none' }}>
                    {iv === 'mensal' ? 'Mensal' : 'Anual'}
                  </button>
                ))}
              </div>
              {intervalo === 'anual' && <span style={{ fontSize: 11.5, fontWeight: 700, background: 'var(--green-b)', color: 'var(--green-t)', border: '1px solid var(--green-bb)', borderRadius: 'var(--r-pill)', padding: '3px 10px' }}>2 meses grátis</span>}
            </div>
            {/* Plan cards */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 12 }}>
              {planos.filter(p => p.visivel).map(p => {
                const atual = p.key === planoAtual && assinatura?.intervalo === intervalo;
                const ehDowngrade = !!assinatura && !atual && (
                  (PLANO_RANK[p.key] ?? 0) < (PLANO_RANK[planoAtual] ?? 0)
                  || (PLANO_RANK[p.key] === PLANO_RANK[planoAtual] && assinatura.intervalo === 'anual' && intervalo === 'mensal')
                );
                const bloqueado = atual || ehDowngrade;
                return (
                  <div key={p.key} style={{ border: `1px solid ${atual ? 'var(--primary)' : 'var(--border)'}`, background: atual ? 'var(--primary-soft)' : 'var(--surface)', borderRadius: 'var(--r-card)', padding: 15, display: 'flex', flexDirection: 'column', gap: 9, position: 'relative' }}>
                    {atual && <span style={{ position: 'absolute', top: 12, right: 12, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--primary)', color: '#fff', borderRadius: 'var(--r-pill)', padding: '2px 8px' }}>Atual</span>}
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{p.nome}</span>
                    {intervalo === 'anual' ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 13, color: 'var(--text3)', textDecoration: 'line-through' }}>{reais(p.precoCentavos)}</span>
                          <span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{reais(Math.round(p.precoAnualCentavos / 12))}</span>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>/mês</span>
                        </div>
                        <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{reais(p.precoAnualCentavos)} cobrado anualmente · economize {reais(p.precoCentavos * 12 - p.precoAnualCentavos)}</span>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}><span style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>{reais(p.precoCentavos)}</span><span style={{ fontSize: 12, color: 'var(--text3)' }}>/mês</span></div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 2 }}>
                      {[p.atend, p.msg].map(t => (
                        <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--text2)' }}>
                          <svg style={{ color: 'var(--green-t)', flexShrink: 0 }} width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>{t}
                        </span>
                      ))}
                    </div>
                    <button onClick={() => { if (!bloqueado) setPlanoConfirm(p.key); }} disabled={bloqueado}
                      title={ehDowngrade ? `Seu plano atual está pago até ${assinatura?.validoAte ?? 'o fim do período'}. Planos menores ficam disponíveis quando ele terminar.` : undefined}
                      style={{ marginTop: 6, background: bloqueado ? 'var(--surface)' : 'var(--primary)', border: `1px solid ${bloqueado ? 'var(--border)' : 'transparent'}`, color: bloqueado ? 'var(--text3)' : '#fff', borderRadius: 'var(--r-ctrl)', padding: '8px 12px', fontSize: 12.5, fontWeight: 600, cursor: bloqueado ? 'default' : 'pointer' }}>
                      {atual ? 'Plano atual' : ehDowngrade ? 'Disponível ao renovar' : 'Mudar para este'}
                    </button>
                  </div>
                );
              })}
            </div>
            {/* Invoice history */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Histórico de faturas</span>
              {faturas.length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--text3)', padding: '9px 13px', background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)' }}>
                  As faturas aparecem aqui depois da primeira cobrança do plano.
                </span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {faturas.map(f => (
                    <div key={f.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 13px', background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)' }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{f.valor}</span>
                      <span style={{ fontSize: 12.5, color: 'var(--text3)', flex: 1 }}>
                        {f.status === 'pago' ? `Pago em ${f.pagoEm}` : `Vencimento ${f.vencimento}`}
                      </span>
                      <span style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', borderRadius: 'var(--r-pill)', padding: '2px 9px',
                        background: f.status === 'pago' ? 'var(--green-b)' : f.status === 'vencido' ? 'var(--red-b)' : 'var(--gray-b)',
                        color: f.status === 'pago' ? 'var(--green-t)' : f.status === 'vencido' ? 'var(--red-t)' : 'var(--gray-t)',
                      }}>
                        {f.status === 'pago' ? 'Pago' : f.status === 'vencido' ? 'Vencido' : 'Pendente'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {assinatura?.metodoPagamento === 'CREDIT_CARD' && assinatura.renovaAutomatico && (
              <button onClick={() => setCancelarConfirmOpen(true)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: 'var(--red-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', padding: '2px 0' }}>
                Cancelar assinatura
              </button>
            )}
          </div>
        </CfgTabPanel>
        )}

        {/* Agentes */}
        {abaAtiva === 'agentes' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                {VAGAS_TEM_LIMITE ? `${atendentesAtivos} de ${maxAtendentes} vagas do plano em uso` : `${atendentesAtivos} com acesso ao painel`}
                {soCadastrados > 0 && ` · ${soCadastrados} só cadastrada(s)`}.
              </span>
              {/* O botão abre sempre: "só cadastrar" não ocupa vaga, e bloquear
                  o botão inteiro no limite esconderia justamente o caminho que
                  o limite não alcança. Quem é recusado é o modo Convidar, e o
                  modal diz por quê. */}
              <button onClick={() => { setMembroModo(limiteAtingido ? 'cadastrar' : 'convidar'); setMembroErr(''); setMembroModalOpen(true); }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0 }} className="hp">
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M12 5v14" /><path d="M5 12h14" /></svg>
                Adicionar
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
              {agentesData.map((a, i) => (
                <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarBg(a.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{iniciais(a.nome)}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.nome}</span>
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>{a.cargo || '—'}</span>
                    </div>
                    {a.pendente && (
                      <span style={{ fontSize: 11, fontWeight: 600, background: 'var(--amber-b)', color: 'var(--amber-t)', border: '1px solid var(--amber-bb)', borderRadius: 'var(--r-pill)', padding: '2px 8px', flexShrink: 0 }}>Convite pendente</span>
                    )}
                    {!a.acessaPainel && (
                      <span title="Não entra no painel e não ocupa vaga do plano" style={{ fontSize: 11, fontWeight: 600, background: 'var(--surface)', color: 'var(--text3)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: '2px 8px', flexShrink: 0 }}>Só cadastrado</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <button onClick={() => handleToggleMembro(i, 'online')}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer', borderRadius: 'var(--r-pill)', padding: '4px 10px 4px 8px', fontSize: 12, fontWeight: 600, color: a.online ? 'var(--green-t)' : 'var(--text3)' }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: a.online ? '#22c55e' : 'var(--border2)' }} />
                      {a.online ? 'Online' : 'Offline'}
                    </button>
                    <button onClick={() => abrirEdicaoDoMembro(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--primary-t)', borderRadius: 'var(--r-ctrl)', padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }} className="hs">
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                      Editar
                    </button>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{a.ativo ? 'Ativo no sistema' : 'Desativado'}</span>
                    <Toggle on={a.ativo} onClick={() => handleToggleMembro(i, 'ativo')} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CfgTabPanel>
        )}

        {/* Campos do contato */}
        {abaAtiva === 'campos' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
              Campos extras que aparecem em cada contato — ex.: convênio, placa do carro, procedimento preferido. Cada negócio define os seus.
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {state.customFieldDefs.map(def => (
                <div key={def.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{def.label}</span>
                  <button onClick={async () => {
                    try {
                      await removeCampoCustomizado(org.orgId, def.key);
                      dispatch({ type: 'SET', key: 'customFieldDefs', value: state.customFieldDefs.filter(d => d.key !== def.key) });
                      showToast('Campo removido');
                    } catch { showToast('Erro ao remover — tente novamente'); }
                  }} style={{ background: 'none', border: 'none', color: 'var(--red-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Remover</button>
                </div>
              ))}
              {state.customFieldDefs.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhum campo customizado ainda.</span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={novoCampo} onChange={e => setNovoCampo(e.target.value)} placeholder="Nome do campo (ex.: Convênio)" style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', fontSize: 13.5, color: 'var(--text)' }} />
              <button onClick={async () => {
                const label = novoCampo.trim();
                if (label.length < 2) return;
                try {
                  const novo = await addCampoCustomizado(org.orgId, label, state.customFieldDefs.length);
                  dispatch({ type: 'SET', key: 'customFieldDefs', value: [...state.customFieldDefs, novo] });
                  setNovoCampo('');
                  showToast('Campo adicionado');
                } catch { showToast('Erro ao adicionar — nome já existe?'); }
              }} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Adicionar</button>
            </div>
          </div>
        </CfgTabPanel>
        )}

        {/* Respostas prontas */}
        {abaAtiva === 'respostas' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>
              Mensagens pré-escritas que o atendente insere com um clique na tela de Conversas — ex.: horário de funcionamento, formas de pagamento, endereço. Dê um título curto para achar rápido.
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {state.respostasProntas.map(r => (
                <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '11px 12px' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input value={r.titulo}
                      onChange={e => dispatch({ type: 'UPD_RESPOSTA_PRONTA', id: r.id, k: 'titulo', v: e.target.value })}
                      onBlur={e => handleSalvarResposta(r.id, e.target.value, r.texto)}
                      placeholder="Título curto" style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }} />
                    <button onClick={() => handleRemoverResposta(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, display: 'flex' }} className="hr">
                      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                    </button>
                  </div>
                  <textarea value={r.texto}
                    onChange={e => dispatch({ type: 'UPD_RESPOSTA_PRONTA', id: r.id, k: 'texto', v: e.target.value })}
                    onBlur={e => handleSalvarResposta(r.id, r.titulo, e.target.value)}
                    rows={2} placeholder="Texto da mensagem" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text2)', resize: 'vertical' }} />
                </div>
              ))}
              {state.respostasProntas.length === 0 && (
                <span style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhuma resposta pronta ainda.</span>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Nova resposta pronta</span>
              <input value={novaResposta.titulo} onChange={e => setNovaResposta(p => ({ ...p, titulo: e.target.value }))} placeholder="Título curto (ex.: Horário de funcionamento)" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', fontSize: 13.5, color: 'var(--text)' }} />
              <textarea value={novaResposta.texto} onChange={e => setNovaResposta(p => ({ ...p, texto: e.target.value }))} rows={3} placeholder="Texto da mensagem que será inserida na conversa" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', fontSize: 13.5, color: 'var(--text)', resize: 'vertical' }} />
              <button onClick={handleAdicionarResposta} disabled={salvandoResposta} style={{ alignSelf: 'flex-end', background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvandoResposta ? 'wait' : 'pointer', opacity: salvandoResposta ? 0.7 : 1 }} className="hp">{salvandoResposta ? 'Adicionando…' : 'Adicionar'}</button>
            </div>
          </div>
        </CfgTabPanel>
        )}

        {abaAtiva === 'templates' && (
        <CfgTabPanel>
          <TemplatesWhatsAppSection />
        </CfgTabPanel>
        )}

        {/* Uso e custo da IA */}
        {abaAtiva === 'uso' && (
        <CfgTabPanel>
          <UsoIASection podeVer={podeVerFaturamento} />
        </CfgTabPanel>
        )}

        {/* Notificações */}
        {abaAtiva === 'notif' && (
        <CfgTabPanel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* O que já funciona hoje */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, background: 'var(--green-b)', borderRadius: 'var(--r-ctrl)', padding: '12px 14px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--green-t)' }}>Conversa precisa de uma pessoa</span>
                <span style={{ fontSize: 12, color: 'var(--text2)' }}>E-mail para os administradores quando a IA transfere uma conversa ou para de responder (limite do plano, pagamento pendente)</span>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--green-t)', flexShrink: 0 }}>Sempre ativo</span>
            </div>

            {[
              { k: 'notifNova' as keyof AppState, label: 'Nova conversa recebida', sub: 'Alerta sonoro e badge quando um cliente inicia atendimento' },
              { k: 'notifExcedido' as keyof AppState, label: 'Tempo de resposta excedido', sub: 'Avisar quando uma conversa passar de 30 min sem resposta' },
              { k: 'notifResumo' as keyof AppState, label: 'Resumo diário por e-mail', sub: 'Indicadores de atendimento enviados às 18h' },
            ].map(n => (
              <div key={n.k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, opacity: 0.6 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.label}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', background: 'var(--gray-b)', color: 'var(--gray-t)', border: '1px solid var(--gray-bb)', borderRadius: 'var(--r-pill)', padding: '1px 8px' }}>Em breve</span>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{n.sub}</span>
                </div>
                <Toggle on={state[n.k] as boolean} onClick={() => showToast('Este aviso ainda está em construção — em breve')} />
              </div>
            ))}
          </div>
        </CfgTabPanel>
        )}

        {/* Agente modal */}
        {state.agenteModalSel !== null && modalBuf && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', width: 'min(540px, calc(100vw - 28px))', maxHeight: '86vh', display: 'flex', flexDirection: 'column', boxShadow: 'var(--sh-pop)', overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--border)' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarBg(modalBuf.id), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{iniciais(modalBuf.nome)}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{modalBuf.nome}</span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{modalBuf.cargo}</span>
                </div>
                <button onClick={() => dispatch({ type: 'FECHAR_AGENTE_MODAL' })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4, borderRadius: 6, display: 'flex' }} className="hs">
                  <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                </button>
              </div>
              <div style={{ display: 'flex', gap: 4, padding: '12px 20px 0', borderBottom: '1px solid var(--border)' }}>
                {(['visao', 'agenda', 'editar'] as const).map(tab => (
                  <button key={tab} onClick={() => dispatch({ type: 'SET', key: 'agenteModalTab', value: tab })}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: '8px 10px', color: state.agenteModalTab === tab ? 'var(--primary)' : 'var(--text3)', borderBottom: `2px solid ${state.agenteModalTab === tab ? 'var(--primary)' : 'transparent'}`, marginBottom: -1 }}>
                    {tab === 'visao' ? 'Visão geral' : tab === 'agenda' ? 'Agenda' : 'Editar'}
                  </button>
                ))}
              </div>
              <div style={{ padding: '18px 20px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {state.agenteModalTab === 'visao' && (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Horário de funcionamento</span>
                      {modalBuf.horario.map((h, j) => (
                        <div key={j} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontSize: 13, color: 'var(--text2)' }}>{h.dia}</span>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{h.hora}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Conhecimento</span>
                      <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.6 }}>{modalBuf.conhecimento}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Preços praticados</span>
                      {modalBuf.precos.length === 0
                        ? <span style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhum preço cadastrado</span>
                        : modalBuf.precos.map((p, j) => (
                          <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                            <span style={{ color: 'var(--text2)' }}>{p.proc}</span>
                            <span style={{ fontWeight: 600 }}>{p.valor}</span>
                          </div>
                        ))}
                    </div>
                  </>
                )}
                {state.agenteModalTab === 'agenda' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Próximos compromissos</span>
                    {state.agendaItens.filter(x => x.atendente === modalBuf.nome).slice(0, 5).map((x, j) => (
                      <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '10px 13px' }}>
                        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--primary-t)', width: 84, flexShrink: 0 }}>{x.data} {x.hora}</span>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          <span style={{ fontSize: 13, fontWeight: 600 }}>{x.cliente}</span>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>{x.servico}</span>
                        </div>
                      </div>
                    ))}
                    {state.agendaItens.filter(x => x.atendente === modalBuf.nome).length === 0 && (
                      <span style={{ fontSize: 13, color: 'var(--text3)' }}>Nenhum compromisso agendado</span>
                    )}
                  </div>
                )}
                {state.agenteModalTab === 'editar' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <AgenteBufField k="nome" label="Nome" />
                      <AgenteBufField k="cargo" label="Cargo / função" />
                    </div>
                    {/* Os dois campos existiam só no formulário de cadastro, e
                        quem foi convidado não tinha onde preencher código
                        nenhum. São da pessoa, valem com ou sem login.
                        Só no Vendas: código de vendedor e copiloto não existem no Atendimento. */}
                    {org.produtoAtivo === 'vendas' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Código no sistema</label>
                        <input value={contatoDoMembro.codigoErp} onChange={e => setContatoDoMembro(p => ({ ...p, codigoErp: e.target.value }))} placeholder="Ex.: V-07" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)' }} />
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>WhatsApp</label>
                        <input value={contatoDoMembro.telefoneWhatsapp} onChange={e => setContatoDoMembro(p => ({ ...p, telefoneWhatsapp: e.target.value }))} placeholder="Ex.: 5573999990000" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)' }} />
                      </div>
                      <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                        O código vai em cada orçamento criado pelo número dessa pessoa, e o WhatsApp é
                        para onde o copiloto manda o aviso.
                      </span>
                    </div>
                    )}
                    <AgenteBufField k="conhecimento" label="Conhecimento e especialidade" />
                    <div style={{ display: 'flex', gap: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 10, background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 14px' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Online agora</span>
                        <Toggle on={modalBuf.online} onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'online', v: !modalBuf.online })} />
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1, gap: 10, background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 14px' }}>
                        <span style={{ fontSize: 13, fontWeight: 600 }}>Ativo no sistema</span>
                        <Toggle on={modalBuf.ativo} onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'ativo', v: !modalBuf.ativo })} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Preços</span>
                        <button onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'precos', v: [...modalBuf.precos, { proc: 'Novo procedimento', valor: 'R$ 0' }] as Preco[] })}
                          style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>+ Adicionar</button>
                      </div>
                      {modalBuf.precos.map((p, j) => (
                        <div key={j} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <input value={p.proc} onChange={e => { const np = [...modalBuf.precos]; np[j] = { ...np[j], proc: e.target.value }; dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'precos', v: np as Preco[] }); }} style={{ flex: 2, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text)' }} placeholder="Procedimento" />
                          <input value={p.valor} onChange={e => { const np = [...modalBuf.precos]; np[j] = { ...np[j], valor: e.target.value }; dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'precos', v: np as Preco[] }); }} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text)' }} placeholder="Valor" />
                          <button onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'precos', v: modalBuf.precos.filter((_, x) => x !== j) as Preco[] })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }} className="hr">
                            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                          </button>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>FAQs do atendente</span>
                        <button onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'faqs', v: [...modalBuf.faqs, { q: 'Nova pergunta', a: 'Resposta' }] as Faq[] })}
                          style={{ background: 'none', border: 'none', color: 'var(--primary-t)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>+ Adicionar</button>
                      </div>
                      {modalBuf.faqs.map((f, j) => (
                        <div key={j} style={{ display: 'flex', flexDirection: 'column', gap: 5, background: 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 11px' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input value={f.q} onChange={e => { const nf = [...modalBuf.faqs]; nf[j] = { ...nf[j], q: e.target.value }; dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'faqs', v: nf as Faq[] }); }} style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text)', fontWeight: 600 }} placeholder="Pergunta" />
                            <button onClick={() => dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'faqs', v: modalBuf.faqs.filter((_, x) => x !== j) as Faq[] })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', padding: 4 }} className="hr">
                              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /></svg>
                            </button>
                          </div>
                          <textarea value={f.a} onChange={e => { const nf = [...modalBuf.faqs]; nf[j] = { ...nf[j], a: e.target.value }; dispatch({ type: 'SET_AGENTE_MODAL_BUF', k: 'faqs', v: nf as Faq[] }); }} rows={2} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 9px', fontSize: 12.5, color: 'var(--text2)', resize: 'vertical' }} placeholder="Resposta" />
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                      <button onClick={() => dispatch({ type: 'FECHAR_AGENTE_MODAL' })} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
                      <button onClick={handleSalvarMembro} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">{salvando ? 'Salvando…' : 'Salvar alterações'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Add member modal */}
        {membroModalOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(420px, calc(100vw - 28px))', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Adicionar alguém à equipe</span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([
                    ['convidar', 'Convidar por e-mail', 'Ganha login e acesso ao painel. Ocupa uma vaga do plano.'],
                    ['cadastrar', 'Só cadastrar', 'Sem e-mail e sem login. Para o número do vendedor ter dono.'],
                  ] as const).map(([k, label, desc]) => {
                    const sel = membroModo === k;
                    return (
                      <div key={k} onClick={() => { setMembroModo(k); setMembroErr(''); }}
                        style={{ border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-soft)' : 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: sel ? 'var(--primary-t)' : 'var(--text)' }}>{label}</span>
                        <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4 }}>{desc}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {membroErr && <span style={{ fontSize: 12.5, color: 'var(--red-t)', background: 'var(--red-b)', borderRadius: 'var(--r-ctrl)', padding: '8px 12px' }}>{membroErr}</span>}
              {membroModo === 'convidar' && limiteAtingido && (
                <span style={{ fontSize: 12.5, color: 'var(--amber-t)', background: 'var(--amber-b)', border: '1px solid var(--amber-bb)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', lineHeight: 1.5 }}>
                  As {maxAtendentes} vagas do seu plano estão em uso. Você ainda pode{' '}
                  <strong>só cadastrar</strong> — quem não entra no painel não ocupa vaga.
                </span>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Nome *</label>
                  <input value={membroForm.nome} onChange={e => setMembroForm(p => ({ ...p, nome: e.target.value }))} style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Cargo / função</label>
                  <input value={membroForm.cargo} onChange={e => setMembroForm(p => ({ ...p, cargo: e.target.value }))} placeholder="Ex.: Recepção" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                </div>
                {membroModo === 'cadastrar' ? (
                  org.produtoAtivo !== 'vendas' ? (
                    <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 }}>
                      Você pode convidá-la depois para entrar no painel.
                    </span>
                  ) : (
                  <>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Código no sistema</label>
                      <input value={membroForm.codigoErp} onChange={e => setMembroForm(p => ({ ...p, codigoErp: e.target.value }))} placeholder="Ex.: V-07" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>WhatsApp</label>
                      <input value={membroForm.telefoneWhatsapp} onChange={e => setMembroForm(p => ({ ...p, telefoneWhatsapp: e.target.value }))} placeholder="Ex.: 5573999990000" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                    </div>
                    <span style={{ gridColumn: '1 / -1', fontSize: 12, color: 'var(--text3)', lineHeight: 1.5, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px' }}>
                      O código vai em cada orçamento criado pelo número dessa pessoa, e o WhatsApp é para
                      onde o copiloto manda o aviso. Você pode convidá-la depois, se um dia ela precisar
                      entrar no painel.
                    </span>
                  </>
                  )
                ) : (
                <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>E-mail *</label>
                  <input type="email" value={membroForm.email} onChange={e => setMembroForm(p => ({ ...p, email: e.target.value }))} placeholder="pessoa@email.com" style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13.5, color: 'var(--text)' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Papel</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {([['atendente', 'Atendente', 'Conversas, agenda e contatos'], ['admin', 'Administrador', 'Tudo, inclusive agente e plano']] as const).map(([k, label, desc]) => {
                      const sel = membroForm.role === k;
                      return (
                        <div key={k} onClick={() => setMembroForm(p => ({ ...p, role: k }))}
                          style={{ border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-soft)' : 'var(--surface2)', borderRadius: 'var(--r-ctrl)', padding: '10px 12px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: sel ? 'var(--primary-t)' : 'var(--text)' }}>{label}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{desc}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setMembroModalOpen(false); setMembroErr(''); }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
                <button onClick={handleAdicionarMembro} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">
                  {salvando ? 'Salvando…' : membroModo === 'cadastrar' ? 'Cadastrar' : 'Convidar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Plan change confirmation modal */}
        {planoConfirm && (() => {
          const p = planos.find(pl => pl.key === planoConfirm)!;
          return (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
              <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(380px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Confirmar mudança de plano</span>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text2)', lineHeight: 1.6 }}>
                  Você vai assinar o plano <strong>{p.nome}</strong> por{' '}
                  <strong>{intervalo === 'anual' ? `${reais(p.precoAnualCentavos)}/ano` : `${reais(p.precoCentavos)}/mês`}</strong>. Escolha como prefere pagar.
                </p>
                {assinatura && (
                  <span style={{ fontSize: 12, color: 'var(--primary-t)', background: 'var(--primary-soft)', borderRadius: 'var(--r-ctrl)', padding: '8px 11px', lineHeight: 1.5 }}>
                    Você já tem um plano ativo — o valor que sobrou do período atual será abatido nesta cobrança.
                  </span>
                )}
                <div style={{ display: 'flex', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-pill)', padding: 2 }}>
                  {(['PIX', 'CREDIT_CARD'] as const).map(m => (
                    <button key={m} onClick={() => setMetodoEscolhido(m)}
                      style={{ flex: 1, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, padding: '7px 10px', borderRadius: 'var(--r-pill)', background: metodoEscolhido === m ? 'var(--surface)' : 'transparent', color: metodoEscolhido === m ? 'var(--text)' : 'var(--text3)' }}>
                      {m === 'PIX' ? 'Pix' : 'Cartão de crédito'}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                  {metodoEscolhido === 'CREDIT_CARD'
                    ? 'No cartão a renovação é automática — dá pra cancelar quando quiser.'
                    : `No Pix você paga o período ${intervalo === 'anual' ? 'anual' : 'mensal'} e renova na mão (sem cobrança automática).`}
                </span>
                {pagamentoErro && <span style={{ fontSize: 12.5, color: 'var(--red-t)', lineHeight: 1.5 }}>{pagamentoErro}</span>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => { setPlanoConfirm(null); setPagamentoErro(''); }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Cancelar</button>
                  <button onClick={() => handleMudarPlano(planoConfirm)} disabled={salvando} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer', opacity: salvando ? 0.7 : 1 }} className="hp">{salvando ? 'Confirmando…' : 'Confirmar'}</button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Modal: Pagar assinatura (Pix) */}
        {pagamento && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(380px, calc(100vw - 28px))', maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, boxShadow: 'var(--sh-pop)' }}>
              {pagamentoStatus === 'pago' ? (
                <>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>Pagamento confirmado! 🎉</span>
                  <button onClick={() => setPagamento(null)} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }} className="hp">Fechar</button>
                </>
              ) : pagamento.metodo === 'CREDIT_CARD' ? (
                <>
                  <span style={{ fontSize: 13.5, fontWeight: 700, alignSelf: 'flex-start' }}>Pague com cartão pra ativar o plano</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', alignSelf: 'flex-start' }}>R$ {pagamento.valor.toFixed(2).replace('.', ',')} · vencimento {pagamento.vencimento}</span>
                  {pagamento.credito ? <span style={{ fontSize: 12, color: 'var(--green-t)', alignSelf: 'flex-start' }}>Crédito de R$ {pagamento.credito.toFixed(2).replace('.', ',')} do seu plano atual aplicado</span> : null}
                  <span style={{ fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.6 }}>
                    Abrimos uma página segura da Asaas pra você inserir os dados do cartão — nunca passam pelo nosso sistema.
                  </span>
                  <a href={pagamento.invoiceUrl} target="_blank" rel="noopener noreferrer"
                    style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 18px', fontSize: 13, fontWeight: 700, textDecoration: 'none' }} className="hp">
                    Abrir página de pagamento
                  </a>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Aguardando pagamento… atualiza automaticamente</span>
                  <button onClick={() => setPagamento(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Fechar e pagar depois</button>
                </>
              ) : (
                <>
                  <span style={{ fontSize: 13.5, fontWeight: 700, alignSelf: 'flex-start' }}>Pague com Pix pra ativar o plano</span>
                  <span style={{ fontSize: 13, color: 'var(--text3)', alignSelf: 'flex-start' }}>R$ {pagamento.valor.toFixed(2).replace('.', ',')} · vencimento {pagamento.vencimento}</span>
                  {pagamento.credito ? <span style={{ fontSize: 12, color: 'var(--green-t)', alignSelf: 'flex-start' }}>Crédito de R$ {pagamento.credito.toFixed(2).replace('.', ',')} do seu plano atual aplicado</span> : null}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`data:image/png;base64,${pagamento.qrCodeBase64}`} alt="QR Code Pix" style={{ width: 200, height: 200, borderRadius: 'var(--r-ctrl)' }} />
                  <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                    <input readOnly value={pagamento.copiaCola} style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 12, color: 'var(--text2)', minWidth: 0 }} />
                    <button onClick={() => { navigator.clipboard.writeText(pagamento.copiaCola ?? ''); showToast('Código copiado'); }} style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }} className="hp">Copiar</button>
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>Aguardando pagamento… atualiza automaticamente</span>
                  <button onClick={() => setPagamento(null)} style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>Fechar e pagar depois</button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Modal: Confirmar cancelamento de assinatura */}
        {cancelarConfirmOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,18,25,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, animation: 'cm-pop .15s ease' }}>
            <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 24, width: 'min(380px, calc(100vw - 28px))', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: 'var(--sh-pop)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>Cancelar assinatura?</span>
                <span style={{ fontSize: 12.5, color: 'var(--text3)', lineHeight: 1.5 }}>A renovação automática é desligada e não há novas cobranças. Seu acesso continua até o fim do período já pago{assinatura?.validoAte ? ` (${assinatura.validoAte})` : ''} — depois o agente para de responder no WhatsApp. Para confirmar, digite &quot;cancelar&quot; abaixo.</span>
              </div>
              <input value={cancelarConfirmTexto} onChange={e => setCancelarConfirmTexto(e.target.value)} placeholder='Digite cancelar' style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--r-ctrl)', padding: '9px 12px', fontSize: 13.5, color: 'var(--text)' }} />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button onClick={() => { setCancelarConfirmOpen(false); setCancelarConfirmTexto(''); }} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 'var(--r-ctrl)', padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }} className="hs">Voltar</button>
                <button disabled={cancelarConfirmTexto !== 'cancelar' || salvando} onClick={handleCancelarAssinatura}
                  style={{ background: cancelarConfirmTexto === 'cancelar' ? 'var(--red-t)' : 'var(--border)', border: 'none', color: '#fff', borderRadius: 'var(--r-ctrl)', padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: cancelarConfirmTexto === 'cancelar' && !salvando ? 'pointer' : 'not-allowed', opacity: salvando ? 0.7 : 1 }}>{salvando ? 'Cancelando…' : 'Confirmar'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

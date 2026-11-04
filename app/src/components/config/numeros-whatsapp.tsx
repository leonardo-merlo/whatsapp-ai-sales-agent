'use client'; // lista e edita os números no navegador, com o client do usuário (a RLS é que autoriza)

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import type { Produto } from '@/lib/produtos';
import {
  listarNumerosWhatsApp, salvarNumeroWhatsApp, EXPLICACAO_PAPEL,
  type NumeroWhatsApp,
} from '@/lib/data/numeros-whatsapp';
import {
  definirPapelDoNumero, roteiroPadraoDoPapel, PAPEL_DO_ROTEIRO, ROTULO_ROTEIRO,
  type MembroDaEquipe, type NumeroConfiguravel, type RoteiroDoNumero,
} from '@/lib/data/agente-do-numero';
import { WhatsAppConnectButton } from './whatsapp-connect-button';

const ROTEIROS: RoteiroDoNumero[] = ['atendimento', 'vendas', 'copiloto'];

// O que se escolhe depende do produto na tela (29/09). No Atendimento todo
// número é atendimento, e não há escolha. No Vendas o número é de um vendedor
// ou é o copiloto, que só manda avisos. O papel atual sempre aparece, para a
// tela não mentir sobre um número antigo.
const ROTEIROS_DO_PRODUTO: Record<Produto, RoteiroDoNumero[]> = {
  atendimento: ['atendimento'],
  vendas: ['vendas', 'copiloto'],
};

function opcoesDoNumero(produto: Produto, atual: RoteiroDoNumero): RoteiroDoNumero[] {
  const doProduto = ROTEIROS_DO_PRODUTO[produto];
  return ROTEIROS.filter(r => r === atual || doProduto.includes(r));
}

function Selo({ texto, tom }: { texto: string; tom: 'neutro' | 'verde' | 'ambar' }) {
  const cores = {
    neutro: { bg: 'var(--surface)', fg: 'var(--text3)', bd: 'var(--border)' },
    verde: { bg: 'var(--green-b)', fg: 'var(--green-t)', bd: 'var(--green-b)' },
    ambar: { bg: 'var(--amber-b)', fg: 'var(--amber-t)', bd: 'var(--amber-bb)' },
  }[tom];
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, background: cores.bg, color: cores.fg,
      border: `1px solid ${cores.bd}`, borderRadius: 'var(--r-pill)', padding: '2px 8px',
    }}>
      {texto}
    </span>
  );
}

/** Cabeçalho de um dos dois grupos da lista. Só aparece quando existem os
 *  dois: com um tipo só, o título viraria ruído. */
function TituloGrupo({ texto, explicacao }: { texto: string; explicacao: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 4 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {texto}
      </span>
      <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{explicacao}</span>
    </div>
  );
}

const rotulo: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: 'var(--text3)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};

const controle: React.CSSProperties = {
  background: 'var(--surface2)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-ctrl)', padding: '8px 11px', fontSize: 13, color: 'var(--text)',
};

/** Como a pessoa aparece no seletor de dono. Quem não entra no painel ganha o
 *  sufixo para o administrador não procurar um login que não existe. */
function nomeDoMembro(m: MembroDaEquipe): string {
  return m.acessaPainel ? m.nome : `${m.nome} (só cadastrado)`;
}

/**
 * Quem é cada número conectado: o que ele faz e de quem ele é.
 *
 * **A escolha mora aqui desde 14/09**, e não mais na tela do agente. A régua:
 * Integração responde *quais números existem, o que cada um faz e de quem é*; a
 * tela do Conhecimento responde *como a IA fala*. Antes quem conectava um
 * número tinha que ir a outra tela para dizer o que ele era — e lá havia um
 * link de volta para cá, que é sinal de que a informação estava no lugar
 * errado.
 *
 * `podeEditar` reflete a RLS (`wa_numbers` só aceita escrita de admin): sem
 * isso a tela mostraria selects que falhariam em silêncio para o atendente.
 */
/** Sentinela do select de dono: uma opção de verdade, não um botão ao lado —
 *  o Leonardo achou o botão "+ Cadastrar pessoa" confuso perto do select
 *  (17/09), porque parecia outra forma de escolher dono, e não outra tela. Um
 *  valor de select que nunca colide com um `id` de `organization_members`
 *  (que são UUID). */
const NOVA_PESSOA = '__cadastrar_nova_pessoa__';

export default function NumerosWhatsAppSection({
  equipe,
  irParaEquipe,
  podeEditar,
  showToast,
}: {
  equipe: MembroDaEquipe[];
  /** Escolher "Cadastrar novo usuário" no select leva para lá — cadastrar
   *  pessoa é assunto da Equipe, não da Integração. */
  irParaEquipe: () => void;
  podeEditar: boolean;
  showToast: (texto: string) => void;
}) {
  const { orgId, produtoAtivo } = useOrg();

  const [numeros, setNumeros] = useState<NumeroWhatsApp[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  // Só serve para o recarregamento depois de um erro de gravação repetir a
  // busca sem duplicar a lógica que está no efeito (mesmo padrão de uso-ia).
  const [sinal, setSinal] = useState(0);

  useEffect(() => {
    let ativo = true;
    listarNumerosWhatsApp(createClient(), orgId)
      .then(lista => { if (ativo) { setNumeros(lista); setErro(null); } })
      .catch((e: unknown) => {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os números.');
      });
    return () => { ativo = false; };
  }, [orgId, sinal]);

  function paraConfiguravel(n: NumeroWhatsApp): NumeroConfiguravel {
    // O roteiro não precisa ser buscado: papel e roteiro são a mesma escolha
    // gravada em dois lugares, e `definirPapelDoNumero` mantém os dois juntos.
    return {
      id: n.id, telefone: n.telefone, papel: n.papel,
      roteiro: roteiroPadraoDoPapel(n.papel), memberId: n.memberId, ativo: n.ativo,
    };
  }

  /** Papel + dono, gravados juntos em `wa_numbers` e `ai_agent_config`. */
  async function definir(numero: NumeroWhatsApp, escolha: { roteiro: RoteiroDoNumero; memberId: string | null }) {
    const papel = PAPEL_DO_ROTEIRO[escolha.roteiro];
    const atualizado: NumeroWhatsApp = {
      ...numero,
      papel,
      memberId: papel === 'vendedor' ? escolha.memberId : null,
    };
    // Otimista: o select responde na hora. Falhando, volta ao que veio do banco
    // — deixar na tela um papel que não foi gravado é pior do que piscar.
    setNumeros(lista => (lista ?? []).map(n => (n.id === numero.id ? atualizado : n)));
    setSalvandoId(numero.id);
    try {
      await definirPapelDoNumero(createClient(), orgId, paraConfiguravel(numero), escolha);
      showToast('Número atualizado');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Não foi possível salvar');
      setSinal(n => n + 1); // volta ao que está no banco
    } finally {
      setSalvandoId(null);
    }
  }

  async function alternarAtivo(numero: NumeroWhatsApp) {
    const atualizado = { ...numero, ativo: !numero.ativo };
    setNumeros(lista => (lista ?? []).map(n => (n.id === numero.id ? atualizado : n)));
    setSalvandoId(numero.id);
    try {
      await salvarNumeroWhatsApp(createClient(), numero.id, {
        papel: atualizado.papel, memberId: atualizado.memberId, ativo: atualizado.ativo,
      });
      showToast(atualizado.ativo ? 'Número reativado' : 'Número desativado');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Não foi possível salvar');
      setSinal(n => n + 1);
    } finally {
      setSalvandoId(null);
    }
  }

  if (erro) {
    return <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>;
  }
  if (!numeros) {
    return <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>Carregando os números…</span>;
  }
  if (!numeros.length) {
    return (
      <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
        Nenhum número conectado ainda. Use os botões acima para conectar o primeiro.
      </span>
    );
  }

  // Cloud API em cima, coexistência embaixo. São dois jeitos diferentes de o
  // número existir (um só a IA atende, no outro o app segue no celular de
  // alguém), e misturados na mesma lista não dá para saber qual é qual.
  const naCloudApi = numeros.filter(n => !n.coexistencia);
  const emCoexistencia = numeros.filter(n => n.coexistencia);
  const temOsDois = naCloudApi.length > 0 && emCoexistencia.length > 0;

  function cartao(n: NumeroWhatsApp) {
        const roteiro = roteiroPadraoDoPapel(n.papel);
        const opcoes = opcoesDoNumero(produtoAtivo, roteiro);
        const dono = equipe.find(m => m.id === n.memberId);
        return (
          <div key={n.id} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 14,
            display: 'flex', flexDirection: 'column', gap: 12, opacity: salvandoId === n.id ? 0.7 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{n.telefone || 'Número sem telefone cadastrado'}</span>
              <Selo texto={n.coexistencia ? 'Coexistência' : 'Cloud API'} tom="neutro" />
              {n.temCredencialPropria
                ? <Selo texto="Credencial própria" tom="verde" />
                : <Selo texto="Usa a credencial da Wappia" tom="ambar" />}
              {!n.ativo && <Selo texto="Inativo" tom="ambar" />}
            </div>

            {podeEditar && opcoes.length > 1 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={rotulo}>O que este número faz</label>
                <select value={roteiro} disabled={salvandoId === n.id}
                  onChange={e => void definir(n, { roteiro: e.target.value as RoteiroDoNumero, memberId: n.memberId })}
                  style={{ ...controle, maxWidth: 320 }}>
                  {opcoes.map(r => <option key={r} value={r}>{ROTULO_ROTEIRO[r]}</option>)}
                </select>
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{EXPLICACAO_PAPEL[n.papel]}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>{ROTULO_ROTEIRO[roteiro]}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>{EXPLICACAO_PAPEL[n.papel]}</span>
              </div>
            )}

            {/* Dono só em número de vendedor. O de atendimento é da empresa, e o
                copiloto não conversa com ninguém — só dispara aviso para a
                equipe, então não há de quem ser. */}
            {n.papel === 'vendedor' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={rotulo}>De quem é este número</label>
                {podeEditar ? (
                  <>
                    {/* Uma opção de verdade no select, e não um botão ao lado
                        dele: o botão "+ Cadastrar pessoa" ficava perto de um
                        select que já tinha alguém escolhido, e o Leonardo leu
                        como "mais um dono" (17/09) — mesmo depois de renomeado
                        para "+ Cadastrar outra pessoa". Cadastrar pessoa é
                        assunto da tela Equipe, não da Integração; escolher esta
                        opção não grava nada aqui, só navega para lá. */}
                    <select value={n.memberId ?? ''} disabled={salvandoId === n.id}
                      onChange={e => {
                        if (e.target.value === NOVA_PESSOA) { irParaEquipe(); return; }
                        void definir(n, { roteiro: 'vendas', memberId: e.target.value || null });
                      }}
                      style={{ ...controle, maxWidth: 320 }}>
                      <option value="">Sem dono definido</option>
                      {equipe.map(m => <option key={m.id} value={m.id}>{nomeDoMembro(m)}</option>)}
                      <option value={NOVA_PESSOA}>+ Cadastrar novo usuário…</option>
                    </select>
                    <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                      O orçamento criado por este número sai com o código dessa pessoa, e o copiloto
                      avisa o WhatsApp dela. Um número tem sempre um dono só.
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>
                    {dono ? nomeDoMembro(dono) : 'Sem dono definido'}
                  </span>
                )}
              </div>
            )}

            {podeEditar && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                <button
                  onClick={() => void alternarAtivo(n)}
                  style={{
                    background: 'none', border: 'none', padding: 0,
                    fontSize: 12, color: 'var(--text3)', textDecoration: 'underline', cursor: 'pointer',
                  }}
                >
                  {n.ativo ? 'Desativar este número' : 'Reativar este número'}
                </button>
                {/* Refazer serve para trocar o número e para receber de novo as
                    credenciais, que a Meta só entrega no momento da conexão.
                    Fica aqui, e não no topo da tela, porque só faz sentido
                    dito ao lado de um número. */}
                <WhatsAppConnectButton
                  coexistencia={n.coexistencia}
                  rotulo="Refazer conexão"
                  variante="link"
                />
              </div>
            )}
          </div>
        );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {temOsDois && (
        <TituloGrupo
          texto="Na Cloud API"
          explicacao="Só a IA atende. O WhatsApp comum não funciona nesses números."
        />
      )}
      {naCloudApi.map(cartao)}

      {temOsDois && (
        <TituloGrupo
          texto="Em coexistência"
          explicacao="O WhatsApp Business continua no celular de quem atende, e a IA trabalha junto."
        />
      )}
      {emCoexistencia.map(cartao)}

      <span style={{ fontSize: 11.5, color: 'var(--text3)' }}>
        Número desativado para de receber mensagem pelo sistema. As conversas que já existem continuam
        no lugar.
      </span>
    </div>
  );
}

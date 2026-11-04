'use client'; // formulário com estado local; a chave é digitada e some da tela

// "Sistema de gestão": onde o administrador diz qual é o ERP da empresa.
//
// A chave **nunca volta** do servidor. A tela mostra "configurada" ou "não
// configurada" e, para trocar, é preciso digitar de novo — o mesmo
// comportamento de qualquer campo de senha. É o par da decisão do C2: o
// segredo mora no Vault, e o navegador nunca o vê.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useOrg } from '@/lib/org-context';
import { useApp } from '@/lib/app-context';
import { CAMINHOS_PADRAO, OPERACOES, type OperacaoDoErp } from '@/lib/erp/caminhos';
import { ROTULO_DA_OPERACAO } from '@/lib/erp/registro-de-chamadas';

const campo = {
  width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
  borderRadius: 'var(--r-ctrl)', padding: '9px 11px', fontSize: 13.5, color: 'var(--text)',
  fontFamily: 'inherit', boxSizing: 'border-box' as const,
};
const rotulo = { fontSize: 12.5, fontWeight: 700, color: 'var(--text2)' };
const ajuda = { fontSize: 12, color: 'var(--text3)', lineHeight: 1.5 };

export default function ConfiguracaoErp() {
  const org = useOrg();
  const { showToast } = useApp();

  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [enderecoBase, setEnderecoBase] = useState('');
  const [token, setToken] = useState('');
  const [ativo, setAtivo] = useState(true);
  const [permiteHttp, setPermiteHttp] = useState(false);
  const [temCredencial, setTemCredencial] = useState(false);
  // Guardado como o usuário digitou, e não já resolvido: campo em branco tem
  // que continuar em branco na tela, mostrando o padrão em cinza, em vez de
  // aparecer preenchido com um valor que ninguém escolheu.
  const [caminhos, setCaminhos] = useState<Partial<Record<OperacaoDoErp, string>>>({});
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);

  useEffect(() => {
    let vivo = true;
    createClient()
      .from('organization_integrations')
      .select('endereco_base, ativo, token_secret_id, config')
      .eq('organization_id', org.orgId).eq('tipo', 'erp').maybeSingle()
      .then(({ data }) => {
        if (!vivo) return;
        setEnderecoBase(data?.endereco_base ?? '');
        setAtivo(data?.ativo ?? true);
        const config = (data?.config ?? {}) as { permite_http?: boolean; caminhos?: Record<string, string> };
        setPermiteHttp(config.permite_http === true);
        // O que está GUARDADO, e não o que está resolvido: só o que foge do
        // padrão vai para o banco, então o campo em branco continua em branco.
        setCaminhos(config.caminhos ?? {});
        // Só o fato de existir chega ao navegador — nunca o segredo.
        setTemCredencial(Boolean(data?.token_secret_id));
        setCarregando(false);
      });
    return () => { vivo = false; };
  }, [org.orgId]);

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const resposta = await fetch('/api/integracao/erp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enderecoBase, token, ativo, permiteHttp, caminhos }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) { showToast(corpo.error ?? 'Não foi possível salvar'); return; }
      setTemCredencial(Boolean(corpo.temCredencial));
      setToken('');
      showToast('Integração salva');
    } catch {
      showToast('Não foi possível salvar — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Remover a integração é uma rota, não um `delete()` da tela — e a razão é a
   * sujeira que o primeiro teste real deixou em 14/09: apagar a linha direto
   * deixa a chave **órfã no Vault**, guardada sem dono, que ninguém acha
   * depois. Quem apaga os dois na ordem certa é a função `apagar_integracao`.
   */
  async function remover() {
    if (salvando) return;
    setSalvando(true);
    try {
      const resposta = await fetch('/api/integracao/erp', { method: 'DELETE' });
      const corpo = await resposta.json();
      if (!resposta.ok) { showToast(corpo.error ?? 'Não foi possível remover'); return; }
      setEnderecoBase('');
      setToken('');
      setTemCredencial(false);
      setAtivo(true);
      setCaminhos({});
      setConfirmandoRemocao(false);
      showToast('Integração removida, junto com a chave guardada no cofre');
    } catch {
      showToast('Não foi possível remover — tente novamente');
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) return <div style={{ fontSize: 13, color: 'var(--text3)' }}>Carregando…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Sistema de gestão</span>
        <span style={ajuda}>
          Onde a IA consulta o cadastro do cliente, o preço e cria o orçamento. Sem isto, o roteiro de
          vendas atende normalmente mas não consulta nada.
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={rotulo} htmlFor="erp-endereco">Endereço da API</label>
        <input
          id="erp-endereco" value={enderecoBase} onChange={e => setEnderecoBase(e.target.value)}
          placeholder="https://api.empresa.com.br/v1" style={campo}
        />
        <span style={ajuda}>
          O endereço base, sem o caminho de cada operação.
        </span>

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, marginTop: 2 }}>
          <input
            id="erp-permite-http" type="checkbox" checked={permiteHttp}
            onChange={e => setPermiteHttp(e.target.checked)} style={{ marginTop: 2 }}
          />
          <span>
            É um ambiente de homologação, sem HTTPS
            <span style={{ ...ajuda, display: 'block' }}>
              Marque só para testar. Em <code>http://</code> a chave de acesso e os CPF/CNPJ dos
              clientes viajam em texto puro pela internet.
            </span>
          </span>
        </label>

        {permiteHttp && enderecoBase.toLowerCase().startsWith('http://') && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'flex-start',
            background: 'var(--red-b)', border: '1px solid var(--red-bb)',
            borderRadius: 'var(--r-ctrl)',
            padding: '9px 11px', fontSize: 12.5, color: 'var(--red-t)', lineHeight: 1.5,
          }}>
            <span aria-hidden="true">⚠</span>
            <span>
              Conexão não criptografada. Troque para <code>https://</code> assim que o cliente
              disponibilizar, e desmarque esta caixa.
            </span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={rotulo} htmlFor="erp-token">Chave de acesso</label>
        <input
          id="erp-token" type="password" value={token} onChange={e => setToken(e.target.value)}
          placeholder={temCredencial ? 'Já configurada — digite para trocar' : 'Cole a chave aqui'}
          style={campo} autoComplete="off"
        />
        <span style={ajuda}>
          {temCredencial
            ? 'A chave está guardada em cofre criptografado e não é exibida aqui. Para trocá-la, digite a nova.'
            : 'A chave vai para um cofre criptografado e nunca volta para esta tela.'}
        </span>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
        <input type="checkbox" checked={ativo} onChange={e => setAtivo(e.target.checked)} />
        Integração ativa
      </label>

      {/* Os quatro caminhos. Duas das operações vieram do documento da
          Distribuidora Exemplo; as outras duas nós inventamos e estão "A DEFINIR" no
          contrato — é para o dia em que elas forem definidas que estes campos
          existem. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>Caminhos das operações</span>
          <span style={ajuda}>
            O que vem depois do endereço acima, em cada uma das quatro operações. Campo em branco usa
            o padrão, que está escrito em cinza.
          </span>
        </div>

        {/* ⚠ O aviso que impede a promessa errada: endereço é configuração,
            formato é código. Sem esta frase, quem edita presume que pode
            adaptar a integração inteira por aqui. */}
        <div style={{
          background: 'var(--amber-b)', borderRadius: 'var(--r-ctrl)',
          padding: '9px 11px', fontSize: 12.5, color: 'var(--amber-t)', lineHeight: 1.5,
        }}>
          O <strong>endereço</strong> de cada operação você ajusta aqui. O <strong>formato</strong> dos
          campos — quais vão no corpo da requisição e com que nome — é do código e muda com a gente.
          Se o sistema de vocês espera um corpo diferente, fale com o Leonardo antes.
        </div>

        {OPERACOES.map(operacao => (
          <div key={operacao} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={rotulo} htmlFor={`erp-caminho-${operacao}`}>{ROTULO_DA_OPERACAO[operacao]}</label>
            <input
              id={`erp-caminho-${operacao}`}
              value={caminhos[operacao] ?? ''}
              onChange={e => setCaminhos(c => ({ ...c, [operacao]: e.target.value }))}
              placeholder={CAMINHOS_PADRAO[operacao]}
              style={{ ...campo, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}
              autoComplete="off" spellCheck={false}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          onClick={salvar} disabled={salvando}
          style={{ background: 'var(--primary)', border: 'none', color: 'var(--on-primary)', borderRadius: 'var(--r-ctrl)', boxShadow: 'var(--sh-primary)', padding: '9px 16px', fontSize: 13, fontWeight: 700, cursor: salvando ? 'wait' : 'pointer' }}
          className="hp"
        >
          {salvando ? 'Salvando…' : 'Salvar integração'}
        </button>

        {(enderecoBase || temCredencial) && (
          confirmandoRemocao ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text2)' }}>
              Remover o endereço e apagar a chave do cofre?
              <button onClick={remover} disabled={salvando}
                style={{ background: 'var(--red-b)', border: '1px solid var(--red-t)', color: 'var(--red-t)', borderRadius: 'var(--r-ctrl)', padding: '7px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }} className="hr">
                Remover
              </button>
              <button onClick={() => setConfirmandoRemocao(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12.5, cursor: 'pointer' }}>
                cancelar
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirmandoRemocao(true)}
              style={{ background: 'none', border: 'none', color: 'var(--text3)', fontSize: 12.5, textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>
              Remover integração
            </button>
          )
        )}
      </div>
    </div>
  );
}

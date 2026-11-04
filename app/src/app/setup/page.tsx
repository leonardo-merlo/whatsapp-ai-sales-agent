'use client'; // wizard de onboarding do primeiro acesso

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { salvarAgenteConfig, addCampoCustomizado } from '@/lib/data/mutations';
import { SEGMENTOS, presetPorSegmento, aplicarNomeNegocio } from '@/lib/presets';
import { SUCESSOS_PADRAO } from '@/lib/types';

const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 13px', fontSize: 14, color: 'var(--text)', width: '100%' } as const;

/** Marca no servidor qual organização o usuário está usando (cookie). */
async function ativarOrganizacao(organizationId: string): Promise<void> {
  try {
    await fetch('/api/org/ativa', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ organizationId }),
    });
  } catch {
    // Falhar aqui só significa cair na organização padrão; a troca na barra
    // lateral resolve. Não vale derrubar um cadastro que já deu certo.
  }
}

function Label({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{children}</span>
      {sub && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{sub}</span>}
    </div>
  );
}

export default function SetupPage() {
  const router = useRouter();
  const [checandoConvite, setChecandoConvite] = useState(true);
  const [step, setStep] = useState(1);
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const [negocio, setNegocio] = useState('');
  const [descricao, setDescricao] = useState('');
  const [segmento, setSegmento] = useState('');
  const [welcomeMsg, setWelcomeMsg] = useState('');
  const [prompt, setPrompt] = useState('');
  const [limitacoes, setLimitacoes] = useState('');

  // Se a pessoa foi convidada por e-mail para uma equipe, entra direto.
  // Após reivindicar (ou se já for membro), navegação dura garante dados frescos
  // mesmo com o efeito rodando duas vezes no StrictMode.
  useEffect(() => {
    (async () => {
      const supabase = createClient();
      // O convite pode ser para a SEGUNDA empresa de quem já tem uma. Quando
      // isso acontece, a organização ativa passa a ser a que acabou de aceitar
      // — cair na antiga faria parecer que o convite não funcionou.
      const { data: orgDoConvite } = await supabase.rpc('claim_member_invite');
      if (orgDoConvite) await ativarOrganizacao(orgDoConvite);

      // `?nova=1` é quem já tem empresa e está abrindo outra (a troca na barra
      // lateral leva para cá); sem isso, quem já tem organização vai ao painel.
      // Lido de `window` e não com `useSearchParams`: esta página é
      // pré-renderizada, e o hook exigiria envolvê-la num Suspense só por isso.
      const criandoOutra = new URLSearchParams(window.location.search).get('nova') === '1';
      if (criandoOutra) { setChecandoConvite(false); return; }

      const { data: { user } } = await supabase.auth.getUser();
      // `limit(1)` e não `maybeSingle()` puro: com dois vínculos o PostgREST
      // devolveria erro, e a pessoa com duas empresas veria o cadastro de novo.
      const { data: membro } = await supabase
        .from('organization_members')
        .select('id')
        .eq('user_id', user?.id ?? '')
        .limit(1)
        .maybeSingle();
      if (membro) {
        window.location.href = '/painel';
        return;
      }
      setChecandoConvite(false);
    })();
  }, [router]);

  function irParaAgente() {
    setErro('');
    if (negocio.trim().length < 2) { setErro('Informe o nome do seu negócio.'); return; }
    if (!segmento) { setErro('Escolha o tipo do seu negócio.'); return; }
    const preset = presetPorSegmento(segmento);
    setWelcomeMsg(aplicarNomeNegocio(preset.welcomeMsg, negocio.trim()));
    setPrompt(aplicarNomeNegocio(preset.prompt, negocio.trim()));
    setLimitacoes(preset.limitacoes);
    setStep(2);
  }

  async function concluir() {
    if (loading) return;
    setErro('');
    setLoading(true);
    const supabase = createClient();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const ownerNome = (user?.user_metadata?.nome as string | undefined) ?? '';

      const { data: orgId, error } = await supabase.rpc('create_organization_with_owner', {
        org_nome: negocio.trim(),
        owner_nome: ownerNome,
        org_segmento: segmento,
      });
      if (error) {
        if (error.message.includes('Limite de organizações')) {
          setErro('Você já tem o número máximo de empresas nesta conta.');
          setLoading(false);
          return;
        }
        throw error;
      }
      // A empresa recém-criada vira a ativa. Sem isto, quem abre a segunda
      // empresa termina o cadastro e cai na primeira.
      await ativarOrganizacao(orgId);

      const preset = presetPorSegmento(segmento);
      await salvarAgenteConfig(orgId, {
        ativo: true,
        welcomeMsg,
        agentPrompt: prompt,
        limitacoes,
        tom: 'simpatico',
        fallbackMode: 'mensagem',
        fallbackMsg: 'Boa pergunta! Vou verificar com a equipe e já te retorno. Enquanto isso, posso ajudar com mais alguma coisa?',
        fallbackAtendente: '',
        horarioVinculaAgenda: false,
        nomeNegocio: negocio.trim(),
        descricaoNegocio: descricao.trim(),
        endereco: '',
        precos: [],
        faqs: preset.faqsExemplo,
        perguntas: preset.perguntas.map(q => ({ ...q, objetivo: 'contato' as const })),
        gatilhos: preset.gatilhos.map(g => ({ ...g, acao: 'transferir' as const, mensagem: '' })),
        sucessos: SUCESSOS_PADRAO,
        infoAdicional: '',
      }, []);

      const camposSugeridos = preset.camposSugeridos ?? [];
      for (let i = 0; i < camposSugeridos.length; i++) {
        await addCampoCustomizado(orgId, camposSugeridos[i].label, i);
      }

      // Aterrissa direto no simulador: o primeiro contato é conversar com o agente.
      router.push('/conhecimento?testar=1');
      router.refresh();
    } catch {
      setLoading(false);
      setErro('Não foi possível concluir. Tente novamente.');
    }
  }

  if (checandoConvite) {
    return (
      <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <span style={{ fontSize: 14, color: 'var(--text3)' }}>Preparando seu espaço…</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 'min(32px, 6vw) min(36px, 5vw)', width: 'min(560px, 100%)', display: 'flex', flexDirection: 'column', gap: 20, boxShadow: '0 8px 40px rgba(0,0,0,.1)' }}>

        {/* progresso */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {[1, 2].map(s => (
            <div key={s} style={{ flex: 1, height: 4, borderRadius: 999, background: step >= s ? 'var(--primary)' : 'var(--border)' }} />
          ))}
          <span style={{ fontSize: 12, color: 'var(--text3)', flexShrink: 0 }}>Passo {step} de 2</span>
        </div>

        {step === 1 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>Sobre seu negócio</h1>
              <span style={{ fontSize: 13.5, color: 'var(--text3)' }}>Isso monta um agente já pronto para o seu tipo de negócio — tudo pode ser ajustado depois.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label>Nome do negócio</Label>
              <input value={negocio} onChange={e => setNegocio(e.target.value)} placeholder="Ex.: Clínica Sorriso, Bella Moda, CT Fight…" style={inputStyle} autoFocus />
            </div>

            {/* Opcional de propósito: é o campo que mais agrega ao agente, mas
                exigir texto livre no primeiro acesso derruba a conclusão do
                onboarding. Quem pular preenche depois na aba Empresa. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label sub="O que vocês fazem e o que te diferencia da concorrência. É com isso que o agente defende seu preço.">O que o seu negócio faz? (opcional)</Label>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={3}
                placeholder="Ex.: Clínica odontológica no centro há 12 anos. Atendemos urgência no mesmo dia, aparelho invisível em até 18x e temos estacionamento próprio."
                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Label>Qual é o tipo do seu negócio?</Label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {SEGMENTOS.map(s => {
                  const sel = segmento === s.key;
                  return (
                    <div key={s.key} onClick={() => setSegmento(s.key)}
                      style={{ border: `2px solid ${sel ? 'var(--primary)' : 'var(--border)'}`, background: sel ? 'var(--primary-soft)' : 'var(--surface2)', borderRadius: 12, padding: '13px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 18 }}>{s.emoji}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700, color: sel ? 'var(--primary-t)' : 'var(--text)' }}>{s.label}</span>
                      <span style={{ fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.4 }}>{s.descricao}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
            <button onClick={irParaAgente} style={{ background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }} className="hp">
              Continuar
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h1 style={{ margin: 0, fontSize: 21, fontWeight: 700, letterSpacing: '-0.02em' }}>Seu agente já vem pronto</h1>
              <span style={{ fontSize: 13.5, color: 'var(--text3)' }}>Preparamos o comportamento do agente para {presetPorSegmento(segmento).label.toLowerCase()}. Ajuste o que quiser — ou deixe assim e refine depois.</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label sub="A primeira mensagem que seus clientes recebem.">Mensagem de boas-vindas</Label>
              <textarea value={welcomeMsg} onChange={e => setWelcomeMsg(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label sub="Descreve o jeito de atender: tom de voz, o que faz e o que evita.">Como o agente deve se comportar</Label>
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={5} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <Label sub="O que o agente nunca deve fazer, mesmo se o cliente pedir.">Limites do agente</Label>
              <textarea value={limitacoes} onChange={e => setLimitacoes(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }} />
            </div>

            {erro && <span style={{ fontSize: 12.5, color: 'var(--red-t)' }}>{erro}</span>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setStep(1)} disabled={loading} style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text2)', borderRadius: 10, padding: '12px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }} className="hs">
                Voltar
              </button>
              <button onClick={concluir} disabled={loading} style={{ flex: 1, background: 'var(--primary)', border: 'none', color: '#fff', borderRadius: 10, padding: '12px', fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }} className="hp">
                {loading ? 'Criando seu espaço…' : 'Criar meu agente'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

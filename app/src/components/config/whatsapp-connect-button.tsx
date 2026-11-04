'use client';
// Botão de Embedded Signup (Tech Provider). Client component porque usa o SDK do
// Facebook no navegador e mantém estado do fluxo. Carrega o SDK, abre o cadastro
// incorporado via FB.login({ config_id }), captura os IDs que o cadastro devolve por
// postMessage e envia code + IDs para /api/whatsapp/connect.

import { useEffect, useRef, useState } from 'react';

const APP_ID = process.env.NEXT_PUBLIC_WHATSAPP_APP_ID;
const CONFIG_ID = process.env.NEXT_PUBLIC_WHATSAPP_CONFIG_ID;

interface FbAuthResponse {
  code?: string;
}
interface FbLoginResponse {
  authResponse?: FbAuthResponse;
}
interface FbLoginOptions {
  config_id: string;
  response_type: string;
  override_default_response_type: boolean;
  extras: Record<string, unknown>;
}
interface FbSdk {
  init(params: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(callback: (response: FbLoginResponse) => void, options: FbLoginOptions): void;
}

declare global {
  interface Window {
    FB?: FbSdk;
    fbAsyncInit?: () => void;
  }
}

type Status = 'idle' | 'conectando' | 'ok' | 'erro';

export function WhatsAppConnectButton({
  coexistencia = false,
  rotulo,
  variante = 'botao',
}: {
  /** Conecta mantendo o WhatsApp Business no celular — é o caminho do número de
   *  vendedor, em que o app não pode sair do telefone dele. */
  coexistencia?: boolean;
  rotulo?: string;
  /** `link` é o "Refazer conexão" que mora dentro do cartão de um número. */
  variante?: 'botao' | 'link';
}) {
  const [status, setStatus] = useState<Status>('idle');
  const [erro, setErro] = useState<string | null>(null);
  // A conexão pode dar certo na Meta e mesmo assim o token do cliente não ser
  // guardado. Sem aviso, o número fica com selo de conectado e envia pelo token
  // da Wappia sem ninguém saber.
  const [avisoToken, setAvisoToken] = useState<string | null>(null);
  const sessionInfo = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  // Carrega o SDK do Facebook uma única vez.
  useEffect(() => {
    if (!APP_ID || window.FB) return;
    window.fbAsyncInit = () => {
      window.FB?.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: 'v22.0' });
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);
  }, []);

  // O cadastro incorporado envia os IDs da conta por postMessage.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://www.facebook.com' && event.origin !== 'https://web.facebook.com') return;
      try {
        const parsed = JSON.parse(event.data as string) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string };
        };
        // Dois eventos de conclusão: `FINISH` é o cadastro normal;
        // `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING` é a coexistência, e a doc da
        // Meta avisa que ele traz **só o waba_id**. O número é descoberto no
        // servidor, com o token do cliente.
        const concluiu = parsed.event === 'FINISH'
          || parsed.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING';
        if (parsed.type === 'WA_EMBEDDED_SIGNUP' && concluiu) {
          sessionInfo.current = {
            wabaId: parsed.data?.waba_id,
            phoneNumberId: parsed.data?.phone_number_id,
          };
        }
      } catch {
        /* nem toda mensagem do postMessage é JSON — ignora */
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  function conectar() {
    if (!window.FB || !CONFIG_ID) {
      setErro('Integração ainda carregando. Tente de novo em instantes.');
      return;
    }
    setErro(null);
    // Limpa o que ficou de uma tentativa anterior: sem isso, se o postMessage
    // de conclusão não chegar nesta tentativa (a Meta não garante o FINISH em
    // todo fluxo — por exemplo criando uma WABA nova em vez de reaproveitar
    // uma existente), o código seguia com o waba_id/phone_number_id da
    // tentativa passada e reconectava o número errado, sem erro nenhum. Foi
    // o que aconteceu em produção em 24/09: duas tentativas, as duas
    // gravaram o mesmo número antigo.
    sessionInfo.current = {};
    window.FB.login(
      (response) => {
        const code = response.authResponse?.code;
        if (!code) {
          setStatus('idle'); // usuário fechou o pop-up
          return;
        }
        const { wabaId, phoneNumberId } = sessionInfo.current;
        if (!wabaId || (!phoneNumberId && !coexistencia)) {
          setStatus('erro');
          setErro('Não recebemos os dados da conta. Refaça a conexão.');
          return;
        }
        setStatus('conectando');
        fetch('/api/whatsapp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, wabaId, phoneNumberId, coexistencia }),
        })
          .then(async (r) => {
            const j = (await r.json().catch(() => null)) as
              { error?: string; tokenGuardado?: boolean; registrado?: boolean; avisoRegistro?: string | null } | null;
            if (!r.ok) throw new Error(j?.error ?? 'Falha na conexão');
            const aviso = j?.tokenGuardado === false
              ? 'Conectado, mas não guardamos a credencial deste número. Refaça a conexão.'
              : j?.registrado === false
                // Quando a Meta diz o motivo, o motivo é mais útil que o sintoma.
                ? j.avisoRegistro
                  ?? 'Conectado na Meta, mas o número ainda não foi registrado na Cloud API. Ele não recebe mensagem até isso ser resolvido.'
                : null;
            setAvisoToken(aviso);
            setStatus('ok');
            // A lista de números e o selo do topo são carregados quando a
            // página abre; sem recarregar, quem acabou de conectar continua
            // vendo o estado antigo e acha que não funcionou. Com aviso na
            // tela não recarrega: sumiria antes de ser lido.
            if (!aviso) setTimeout(() => window.location.reload(), 1200);
          })
          .catch((e: Error) => {
            setStatus('erro');
            setErro(e.message);
          });
      },
      {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        // `setup` é o que a doc do Embedded Signup v4 manda (o v2 deixa de
        // funcionar em 15/10/2026). `sessionInfoVersion` continua porque é ele
        // que faz o postMessage do FINISH trazer waba_id e phone_number_id.
        extras: {
          setup: {},
          // Coexistência: troca a tela de escolher WABA pela de conectar o
          // número que já está no aplicativo do celular.
          ...(coexistencia ? { featureType: 'whatsapp_business_app_onboarding' } : {}),
          sessionInfoVersion: '3',
        },
      },
    );
  }

  // O botão não muda de cara quando já existe número conectado: conectar aqui
  // quer dizer **acrescentar mais um**, e não "o número da empresa". Quem diz
  // quais números existem é a lista de Números conectados, e é lá que cada um
  // tem o seu "Refazer conexão".
  const desabilitado = status === 'conectando' || !APP_ID;
  const texto = status === 'conectando' ? 'Conectando…'
    : status === 'ok' ? 'Conectado ✓'
      : (rotulo ?? 'Conectar número');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignSelf: 'flex-start' }}>
      {variante === 'link' ? (
        <button
          onClick={conectar}
          disabled={desabilitado}
          style={{
            alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
            fontSize: 12, color: 'var(--text3)', textDecoration: 'underline',
            cursor: desabilitado ? 'not-allowed' : 'pointer',
          }}
        >
          {texto}
        </button>
      ) : (
        <button
          onClick={conectar}
          disabled={desabilitado}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            background: APP_ID ? 'var(--primary)' : 'var(--border)',
            border: 'none',
            color: APP_ID ? '#fff' : 'var(--text3)',
            borderRadius: 'var(--r-ctrl)',
            padding: '8px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: desabilitado ? 'not-allowed' : 'pointer',
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          {texto}
        </button>
      )}
      {avisoToken && <span style={{ fontSize: 12, color: 'var(--red-t)' }}>{avisoToken}</span>}
      {erro && <span style={{ fontSize: 12, color: 'var(--red-t)' }}>{erro}</span>}
    </div>
  );
}

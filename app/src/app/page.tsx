import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { mapPlano } from '@/lib/data/mappers';
import type { Plano } from '@/lib/types';
import LpHeader from '@/components/landing/lp-header';
import LpPricing from '@/components/landing/lp-pricing';

export const metadata: Metadata = {
  title: 'Wappia — seu WhatsApp responde na hora',
  description: 'Um atendente de IA que responde seus clientes no WhatsApp oficial do seu negócio, agenda horários e avisa você quando precisa. Teste grátis no simulador.',
};

// Preços exibidos na landing vêm da mesma tabela que o app usa — nunca divergem.
// Leitura pública de dados de marketing; fallback estático se o banco falhar.
async function buscarPlanos(): Promise<Plano[]> {
  try {
    const supabase = createServiceClient();
    // Só a vitrine: plano escondido continua valendo para quem já assinou.
    const { data } = await supabase.from('plans').select('*').eq('visivel', true).order('preco_centavos');
    if (data && data.length > 0) return data.map(mapPlano);
  } catch { /* segue com fallback */ }
  return [
    { key: 'unico', nome: 'Wappia', preco: 'R$ 250', precoCentavos: 25000, precoAnualCentavos: 250000, atend: '5 atendentes', msg: '1.000 msgs/mês', visivel: true },
  ];
}

const CHAT_DEMO: { de: 'cliente' | 'ia'; texto: string; hora: string }[] = [
  { de: 'cliente', texto: 'Oi! Vocês têm vestido midi? Qual o preço?', hora: '21:47' },
  { de: 'ia', texto: 'Oi! 😊 Temos sim! O midi floral sai por R$ 189 e o liso por R$ 159. Quer que eu veja os tamanhos disponíveis?', hora: '21:47' },
  { de: 'cliente', texto: 'Tem M do floral? Consigo retirar amanhã?', hora: '21:48' },
  { de: 'ia', texto: 'Tem M sim! E consegue retirar amanhã a partir das 9h. Posso deixar separado no seu nome?', hora: '21:48' },
];

const PASSOS = [
  { titulo: 'Crie a conta e diga o tipo do seu negócio', texto: 'Loja, clínica, salão, academia, oficina… o agente já nasce sabendo atender o seu ramo, com mensagens prontas que você pode ajustar.' },
  { titulo: 'Converse com ele antes de qualquer cliente', texto: 'No simulador, você faz as perguntas que seus clientes fariam e vê as respostas na hora. Ajustou, testou, gostou — aí sim publica.' },
  { titulo: 'Conecte o WhatsApp oficial do seu negócio', texto: 'Conexão pela API oficial da Meta, sem risco de bloqueio do número. A partir daí, ele atende — e você assume qualquer conversa com um toque.' },
];

// Funcionalidades visíveis no print do painel (§8) — pills do showcase.
const SHOWCASE_PILLS = ['IA + atendente humano', 'Etiquetas nas conversas', 'Agendamento integrado', 'Ficha completa do cliente'];

const RECURSOS = [
  { titulo: 'Responde de madrugada, domingo e feriado', texto: 'Cliente que pergunta às 23h e não recebe resposta compra em outro lugar. O agente responde em segundos, sempre.' },
  { titulo: 'Você no comando, sempre', texto: 'Assuma qualquer conversa com um toque. Defina o que a IA nunca pode fazer e quando ela deve chamar uma pessoa.' },
  { titulo: 'Agenda horários sozinho', texto: 'O agente oferece horários livres da sua agenda e marca o compromisso — você só vê a agenda encher.' },
  { titulo: 'Conhece seus produtos e preços', texto: 'Cadastre (ou importe uma planilha) e ele responde o que você vende, quanto custa e o que tem em estoque.' },
  { titulo: 'Avisa quando precisa de você', texto: 'Se um cliente pede algo que exige uma pessoa, o agente transfere a conversa e avisa a equipe por e-mail.' },
  { titulo: 'Feito para usar no celular', texto: 'Acompanhe conversas, intervenha e ajuste o agente do balcão, do sofá ou da fila do banco.' },
];

// Números honestos do produto — fatos verdadeiros, não métricas de adoção inventadas.
// Quando houver dados reais coletados (ex.: % de mensagens respondidas), trocar aqui.
const METRICAS = [
  { n: '24/7', l: 'Atende de madrugada, domingo e feriado — sem contratar ninguém a mais.', tone: 'a' },
  { n: 'Na hora', l: 'Sem fila e sem "respondemos em breve" — mesmo às 3h da manhã.', tone: 'b' },
  { n: 'R$ 0', l: 'Pra testar tudo no simulador antes de conectar o WhatsApp.', tone: 'c' },
  { n: '1 toque', l: 'É o que basta pra você assumir qualquer conversa da IA.', tone: 'b' },
];

const FAQS = [
  { q: 'É o WhatsApp oficial? Meu número corre risco de bloqueio?', a: 'Sim, é a API oficial do WhatsApp (Meta) — a mesma usada por grandes empresas. Diferente de soluções que "escaneiam QR code", não há risco de banimento do seu número.' },
  { q: 'E se a IA falar besteira para um cliente?', a: 'Você define limites do que ela nunca pode fazer, testa tudo no simulador antes de publicar, e ela transfere para uma pessoa sempre que o assunto foge do combinado. Além disso, você pode assumir qualquer conversa a qualquer momento.' },
  { q: 'Preciso entender de tecnologia?', a: 'Não. Você cria a conta, escolhe o tipo do negócio e o agente nasce pronto. Ajustar é escrever em português, como quem orienta um funcionário novo.' },
  { q: 'Funciona para o meu tipo de negócio?', a: 'Loja, clínica, consultório, salão, barbearia, academia, oficina e serviços em geral. O agente vem com comportamento pronto para cada segmento.' },
  { q: 'Posso cancelar quando quiser?', a: 'Pode. Sem fidelidade e sem multa — o plano é mensal e o cancelamento é um botão dentro do app.' },
];

// Índice do stagger: cada item entra 60ms depois do anterior.
const stagger = (i: number): React.CSSProperties => ({ ['--i' as string]: i });

function Check({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) redirect('/painel');

  const planos = await buscarPlanos();

  return (
    <div className="lp">
      <style>{`
        /* ---- tokens da landing (sempre tema claro: página é logada-fora) ---- */
        .lp {
          --lp-max: 1280px;
          --lp-accent: #1e8a3e;            /* verde da marca (extraído do logo) */
          --lp-accent-strong: #15803d;
          --lp-accent-bright: #34d058;     /* verde legível sobre fundo escuro */
          --lp-accent-soft: rgba(30,138,62,.10);
          --lp-dark: #0a0a0a;
          --lp-on-dark: #ffffff;
          --lp-on-dark-2: #a3a3a3;
          --lp-cta: #064e3b;               /* verde profundo — EXCLUSIVO do CTA final */
          --lp-ink: #131311;
          --lp-muted: #5c5c56;
          --lp-faint: #8a8a82;
          --lp-line: #e9e9e5;
          --lp-surface: #f6f6f4;
          --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
          --ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);
          min-height: 100dvh;
          background: #ffffff;
          color: var(--lp-ink);
          scroll-behavior: smooth;
          /* clip (não hidden): impede que o blob decorativo crie scroll horizontal
             sem virar contêiner de rolagem — o header sticky continua funcionando. */
          overflow-x: clip;
        }
        .lp *:focus-visible { outline: 2px solid var(--lp-accent); outline-offset: 2px; border-radius: 4px; }

        /* ---- container: fundo full-bleed, conteúdo com trilho de 1280 ---- */
        .lp-wrap { max-width: var(--lp-max); margin: 0 auto; padding-inline: clamp(20px, 5vw, 48px); }
        .lp-band { width: 100%; }
        .lp-band--light { background: var(--lp-surface); }
        .lp-band--dark { background: var(--lp-dark); color: var(--lp-on-dark); }
        .lp-band--cta { background: var(--lp-cta); color: #fff; }

        /* ---- botões (sistema único) ---- */
        .lp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 8px; padding: 14px 28px; font-size: 15px; font-weight: 600; text-decoration: none; text-align: center; cursor: pointer; transition: transform 160ms var(--ease-out), box-shadow 160ms var(--ease-out), background 160ms ease, border-color 160ms ease; }
        .lp-btn--sm { padding: 10px 18px; font-size: 14px; }
        .lp-btn--primary { background: var(--lp-ink); color: #fff; box-shadow: 0 4px 14px rgba(0,0,0,.12); }
        .lp-btn--primary:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(0,0,0,.18); }
        .lp-btn--accent { background: var(--lp-accent); color: #fff; box-shadow: 0 4px 14px rgba(30,138,62,.28); }
        .lp-btn--accent:hover { transform: translateY(-1px); box-shadow: 0 10px 26px rgba(30,138,62,.35); }
        .lp-btn--ghost { color: var(--lp-muted); border-color: var(--lp-line); background: #fff; }
        .lp-btn--ghost:hover { color: var(--lp-ink); border-color: var(--lp-faint); transform: translateY(-1px); }
        .lp-btn--invert { background: #fff; color: #06311f; box-shadow: 0 8px 24px rgba(0,0,0,.22); }
        .lp-btn--invert:hover { transform: translateY(-1px); box-shadow: 0 14px 34px rgba(0,0,0,.3); }
        .lp-btn:active { transform: scale(0.97); }

        /* ---- header flutuante ---- */
        .lp-header { position: sticky; top: 0; z-index: 50; height: 72px; display: flex; align-items: center; transition: background .25s ease, box-shadow .25s ease, backdrop-filter .25s ease; }
        .lp-header.is-scrolled { background: rgba(255,255,255,.8); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: 0 1px 0 rgba(0,0,0,.05), 0 10px 30px rgba(0,0,0,.05); }
        .lp-header-inner { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
        .lp-logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 16px; color: var(--lp-ink); text-decoration: none; }
        .lp-logo-mark { display: inline-flex; }
        .lp-nav { display: flex; align-items: center; gap: 10px; }

        /* ---- hero ---- */
        .lp-hero { position: relative; display: grid; grid-template-columns: 1.1fr 342px; gap: clamp(40px, 6vw, 72px); align-items: center; padding-block: clamp(36px, 5vw, 64px) clamp(56px, 8vw, 88px); }
        .lp-hero .lp-hero-blob { position: absolute; z-index: 0; top: 4%; right: 2%; width: 460px; height: 460px; border-radius: 50%; background: radial-gradient(circle at 50% 50%, rgba(52,208,88,.22), rgba(30,138,62,0) 68%); filter: blur(60px); pointer-events: none; }
        .lp-hero > * { position: relative; z-index: 1; }
        .lp-pill { display: inline-flex; align-items: center; gap: 8px; background: var(--lp-surface); border: 1px solid var(--lp-line); color: var(--lp-muted); font-size: 13px; font-weight: 600; padding: 6px 14px; border-radius: 999px; margin-bottom: 22px; }
        .lp-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--lp-accent); box-shadow: 0 0 0 0 rgba(30,138,62,.5); animation: lp-pulse 2.2s infinite; }
        @keyframes lp-pulse { 0% { box-shadow: 0 0 0 0 rgba(30,138,62,.45); } 70% { box-shadow: 0 0 0 7px rgba(30,138,62,0); } 100% { box-shadow: 0 0 0 0 rgba(30,138,62,0); } }
        .lp-h1 { font-size: clamp(2.5rem, 5.4vw, 3.75rem); line-height: 1.07; letter-spacing: -0.022em; font-weight: 700; margin: 0 0 18px; text-wrap: balance; }
        .lp-sub { font-size: clamp(1rem, 1.3vw, 1.125rem); line-height: 1.6; color: var(--lp-muted); margin: 0 0 28px; max-width: 48ch; text-wrap: pretty; }
        .lp-hero-ctas { display: flex; gap: 12px; flex-wrap: wrap; }
        .lp-trust { margin-top: 20px; font-size: 13px; color: var(--lp-faint); line-height: 1.6; }

        /* ---- phone mock (cara de WhatsApp mobile) ---- */
        .lp-phone { position: relative; width: 342px; max-width: 100%; margin: 0 auto; background: #0d0d0f; border-radius: 46px; padding: 11px; box-shadow: 0 30px 80px rgba(0,0,0,.30), 0 4px 12px rgba(0,0,0,.12); }
        .lp-phone-island { position: absolute; z-index: 4; top: 20px; left: 50%; transform: translateX(-50%); width: 96px; height: 26px; background: #0d0d0f; border-radius: 999px; }
        .lp-phone-screen { position: relative; border-radius: 36px; overflow: hidden; background: var(--wa-bg); }
        .lp-wa-status { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px 7px; background: #008069; color: #fff; font-size: 12.5px; font-weight: 600; }
        .lp-wa-sys { display: inline-flex; align-items: center; gap: 5px; }
        .lp-wa-top { display: flex; align-items: center; gap: 9px; padding: 8px 12px 10px; background: #008069; color: #fff; }
        .lp-wa-top > svg { opacity: .95; flex-shrink: 0; }
        .lp-wa-ava { width: 30px; height: 30px; border-radius: 50%; background: #25d366; color: #054d38; font-weight: 700; font-size: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .lp-wa-id { display: flex; flex-direction: column; line-height: 1.15; margin-right: auto; }
        .lp-wa-id strong { font-size: 13.5px; font-weight: 600; }
        .lp-wa-id em { font-size: 11px; font-style: normal; opacity: .85; }
        .lp-wa-actions { display: flex; gap: 16px; }
        .lp-wa-body { background: var(--wa-bg); padding: 14px 12px 8px; }
        .lp-wa-day { display: block; width: fit-content; margin: 0 auto 12px; background: #e2f0e6; color: #54656f; font-size: 10px; font-weight: 600; padding: 4px 12px; border-radius: 8px; text-transform: uppercase; letter-spacing: .04em; }
        .lp-wa-input { display: flex; align-items: center; gap: 8px; padding: 9px 12px 14px; background: var(--wa-bg); }
        .lp-wa-field { flex: 1; background: #fff; border-radius: 999px; padding: 9px 15px; font-size: 12.5px; color: var(--wa-meta); box-shadow: 0 1px 1px rgba(0,0,0,.05); }
        .lp-wa-send { width: 34px; height: 34px; border-radius: 50%; background: #008069; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }

        /* ---- bolhas do chat ---- */
        .lp-bubble { max-width: 86%; border-radius: 12px; padding: 9px 12px; font-size: 13.5px; line-height: 1.5; color: var(--wa-text); box-shadow: 0 1px 1px rgba(0,0,0,.07); margin-bottom: 9px; opacity: 0; animation: lp-in .5s var(--ease-out) forwards; }
        .lp-bubble .h { display: block; font-size: 10.5px; color: var(--wa-meta); text-align: right; margin-top: 3px; }
        .lp-bubble.cliente { background: var(--wa-in); margin-right: auto; }
        .lp-bubble.ia { background: var(--wa-out); margin-left: auto; }
        .lp-bubble:nth-child(2) { animation-delay: .15s; } .lp-bubble:nth-child(3) { animation-delay: .9s; }
        .lp-bubble:nth-child(4) { animation-delay: 1.6s; } .lp-bubble:nth-child(5) { animation-delay: 2.3s; }
        .lp-chat-caption { font-size: 11.5px; color: var(--wa-meta); text-align: center; padding: 4px 8px 2px; }
        @keyframes lp-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

        /* ---- prova social / trust strip ---- */
        .lp-trustband { padding-block: clamp(40px, 6vw, 64px); }
        .lp-trustband-title { text-align: center; font-size: 13px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-faint); margin: 0 0 26px; }
        .lp-trust-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 14px 32px; }
        .lp-trust-item { display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; color: var(--lp-muted); }
        .lp-trust-item svg { color: var(--lp-accent); flex-shrink: 0; }
        /* TODO(logos): quando houver logos de clientes reais, trocar o trust-row acima
           por uma fileira de 4–6 <Image> em grayscale (filter: grayscale(100%); opacity:.6)
           com hover que remove o grayscale. Não inventar marcas. */

        /* ---- seção base ---- */
        .lp-section { padding-block: clamp(64px, 8vw, 96px); }
        .lp-section--dark { padding-block: clamp(80px, 10vw, 120px); }
        .lp-section--center { text-align: center; }
        .lp-section--center .lp-lead { margin-left: auto; margin-right: auto; }
        .lp-eyebrow { font-size: 13px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--lp-accent-strong); margin: 0 0 12px; }
        .lp-band--dark .lp-eyebrow { color: var(--lp-accent-bright); }
        .lp-h2 { font-size: clamp(2rem, 4vw, 2.75rem); line-height: 1.1; letter-spacing: -0.015em; font-weight: 700; margin: 0 0 10px; text-wrap: balance; }
        .lp-lead { font-size: clamp(.9375rem, 1.2vw, 1.0625rem); line-height: 1.6; color: var(--lp-faint); margin: 0 0 44px; max-width: 60ch; text-wrap: pretty; }
        .lp-band--dark .lp-lead { color: var(--lp-on-dark-2); }

        /* ---- passos (carrossel horizontal com snap) ---- */
        .lp-steps { display: flex; gap: 20px; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; margin-inline: calc(-1 * clamp(20px, 5vw, 48px)); padding: 4px clamp(20px, 5vw, 48px) 10px; }
        .lp-steps::-webkit-scrollbar { display: none; }
        .lp-step { scroll-snap-align: start; flex: 0 0 clamp(266px, 30%, 372px); background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.09); border-radius: 18px; padding: 28px 26px; }
        .lp-step-n { font-size: 2.75rem; font-weight: 700; line-height: 1; color: var(--lp-accent-bright); margin-bottom: 14px; }
        .lp-step h3 { font-size: 1.1875rem; font-weight: 600; margin: 0 0 8px; color: #fff; }
        .lp-step p { font-size: .9375rem; line-height: 1.6; color: var(--lp-on-dark-2); margin: 0; }

        /* ---- showcase do produto (dark contínuo) ---- */
        .lp-showcase { padding-block: 0 clamp(80px, 10vw, 120px); }
        .lp-frame { border-radius: 12px; overflow: hidden; background: #1b1b1b; box-shadow: 0 20px 60px rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.08); }
        .lp-frame-bar { display: flex; align-items: center; gap: 7px; padding: 12px 16px; background: #161616; border-bottom: 1px solid rgba(255,255,255,.06); }
        .lp-frame-bar i { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
        .lp-frame-bar i:nth-child(1) { background: #ff5f57; } .lp-frame-bar i:nth-child(2) { background: #febc2e; } .lp-frame-bar i:nth-child(3) { background: #28c840; }
        .lp-frame img { display: block; width: 100%; height: auto; }
        .lp-showcase-pills { display: flex; flex-wrap: wrap; gap: 10px; justify-content: center; margin-top: 28px; }
        .lp-spill { display: inline-block; font-size: 13px; font-weight: 600; color: var(--lp-on-dark); background: rgba(255,255,255,.07); border: 1px solid rgba(255,255,255,.12); padding: 8px 15px; border-radius: 999px; }

        /* ---- recursos (features) ---- */
        .lp-recursos { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 56px; }
        .lp-feat { display: flex; gap: 16px; padding: 20px 0; border-bottom: 1px solid var(--lp-line); }
        .lp-feat-ic { flex-shrink: 0; width: 32px; height: 32px; border-radius: 50%; background: var(--lp-accent-soft); color: var(--lp-accent-strong); display: flex; align-items: center; justify-content: center; margin-top: 2px; }
        .lp-feat h3 { font-size: 1.0625rem; font-weight: 600; margin: 0 0 4px; }
        .lp-feat p { font-size: .9375rem; line-height: 1.55; color: var(--lp-muted); margin: 0; }

        /* ---- métricas ---- */
        .lp-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
        .lp-stat { border-radius: 16px; padding: 30px 24px; box-shadow: 0 4px 24px rgba(0,0,0,.05); }
        .lp-stat--a { background: #eaf6ee; } .lp-stat--b { background: #f2f4f1; } .lp-stat--c { background: #e6f4ea; }
        .lp-stat-n { font-size: clamp(2.6rem, 4vw, 4rem); font-weight: 700; letter-spacing: -0.02em; line-height: 1; color: var(--lp-accent-strong); margin-bottom: 12px; }
        .lp-stat-l { font-size: .9375rem; line-height: 1.5; color: var(--lp-muted); margin: 0; }

        /* ---- planos + toggle mensal/anual ---- */
        .lp-toggle { position: relative; display: flex; width: fit-content; margin: 0 auto 40px; background: var(--lp-surface); border: 1px solid var(--lp-line); border-radius: 999px; padding: 4px; }
        .lp-toggle-thumb { position: absolute; top: 4px; left: 4px; bottom: 4px; width: calc(50% - 4px); background: #fff; border-radius: 999px; box-shadow: 0 2px 8px rgba(0,0,0,.08); transition: transform .22s var(--ease-out); }
        .lp-toggle-thumb[data-anual="true"] { transform: translateX(100%); }
        .lp-toggle-opt { position: relative; z-index: 1; border: 0; background: transparent; cursor: pointer; padding: 9px 22px; font-size: 14px; font-weight: 600; color: var(--lp-faint); display: inline-flex; align-items: center; gap: 8px; transition: color .18s ease; font-family: inherit; }
        .lp-toggle-opt.is-active { color: var(--lp-ink); }
        .lp-toggle-save { font-size: 10.5px; font-weight: 700; color: var(--lp-accent-strong); background: var(--lp-accent-soft); padding: 2px 7px; border-radius: 999px; }
        .lp-planos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; align-items: start; }
        .lp-plano { background: #fff; border: 1px solid var(--lp-line); border-radius: 16px; padding: 28px 24px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.04); }
        .lp-plano.destaque { border: 2px solid var(--lp-accent); position: relative; box-shadow: 0 16px 44px rgba(30,138,62,.16); }
        .lp-plano .tag { position: absolute; top: -12px; left: 24px; background: var(--lp-accent); color: #fff; font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; border-radius: 999px; padding: 4px 12px; }
        .lp-plano h3 { margin: 0; font-size: 1.0625rem; font-weight: 600; }
        .lp-preco-wrap { min-height: 66px; }
        .lp-preco { font-size: 2.25rem; font-weight: 700; letter-spacing: -0.02em; animation: lp-price .22s var(--ease-out); }
        .lp-preco small { font-size: 13px; color: var(--lp-faint); font-weight: 500; }
        .lp-preco-note { font-size: 12px; color: var(--lp-faint); margin-top: 2px; }
        @keyframes lp-price { from { opacity: .3; filter: blur(3px); transform: translateY(2px); } to { opacity: 1; filter: blur(0); transform: none; } }
        .lp-plano ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 9px; }
        .lp-plano li { font-size: .875rem; color: var(--lp-muted); display: flex; gap: 9px; align-items: center; }
        .lp-plano li svg { color: var(--lp-accent-strong); flex-shrink: 0; }
        .lp-plano .lp-btn { margin-top: 6px; }

        /* ---- FAQ (centralizado) ---- */
        .lp-faq { max-width: 720px; margin: 0 auto; text-align: left; }
        .lp-faq details { border-bottom: 1px solid var(--lp-line); }
        .lp-faq summary { cursor: pointer; padding: 20px 4px; font-size: 1rem; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
        .lp-faq summary::-webkit-details-marker { display: none; }
        .lp-faq summary::after { content: '+'; font-size: 22px; font-weight: 400; color: var(--lp-faint); transition: transform .2s var(--ease-out); line-height: 1; }
        .lp-faq details[open] summary::after { transform: rotate(45deg); }
        .lp-faq details p { margin: 0; padding: 0 4px 20px; font-size: .9375rem; line-height: 1.65; color: var(--lp-muted); }

        /* ---- CTA final ---- */
        .lp-final { text-align: center; padding-block: clamp(80px, 10vw, 120px); }
        .lp-final .lp-h2 { color: #fff; margin-bottom: 14px; }
        .lp-final p { color: rgba(255,255,255,.78); font-size: 1.0625rem; line-height: 1.6; max-width: 52ch; margin: 0 auto 28px; }

        /* ---- footer ---- */
        .lp-footer-band { border-top: 1px solid var(--lp-line); }
        .lp-footer { padding: 26px 0; display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; color: var(--lp-faint); flex-wrap: wrap; align-items: center; }
        .lp-footer a { color: var(--lp-muted); text-decoration: none; font-weight: 600; }
        .lp-footer a:hover { color: var(--lp-ink); }

        /* ---- textura: grão sutil nas faixas escuras (quebra o "flat") ---- */
        .lp-band--dark, .lp-band--cta { position: relative; isolation: isolate; }
        .lp-band--dark::after, .lp-band--cta::after {
          content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none; opacity: .32;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E");
          background-size: 160px 160px;
        }

        /* ---- scroll reveal com stagger (CSS puro, scroll-driven) ----
           Sem JS: nada de hidratação nem risco de deixar conteúdo invisível.
           Navegador sem suporte simplesmente mostra tudo normal (o @supports não entra).
           O stagger sai do --i: cada item entra um pouco depois do anterior. */
        @keyframes lp-reveal { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @supports (animation-timeline: view()) {
          @media (prefers-reduced-motion: no-preference) {
            .lp [data-r] {
              animation: lp-reveal linear both;
              animation-timeline: view();
              animation-range: entry calc(var(--i, 0) * 5%) entry calc(38% + var(--i, 0) * 5%);
            }
          }
        }

        /* ---- responsivo ---- */
        @media (max-width: 1024px) { .lp-stats { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 860px) {
          /* minmax(0,1fr): deixa a coluna encolher abaixo da largura fixa do celular */
          .lp-hero { grid-template-columns: minmax(0, 1fr); gap: 40px; }
          .lp-hero .lp-hero-blob { width: 320px; height: 320px; top: -2%; right: -10%; }
          .lp-recursos, .lp-planos { grid-template-columns: 1fr; }
          .lp-nav .lp-btn--ghost { display: none; }
        }
        @media (max-width: 560px) {
          .lp-stats { grid-template-columns: 1fr; }
          .lp-trust-row { flex-direction: column; align-items: flex-start; }
        }
        @media (prefers-reduced-motion: reduce) {
          .lp-bubble { animation: none; opacity: 1; }
          .lp-dot { animation: none; }
          .lp-preco { animation: none; }
          .lp-toggle-thumb { transition: none; }
          .lp { scroll-behavior: auto; }
        }
      `}</style>

      <LpHeader />

      {/* ===== HERO ===== */}
      <section className="lp-band">
        <div className="lp-wrap lp-hero">
          <div className="lp-hero-blob" aria-hidden="true" />
          <div>
            <span className="lp-pill"><span className="lp-dot" /> Atende agora, 24 horas por dia</span>
            <h1 className="lp-h1">Seu WhatsApp responde na hora. Mesmo quando você não pode.</h1>
            <p className="lp-sub">
              Um atendente de IA que responde seus clientes, informa preços, agenda horários e
              chama você quando o assunto precisa de gente — no WhatsApp oficial do seu negócio.
            </p>
            <div className="lp-hero-ctas">
              <Link href="/cadastro" className="lp-btn lp-btn--primary">Criar meu agente grátis</Link>
              <Link href="/login" className="lp-btn lp-btn--ghost">Já tenho conta</Link>
            </div>
            <p className="lp-trust">Configure em 2 minutos · Teste no simulador antes de conectar · Assuma qualquer conversa com um toque</p>
          </div>

          <div className="lp-phone" aria-label="Conversa no WhatsApp atendida pelo agente">
            <span className="lp-phone-island" aria-hidden="true" />
            <div className="lp-phone-screen">
              <div className="lp-wa-status" aria-hidden="true">
                <span>21:47</span>
                <span className="lp-wa-sys">
                  <svg width={17} height={11} viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2" width="3" height="10" rx="1" opacity=".5" /><rect x="15" y="0" width="3" height="12" rx="1" opacity=".5" /></svg>
                  <svg width={15} height={11} viewBox="0 0 15 11" fill="currentColor"><path d="M7.5 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3A10.3 10.3 0 0 0 7.5.3 10.3 10.3 0 0 0 .3 3.3l1.2 1.3A8.4 8.4 0 0 1 7.5 2.2Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.3a7 7 0 0 0-9.6 0l1.2 1.3a5.1 5.1 0 0 1 3.6-1.4Zm0 3.4 1.9-2a2.7 2.7 0 0 0-3.8 0l1.9 2Z" /></svg>
                  <svg width={24} height={12} viewBox="0 0 24 12" fill="none"><rect x="1" y="1.5" width="19" height="9" rx="2.5" stroke="currentColor" strokeOpacity=".5" /><rect x="2.5" y="3" width="16" height="6" rx="1.2" fill="currentColor" /><rect x="21" y="4" width="2" height="4" rx="1" fill="currentColor" fillOpacity=".5" /></svg>
                </span>
              </div>
              <div className="lp-wa-top">
                <svg width={9} height={16} viewBox="0 0 9 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polyline points="8 1 1 8 8 15" /></svg>
                <span className="lp-wa-ava">L</span>
                <span className="lp-wa-id"><strong>Sua loja</strong><em>online</em></span>
                <span className="lp-wa-actions">
                  <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="m23 7-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
                  <svg width={19} height={19} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.6A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" /></svg>
                </span>
              </div>
              <div className="lp-wa-body">
                <span className="lp-wa-day">Hoje</span>
                {CHAT_DEMO.map((m, i) => (
                  <div key={i} className={`lp-bubble ${m.de}`}>
                    {m.texto}
                    <span className="h">{m.hora}</span>
                  </div>
                ))}
                <p className="lp-chat-caption">Respondido em segundos, às 21h47, sem ninguém no balcão.</p>
              </div>
              <div className="lp-wa-input" aria-hidden="true">
                <span className="lp-wa-field">Mensagem</span>
                <span className="lp-wa-send"><svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor"><path d="M2 21 23 12 2 3l4 9-4 9Z" /></svg></span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ===== PROVA SOCIAL / TRUST ===== */}
      <section className="lp-band lp-trustband">
        <div className="lp-wrap">
          <p className="lp-trustband-title" data-r>Para negócios que não querem perder cliente por demora</p>
          <div className="lp-trust-row">
            {['API oficial do WhatsApp (Meta)', 'Sem risco de bloqueio do número', 'Dados hospedados no Brasil', 'Sem fidelidade, cancele quando quiser'].map((t, i) => (
              <span key={t} className="lp-trust-item" data-r style={stagger(i + 1)}><Check size={16} /> {t}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ===== NO AR EM TRÊS PASSOS (dark, carrossel) ===== */}
      <section className="lp-band lp-band--dark lp-section--dark">
        <div className="lp-wrap">
          <p className="lp-eyebrow" data-r>Comece hoje</p>
          <h2 className="lp-h2" data-r style={stagger(1)}>No ar em três passos</h2>
          <p className="lp-lead" data-r style={stagger(2)}>Sem instalar nada, sem falar com vendedor, sem entender de tecnologia.</p>
          <div className="lp-steps">
            {PASSOS.map((p, i) => (
              <div key={p.titulo} className="lp-step" data-r style={stagger(i + 2)}>
                <div className="lp-step-n">{i + 1}</div>
                <h3>{p.titulo}</h3>
                <p>{p.texto}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== SHOWCASE DO PRODUTO (dark contínuo) ===== */}
      <section className="lp-band lp-band--dark lp-showcase">
        <div className="lp-wrap">
          <p className="lp-eyebrow" data-r>Veja por dentro</p>
          <h2 className="lp-h2" data-r style={stagger(1)}>Você no controle, sempre</h2>
          <p className="lp-lead" data-r style={stagger(2)}>A IA atende, você acompanha tudo em um painel — e assume a conversa quando quiser.</p>
          {/* Componente isolado do print: trocar apenas o src quando a tela mudar. */}
          <div data-r style={stagger(3)}><ProductScreenshot /></div>
          <div className="lp-showcase-pills">
            {SHOWCASE_PILLS.map((p, i) => <span key={p} className="lp-spill" data-r style={stagger(i + 4)}>{p}</span>)}
          </div>
        </div>
      </section>

      {/* ===== FEITO PARA QUEM VIVE DE ATENDER BEM ===== */}
      <section className="lp-band lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2" data-r>Feito para quem vive de atender bem</h2>
          <p className="lp-lead" data-r style={stagger(1)}>Cada cliente sem resposta é uma venda que foi para o concorrente.</p>
          <div className="lp-recursos">
            {RECURSOS.map((r, i) => (
              <div key={r.titulo} className="lp-feat" data-r style={stagger(i % 2 === 0 ? 1 : 2)}>
                <span className="lp-feat-ic"><Check size={17} /></span>
                <div>
                  <h3>{r.titulo}</h3>
                  <p>{r.texto}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== MÉTRICAS / RESULTADOS ===== */}
      <section className="lp-band lp-band--light lp-section">
        <div className="lp-wrap">
          <h2 className="lp-h2" data-r>Por que os donos não largam mais</h2>
          <p className="lp-lead" data-r style={stagger(1)}>Nada de promessa mágica — só o que a Wappia faz todo dia por quem atende no WhatsApp.</p>
          <div className="lp-stats">
            {METRICAS.map((m, i) => (
              <div key={m.n} className={`lp-stat lp-stat--${m.tone}`} data-r style={stagger(i + 1)}>
                <div className="lp-stat-n">{m.n}</div>
                <p className="lp-stat-l">{m.l}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== PLANOS ===== */}
      <section className="lp-band lp-section" id="precos">
        <div className="lp-wrap">
          <h2 className="lp-h2" data-r>Planos simples, sem fidelidade</h2>
          <p className="lp-lead" data-r style={stagger(1)}>Comece grátis no simulador. Pague só quando quiser colocar o agente no ar — e cancele quando quiser.</p>
          <LpPricing planos={planos} />
        </div>
      </section>

      {/* ===== DEPOIMENTOS =====
          TODO(depoimentos): quando houver depoimentos reais de clientes (nome, negócio,
          foto), reativar como faixa escura (lp-band--dark) com 2–3 TestimonialCards entre
          Planos e FAQ. Não inventar depoimentos. */}

      {/* ===== FAQ (centralizado) ===== */}
      <section className="lp-band lp-band--light lp-section lp-section--center">
        <div className="lp-wrap">
          <h2 className="lp-h2" data-r>Perguntas que todo mundo faz</h2>
          <p className="lp-lead" data-r style={stagger(1)}>As mesmas que você provavelmente está se fazendo agora.</p>
          <div className="lp-faq">
            {FAQS.map((f, i) => (
              <details key={f.q} data-r style={stagger(i + 1)}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ===== CTA FINAL (verde profundo, exclusivo) ===== */}
      <section className="lp-band lp-band--cta">
        <div className="lp-wrap lp-final">
          <h2 className="lp-h2" data-r>Converse com o seu agente hoje</h2>
          <p data-r style={stagger(1)}>Crie a conta, teste no simulador e veja com seus olhos — antes de qualquer cliente.</p>
          <Link href="/cadastro" className="lp-btn lp-btn--invert" data-r style={stagger(2)}>Criar meu agente grátis</Link>
        </div>
      </section>

      {/* ===== FOOTER ===== */}
      <div className="lp-band lp-footer-band">
        <div className="lp-wrap">
          <footer className="lp-footer">
            <span>© 2026 Wappia · Feito no Brasil</span>
            <span style={{ fontSize: 11.5 }}>Leonardo Marinho Alves Merlo ME · CNPJ 30.814.165/0001-68</span>
            <span><Link href="/privacidade">Privacidade</Link> · <Link href="/termos-de-uso">Termos</Link> · <Link href="/login">Entrar</Link> · <Link href="/cadastro">Criar conta</Link></span>
          </footer>
        </div>
      </div>
    </div>
  );
}

// Print do painel isolado para troca fácil da imagem depois (§8).
function ProductScreenshot() {
  return (
    <div className="lp-frame">
      <div className="lp-frame-bar" aria-hidden="true"><i /><i /><i /></div>
      <Image
        src="/screens/painel-wappia.png"
        alt="Painel da Wappia: conversa do cliente no WhatsApp com a ficha de detalhes do contato à direita"
        width={1896}
        height={907}
        sizes="(max-width: 1280px) 100vw, 1280px"
      />
    </div>
  );
}

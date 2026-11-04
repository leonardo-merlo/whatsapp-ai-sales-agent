import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Exclusão de dados — Wappia',
  description: 'Como solicitar a exclusão dos seus dados pessoais tratados pelo Wappia, em conformidade com a LGPD.',
};

const ATUALIZADO_EM = '21 de julho de 2026';
const EMAIL = 'leomamerlo@gmail.com';

export default function ExclusaoDeDados() {
  const mailto = `mailto:${EMAIL}?subject=${encodeURIComponent('Solicitação de exclusão de dados')}&body=${encodeURIComponent('Nome completo:\nE-mail da conta:\nNome do negócio:\n\nSolicito a exclusão dos meus dados pessoais tratados pelo Wappia.')}`;

  return (
    <div className="pp">
      <style>{`
        .pp { min-height: 100vh; background: var(--bg); color: var(--text); }
        .pp-wrap { max-width: 760px; margin: 0 auto; padding: 0 20px; }
        .pp-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 0; border-bottom: 1px solid var(--border); }
        .pp-logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; text-decoration: none; color: var(--text); }
        .pp-back { font-size: 13.5px; color: var(--text2); text-decoration: none; font-weight: 600; }
        .pp-doc { padding: 44px 0 72px; }
        .pp-doc h1 { font-size: 30px; letter-spacing: -0.02em; font-weight: 800; margin: 0 0 6px; }
        .pp-updated { font-size: 13px; color: var(--text3); margin: 0 0 32px; }
        .pp-doc h2 { font-size: 18px; font-weight: 700; margin: 34px 0 10px; letter-spacing: -0.01em; }
        .pp-doc p, .pp-doc li { font-size: 15px; line-height: 1.7; color: var(--text2); }
        .pp-doc p { margin: 0 0 12px; }
        .pp-doc ul, .pp-doc ol { margin: 0 0 12px; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
        .pp-doc strong { color: var(--text); font-weight: 650; }
        .pp-doc a { color: var(--primary); text-decoration: none; font-weight: 600; }
        .pp-doc a:hover { text-decoration: underline; }
        .pp-cta { display: inline-flex; align-items: center; gap: 8px; background: var(--primary); color: #fff !important; border-radius: 10px; padding: 12px 20px; font-size: 14px; font-weight: 700; text-decoration: none; margin: 4px 0 8px; }
        .pp-footer { border-top: 1px solid var(--border); padding: 22px 0; font-size: 12.5px; color: var(--text3); }
      `}</style>

      <div className="pp-wrap">
        <header className="pp-topbar">
          <Link href="/" className="pp-logo">
            <Image src="/brand/wappia-verde.png" alt="Wappia" width={40} height={32} priority style={{ height: 32, width: 'auto' }} />
            Wappia
          </Link>
          <Link href="/" className="pp-back">← Voltar ao site</Link>
        </header>

        <article className="pp-doc">
          <h1>Exclusão de dados</h1>
          <p className="pp-updated">Última atualização: {ATUALIZADO_EM}</p>

          <p>
            A Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD) garante a você o direito de solicitar
            a exclusão dos seus dados pessoais tratados pelo <strong>Wappia</strong>. Esta página explica o que é
            excluído e como pedir.
          </p>

          <h2>Como solicitar</h2>
          <p>
            Envie um e-mail para <a href={`mailto:${EMAIL}`}>{EMAIL}</a>{' '}
            com o assunto &ldquo;Solicitação de exclusão de dados&rdquo;, informando:
          </p>
          <ul>
            <li>Seu nome completo;</li>
            <li>O e-mail usado na sua conta Wappia;</li>
            <li>O nome do negócio associado à conta.</li>
          </ul>
          <p>
            <a className="pp-cta" href={mailto}>Solicitar exclusão por e-mail</a>
          </p>
          <p>
            Confirmamos a sua identidade e concluímos a exclusão em até <strong>15 dias</strong>, avisando você
            por e-mail quando terminar.
          </p>

          <h2>O que é excluído</h2>
          <ul>
            <li>Os dados de cadastro da conta e do negócio;</li>
            <li>Os contatos, conversas, agendamentos e configurações do agente;</li>
            <li>O conteúdo das mensagens armazenado para o funcionamento do atendimento.</li>
          </ul>

          <h2>O que pode ser retido</h2>
          <p>
            Alguns registros podem ser mantidos por prazo limitado quando houver <strong>obrigação legal</strong>
            {' '}(por exemplo, dados fiscais e financeiros) ou para o exercício regular de direitos, conforme
            permitido pela LGPD. Após esses prazos, os dados são eliminados.
          </p>

          <h2>Dúvidas</h2>
          <p>
            Para qualquer dúvida sobre seus dados, fale com a gente pelo e-mail{' '}
            <a href={`mailto:${EMAIL}`}>{EMAIL}</a>. Veja também a nossa{' '}
            <Link href="/privacidade">Política de Privacidade</Link>.
          </p>
        </article>

        <footer className="pp-footer">© {new Date().getFullYear()} Wappia · Leonardo Marinho Alves Merlo ME · CNPJ 30.814.165/0001-68</footer>
      </div>
    </div>
  );
}

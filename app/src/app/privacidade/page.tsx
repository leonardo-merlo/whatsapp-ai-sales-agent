import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Política de Privacidade — Wappia',
  description: 'Como o Wappia coleta, usa, compartilha e protege os dados pessoais tratados na plataforma, em conformidade com a LGPD.',
};

const ATUALIZADO_EM = '29 de setembro de 2026';

export default function Privacidade() {
  return (
    <div className="pp">
      <style>{`
        .pp { min-height: 100vh; background: var(--bg); color: var(--text); }
        .pp-wrap { max-width: 760px; margin: 0 auto; padding: 0 20px; }
        .pp-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 0; border-bottom: 1px solid var(--border); }
        .pp-logo { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 15px; text-decoration: none; color: var(--text); }
        .pp-logo-badge { width: 34px; height: 34px; border-radius: 9px; background: var(--primary); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .pp-back { font-size: 13.5px; color: var(--text2); text-decoration: none; font-weight: 600; }
        .pp-doc { padding: 44px 0 72px; }
        .pp-doc h1 { font-size: 30px; letter-spacing: -0.02em; font-weight: 800; margin: 0 0 6px; }
        .pp-updated { font-size: 13px; color: var(--text3); margin: 0 0 32px; }
        .pp-doc h2 { font-size: 18px; font-weight: 700; margin: 34px 0 10px; letter-spacing: -0.01em; }
        .pp-doc p, .pp-doc li { font-size: 15px; line-height: 1.7; color: var(--text2); }
        .pp-doc p { margin: 0 0 12px; }
        .pp-doc ul { margin: 0 0 12px; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
        .pp-doc strong { color: var(--text); font-weight: 650; }
        .pp-doc a { color: var(--primary); text-decoration: none; font-weight: 600; }
        .pp-doc a:hover { text-decoration: underline; }
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
          <h1>Política de Privacidade</h1>
          <p className="pp-updated">Última atualização: {ATUALIZADO_EM}</p>

          <p>
            Esta Política de Privacidade descreve como a plataforma <strong>Wappia</strong> coleta, usa, armazena,
            compartilha e protege dados pessoais, em conformidade com a Lei Geral de Proteção de Dados
            (Lei nº 13.709/2018 — LGPD). Ao criar uma conta ou utilizar o Wappia, você concorda com as práticas
            descritas aqui.
          </p>

          <h2>1. Quem é o controlador dos dados</h2>
          <p>
            O Wappia é operado por <strong>Leonardo Marinho Alves Merlo ME</strong>, inscrita no CNPJ sob o
            nº 30.814.165/0001-68 (&quot;Wappia&quot;, &quot;nós&quot;). Para questões de privacidade, entre em contato pelo
            e-mail <a href="mailto:leomamerlo@gmail.com">leomamerlo@gmail.com</a>.
          </p>

          <h2>2. O que é o Wappia</h2>
          <p>
            O Wappia é um software de atendimento que conecta o WhatsApp oficial de um negócio (via
            WhatsApp Business Platform / API de Nuvem da Meta) a um assistente de inteligência artificial. O
            assistente responde clientes, informa preços e produtos, agenda horários e transfere a conversa para
            um atendente humano quando necessário.
          </p>

          <h2>3. Dados que coletamos</h2>
          <p>Tratamos duas categorias de dados pessoais:</p>
          <p><strong>a) Dados do cliente empresarial</strong> (você, que contrata o Wappia):</p>
          <ul>
            <li>Nome, e-mail e telefone de cadastro;</li>
            <li>Dados do negócio (razão social, ramo de atividade, informações de contato);</li>
            <li>Dados de faturamento e pagamento, processados por nosso parceiro de pagamentos;</li>
            <li>Dados de uso da plataforma (registros de acesso, ações realizadas).</li>
          </ul>
          <p><strong>b) Dados dos usuários finais</strong> (os clientes que conversam com o negócio pelo WhatsApp):</p>
          <ul>
            <li>Número de telefone e nome de perfil do WhatsApp;</li>
            <li>Conteúdo das mensagens trocadas com o assistente e com a equipe do negócio;</li>
            <li>Informações fornecidas na conversa (ex.: agendamentos, preferências, contatos).</li>
          </ul>
          <p>
            O negócio que utiliza o Wappia é o controlador dos dados dos seus próprios clientes; o Wappia atua
            como operador, tratando esses dados conforme as instruções do negócio e esta Política.
          </p>

          <h2>4. Como usamos os dados</h2>
          <ul>
            <li>Prestar o serviço de atendimento automatizado e permitir a intervenção humana;</li>
            <li>Gerar respostas do assistente de IA com base no conhecimento configurado pelo negócio;</li>
            <li>Registrar conversas, contatos e agendamentos para o negócio consultar;</li>
            <li>Enviar notificações operacionais (ex.: avisar a equipe quando uma conversa precisa de uma pessoa);</li>
            <li>Processar cobranças e gerir a assinatura;</li>
            <li>Garantir segurança, prevenir fraudes e cumprir obrigações legais.</li>
          </ul>

          <h2>5. Base legal</h2>
          <p>
            Tratamos dados pessoais com fundamento na execução do contrato (art. 7º, V da LGPD), no cumprimento
            de obrigação legal (art. 7º, II), no legítimo interesse para operação e segurança do serviço
            (art. 7º, IX) e, quando aplicável, no consentimento do titular (art. 7º, I).
          </p>

          <h2>6. Dados sensíveis de saúde</h2>
          <p>
            Clínicas e consultórios que usam o Wappia recebem pelo WhatsApp dados de saúde dos pacientes, como
            motivo da consulta, especialidade e convênio. Esses são dados pessoais sensíveis (art. 5º, II da
            LGPD) e só são tratados nas hipóteses do art. 11: para a tutela da saúde, por profissionais e
            serviços de saúde (art. 11, II, alínea f), para o cumprimento de obrigação legal ou regulatória (art. 11,
            II, alínea a) ou com o consentimento específico do paciente (art. 11, I).
          </p>
          <ul>
            <li>A clínica é a controladora desses dados; o Wappia é operador e trata os dados só para prestar o atendimento contratado.</li>
            <li>O assistente de IA não faz diagnóstico, não prescreve e não comenta exames.</li>
            <li>Os dados de saúde não são usados para publicidade, perfilamento ou venda a terceiros.</li>
            <li>A clínica pode exportar os dados de um paciente e apagá-los pelo painel, a pedido do titular.</li>
            <li>O acesso fica restrito à equipe da clínica, com isolamento por organização.</li>
          </ul>

          <h2>7. Integração com o WhatsApp e a Meta</h2>
          <p>
            O Wappia utiliza a WhatsApp Business Platform (API de Nuvem) fornecida pela Meta Platforms, Inc. O
            envio e o recebimento de mensagens ocorrem por meio da infraestrutura da Meta, sujeitos às
            políticas dela. Ao conectar o WhatsApp do seu negócio ao Wappia, você autoriza esse tratamento e
            declara ter base legal para tratar os dados dos seus clientes finais. Consulte a
            {' '}<a href="https://www.whatsapp.com/legal/business-policy/" target="_blank" rel="noopener noreferrer">Política Comercial do WhatsApp</a>.
          </p>

          <h2>8. Compartilhamento com terceiros</h2>
          <p>
            Não vendemos dados pessoais. Compartilhamos dados apenas com prestadores necessários para operar o
            serviço, sob obrigações de confidencialidade e segurança:
          </p>
          <ul>
            <li><strong>Meta Platforms</strong> — envio e recebimento de mensagens no WhatsApp;</li>
            <li><strong>Provedor de nuvem e banco de dados</strong> — hospedagem e armazenamento da aplicação;</li>
            <li><strong>Provedor de e-mail transacional</strong> — envio de notificações e avisos;</li>
            <li><strong>Provedor de pagamentos</strong> — processamento de cobranças da assinatura;</li>
            <li><strong>Modelos de inteligência artificial</strong> — geração das respostas do assistente.</li>
          </ul>
          <p>Também podemos compartilhar dados quando exigido por lei ou ordem de autoridade competente.</p>

          <h2>9. Retenção dos dados</h2>
          <p>
            Mantemos os dados pelo tempo necessário à prestação do serviço e ao cumprimento de obrigações
            legais. Encerrada a conta, os dados são eliminados ou anonimizados em prazo razoável, salvo quando a
            retenção for exigida por lei.
          </p>

          <h2>10. Segurança</h2>
          <p>
            Adotamos medidas técnicas e organizacionais para proteger os dados, incluindo controle de acesso,
            isolamento de dados por organização e transmissão criptografada (HTTPS). Nenhum sistema é
            totalmente imune a incidentes; em caso de violação relevante, atuaremos conforme a LGPD.
          </p>

          <h2>11. Direitos do titular</h2>
          <p>Nos termos do art. 18 da LGPD, o titular pode solicitar:</p>
          <ul>
            <li>Confirmação da existência de tratamento e acesso aos dados;</li>
            <li>Correção de dados incompletos, inexatos ou desatualizados;</li>
            <li>Anonimização, bloqueio ou eliminação de dados desnecessários;</li>
            <li>Portabilidade e informação sobre compartilhamentos;</li>
            <li>Revogação do consentimento.</li>
          </ul>
          <p>
            Para exercer esses direitos, escreva para <a href="mailto:leomamerlo@gmail.com">leomamerlo@gmail.com</a>.
            Pedidos relativos a dados de usuários finais devem ser encaminhados ao negócio responsável pela conta.
          </p>

          <h2>12. Cookies</h2>
          <p>
            Utilizamos cookies estritamente necessários para autenticação e funcionamento do serviço. Não
            utilizamos cookies para publicidade de terceiros.
          </p>

          <h2>13. Alterações desta Política</h2>
          <p>
            Podemos atualizar esta Política periodicamente. Alterações relevantes serão comunicadas pelos canais
            do serviço. A data da última atualização está indicada no topo desta página.
          </p>

          <h2>14. Contato</h2>
          <p>
            Dúvidas sobre esta Política ou sobre o tratamento dos seus dados:
            {' '}<a href="mailto:leomamerlo@gmail.com">leomamerlo@gmail.com</a>.
          </p>
        </article>

        <footer className="pp-footer">
          © 2026 Wappia · Leonardo Marinho Alves Merlo ME · CNPJ 30.814.165/0001-68
        </footer>
      </div>
    </div>
  );
}

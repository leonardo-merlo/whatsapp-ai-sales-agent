import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Termos de Uso — Wappia',
  description: 'Regras de uso da plataforma Wappia, agente de IA para o WhatsApp oficial de empresas.',
};

const ATUALIZADO_EM = '25 de setembro de 2026';
const EMAIL = 'leomamerlo@gmail.com';

export default function TermosDeUso() {
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
          <h1>Termos de Uso</h1>
          <p className="pp-updated">Última atualização: {ATUALIZADO_EM}</p>

          <p>
            Estes Termos de Uso regem a contratação e o uso da plataforma <strong>Wappia</strong>, operada por
            {' '}<strong>Leonardo Marinho Alves Merlo ME</strong>, inscrita no CNPJ sob o nº 30.814.165/0001-68
            (&ldquo;Wappia&rdquo;, &ldquo;nós&rdquo;). Ao criar uma conta ou usar a plataforma, a empresa contratante (&ldquo;Cliente&rdquo;, &ldquo;você&rdquo;)
            declara ter lido e aceitado estes Termos.
          </p>

          <h2>1. Objeto do serviço</h2>
          <p>
            O Wappia é um software como serviço (SaaS) que conecta o número de WhatsApp oficial do Cliente a um
            assistente de inteligência artificial. O assistente responde clientes finais, informa produtos e
            preços, agenda horários, registra pedidos e transfere a conversa para uma pessoa da equipe quando
            necessário, conforme a configuração feita pelo Cliente no painel.
          </p>
          <p>
            O serviço é destinado a empresas e profissionais no exercício de atividade econômica. Não é um
            serviço para consumidores pessoas físicas.
          </p>

          <h2>2. Conta e responsabilidades do Cliente</h2>
          <ul>
            <li>Fornecer dados de cadastro verdadeiros e mantê-los atualizados;</li>
            <li>Guardar as credenciais de acesso e responder por tudo que for feito com elas, inclusive pelos membros da equipe que convidar;</li>
            <li>Configurar o agente com informações corretas sobre produtos, preços, horários e políticas do negócio. As respostas da IA partem do que o Cliente cadastrou;</li>
            <li>Acompanhar as conversas e assumir o atendimento quando a situação exigir uma pessoa;</li>
            <li>Ter base legal para tratar os dados dos seus clientes finais e para enviar mensagens a eles;</li>
            <li>Não usar o Wappia para spam, fraude, conteúdo ilegal ou qualquer finalidade proibida pelas políticas da Meta ou pela lei brasileira.</li>
          </ul>
          <p>
            A inteligência artificial pode errar. O Cliente é responsável pelas ofertas, preços e compromissos
            assumidos com os seus clientes finais, e deve revisar a configuração do agente sempre que o negócio
            mudar.
          </p>

          <h2>3. WhatsApp oficial e políticas da Meta</h2>
          <p>
            O Wappia usa exclusivamente a API oficial do WhatsApp (WhatsApp Business Platform, API de Nuvem),
            fornecida pela Meta Platforms, Inc. Ao conectar o seu número, o Cliente passa a ter uma conta do
            WhatsApp Business própria junto à Meta e fica sujeito, além destes Termos, às
            {' '}<a href="https://www.whatsapp.com/legal/business-terms/" target="_blank" rel="noopener noreferrer">Condições do WhatsApp Business</a>
            {' '}e à <a href="https://www.whatsapp.com/legal/business-policy/" target="_blank" rel="noopener noreferrer">Política Comercial do WhatsApp</a>.
          </p>
          <p>
            A Meta pode aprovar ou recusar modelos de mensagem, limitar o volume de envios, reduzir a
            classificação de qualidade ou restringir o número do Cliente, por decisão própria. O Wappia não
            controla essas decisões e não responde por elas.
          </p>

          <h2>4. Cobrança das mensagens pela Meta</h2>
          <p>
            As mensagens enviadas pelo WhatsApp oficial podem ser cobradas pela Meta, conforme a tabela dela
            vigente no momento do envio. <strong>Essa cobrança é feita pela Meta diretamente ao Cliente</strong>,
            na forma de pagamento que o Cliente cadastrar na conta dele junto à Meta.
          </p>
          <p>
            <strong>O Wappia cobra apenas a assinatura da plataforma.</strong> Não intermediamos, não
            repassamos e não somos responsáveis pelos valores cobrados pela Meta. Sem forma de pagamento válida
            na Meta, os envios que ela cobra falham, e isso não caracteriza falha do Wappia.
          </p>

          <h2>5. Planos e pagamento</h2>
          <p>
            A assinatura é cobrada de forma recorrente, no plano e na periodicidade escolhidos pelo Cliente no
            painel. Os pagamentos são processados pela <strong>Asaas</strong>, nossa parceira de pagamentos.
          </p>
          <ul>
            <li>Os valores e os limites de cada plano são os informados no painel no momento da contratação;</li>
            <li>Mudanças de preço são comunicadas com pelo menos 30 dias de antecedência e valem a partir do ciclo seguinte;</li>
            <li>Em caso de atraso, o acesso pode ser suspenso até a regularização, sem prejuízo da cobrança dos valores devidos.</li>
          </ul>

          <h2>6. Cancelamento</h2>
          <p>
            O Cliente pode cancelar a assinatura a qualquer momento pelo painel. O cancelamento interrompe as
            cobranças futuras, e o acesso continua até o fim do período já pago. Não há reembolso proporcional
            de período já iniciado, salvo quando exigido por lei.
          </p>
          <p>
            Podemos suspender ou encerrar a conta que violar estes Termos, as políticas da Meta ou a lei,
            avisando o Cliente sempre que possível. Após o encerramento, os dados são tratados conforme a
            {' '}<Link href="/privacidade">Política de Privacidade</Link> e a página de
            {' '}<Link href="/exclusao-de-dados">Exclusão de dados</Link>.
          </p>

          <h2>7. Disponibilidade</h2>
          <p>
            Trabalhamos para manter a plataforma disponível, mas o serviço depende de terceiros (Meta,
            provedores de nuvem e de inteligência artificial) e pode ter interrupções para manutenção ou por
            falhas fora do nosso controle. Não garantimos funcionamento ininterrupto ou livre de erros.
          </p>

          <h2>8. Limitação de responsabilidade</h2>
          <p>Na máxima extensão permitida pela lei, o Wappia não responde por:</p>
          <ul>
            <li>Respostas da IA baseadas em informações incorretas ou desatualizadas cadastradas pelo Cliente;</li>
            <li>Decisões da Meta sobre o número, a conta ou os modelos de mensagem do Cliente;</li>
            <li>Cobranças da Meta pelas mensagens;</li>
            <li>Lucros cessantes, perda de vendas ou danos indiretos;</li>
            <li>Indisponibilidade causada por terceiros ou por caso fortuito e força maior.</li>
          </ul>
          <p>
            Em qualquer hipótese, a responsabilidade total do Wappia fica limitada ao valor pago pelo Cliente
            nos 12 meses anteriores ao fato que deu origem à reclamação.
          </p>

          <h2>9. Proteção de dados (LGPD)</h2>
          <p>
            Em relação aos dados dos clientes finais que conversam pelo WhatsApp, o Cliente é o controlador e o
            Wappia atua como operador, tratando esses dados apenas para prestar o serviço e conforme as
            instruções do Cliente, nos termos da Lei nº 13.709/2018 (LGPD). Os detalhes sobre quais dados
            tratamos, com quem compartilhamos e como exercer direitos estão na
            {' '}<Link href="/privacidade">Política de Privacidade</Link>, que faz parte destes Termos.
          </p>

          <h2>10. Propriedade intelectual</h2>
          <p>
            O software, a marca e o conteúdo da plataforma pertencem ao Wappia. O Cliente mantém a propriedade
            dos dados e do conteúdo que cadastra, e nos autoriza a usá-los apenas para prestar o serviço.
          </p>

          <h2>11. Alterações destes Termos</h2>
          <p>
            Podemos atualizar estes Termos. Mudanças relevantes são comunicadas pelos canais do serviço, e a
            data da última atualização fica indicada no topo desta página. Continuar usando o Wappia depois da
            mudança significa aceitar a nova versão.
          </p>

          <h2>12. Foro</h2>
          <p>
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro da comarca
            da sede do Wappia para resolver qualquer questão relacionada a eles, com renúncia a qualquer outro,
            por mais privilegiado que seja.
          </p>

          <h2>13. Contato</h2>
          <p>
            Dúvidas sobre estes Termos: <a href={`mailto:${EMAIL}`}>{EMAIL}</a>.
          </p>
        </article>

        <footer className="pp-footer">
          © 2026 Wappia · Leonardo Marinho Alves Merlo ME · CNPJ 30.814.165/0001-68
        </footer>
      </div>
    </div>
  );
}

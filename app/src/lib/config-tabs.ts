import type { PapelMembro } from './permissoes';
import { permissoesDe } from './permissoes';

export type ConfigTabKey = 'negocio' | 'whatsapp' | 'templates' | 'plano' | 'uso' | 'agentes' | 'campos' | 'respostas' | 'notif';

// `somenteAdmin` acompanha a RLS: toda escrita das tabelas por trás destas abas
// passa por is_admin_of, então mostrá-las para um atendente só produziria botão
// que falha em silêncio.
//
// A ordem é a régua nova de 14/09: primeiro o que a empresa é, depois quais
// números existem e o que cada um faz, depois quem são as pessoas. Equipe subiu
// para junto de Integração porque uma decide o dono do número que a outra
// escolhe — era duas abas de distância.
/**
 * Abas escondidas do painel, por decisão comercial e não por permissão.
 *
 * **Planos está aqui desde 20/09**, enquanto a Distribuidora Exemplo estiver em
 * homologação: o desenvolvedor deles recebe login de admin para conferir a
 * integração, e preço, fatura e limite de plano não são assunto dele. Não é
 * regra de papel — um admin de verdade poderia ver; é uma aba que ninguém vê
 * por enquanto.
 *
 * **Para trazer de volta, tire a chave desta lista.** Nada mais precisa mudar:
 * o painel da aba continua inteiro em `sections/config.tsx`, e a rota
 * `/configuracoes/planos` volta a abrir sozinha.
 *
 * ⚠️ Enquanto Planos estiver escondida, ninguém assina nem vê fatura pelo
 * painel — nem o Leonardo, em organização nenhuma.
 */
const ABAS_ESCONDIDAS: ConfigTabKey[] = ['plano'];

export const CONFIG_TABS: { key: ConfigTabKey; label: string; desc: string; somenteAdmin: boolean }[] = [
  { key: 'negocio', label: 'Dados do negócio', desc: 'Razão social, documento, endereço e telefone fixo', somenteAdmin: true },
  { key: 'whatsapp', label: 'Integração WhatsApp', desc: 'Número oficial e status da conexão com a Meta', somenteAdmin: true },
  { key: 'templates', label: 'Templates', desc: 'Mensagens aprovadas pela Meta para falar fora das 24 horas', somenteAdmin: true },
  // Deixou de dizer "Atendentes com acesso ao sistema": desde que cadastrar
  // parou de ser convidar, cabe aqui gente sem login nenhum.
  { key: 'agentes', label: 'Equipe', desc: 'Quem é cada pessoa do time — com ou sem acesso ao painel', somenteAdmin: true },
  { key: 'plano', label: 'Planos', desc: 'Plano atual, uso do mês e histórico de faturas', somenteAdmin: true },
  { key: 'uso', label: 'Uso da IA', desc: 'Tokens consumidos e custo por fluxo do agente', somenteAdmin: true },
  { key: 'campos', label: 'Tags', desc: 'Campos extras que aparecem em cada contato', somenteAdmin: true },
  { key: 'respostas', label: 'Respostas', desc: 'Mensagens prontas para usar com um clique nas conversas', somenteAdmin: true },
  { key: 'notif', label: 'Notificações', desc: 'Avisos por e-mail e alertas do sistema', somenteAdmin: true },
];

/**
 * O pedaço de URL de cada aba.
 *
 * É separado da chave de propósito: a chave é o que o estado e o banco usam há
 * muito tempo (`agentes`, `campos`, `notif`), e trocá-la mexeria em código que
 * nada tem a ver com endereço. O endereço, por outro lado, é lido por gente —
 * `/configuracoes/equipe` diz o que a tela mostra, `/configuracoes/agentes`
 * diria outra coisa.
 */
export const SLUG_DA_ABA: Record<ConfigTabKey, string> = {
  negocio: 'negocio',
  whatsapp: 'integracao',
  templates: 'templates',
  agentes: 'equipe',
  plano: 'planos',
  uso: 'uso-da-ia',
  campos: 'tags',
  respostas: 'respostas',
  notif: 'notificacoes',
};

export function caminhoDaAba(key: ConfigTabKey): string {
  return `/configuracoes/${SLUG_DA_ABA[key]}`;
}

/** `undefined` quando o endereço não corresponde a aba nenhuma. */
export function abaDoSlug(slug: string): ConfigTabKey | undefined {
  return CONFIG_TABS.find(t => SLUG_DA_ABA[t.key] === slug)?.key;
}

/**
 * As abas que este papel vê — e é a **única** porta: a rota
 * `/configuracoes/[aba]` manda para a primeira aba permitida quando o endereço
 * não está nesta lista, então esconder aqui esconde do menu e da URL digitada
 * de uma vez.
 */
export function configTabsPara(papel: PapelMembro) {
  const podeAdministrar = permissoesDe(papel).editarDadosNegocio;
  return CONFIG_TABS.filter(t =>
    !ABAS_ESCONDIDAS.includes(t.key) && (podeAdministrar || !t.somenteAdmin));
}

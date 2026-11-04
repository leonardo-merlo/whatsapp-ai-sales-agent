// A chave dos syncs do sistema de gestão (produtos diário, regiões mensal).
//
// **Ligada em 30/09**, quando a Distribuidora Exemplo passou os endereços (`/produtos`
// e `/regioes`, gravados em `organization_integrations.config.syncs`).
// Desligada (`false`), a rota do cron responde 200 sem ler nada e sem chamar
// ninguém: é o jeito de parar os syncs de todas as organizações de uma vez.
//
// Organização sem caminho configurado continua sem sync mesmo com a chave
// ligada. Spec: docs/superpowers/specs/2026-09-27-syncs-exemplo-design.md.
export const SYNCS_DO_ERP_LIGADOS = true;

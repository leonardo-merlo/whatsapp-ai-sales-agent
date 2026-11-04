import type { NextConfig } from "next";
import path from "path";

// Headers de segurança aplicados a todas as rotas (baseline OWASP/LGPD).
// Não inclui Content-Security-Policy: uma CSP estrita exige nonce nos scripts
// inline do Next e precisa ser testada com cuidado — fica como próximo passo.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
];

const nextConfig: NextConfig = {
  // O monorepo tem lockfiles em mais de um nível; fixa a raiz do app para o
  // Turbopack não inferir errado (e silencia o warning no dev).
  turbopack: {
    root: path.join(__dirname),
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit lê arquivos de fonte do disco; PGlite carrega WASM. Ambos ficam fora do bundle.
  serverExternalPackages: ["pdfkit", "@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // o logotipo padrão é lido do disco pelo gerador de PDF (funções serverless não enxergam /public)
  outputFileTracingIncludes: { "/**": ["./public/logo-casafro-header.jpg"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;

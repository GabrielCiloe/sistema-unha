import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Os testes e2e compilam numa pasta própria para não colidir com o `next dev` em execução.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
};

export default nextConfig;

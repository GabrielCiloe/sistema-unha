import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Os testes e2e compilam numa pasta própria para não colidir com o `next dev` em execução.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Service worker do PWA: sempre revalidado, para atualizações chegarem logo aos celulares.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] }];
  },
};

export default nextConfig;

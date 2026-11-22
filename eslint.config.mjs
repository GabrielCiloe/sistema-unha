import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    // Só o que não é código do app: dependências, builds, vídeo, plugin/capturas do Figma e artefatos de teste.
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-*/**",
      "vendor/**",
      "video/**",
      "docs/figma-*/**",
      "test-results/**",
      "playwright-report/**",
      ".maestri/**",
      "next-env.d.ts",
      // Arquivo local ainda não versionado (pendência de outra entrega); entra no lint quando for commitado.
      "prisma/seed-demo.mjs",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      // Convenção do projeto: prefixo _ marca o que é descartado de propósito (ex.: const { id: _i, ...rest } = obj).
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
];

export default config;

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // Evita CJS re-exports con getters (Rollup no ve named exports estáticos en dist).
      {
        find: "@theforge/business-rules",
        replacement: path.resolve(__dirname, "../../packages/business-rules/src/index.ts"),
      },
      {
        find: "@theforge/shared-types/session",
        replacement: path.resolve(__dirname, "../../packages/shared-types/src/session.ts"),
      },
      {
        find: "@theforge/shared-types/markdown-repair",
        replacement: path.resolve(__dirname, "../../packages/shared-types/src/markdown-repair.ts"),
      },
      {
        find: "@theforge/shared-types/mdd-pipeline-limits",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/mdd-pipeline-limits.ts",
        ),
      },
      {
        find: "@theforge/shared-types/markdown-table",
        replacement: path.resolve(__dirname, "../../packages/shared-types/src/markdown-table.ts"),
      },
      {
        find: "@theforge/shared-types/mermaid",
        replacement: path.resolve(__dirname, "../../packages/shared-types/src/mermaid.ts"),
      },
      {
        find: "@theforge/shared-types/format-document-markdown",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/format-document-markdown.ts",
        ),
      },
      {
        find: "@theforge/shared-types/dbga-document-structure",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/dbga-document-structure.ts",
        ),
      },
      {
        find: "@theforge/shared-types/mdd-governance-patterns",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/mdd-governance-patterns.ts",
        ),
      },
      {
        find: "@theforge/shared-types/mdd-governance-pattern-compat",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/mdd-governance-pattern-compat.ts",
        ),
      },
      {
        find: "@theforge/shared-types/repair-directory-tree",
        replacement: path.resolve(
          __dirname,
          "../../packages/shared-types/src/repair-directory-tree.ts",
        ),
      },
      // Exact match only — object-style alias would prefix-match subpaths to index.ts/….
      {
        find: /^@theforge\/shared-types$/,
        replacement: path.resolve(__dirname, "../../packages/shared-types/src/index.ts"),
      },
    ],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // 127.0.0.1 evita colisión con otro dev server en localhost:3000 (p. ej. PR Architect).
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        // SSE chat/stream: sin timeout corto del proxy de dev
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
});

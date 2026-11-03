/**
 * Parser Mermaid real para Node (oráculo de pruebas).
 *
 * Monta las globales mínimas de jsdom que mermaid y DOMPurify necesitan al
 * cargarse (`window`, `document`, `navigator`) y delega en `mermaid.parse`.
 *
 * Solo tooling de pruebas y scripts: NO está registrado en ningún módulo Nest y
 * `tsconfig.build.json` lo excluye del build, de modo que no viaja a `dist` ni a
 * la imagen Docker. En runtime la API usa `mermaid-parse.worker.ts`.
 */
import { isMainThread } from "node:worker_threads";

export type { MermaidParseResult, MermaidParser } from "@theforge/shared-types/mermaid-oracle";

if (isMainThread && process.env.NODE_ENV === "production") {
  throw new Error(
    "node-mermaid-parser es solo para pruebas y scripts: monta globales de DOM (window/document/navigator) " +
      "y no debe cargarse en el hilo principal de la API en producción. Usa el worker_thread de runtime.",
  );
}

export { createNodeMermaidParser } from "./mermaid-parse-logic.js";

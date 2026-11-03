/**
 * Worker aislado: monta jsdom + mermaid sin contaminar el hilo principal de Nest.
 */
import { parentPort } from "node:worker_threads";
import { parseMermaidDiagram } from "./mermaid-parse-logic.js";

export type MermaidParseWorkerRequest = {
  id: number;
  text: string;
};

export type MermaidParseWorkerResponse = {
  id: number;
  result: Awaited<ReturnType<typeof parseMermaidDiagram>>;
};

parentPort?.on("message", (msg: MermaidParseWorkerRequest) => {
  void (async () => {
    const result = await parseMermaidDiagram(msg.text ?? "");
    const out: MermaidParseWorkerResponse = { id: msg.id, result };
    parentPort?.postMessage(out);
  })();
});

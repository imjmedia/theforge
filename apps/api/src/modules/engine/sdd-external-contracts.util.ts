/**
 * Contratos de integraciones externas — delega al registro extensible en shared-types.
 */

import { collectExternalIntegrationGapsFromRegistry } from "@theforge/shared-types";
import { resolveMessagingBrokerFromMddSection2 } from "./messaging-broker.util.js";

/** Gaps cuando BRD/DBGA declara integración pero falta en API/Architecture/Infra. */
export function collectExternalIntegrationContractGaps(params: {
  dbgaMarkdown?: string | null;
  brdMarkdown?: string | null;
  mddMarkdown?: string | null;
  apiContractsMarkdown?: string | null;
  architectureMarkdown?: string | null;
  infraMarkdown?: string | null;
}): string[] {
  const scopeCorpus = [
    params.dbgaMarkdown,
    params.brdMarkdown,
    params.mddMarkdown,
  ]
    .filter(Boolean)
    .join("\n");

  const gaps = collectExternalIntegrationGapsFromRegistry({
    scopeCorpus,
    apiMarkdown: params.apiContractsMarkdown ?? "",
    architectureMarkdown: params.architectureMarkdown ?? "",
    infraMarkdown: params.infraMarkdown ?? "",
  });

  const broker = resolveMessagingBrokerFromMddSection2(params.mddMarkdown ?? "");
  if (broker === "bull") {
    return gaps.filter((g) => !/\[Integración rabbitmq\]/i.test(g));
  }

  return gaps;
}

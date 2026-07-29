/**
 * Resolución de broker/cola dominante desde MDD §2 (paridad con suggest-agent-governance).
 */

import { extractMddSection } from "@theforge/shared-types";

export type MessagingBrokerResolution = "bull" | "kafka" | "rabbitmq" | "conflict" | "unknown";

function extractMddSection2PrimaryProse(mddMarkdown: string): string {
  const sec2 = extractMddSection(mddMarkdown ?? "", 2);
  if (!sec2) return "";
  return sec2.split(/\n##\s+/)[0]?.trim() ?? sec2;
}

/** Broker/cola primaria declarada en MDD §2 (BullMQ/Redis, RabbitMQ, Kafka). */
export function resolveMessagingBrokerFromMddSection2(mddMarkdown: string): MessagingBrokerResolution {
  const authority =
    extractMddSection2PrimaryProse(mddMarkdown) || extractMddSection(mddMarkdown ?? "", 2) || mddMarkdown;
  const hasBull = /bullmq|\bbull\b/i.test(authority);
  const hasRedis = /\bredis\b/i.test(authority);
  const hasKafka = /kafka/i.test(authority);
  const hasRabbit = /rabbitmq/i.test(authority);

  if (hasBull || (hasRedis && !hasKafka && !hasRabbit)) return "bull";
  if (hasKafka && hasRabbit) return "conflict";
  if (hasKafka) return "kafka";
  if (hasRabbit) return "rabbitmq";
  return "unknown";
}

/** True cuando §2 exige contratos de eventos RabbitMQ/Kafka (no BullMQ primario). */
export function mddRequiresEventBrokerContracts(mddMarkdown: string): boolean {
  const broker = resolveMessagingBrokerFromMddSection2(mddMarkdown);
  return broker === "rabbitmq" || broker === "kafka";
}

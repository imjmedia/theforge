/**
 * Registro extensible de integraciones externas para auditoría SDD (alcance → API/Architecture/Infra).
 */

export type ExternalIntegrationSignal = {
  id: string;
  label: string;
  scopePattern: string;
  apiPattern: string;
  architecturePattern: string;
  infraPattern: string;
};

/** Integraciones built-in; proyectos pueden extender vía domainInventory.externalIntegrations. */
export const BUILTIN_EXTERNAL_INTEGRATIONS: ExternalIntegrationSignal[] = [
  {
    id: "websocket_gateway",
    label: "WebSocket Gateway",
    scopePattern: "\\b(websocket|ws\\s+gateway|gateway\\s+websocket|tiempo\\s+real|real[- ]time\\s+feed)\\b",
    apiPattern: "\\b(wss?:\\/\\/|websocket|\\/ws\\b|socket\\.io)\\b",
    architecturePattern: "\\b(websocket|gateway\\s+ws|real[- ]time)\\b",
    infraPattern: "\\b(websocket|nginx\\s+proxy.*upgrade|sticky\\s+session)\\b",
  },
  {
    id: "banxico",
    label: "Banxico / tipo de cambio",
    scopePattern: "\\b(banxico|tipo\\s+de\\s+cambio\\s+oficial|fix\\s+mxn|series\\s+banxico)\\b",
    apiPattern: "\\b(banxico|\\/exchange[- ]?rates|tipo\\s+cambio)\\b",
    architecturePattern: "\\b(banxico|fix\\s+mxn)\\b",
    infraPattern: "\\b(banxico|cron.*tipo\\s+cambio)\\b",
  },
  {
    id: "polygon",
    label: "Polygon.io market data",
    scopePattern: "\\b(polygon\\.io|polygon\\s+api|market\\s+data\\s+polygon)\\b",
    apiPattern: "\\b(polygon|\\/market[- ]?data|\\/quotes)\\b",
    architecturePattern: "\\b(polygon)\\b",
    infraPattern: "\\b(polygon|market\\s+data\\s+provider)\\b",
  },
  {
    id: "stripe",
    label: "Stripe billing",
    scopePattern: "\\b(stripe|checkout\\s+session|webhook\\s+stripe|billing\\s+portal)\\b",
    apiPattern: "\\b(stripe|\\/webhooks\\/stripe|\\/billing)\\b",
    architecturePattern: "\\b(stripe|payment\\s+provider)\\b",
    infraPattern: "\\b(stripe|webhook\\s+secret|STRIPE_)\\b",
  },
  {
    id: "rabbitmq",
    label: "RabbitMQ / EDA",
    scopePattern: "\\b(rabbitmq|event-driven|message\\s+broker)\\b",
    apiPattern: "\\b(rabbitmq|publisher|consumer|event-bus|\\/events)\\b",
    architecturePattern: "\\b(rabbitmq|outbox|event-driven)\\b",
    infraPattern: "\\b(rabbitmq|amqp|message\\s+queue)\\b",
  },
];

export type ExternalIntegrationCheckInput = {
  scopeCorpus: string;
  apiMarkdown: string;
  architectureMarkdown: string;
  infraMarkdown: string;
  extraIntegrations?: ExternalIntegrationSignal[];
};

function compileSafe(re: string): RegExp {
  return new RegExp(re, "i");
}

/** Gaps cuando el alcance declara una integración pero falta en artefactos downstream. */
export function collectExternalIntegrationGapsFromRegistry(
  input: ExternalIntegrationCheckInput,
): string[] {
  if (input.scopeCorpus.length < 200) return [];

  const registry = [
    ...BUILTIN_EXTERNAL_INTEGRATIONS,
    ...(input.extraIntegrations ?? []),
  ];
  const gaps: string[] = [];

  for (const sig of registry) {
    const scopeRe = compileSafe(sig.scopePattern);
    if (!scopeRe.test(input.scopeCorpus)) continue;

    const missing: string[] = [];
    if (!compileSafe(sig.apiPattern).test(input.apiMarkdown)) missing.push("API contracts");
    if (!compileSafe(sig.architecturePattern).test(input.architectureMarkdown)) {
      missing.push("Architecture");
    }
    if (!compileSafe(sig.infraPattern).test(input.infraMarkdown)) missing.push("Infra");

    if (missing.length > 0) {
      gaps.push(
        `[Integración ${sig.id}] En alcance DBGA/BRD pero falta en: ${missing.join(", ")}`,
      );
    }
  }

  return gaps;
}

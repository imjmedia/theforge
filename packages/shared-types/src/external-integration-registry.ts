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

/**
 * Neutraliza palabras que `resolveDeliverables` interpreta como artefacto destino
 * (API, Architecture, Infra) para que el texto citado no añada destinos falsos.
 */
function neutralizeTargetWords(text: string): string {
  // Mismos criterios que `resolveDeliverables` (readiness-audit.util.ts): architecture/arquitectura/
  // infraestructura sin límite de palabra (también matchean en plurales y compuestos).
  return text.replace(
    /api\s*contracts|api_contracts|architecture|arquitectura|infraestructura|\bapi\b|\binfra\b/gi,
    "…",
  );
}

/** Extracto (~80 caracteres alrededor del match) del corpus, en una sola línea. */
function extractExcerpt(corpus: string, index: number, length: number): string {
  const pad = 40;
  const start = Math.max(0, index - pad);
  const end = Math.min(corpus.length, index + length + pad);
  const raw = corpus.slice(start, end).replace(/\s+/g, " ").trim();
  return neutralizeTargetWords(raw);
}

/** Patrón en texto legible: sin `\\b` y con el alias `/…/i`. */
function formatPattern(pattern: string): string {
  return neutralizeTargetWords(`/${pattern.replace(/\\b/g, "")}/i`);
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
    const scopeMatch = compileSafe(sig.scopePattern).exec(input.scopeCorpus);
    if (!scopeMatch) continue;

    const missing: { label: string; pattern: string }[] = [];
    if (!compileSafe(sig.apiPattern).test(input.apiMarkdown)) {
      missing.push({ label: "API contracts", pattern: sig.apiPattern });
    }
    if (!compileSafe(sig.architecturePattern).test(input.architectureMarkdown)) {
      missing.push({ label: "Architecture", pattern: sig.architecturePattern });
    }
    if (!compileSafe(sig.infraPattern).test(input.infraMarkdown)) {
      missing.push({ label: "Infra", pattern: sig.infraPattern });
    }

    if (missing.length > 0) {
      const excerpt = extractExcerpt(input.scopeCorpus, scopeMatch.index, scopeMatch[0].length);
      const criteria = missing
        .map((m) => `${m.label} debe mencionar ${formatPattern(m.pattern)}`)
        .join("; ");
      gaps.push(
        `[Integración ${sig.id}] En alcance DBGA/BRD pero falta en: ${missing.map((m) => m.label).join(", ")}. ` +
          `Disparado por: «${excerpt}». Criterio: ${criteria}`,
      );
    }
  }

  return gaps;
}

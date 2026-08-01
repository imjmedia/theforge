/**
 * Extrae líneas de texto editables de un slide para exportación PPTX.
 */
import type { EvdSlideBase } from "./evd-deck.types.js";

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

function namedItems(
  items: unknown,
  render: (item: Record<string, unknown>) => string,
): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i): i is Record<string, unknown> => i && typeof i === "object")
    .map(render)
    .filter(Boolean);
}

/** Devuelve líneas con viñetas para el cuerpo del slide. */
export function extractSlideBodyLines(slide: EvdSlideBase): string[] {
  switch (slide.type) {
    case "title":
      return slide.subtitle ? [String(slide.subtitle)] : [];

    case "problem_statement": {
      const lines = asStringArray(slide.painPoints);
      if (slide.impact) lines.push(String(slide.impact));
      if (slide.urgency) lines.push(String(slide.urgency));
      return lines;
    }

    case "solution_vision": {
      const lines: string[] = [];
      if (slide.description) lines.push(String(slide.description));
      lines.push(...asStringArray(slide.keyOutcomes));
      return lines;
    }

    case "current_vs_new": {
      const lines: string[] = [];
      const current = asStringArray(slide.currentSteps);
      const next = asStringArray(slide.newSteps);
      if (current.length) {
        lines.push(String(slide.currentLabel ?? "Actual"));
        lines.push(...current.map((l) => `• ${l}`));
      }
      if (next.length) {
        lines.push(String(slide.newLabel ?? "Nuevo"));
        lines.push(...next.map((l) => `• ${l}`));
      }
      if (slide.improvementSummary) lines.push(String(slide.improvementSummary));
      return lines;
    }

    case "process_flow":
      return namedItems(slide.steps, (step) => {
        const label = String(step.label ?? "");
        const desc = step.description ? ` — ${String(step.description)}` : "";
        const auto = step.automated ? " (automático)" : "";
        return `${label}${desc}${auto}`;
      });

    case "automations":
      return namedItems(slide.automations, (a) => {
        const name = String(a.name ?? "");
        const desc = a.description ? `: ${String(a.description)}` : "";
        const saved = a.timeSaved ? ` · ${String(a.timeSaved)}` : "";
        return `${name}${desc}${saved}`;
      });

    case "key_features":
      return namedItems(slide.features, (f) => {
        const name = String(f.name ?? "");
        const desc = f.description ? `: ${String(f.description)}` : "";
        return `${name}${desc}`;
      });

    case "data_overview": {
      const lines = namedItems(slide.dataTypes, (d) => {
        const name = String(d.name ?? "");
        const desc = d.description ? `: ${String(d.description)}` : "";
        return `${name}${desc}`;
      });
      lines.push(
        ...namedItems(slide.flows, (f) => {
          const from = String(f.from ?? "");
          const to = String(f.to ?? "");
          const desc = f.description ? ` — ${String(f.description)}` : "";
          return `${from} → ${to}${desc}`;
        }),
      );
      if (lines.length === 0 && slide.body) return [String(slide.body)];
      return lines;
    }

    case "integrations":
      return namedItems(slide.integrations, (i) => {
        const name = String(i.name ?? "");
        const purpose = i.purpose ? ` — ${String(i.purpose)}` : "";
        return `${name}${purpose}`;
      });

    case "security_access": {
      const lines = namedItems(slide.roles, (r) => {
        const name = String(r.name ?? "");
        const perms = Array.isArray(r.permissions)
          ? `: ${(r.permissions as string[]).join(", ")}`
          : "";
        return `${name}${perms}`;
      });
      lines.push(...asStringArray(slide.dataProtection));
      return lines;
    }

    case "rollout_plan":
      return namedItems(slide.phases, (p) => {
        const label = String(p.label ?? "");
        const duration = p.duration ? ` (${String(p.duration)})` : "";
        const desc = p.description ? `: ${String(p.description)}` : "";
        return `${label}${duration}${desc}`;
      });

    case "timeline":
      return namedItems(slide.milestones, (m) => {
        const label = String(m.label ?? "");
        const date = m.date ? ` · ${String(m.date)}` : "";
        return `${label}${date}`;
      });

    case "cta": {
      const lines: string[] = [];
      if (slide.description) lines.push(String(slide.description));
      if (slide.contactInfo) lines.push(String(slide.contactInfo));
      return lines;
    }

    default:
      if (slide.body) return String(slide.body).split("\n").filter(Boolean);
      return asStringArray(slide.painPoints ?? slide.keyOutcomes);
  }
}

export function stripB64Prefix(b64: string): string {
  if (b64.startsWith("data:")) {
    const comma = b64.indexOf(",");
    return comma >= 0 ? b64.slice(comma + 1) : b64;
  }
  return b64;
}

export function isUsableB64(value: string | undefined): value is string {
  if (!value || value.startsWith("[image")) return false;
  return value.length > 80;
}

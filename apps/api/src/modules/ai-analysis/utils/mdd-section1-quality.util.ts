/**
 * Calidad estructural de §1 Contexto (constitución MDD) según complejidad.
 */

import type { MddComplexityLevel } from "../state/mdd-state.schema.js";
import { extractContextSectionBody, isMddSectionPipelinePlaceholderBody } from "./mdd-sanitize/section-merge.js";

export const MIN_SECTION1_BODY_LEN_LOW = 200;
export const MIN_SECTION1_BODY_LEN_MEDIUM = 600;
export const MIN_SECTION1_BODY_LEN_HIGH = 900;

const SUBSECTION_LABELS = {
  proposito: "Propósito del sistema",
  fronteras: "Alcance y fronteras",
  mapaContextos: "Mapa de contextos DDD",
  glosario: "Glosario de dominio",
  actores: "Actores del documento",
} as const;

type SubsectionKey = keyof typeof SUBSECTION_LABELS;

export type Section1QualityResult = {
  ok: boolean;
  bodyLen: number;
  minLen: number;
  missingSubsections: string[];
  blockers: string[];
};

function level(complexity?: MddComplexityLevel): MddComplexityLevel {
  return complexity ?? "HIGH";
}

/** Longitud mínima del cuerpo §1 según complejidad del proyecto. */
export function minSection1BodyLength(complexity?: MddComplexityLevel): number {
  const cx = level(complexity);
  if (cx === "LOW") return MIN_SECTION1_BODY_LEN_LOW;
  if (cx === "MEDIUM") return MIN_SECTION1_BODY_LEN_MEDIUM;
  return MIN_SECTION1_BODY_LEN_HIGH;
}

function hasSubsection(body: string, key: SubsectionKey): boolean {
  const lower = body.toLowerCase();
  switch (key) {
    case "proposito":
      return (
        /###\s*(?:propósito|proposito|objetivo)/i.test(body) ||
        /propósito del sistema|objetivo principal|resultado de negocio|misión del/i.test(lower)
      );
    case "fronteras":
      return (
        /###\s*(?:alcance|fronteras|frontera)/i.test(body) ||
        /fronteras|fuera de alcance|en alcance|qué es core|servicios core|extensiones/i.test(lower)
      );
    case "mapaContextos":
      return (
        /###\s*mapa de contextos/i.test(body) ||
        /mapa de contextos|contextos delimitados|colindantes|en alcance del mdd/i.test(lower)
      );
    case "glosario":
      return (
        /###\s*glosario/i.test(body) ||
        /glosario|ubiquitous language|término.*→|termino.*→/i.test(lower)
      );
    case "actores":
      return (
        /###\s*actores/i.test(body) ||
        /actores del documento|stakeholder|dueños de implementación|audiencia técnica/i.test(lower)
      );
    default:
      return false;
  }
}

function requiredSubsections(complexity: MddComplexityLevel): SubsectionKey[] {
  if (complexity === "LOW") return ["proposito", "fronteras"];
  if (complexity === "MEDIUM") return ["proposito", "fronteras", "mapaContextos", "actores"];
  return ["proposito", "fronteras", "mapaContextos", "glosario", "actores"];
}

/** Evalúa longitud y subsecciones obligatorias de §1. */
export function evaluateSection1BodyQuality(
  body: string | null | undefined,
  complexity?: MddComplexityLevel,
): Section1QualityResult {
  const cx = level(complexity);
  const minLen = minSection1BodyLength(cx);
  const trimmed = (body ?? "").trim();
  const blockers: string[] = [];
  const missingSubsections: string[] = [];

  if (!trimmed || isMddSectionPipelinePlaceholderBody(trimmed)) {
    blockers.push("§1 Contexto vacío o placeholder del pipeline.");
    return {
      ok: false,
      bodyLen: trimmed.length,
      minLen,
      missingSubsections: ["contenido"],
      blockers,
    };
  }

  if (trimmed.length < minLen) {
    blockers.push(
      `Sección 1. Contexto tiene contenido insuficiente (${trimmed.length} chars; mínimo ${minLen}).`,
    );
  }

  for (const key of requiredSubsections(cx)) {
    if (!hasSubsection(trimmed, key)) {
      missingSubsections.push(SUBSECTION_LABELS[key]);
    }
  }

  if (cx === "MEDIUM" || cx === "HIGH") {
    const hasMapa = hasSubsection(trimmed, "mapaContextos");
    const hasGlosario = hasSubsection(trimmed, "glosario");
    if (!hasMapa && !hasGlosario) {
      if (!missingSubsections.some((m) => m.includes("Glosario") || m.includes("Mapa"))) {
        missingSubsections.push("Mapa de contextos DDD o Glosario de dominio");
      }
    } else {
      const glosarioIdx = missingSubsections.indexOf(SUBSECTION_LABELS.glosario);
      if (glosarioIdx !== -1 && (hasGlosario || hasMapa)) {
        missingSubsections.splice(glosarioIdx, 1);
      }
      const mapaIdx = missingSubsections.indexOf(SUBSECTION_LABELS.mapaContextos);
      if (mapaIdx !== -1 && (hasMapa || hasGlosario)) {
        missingSubsections.splice(mapaIdx, 1);
      }
    }
  }

  if (missingSubsections.length > 0) {
    blockers.push(
      `Sección 1. Contexto: estructura constitución incompleta (faltan: ${missingSubsections.join(", ")}).`,
    );
  }

  return {
    ok: blockers.length === 0,
    bodyLen: trimmed.length,
    minLen,
    missingSubsections,
    blockers,
  };
}

/** True si el borrador cumple calidad constitucional de §1 para la complejidad dada. */
export function draftMeetsSection1Quality(draft: string, complexity?: MddComplexityLevel): boolean {
  return evaluateSection1BodyQuality(extractContextSectionBody(draft), complexity).ok;
}

function primarySourceText(clarifiedScope: string, dbgaContent: string): string {
  const scope = clarifiedScope.trim();
  const dbga = dbgaContent.trim();
  if (scope.length >= 300) return scope.slice(0, 12_000);
  if (dbga.length >= 500) return dbga.slice(0, 12_000);
  return (scope || dbga).slice(0, 12_000);
}

function firstSubstantialParagraph(text: string, minLen = 80): string {
  const blocks = text
    .split(/\n\n+/)
    .map((s) => s.replace(/^#+\s*/, "").trim())
    .filter((s) => s.length >= minLen && !/^\(pendiente/i.test(s));
  return (blocks[0] ?? text).slice(0, 1_200).trim();
}

function extractExistingProposito(existingBody: string): string | null {
  const m = existingBody.match(
    /###\s*(?:Propósito|Proposito|Objetivo)[^\n]*\n+([\s\S]*?)(?=\n###\s|\n##\s|$)/i,
  );
  const block = m?.[1]?.trim();
  if (block && block.length >= 80) return block.slice(0, 1_200);
  if (existingBody.length >= 80 && !/^###/m.test(existingBody.slice(0, 40))) {
    return existingBody.split(/\n\n+/)[0]?.trim().slice(0, 1_200) ?? null;
  }
  return null;
}

function bulletLinesFromSource(text: string, max = 6): string[] {
  const lines: string[] = [];
  for (const line of text.split(/\n/)) {
    const t = line.replace(/^[-*]\s+/, "").replace(/^\*\*([^*]+)\*\*:?\s*/, "$1: ").trim();
    if (t.length < 25 || t.length > 280) continue;
    if (/^(objective|technologies|focus|requirements|scope):/i.test(t)) continue;
    lines.push(t.startsWith("-") ? t : `- ${t}`);
    if (lines.length >= max) break;
  }
  return lines;
}

function inferGlossaryLines(text: string): string[] {
  const terms = new Set<string>();
  const out: string[] = [];
  for (const m of text.matchAll(/\*\*([^*]{2,48})\*\*/g)) {
    const term = m[1]!.trim();
    if (terms.has(term.toLowerCase())) continue;
    terms.add(term.toLowerCase());
    out.push(`- **${term}:** término del dominio descrito en el alcance.`);
    if (out.length >= 6) break;
  }
  if (out.length >= 2) return out;
  return [
    "- **Inquilino (tenant):** unidad de aislamiento multiempresa.",
    "- **Alcance:** capacidades descritas en el benchmark y requisitos del usuario.",
  ];
}

/**
 * Ensambla §1 con subsecciones constitución a partir de scope/DBGA cuando el LLM devolvió solo un párrafo.
 */
export function buildHydratedSection1Body(params: {
  existingBody?: string;
  clarifiedScope: string;
  dbgaContent: string;
  complexity?: MddComplexityLevel;
}): string {
  const cx = level(params.complexity);
  const source = primarySourceText(params.clarifiedScope, params.dbgaContent);
  const existing = (params.existingBody ?? "").trim();
  const proposito =
    extractExistingProposito(existing) ?? firstSubstantialParagraph(source);

  const bullets = bulletLinesFromSource(source);
  const fronterasBody =
    bullets.length >= 2
      ? bullets.join("\n")
      : `- **Core:** ${firstSubstantialParagraph(source, 40).slice(0, 400)}\n- **Integraciones:** sistemas externos mencionados en el benchmark.\n- **Fuera de alcance:** funcionalidad no descrita en BRD/DBGA.`;

  const mapaBody = `- **En alcance del MDD:** ${firstSubstantialParagraph(source, 40).slice(0, 350)}\n- **Colindantes (integración):** CRM, ERP, SaaS y canal de mensajería según benchmark.\n- **Fuera de alcance explícito:** capacidades no mencionadas en la entrada.`;

  const actoresBody =
    `- **Stakeholder de decisión:** patrocinador del producto y negocio.\n` +
    `- **Dueños de implementación:** equipo fullstack según stack declarado.\n` +
    `- **Audiencia técnica:** desarrolladores que implementan §2–§7.`;

  const glosarioBody = inferGlossaryLines(source).join("\n");

  const parts: string[] = [`### Propósito del sistema\n\n${proposito}`, `### Alcance y fronteras\n\n${fronterasBody}`];

  if (cx !== "LOW") {
    parts.push(`### Mapa de contextos delimitados (DDD)\n\n${mapaBody}`);
    parts.push(`### Actores del documento\n\n${actoresBody}`);
  }
  if (cx === "HIGH" || (cx === "MEDIUM" && !hasSubsection(existing, "glosario"))) {
    parts.push(`### Glosario de dominio\n\n${glosarioBody}`);
  }

  return parts.join("\n\n");
}

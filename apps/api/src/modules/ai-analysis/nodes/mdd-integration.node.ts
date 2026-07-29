/**
 * @fileoverview Nodo de integración — maneja especificaciones de integración.
 */

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage } from "@langchain/core/messages";
import { INTEGRATION_ENGINEER_MDD_PROMPT } from "../prompts/load-prompts.js";
import type { MDDStateType } from "../state/index.js";
import {
  mddIntegracionSubsectionSchema,
  mddIntegracionWithManifestSchema,
} from "../state/mdd-structured.schema.js";
import { mergeMddStructured } from "../utils/mdd-merge-structured.js";
import { getUserBrief } from "../utils/mdd-user-brief.js";
import {
  buildNewFormatManifestFromIdentifiedTerms,
  extractIdentifiedInfraFromText,
  ensureSection6WhenSection7Present,
  fixIntegrationSectionBullets,
  getMddDraftSummary,
  integracionToSection7Markdown,
  jsonSectionToMarkdown,
  logMddNodeOutput,
  getSectionsToPreserveFromExecutorPlan,
  preserveUntouchedMddSectionsFromBaseline,
  replaceSection6Or7InDraft,
  sanitizeManifestToMatchIdentifiedInfra,
  stripInstructionAndFeedbackBlocks,
  stripNotaPendienteHeadingInIntegrationSection,
} from "../utils/mdd-sanitize.js";
import { extractFirstJsonObject, parseJsonOrThrow } from "../utils/parse-json.js";
import { getInternalDirectivesContext, extractInternalDirectives } from "../utils/mdd-mesh-topology.js";
import { stripThinkingTags } from "../utils/mdd-security-parse.js";
import { extractLlmText, invokeLlmWithRetry } from "../utils/mdd-llm-retry.util.js";
import { logMddLlmMetrics, measureMddLlmCall } from "../utils/mdd-llm-metrics.util.js";
import { buildTrimmedTailAgentContext } from "../utils/mdd-tail-parallel.util.js";
import {
  draftHasSubstantialSection7,
  reinjectTailSectionsFromSnapshotsForGateLoop,
  stateHasSubstantialTailSnapshots,
} from "../utils/mdd-section-preserve.util.js";
import { z } from "zod";

export type MddIntegrationNodeOptions = {
  /** F3: solo devuelve slice structured (sin mddDraft). */
  sliceOnly?: boolean;
  /** F3: contexto §1+§2+DDL§3+tabla§4 (sin JSON). */
  trimmedTailContext?: boolean;
};

/** Schema de salida estructurada: integracion con subsections y manifest opcional. */
const integrationStructuredSchema = z.object({
  integracion: mddIntegracionWithManifestSchema,
});

/** Acepta string u objeto legacy; normaliza a string. */
function sectionToStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const obj = x as Record<string, unknown>;
    const key = ["content", "text", "section", "integrationSection"].find(
      (k) => typeof obj[k] === "string",
    );
    if (key) return String(obj[key]);
  }
  return typeof x === "object" ? JSON.stringify(x, null, 2) : String(x);
}

const legacyIntegrationOutputSchema = z.object({
  integrationSection: z
    .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
    .transform(sectionToStr)
    .pipe(z.string()),
});

const LOG = (msg: string, ...args: unknown[]) => console.log(`[MDD:Integration] ${msg}`, ...args);

/** Detecta si el usuario describió un flujo de integración concreto. */
function hasUserDescribedIntegrationFlow(state: MDDStateType): boolean {
  const scope = (state.clarifiedScope ?? "").trim();
  const accumulated = (state.userInputAccumulated ?? "").trim();
  const text = `${scope} ${accumulated}`.toLowerCase();
  return (
    (/flujo\s+de\s+integraci[oó]n|definir(?:te)?\s+el\s+flujo|cuando el usuario entre/i.test(text) &&
      (/redirecci[oó]n|login\s+personalizado|logo.*slogan|token|mfa|validar.*token|rol.*aplicaci[oó]n/i.test(text) ||
        /redirig|pantalla de login|obtenga el rol/i.test(text)))
  );
}

/** Último bloque de userInputAccumulated (tras el último "---") o todo si es corto. */
function getLastUserInputBlock(accumulated: string, maxLen = 2000): string {
  const t = (accumulated ?? "").trim();
  if (!t) return "";
  const parts = t.split(/\n\n---\n\n/);
  const last = parts[parts.length - 1]?.trim() ?? t;
  return last.length > maxLen ? last.slice(0, maxLen) + "\n...(truncado)" : last;
}

/** Extrae del documento qué infra está identificada. */
function getIdentifiedInfraFromState(state: MDDStateType): string[] {
  const scope = (state.clarifiedScope ?? "").trim();
  const draft = (state.mddDraft ?? "").trim();
  const accumulated = (state.userInputAccumulated ?? "").trim();
  return extractIdentifiedInfraFromText(`${scope} ${draft} ${accumulated}`);
}

/** Extrae bloque ```json ... ``` y parsea como manifest. */
function extractManifestFromMarkdown(section: string): Record<string, unknown> | undefined {
  const m = section.match(/```json\s*([\s\S]*?)```/i);
  if (!m?.[1]) return undefined;
  try {
    const obj = JSON.parse(m[1].trim()) as Record<string, unknown>;
    return typeof obj === "object" && obj !== null ? obj : undefined;
  } catch {
    return undefined;
  }
}

/** Fallback: desde markdown de sección Integración construye integracion (una subsección + manifest si hay). */
function markdownToIntegracion(
  sectionMarkdown: string,
  identifiedInfra: string[],
): z.infer<typeof mddIntegracionWithManifestSchema> {
  let section = sectionMarkdown
    .replace(/^##\s*Integraci[oó]n\s*/i, "")
    .trim();
  section = stripInstructionAndFeedbackBlocks(section);
  section = fixIntegrationSectionBullets(section);
  if (identifiedInfra.length > 0) {
    const fullSection = "## Integración\n\n" + section;
    section = sanitizeManifestToMatchIdentifiedInfra(fullSection, identifiedInfra).replace(
      /^##\s*Integraci[oó]n\s*\n*/i,
      "",
    ).trim();
  }
  section = stripNotaPendienteHeadingInIntegrationSection(section);
  let manifest: Record<string, unknown> | undefined = extractManifestFromMarkdown(section);
  const contentText = section.replace(/```json\s*[\s\S]*?```/i, "").trim() || "(Pendiente de definir.)";
  const content = [contentText];
  const subsection = mddIntegracionSubsectionSchema.parse({
    title: "Integración",
    content,
  });
  return mddIntegracionWithManifestSchema.parse({
    subsections: [subsection],
    manifest,
  });
}

/** Si alguna subsección tiene content vacío, la rellena con un hint contextual. */
function ensureIntegrationContent(
  slice: { integracion: z.infer<typeof mddIntegracionWithManifestSchema> },
  state: MDDStateType,
): void {
  const subs = Array.isArray(slice.integracion) ? slice.integracion : slice.integracion.subsections;
  if (!subs) return;
  const scope = (state.clarifiedScope ?? "").slice(0, 200).trim();
  for (const sub of subs) {
    const contentArr = Array.isArray(sub.content) ? sub.content : [String(sub.content ?? "")];
    const hasRealContent = contentArr.some((c: string) => c.trim().length > 10);
    if (!hasRealContent) {
      const hint = getIntegrationHint(sub.title, scope);
      sub.content = [hint, "(Detalle pendiente de definir en la iteración.)"];
      LOG("rellenado content vacío para %s", sub.title);
    } else {
      // Asegurar que sea array
      sub.content = contentArr;
    }
  }
}

/** Genera un hint contextual para una subsección de integración con content vacío. */
function getIntegrationHint(title: string, scope: string): string {
  const t = title.toLowerCase();
  const ctx = scope ? ` (contexto: ${scope.slice(0, 120)})` : "";
  if (t.includes("flujo") || t.includes("integración") || t.includes("7.1")) {
    return `Describir paso a paso el flujo de integración entre los sistemas involucrados.${ctx}`;
  }
  if (t.includes("seguridad") || t.includes("validación") || t.includes("7.2")) {
    return `Documentar TLS en tránsito, validación de tokens, rate limiting y autenticación a nivel transporte.${ctx}`;
  }
  if (t.includes("resilien") || t.includes("7.3")) {
    return `Definir timeouts, reintentos con backoff y circuit breaker según los requisitos del sistema.${ctx}`;
  }
  if (t.includes("infraestructura") || t.includes("despliegue") || t.includes("7.4")) {
    return `Especificar stack de despliegue (Docker, Dokploy, Kubernetes) y configuración de contenedores.${ctx}`;
  }
  if (t.includes("variable") || t.includes("entorno") || t.includes("7.5")) {
    return `Enumerar variables de entorno necesarias: base de datos, autenticación, caché, logging.${ctx}`;
  }
  if (t.includes("ci/cd") || t.includes("pipeline") || t.includes("7.6")) {
    return `Describir pipeline CI/CD: linting, tests, build, deploy y healthcheck.${ctx}`;
  }
  return `Detalle pendiente para "${title}".${ctx}`;
}

/** Creates the MDD Integration Engineer node. Outputs structured integracion; merge into mddStructured and derive mddDraft. */
export function createMddIntegrationNode(llm: BaseChatModel, opts?: MddIntegrationNodeOptions) {
  return async (state: MDDStateType): Promise<Partial<MDDStateType>> => {
    const sliceOnly = opts?.sliceOnly === true;
    LOG("entry mddDraftLen=%s sliceOnly=%s", (state.mddDraft ?? "").length, sliceOnly);
    try {
      if (
        state.deliveryGateLoopActive === true &&
        state.deliveryGateFixTarget === "integration" &&
        stateHasSubstantialTailSnapshots(state)
      ) {
        const reinjected = reinjectTailSectionsFromSnapshotsForGateLoop(state);
        if (reinjected) {
          LOG("gate loop integration — re-inyectado §6/§7 desde snapshots (skip LLM)");
          if (sliceOnly) {
            return {
              mddStructured: state.mddStructured,
              ...(reinjected.securitySectionMd ? { securitySectionMd: reinjected.securitySectionMd } : {}),
              ...(reinjected.integrationSectionMd ? { integrationSectionMd: reinjected.integrationSectionMd } : {}),
            };
          }
          return reinjected;
        }
      }

      const brief = getUserBrief(state);
      const briefBlock = brief
        ? `**Objetivo del documento (lo que el usuario pide):** ${brief}\n\n**Tu tarea:** Elaborar la sección 7. Infraestructura/Integración para una aplicación que cumple este objetivo.\n\n---\n\n`
        : "";
      const contextParts: string[] = briefBlock ? [briefBlock] : [];
      if (state.acceptedProposalDirective?.trim()) {
        const directive = state.acceptedProposalDirective.trim();
        const affectsSection7 =
          /\b(infraestructura|docker|ci\/cd|despliegue|variables?\s+de\s+entorno|manifest|\.env|integracion|kubernetes|kubernets|k8s|dokploy|coolify|contenedores?)\b/i.test(
            directive,
          );
        const priorityBlock = affectsSection7
          ? ["**Prioridad (léelo primero):** La ACCIÓN REQUERIDA siguiente tiene prioridad máxima. Aplícala en ## 7. Infraestructura/Integración.", ""]
          : [];
        contextParts.unshift(
          ...priorityBlock,
          "**ACCIÓN REQUERIDA (usuario aceptó esta propuesta):**",
          directive,
          "Debes aplicar esta directiva en ## 7. Infraestructura/Integración.",
          "",
        );
      }
      const accumulated = (state.userInputAccumulated ?? "").trim();
      if (hasUserDescribedIntegrationFlow(state)) {
        const userFlowText = getLastUserInputBlock(accumulated);
        contextParts.push(
          "**Flujo de integración descrito por el usuario (documentar EXACTAMENTE en esta sección, con subsecciones ### y párrafos):**",
          userFlowText || "(ver respuestas del usuario en el borrador/contexto)",
          "",
          "Incluye una subsección que describa paso a paso: (1) app detecta que no hay token válido y redirige a endpoint de login, (2) pantalla de login personalizada con logo, nombre, slogan y background de la aplicación, (3) SSO valida usuario/contraseña, (4) si MFA activado → pantalla de código → si correcto continúa, (5) redirección a la aplicación con el token, (6) la aplicación valida el token en el SSO y obtiene el rol del usuario en esa aplicación.",
          "",
        );
      }
      const identifiedInfra = getIdentifiedInfraFromState(state);
      if (identifiedInfra.length > 0) {
        contextParts.push(
          `**Manifest de Infraestructura:** El documento ya identifica: ${identifiedInfra.join(", ")}. El manifest al final de la sección debe reflejar **únicamente** lo identificado.`,
          "",
        );
      } else {
        contextParts.push(
          "**Manifest de Infraestructura:** El documento **no especifica** stack. Debes escribir igual una sección **completa** con subsecciones (Flujo, Seguridad y validación, Resiliencia, Infraestructura). Al final incluye manifest con `\"stack\": []` y `\"pending\": \"Definir con el usuario: orquestación y despliegue\"`.",
          "",
        );
      }
      const scope = (state.clarifiedScope ?? "").trim();
      if (scope) {
        contextParts.push("**Alcance clarificado:**", scope, "");
      }
      const draftBlock = opts?.trimmedTailContext
        ? buildTrimmedTailAgentContext(state.mddDraft ?? "")
        : (state.mddDraft ?? "(vacío)");
      contextParts.push(
        opts?.trimmedTailContext
          ? "**Contexto MDD (referencia acotada para Integración):**"
          : "**Borrador actual del MDD (usa las secciones 1–4 y Seguridad para derivar ## Integración):**",
        draftBlock,
        getInternalDirectivesContext(state, "integration_engineer"),
      );
      if (state.auditorFeedback?.trim()) {
        contextParts.push(
          "",
          "**Feedback del Auditor (relevante para Integración/Manifest – aplicar):**",
          state.auditorFeedback.trim(),
        );
      }
      const context = contextParts.join("\n");
      const prompt = `${INTEGRATION_ENGINEER_MDD_PROMPT}\n\n---\n${context}`;
      const inputDraftLen = (state.mddDraft ?? "").trim().length;
      const startedAt = Date.now();
      const response = await invokeLlmWithRetry(llm, [new HumanMessage(prompt)], { tag: "Integration" });
      const rawText = response ? extractLlmText(response) : "";
      const text = stripThinkingTags(rawText);
      logMddLlmMetrics(LOG, measureMddLlmCall(startedAt, prompt.length, rawText.length));
      if (!text.trim()) {
        const reinjected = reinjectTailSectionsFromSnapshotsForGateLoop(state);
        if (reinjected) {
          LOG("LLM vacío — restaurado §6/§7 desde snapshots");
          if (sliceOnly) {
            return {
              mddStructured: state.mddStructured,
              ...(reinjected.securitySectionMd ? { securitySectionMd: reinjected.securitySectionMd } : {}),
              ...(reinjected.integrationSectionMd ? { integrationSectionMd: reinjected.integrationSectionMd } : {}),
            };
          }
          return { ...reinjected, mddStructured: state.mddStructured ?? {} };
        }
        if (draftHasSubstantialSection7(state.mddDraft ?? "")) {
          LOG("LLM sin respuesta — preservando §7 existente (inputLen=%s)", inputDraftLen);
          logMddNodeOutput("Integration", state.mddDraft ?? "", { inputLen: inputDraftLen });
          return {};
        }
        LOG("LLM vacío, usando fallback");
        const slice = {
          integracion: mddIntegracionWithManifestSchema.parse({
            subsections: [
              mddIntegracionSubsectionSchema.parse({
                title: "Integración",
                content: ["(Pendiente de definir.)"],
              }),
            ],
            manifest: {
              project_id: "mdd-project",
              stack: { backend: {}, database: {}, security: {} },
              deployment: { orchestrator: "TBD", provider: "TBD", tooling: {}, resources: {} },
              integration_metadata: { api_prefix: "/api/v1", jwks_enabled: false, multi_tenant_support: false },
            },
          }),
        };
        const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
        if (sliceOnly) {
          return {
            mddStructured: { integracion: merged.integracion ?? slice.integracion },
            integrationSectionMd: integracionToSection7Markdown(slice.integracion),
          };
        }
        let fallbackDraft = replaceSection6Or7InDraft(state.mddDraft ?? "", 7, integracionToSection7Markdown(slice.integracion));
        if (state.executorControlled === true && state.previousMddDraftForMerge?.trim()) {
          const preserve = getSectionsToPreserveFromExecutorPlan(state.sectionsToRun);
          if (preserve.length > 0) {
            fallbackDraft = preserveUntouchedMddSectionsFromBaseline(
              fallbackDraft,
              state.previousMddDraftForMerge.trim(),
              preserve,
            );
          }
        }
        logMddNodeOutput("Integration", fallbackDraft, { inputLen: inputDraftLen });
        return { mddStructured: merged, mddDraft: fallbackDraft };
      }
      const jsonStr = extractFirstJsonObject(text) ?? text.trim();

      let slice: { integracion: z.infer<typeof mddIntegracionWithManifestSchema> };
      try {
        const parsed = parseJsonOrThrow(jsonStr, integrationStructuredSchema);
        slice = { integracion: parsed.integracion };
        LOG("parse estructurado ok subs=%d", slice.integracion.subsections.length);
      } catch {
        LOG("parse estructurado falló, fallback desde markdown");
        let section = "";
        try {
          const legacy = parseJsonOrThrow(text, legacyIntegrationOutputSchema);
          section = String(legacy.integrationSection ?? "").trim();
        } catch {
          section = text.replace(/^```(?:markdown)?\s*|\s*```$/g, "").trim();
        }
        const sec6Match = section.match(/\n##\s+6\.\s/m);
        if (sec6Match != null && sec6Match.index != null) {
          section = section.slice(0, sec6Match.index).trim();
        }
        if (section.startsWith("{") && section.includes('"')) {
          section = jsonSectionToMarkdown(section, "Integración");
        }
        const identifiedInfra = getIdentifiedInfraFromState(state);
        slice = {
          integracion: markdownToIntegracion(section || "## Integración\n\n(Pendiente de definir.)", identifiedInfra),
        };
        const man = slice.integracion.manifest as Record<string, unknown> | undefined;
        const isOldFormat = man && Array.isArray(man.stack);
        if (!slice.integracion.manifest || isOldFormat) {
          slice.integracion.manifest = buildNewFormatManifestFromIdentifiedTerms(identifiedInfra);
        }
      }

      LOG("[DIAG §7] LLM text len=%s rawPrefix=%s", text.length, text.slice(0, 300).replace(/\n/g, " "));
      LOG("[DIAG §7] slice subsections=%s", Array.isArray(slice.integracion) ? slice.integracion.length : (slice.integracion as { subsections?: unknown[] })?.subsections?.length ?? 0);

      // Post-processing: si alguna subsección tiene content vacío, rellenar con hint
      ensureIntegrationContent(slice, state);
      // Log qué subsections tienen contenido real
      const subs = Array.isArray(slice.integracion) ? slice.integracion : slice.integracion.subsections;
      for (const s of subs) {
        LOG("subsection %s contentLen=%d", s.title, Array.isArray(s.content) ? s.content.join("").length : String(s.content ?? "").length);
      }

      const merged = mergeMddStructured(state.mddStructured, slice, state.mddDraft ?? "");
      const internalDirectives = extractInternalDirectives(text, "integration_engineer");
      const meshUpdate = internalDirectives.length > 0 ? { internalDirectives } : {};

      const integracionForMd = Array.isArray(merged.integracion)
        ? { subsections: merged.integracion }
        : (merged.integracion ?? slice.integracion);
      let section7Md = integracionToSection7Markdown(integracionForMd);
      const s7BodyFromLlm = section7Md.replace(/^##[^\n]+\n+/, "").trim();
      if (!draftHasSubstantialSection7(`# MDD\n${section7Md}`)) {
        const reinjected = reinjectTailSectionsFromSnapshotsForGateLoop(state);
        if (reinjected?.integrationSectionMd) {
          section7Md = reinjected.integrationSectionMd;
          LOG("§7 LLM insustancial — restaurado desde snapshot");
        }
      } else if (s7BodyFromLlm.length < 200) {
        const reinjected = reinjectTailSectionsFromSnapshotsForGateLoop(state);
        if (reinjected?.integrationSectionMd) {
          section7Md = reinjected.integrationSectionMd;
          LOG("§7 LLM corto — restaurado desde snapshot");
        }
      }

      if (sliceOnly) {
        LOG("ok sliceOnly integracion subs=%s", integracionForMd.subsections?.length ?? 0);
        return {
          mddStructured: { integracion: merged.integracion ?? slice.integracion },
          integrationSectionMd: section7Md,
          ...meshUpdate,
        };
      }

      const draftWithSection6 = ensureSection6WhenSection7Present(state.mddDraft ?? "");
      let mddDraft = replaceSection6Or7InDraft(draftWithSection6, 7, section7Md);
      if (state.executorControlled === true && state.previousMddDraftForMerge?.trim()) {
        const preserve = getSectionsToPreserveFromExecutorPlan(state.sectionsToRun);
        if (preserve.length > 0) {
          mddDraft = preserveUntouchedMddSectionsFromBaseline(
            mddDraft,
            state.previousMddDraftForMerge.trim(),
            preserve,
          );
          LOG("preservadas secciones fuera de plan tras integration: %s", preserve.join(","));
        }
      }
      const sum = getMddDraftSummary(mddDraft);
      LOG("ok integracion §7 en mddDraft len=%s section2=%s", sum.length, sum.section2);
      logMddNodeOutput("Integration", mddDraft, { inputLen: inputDraftLen });
      return { mddStructured: merged, mddDraft, integrationSectionMd: section7Md, ...meshUpdate };
    } catch (err) {
      LOG("error: %s", err instanceof Error ? err.message : String(err));
      throw err;
    }
  };
}

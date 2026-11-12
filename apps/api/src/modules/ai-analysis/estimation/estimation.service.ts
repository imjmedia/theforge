import { Injectable } from "@nestjs/common";
import { Prisma } from "@theforge/database";
import { PrismaService } from "../../../prisma/prisma.service.js";
import { pickPrimaryStage } from "../../projects/stage-helpers.js";
import type {
  AuditorGaps,
  DocumentCompleteness,
  EstimationComplexity,
  LiveMetricsResult,
  MDDContext,
  MddAuditSnapshot,
  PlanningDocumentFields,
  PrecisionBreakdown,
  SemaphoreStatusLive,
} from "./estimation.types.js";
import {
  PRECISION_GREEN_MIN,
  AI_TOKENS_PER_ENTITY,
  AI_TOKENS_PER_SCREEN,
  AI_TOKENS_PER_ENDPOINT,
  AI_BASE_OVERHEAD_TOKENS,
  AI_COST_PER_TOKEN_USD,
  MXN_PER_USD,
} from "./estimation.types.js";
import { computeCostEstimation, countCostDrivers } from "@theforge/business-rules";
import { extractTechnicalMetadataTags } from "../../engine/mdd-markdown-parser.js";
import { computeContractGaps, computeTraceabilityGaps } from "../../engine/mdd-internal-audit.util.js";
import { hashMddDraft } from "./mdd-draft-hash.util.js";
import { computeDocumentCompleteness } from "./completeness.util.js";
import { computeCrossDocumentConsistency } from "./consistency.util.js";
import { parseDesignSpec, EMPTY_DESIGN_SPEC, isDesignFirst } from "@theforge/shared-types";
import {
  draftMeetsSection1Quality,
  minSection1BodyLength,
} from "../utils/mdd-section1-quality.util.js";
import { evaluateSection5TailTruncation } from "../utils/mdd-content-quality.util.js";
import {
  extractBestSection5Body,
  isMddSectionPipelinePlaceholderBody,
} from "../utils/mdd-sanitize/section-merge.js";
import { computeConsistencyGaps, detectReferenceSections } from "./mdd-section-detectors.util.js";
import { ConformanceService } from "../../engine/conformance.service.js";
import {
  buildSemaphoreInputsFromLoaded,
  type BuildSemaphoreInputsParams,
} from "./semaphore-inputs.factory.js";
import { computeCompletenessScore, resolveCompletenessPhase } from "@theforge/shared-types";
import type { SemaphoreSource } from "@theforge/shared-types";

/** Extrae el cuerpo de la primera sección cuyo título coincide con pattern (hasta el siguiente ##). */
function extractSection(md: string, pattern: RegExp): string {
  const content = (md || "").trim();
  const m = content.match(pattern);
  if (!m) return "";
  const start = m.index ?? 0;
  const afterTitle = start + (m[0]?.length ?? 0);
  const rest = content.slice(afterTitle);
  const nextH2 = rest.match(/\n##\s/m);
  const end = nextH2 ? nextH2.index! + 1 : rest.length;
  return rest.slice(0, end).trim();
}

/** Calificación máxima cuando la sección está en Estado Inconsistente (matriz de trazabilidad). */
const PRECISION_CAP_INCONSISTENTE = 40;

function isRelaxedComplexity(c: EstimationComplexity): boolean {
  return c === "LOW" || c === "MEDIUM";
}

/**
 * LOW/MEDIUM: no exigir en semáforo/desglose los mismos rigores que HIGH (credenciales/SQL, Dockerfile vs §2, edge security, manifest §7).
 * La matriz de entregables ya es más liviana; el auditor LLM sigue pudiendo marcar gaps narrativos.
 */
function adjustGapsForEstimationComplexity(
  gaps: ReturnType<typeof computeConsistencyGaps>,
  complexity: EstimationComplexity,
): ReturnType<typeof computeConsistencyGaps> {
  if (complexity === "HIGH") return gaps;
  const g = { ...gaps };
  if (isRelaxedComplexity(complexity)) {
    g.securityCompletenessGap = 0;
    g.infraStackGap = 0;
    g.securityEdgeCaseGap = 0;
  }
  if (complexity === "LOW") {
    g.missingManifest = 0;
  }
  return g;
}

/** Section keys used in sectionStatus (matriz de trazabilidad). */
const TRACEABILITY_SECTION_KEYS = [
  "contexto",
  "modeloDatos",
  "apiContracts",
  "seguridad",
] as const;

/** Mínimo §5 sustancial (alineado con delivery gate HIGH). */
const MIN_SECTION5_BODY_LENGTH_HIGH = 150;

const BDD_RULE_RE =
  /\b(?:dado|given)\b[\s\S]{0,240}?\b(?:cuando|when)\b[\s\S]{0,240}?\b(?:entonces|then)\b/i;

const EDGE_CASES_RE =
  /\bedge\s*cases?\b|\bcasos?\s+de\s+borde\b|\bcondici[oó]n\s+de\s+carrera\b|\bidempotenc/i;

function scoreSection5ForPrecisionBreakdown(
  md: string,
  complexity: EstimationComplexity,
): { score: number; reasons: string[] } {
  const body = (extractBestSection5Body(md) ?? "").trim();
  const reasons: string[] = [];
  const minLen = complexity === "HIGH" ? MIN_SECTION5_BODY_LENGTH_HIGH : 200;

  if (!body) {
    return { score: 0, reasons: ["§5 Lógica y Edge Cases ausente o no detectable en el MDD."] };
  }
  if (isMddSectionPipelinePlaceholderBody(body)) {
    return {
      score: 0,
      reasons: ["§5 es placeholder del pipeline (Pendiente: paso dedicado). Regenera §5."],
    };
  }

  const bodyLen = body.length;
  if (bodyLen < minLen) {
    reasons.push(`§5 muy breve (${bodyLen} chars; mínimo ${minLen}).`);
  }

  let score = 100;
  if (bodyLen < minLen) {
    score = Math.max(0, Math.round((bodyLen / minLen) * 50));
  } else if (bodyLen < 200) {
    score -= 15;
    reasons.push("§5 por debajo de longitud sustancial (~200 chars).");
  }

  if (!BDD_RULE_RE.test(body)) {
    score -= 25;
    reasons.push("Faltan reglas BDD/AAA (Dado/cuando/entonces o Given/When/Then).");
  }
  if (!EDGE_CASES_RE.test(body)) {
    score -= 15;
    reasons.push("No documenta edge cases explícitos (carrera, idempotencia, rollback, etc.).");
  }

  const tailIssue = evaluateSection5TailTruncation(body);
  if (tailIssue) {
    score -= 25;
    reasons.push(tailIssue);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), reasons };
}

/**
 * Desglose de precisión por sección/agente (0–100) para la tabla del chat.
 * Usa las mismas secciones y gaps que el semáforo; cada dimensión se penaliza según gaps que la afectan.
 * Si una sección está en traceabilityGaps.inconsistentSections, se capa a PRECISION_CAP_INCONSISTENTE.
 */
function computePrecisionBreakdown(md: string, complexity: EstimationComplexity = "HIGH"): PrecisionBreakdown {
  const sections = detectReferenceSections(md);
  const gaps = adjustGapsForEstimationComplexity(computeConsistencyGaps(md), complexity);
  const traceability = computeTraceabilityGaps(md);
  const inconsistentSet = new Set(traceability.inconsistentSections);
  const contextBlock = extractSection(md, /^#+\s*(?:1\.\s*)?(?:contexto\s+y\s+alcance|contexto\b)/im);
  // Frontend está dentro de §2 Arquitectura y Stack (subsección ### Frontend)
  const frontendBlock = extractSection(md, /^#+\s*(?:2\.\s*)?(?:arquitectura\s+y\s+stack|arquitectura\s+frontend|frontend)/im);

  const sectionStatus: PrecisionBreakdown["sectionStatus"] = {};
  if (inconsistentSet.size > 0) {
    for (const key of TRACEABILITY_SECTION_KEYS) {
      if (inconsistentSet.has(key)) sectionStatus[key] = "inconsistente";
    }
  }

  let contexto = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        100 -
          (gaps.contradictionGap ? 40 : 0) -
          (contextBlock.length < minSection1BodyLength(complexity) ? 30 : 0) -
          (!draftMeetsSection1Quality(md, complexity) ? 25 : 0),
      ),
    ),
  );
  if (inconsistentSet.has("contexto")) contexto = Math.min(contexto, PRECISION_CAP_INCONSISTENTE);

  let modeloDatos = Math.round(
    Math.max(
      0,
      Math.min(100, sections.db * 100 - gaps.mermaidParityGap * 25),
    ),
  );
  if (inconsistentSet.has("modeloDatos")) modeloDatos = Math.min(modeloDatos, PRECISION_CAP_INCONSISTENTE);

  let apiContracts = Math.round(
    Math.max(
      0,
      Math.min(100, sections.endpoints * 100 - (sections.endpointsWithPayloads ? 0 : 25)),
    ),
  );
  if (inconsistentSet.has("apiContracts")) apiContracts = Math.min(apiContracts, PRECISION_CAP_INCONSISTENTE);

  const frontend = Math.round(
    Math.max(0, Math.min(100, frontendBlock.length >= 80 ? 100 : frontendBlock.length >= 40 ? 50 : 0)),
  );
  let seguridad = Math.round(
    Math.max(
      0,
      Math.min(100, sections.security * 100 - gaps.securityCompletenessGap * 30 - gaps.securityEdgeCaseGap * 30),
    ),
  );
  if (inconsistentSet.has("seguridad")) seguridad = Math.min(seguridad, PRECISION_CAP_INCONSISTENTE);

  const integracion = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        sections.infra * 100 - gaps.missingManifest * 40 - gaps.contradictionGap * 30 - gaps.infraStackGap * 30,
      ),
    ),
  );

  const section5Breakdown = scoreSection5ForPrecisionBreakdown(md, complexity);
  const logicaEdgeCases = section5Breakdown.score;

  const sectionReasons: PrecisionBreakdown["sectionReasons"] = {};
  const trazaMsg =
    "Trazabilidad: concepto en Contexto sin ningún soporte en Modelo, API ni Seguridad (añade al menos uno o quítalo del contexto).";
  if (contextBlock.length < minSection1BodyLength(complexity)) {
    sectionReasons.contexto = "Sección §1 Contexto muy breve o sin subsecciones constitución.";
  }
  if (gaps.contradictionGap) sectionReasons.contexto = (sectionReasons.contexto ? sectionReasons.contexto + " " : "") + "Contradicción entre contexto e integración.";
  if (inconsistentSet.has("contexto")) sectionReasons.contexto = (sectionReasons.contexto ? sectionReasons.contexto + " " : "") + trazaMsg;

  const modeloReasons: string[] = [];
  if (gaps.mermaidParityGap) modeloReasons.push("Diagrama Mermaid no coincide con tablas SQL.");
  if (inconsistentSet.has("modeloDatos")) modeloReasons.push(trazaMsg);
  if (modeloReasons.length) sectionReasons.modeloDatos = modeloReasons.join(" ");

  const apiReasons: string[] = [];
  if (!sections.endpointsWithPayloads && sections.endpoints > 0) apiReasons.push("Faltan payloads (request/response) en endpoints.");
  if (inconsistentSet.has("apiContracts")) apiReasons.push(trazaMsg);
  if (apiReasons.length) sectionReasons.apiContracts = apiReasons.join(" ");

  if (frontend < 100 && frontendBlock.length < 80) sectionReasons.frontend = "Sección Frontend en §2 muy breve o ausente.";

  const segReasons: string[] = [];
  if (sections.security === 0) segReasons.push("§6 Seguridad no está presente en el MDD. La sección completa falta — debe generarse.");
  if (gaps.securityCompletenessGap) segReasons.push("Falta almacén de credenciales o columnas de auditoría (según doc).");
  if (gaps.securityEdgeCaseGap) segReasons.push("Lógica de bloqueo sin número de intentos definido en §6 Seguridad.");
  if (inconsistentSet.has("seguridad")) segReasons.push(trazaMsg);
  if (segReasons.length) sectionReasons.seguridad = segReasons.join(" ");

  const intReasons: string[] = [];
  if (gaps.missingManifest) intReasons.push("Falta manifest JSON o Technical Metadata en §7.");
  if (gaps.contradictionGap) intReasons.push("Contradicción contexto ↔ integración.");
  if (gaps.infraStackGap) intReasons.push("Stack (NestJS/Node) no reflejado en Infra (Dockerfile Node).");
  if (intReasons.length) sectionReasons.integracion = intReasons.join(" ");

  if (section5Breakdown.reasons.length > 0 && logicaEdgeCases < 100) {
    sectionReasons.logicaEdgeCases = section5Breakdown.reasons.join(" ");
  }

  return {
    contexto,
    modeloDatos,
    apiContracts,
    frontend,
    logicaEdgeCases,
    seguridad,
    integracion,
    ...(Object.keys(sectionStatus).length > 0 ? { sectionStatus } : {}),
    ...(Object.keys(sectionReasons).length > 0 ? { sectionReasons } : {}),
  };
}

function buildReadinessHints(
  md: string,
  precision: number,
  sections: ReturnType<typeof detectReferenceSections>,
  gaps: ReturnType<typeof computeConsistencyGaps>,
  cx: EstimationComplexity,
): string[] {
  const out: string[] = [];
  if (precision < 70) {
    out.push(
      "Prioriza §3 (modelo de datos) y §4 (API con payloads y códigos HTTP) antes de cascadas largas con IA.",
    );
  } else if (precision < PRECISION_GREEN_MIN) {
    out.push("Refuerza trazabilidad §2↔§7 y paridad Mermaid/SQL para subir efectividad en conformance y generación asistida.");
  }
  if (!sections.endpointsWithPayloads) {
    out.push("Contratos API: añade cuerpos JSON de request/response en los endpoints críticos.");
  }
  if (!sections.securitySubstantive) {
    out.push("Seguridad: documenta authN/Z, datos sensibles y amenazas; mejora la verificación con IA (checkbox conformance).");
  }
  if (gaps.contradictionGap > 0) {
    out.push("Elimina contradicciones entre secciones (reduce falsos positivos y retrabajo en OpenRouter).");
  }
  if (gaps.mermaidParityGap > 0) {
    out.push("Alinea diagrama ER con tablas SQL para desbloquear Blueprint ↔ §3 y Contratos API.");
  }
  if (cx === "HIGH" && sections.db > 0 && !sections.endpointsWithPayloads) {
    out.push("Alcance HIGH: sin payloads en API el semáforo suele quedar en amarillo aunque el MDD sea largo.");
  }
  if (md.length > 8000 && precision < 90) {
    out.push("MDD extenso: revisa señales duplicadas o tablas huérfanas que confunden al modelo.");
  }
  return out.slice(0, 6);
}

type StoredAuditorGaps = { gaps: AuditorGaps; auditedDraftHash?: string };

/**
 * Servicio de estimación en vivo, independiente del flujo LangChain.
 * Tasa interna 2026: $21k netos × 1.4 carga social ÷ 160 h/mes = $185 MXN/hr.
 * Llamable por GET /ai-analysis/estimation?projectId= o cuando el documento cambie en el front.
 */
@Injectable()
export class EstimationService {
  private readonly conformanceService = new ConformanceService();
  private readonly liveDraftByProject = new Map<string, string>();
  /**
   * Gaps del Auditor LLM + hash del borrador que evaluaron. Se usan sólo si el contenido evaluado
   * (override del editor, borrador en vivo o DB) tiene ese mismo hash; si cambió, caen a regex.
   */
  private readonly auditorGapsByProject = new Map<string, StoredAuditorGaps>();
  /** `projectId` o `projectId::stageId` → complejidad para semáforo/desglose (alineado con Workshop). */
  private readonly estimationComplexityByKey = new Map<string, EstimationComplexity>();
  private readonly complexityLoads = new Map<string, Promise<EstimationComplexity>>();

  constructor(private readonly prisma: PrismaService) { }

  /** Inicio de stream MDD o tras cargar proyecto: fija complejidad para `calculateLiveMetrics` sin pasarla en cada llamada. */
  cacheProjectComplexity(projectId: string, stageId: string | null | undefined, complexity: EstimationComplexity): void {
    const p = projectId?.trim();
    if (!p) return;
    this.estimationComplexityByKey.set(this.draftKey(p, stageId), complexity);
    // La complejidad es del proyecto: también como fallback para consultas sin etapa.
    this.estimationComplexityByKey.set(p, complexity);
  }

  /**
   * Resuelve (y cachea) `Project.complexity` desde Prisma cuando no está en caché.
   * Los callers asíncronos deben invocarlo antes del `calculateLiveMetrics` síncrono para no asumir HIGH.
   */
  async ensureProjectComplexity(projectId: string, stageId?: string | null): Promise<EstimationComplexity> {
    const p = projectId?.trim();
    if (!p) return "HIGH";
    const cached = this.lookupCachedComplexity(p, stageId);
    if (cached) return cached;
    let pending = this.complexityLoads.get(p);
    if (!pending) {
      pending = this.prisma.project
        .findUnique({ where: { id: p }, select: { complexity: true } })
        .then((proj) => {
          const cx = (proj?.complexity as EstimationComplexity | undefined) ?? "HIGH";
          this.cacheProjectComplexity(p, stageId, cx);
          return cx;
        })
        .finally(() => {
          this.complexityLoads.delete(p);
        });
      this.complexityLoads.set(p, pending);
    }
    return pending;
  }

  private lookupCachedComplexity(projectId: string, stageId?: string | null): EstimationComplexity | undefined {
    return (
      this.estimationComplexityByKey.get(this.draftKey(projectId, stageId)) ??
      this.estimationComplexityByKey.get(projectId)
    );
  }

  private resolveEstimationComplexity(options?: {
    complexity?: EstimationComplexity;
    projectId?: string;
    stageId?: string | null;
  }): EstimationComplexity {
    if (options?.complexity) return options.complexity;
    const pid = options?.projectId?.trim();
    if (!pid) return "HIGH";
    const cached = this.lookupCachedComplexity(pid, options?.stageId);
    if (cached) return cached;
    // Sin caché y API síncrona: HIGH sólo esta vez; precarga en segundo plano para las siguientes llamadas.
    try {
      void this.ensureProjectComplexity(pid, options?.stageId).catch(() => undefined);
    } catch {
      /* prisma no disponible (tests): se queda HIGH */
    }
    return "HIGH";
  }

  /** Clave de borrador/gaps: `projectId` o `projectId::stageId` si hay etapa explícita. */
  private draftKey(projectId: string, stageId?: string | null): string {
    const p = projectId?.trim() ?? "";
    const s = stageId?.trim();
    return s ? `${p}::${s}` : p;
  }

  setLiveDraft(projectId: string, mddDraft: string, stageId?: string | null): void {
    if (!projectId?.trim()) return;
    // Los gaps del Auditor no se borran aquí: el hash guardado hace que dejen de aplicar en cuanto el contenido cambia
    // (el stream re-registra el mismo `auditorGaps` en cada evento, y conserva su hash original).
    this.liveDraftByProject.set(this.draftKey(projectId, stageId), mddDraft ?? "");
  }

  /**
   * Almacena gaps estructurados del Auditor (LLM) junto con el hash del borrador evaluado.
   * `auditedDraftHash` explícito > hash previo si son los mismos gaps (re-registro del stream) > hash del borrador
   * en vivo > sin hash (se ata de forma perezosa al contenido del servidor en la primera lectura).
   * `gaps == null` los elimina.
   */
  setAuditorGaps(
    projectId: string,
    gaps: AuditorGaps | undefined,
    stageId?: string | null,
    auditedDraftHash?: string,
  ): void {
    if (!projectId?.trim()) return;
    const key = this.draftKey(projectId, stageId);
    if (gaps == null) {
      this.auditorGapsByProject.delete(key);
      return;
    }
    const prev = this.auditorGapsByProject.get(key);
    const sameGapsAsPrev = prev != null && JSON.stringify(prev.gaps) === JSON.stringify(gaps);
    const live = this.liveDraftByProject.get(key);
    const hash =
      auditedDraftHash ??
      (sameGapsAsPrev ? prev.auditedDraftHash : undefined) ??
      (live != null && live.trim().length > 0 ? hashMddDraft(live) : undefined);
    this.auditorGapsByProject.set(key, { gaps, ...(hash ? { auditedDraftHash: hash } : {}) });
  }

  /**
   * Tras persistir el MDD final de un job ya auditado (`prevalidatedFromStream`): los gaps describen el contenido
   * persistido aunque el sanitizado haya cambiado espacios/formato → reata el hash.
   */
  rebindAuditorGapsToPersistedContent(projectId: string, stageId: string | null | undefined, content: string): void {
    if (!projectId?.trim()) return;
    const entry = this.auditorGapsByProject.get(this.draftKey(projectId, stageId));
    if (entry && content.trim()) entry.auditedDraftHash = hashMddDraft(content);
  }

  /** PATCH manual del MDD: si el contenido persistido no es el que auditó el Auditor, los gaps ya no aplican. */
  dropAuditorGapsIfContentChanged(projectId: string, stageId: string | null | undefined, content: string): void {
    if (!projectId?.trim()) return;
    const key = this.draftKey(projectId, stageId);
    const entry = this.auditorGapsByProject.get(key);
    if (!entry) return;
    if (!entry.auditedDraftHash || entry.auditedDraftHash !== hashMddDraft(content)) {
      this.auditorGapsByProject.delete(key);
    }
  }

  /** Persiste audit trail / breakdown / gaps del último pipeline MDD en `Stage.shortTermContext`. */
  async saveMddAuditSnapshot(
    projectId: string,
    stageId: string | null | undefined,
    snapshot: Omit<MddAuditSnapshot, "updatedAt">,
  ): Promise<void> {
    const sid = await this.resolveStageId(projectId, stageId);
    if (!sid) return;
    const stage = await this.prisma.stage.findUnique({
      where: { id: sid },
      select: { shortTermContext: true, mddContent: true },
    });
    const prev =
      stage?.shortTermContext && typeof stage.shortTermContext === "object" && !Array.isArray(stage.shortTermContext)
        ? (stage.shortTermContext as Record<string, unknown>)
        : {};
    const auditedDraftHash = snapshot.auditorGaps
      ? (snapshot.auditedDraftHash ?? this.resolveAuditedDraftHash(projectId, stageId, snapshot.auditorGaps, stage?.mddContent))
      : undefined;
    await this.prisma.stage.update({
      where: { id: sid },
      data: {
        shortTermContext: {
          ...prev,
          mddAuditSnapshot: {
            ...snapshot,
            ...(auditedDraftHash ? { auditedDraftHash } : {}),
            updatedAt: new Date().toISOString(),
          },
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Hash del borrador que evaluó el Auditor cuando el caller no lo pasa: el de los mismos gaps en memoria,
   * si no el del borrador en vivo (stream) y, para auditorías manuales, el del MDD persistido de la etapa.
   */
  private resolveAuditedDraftHash(
    projectId: string,
    stageId: string | null | undefined,
    gaps: AuditorGaps,
    persistedMdd: string | null | undefined,
  ): string | undefined {
    const key = this.draftKey(projectId, stageId);
    const mem = this.auditorGapsByProject.get(key);
    if (mem?.auditedDraftHash && JSON.stringify(mem.gaps) === JSON.stringify(gaps)) return mem.auditedDraftHash;
    const live = this.liveDraftByProject.get(key);
    if (live != null && live.trim().length > 0) return hashMddDraft(live);
    if (persistedMdd && persistedMdd.trim().length > 0) return hashMddDraft(persistedMdd);
    return undefined;
  }

  /** Recupera el último snapshot de auditoría MDD persistido. */
  async getMddAuditSnapshot(
    projectId: string,
    stageId?: string | null,
  ): Promise<MddAuditSnapshot | null> {
    const sid = await this.resolveStageId(projectId, stageId);
    if (!sid) return null;
    const stage = await this.prisma.stage.findUnique({
      where: { id: sid },
      select: { shortTermContext: true },
    });
    const ctx = stage?.shortTermContext;
    if (!ctx || typeof ctx !== "object" || Array.isArray(ctx)) return null;
    const snap = (ctx as Record<string, unknown>).mddAuditSnapshot;
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) return null;
    return snap as MddAuditSnapshot;
  }

  private async resolveStageId(
    projectId: string,
    stageId?: string | null,
  ): Promise<string | null> {
    const pid = projectId?.trim();
    if (!pid) return null;
    if (stageId?.trim()) return stageId.trim();
    const project = await this.prisma.project.findUnique({
      where: { id: pid },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    return pickPrimaryStage(project?.stages ?? [])?.id ?? null;
  }

  clearLiveDraft(projectId: string, stageId?: string | null): void {
    if (!projectId?.trim()) return;
    this.liveDraftByProject.delete(this.draftKey(projectId, stageId));
  }

  async getMddContentForProject(projectId: string, stageId?: string | null): Promise<string | null> {
    const key = this.draftKey(projectId, stageId);
    const live = this.liveDraftByProject.get(key);
    if (live != null && live.trim().length > 0) return live;
    const legacyOnly = projectId?.trim() ?? "";
    if (stageId?.trim()) {
      const legacy = this.liveDraftByProject.get(legacyOnly);
      if (legacy != null && legacy.trim().length > 0) return legacy;
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId?.trim() },
      include: { stages: { orderBy: { ordinal: "asc" } } },
    });
    const stages = project?.stages ?? [];
    if (stageId?.trim()) {
      const st = stages.find((s) => s.id === stageId.trim());
      return st?.mddContent ?? null;
    }
    const stage = pickPrimaryStage(stages);
    return stage?.mddContent ?? null;
  }

  /**
   * Gaps del Auditor aplicables a `content`: sólo si el hash normalizado del contenido evaluado coincide con el del
   * borrador que auditó el Auditor (memoria o snapshot persistido). Sin gaps vigentes → `undefined` (regex).
   * Nunca lee la clave legacy `projectId` cuando hay `stageId` (evita cruzar etapas).
   */
  /** Gaps del Auditor para sync persistido (API pública para `StageSemaphoreSyncService`). */
  async resolveAuditorGapsForPersisted(
    projectId: string,
    stageId: string,
    content: string,
  ): Promise<AuditorGaps | undefined> {
    return this.resolveAuditorGapsForContent(projectId, stageId, content, false);
  }

  private async resolveAuditorGapsForContent(
    projectId: string,
    stageId: string | null | undefined,
    content: string,
    hasOverride: boolean,
  ): Promise<AuditorGaps | undefined> {
    if (!content.trim()) return undefined;
    const key = this.draftKey(projectId, stageId);
    const contentHash = hashMddDraft(content);
    let serverHashPromise: Promise<string> | undefined;
    /** Hash del contenido que el servidor tiene (en vivo o DB); el override sólo "es el servidor" si coincide. */
    const matchesServerContent = async (): Promise<boolean> => {
      if (!hasOverride) return true;
      serverHashPromise ??= this.getMddContentForProject(projectId, stageId).then((c) => hashMddDraft(c ?? ""));
      return (await serverHashPromise) === contentHash;
    };

    const entry = this.auditorGapsByProject.get(key);
    if (entry) {
      if (entry.auditedDraftHash) {
        if (entry.auditedDraftHash === contentHash) return entry.gaps;
      } else if (await matchesServerContent()) {
        // Gaps sin hash (callers que no lo pasan): describen el contenido del servidor → se atan al primer match.
        entry.auditedDraftHash = contentHash;
        return entry.gaps;
      }
    }
    const snap = await this.getMddAuditSnapshot(projectId, stageId);
    if (snap?.auditorGaps) {
      if (snap.auditedDraftHash) {
        if (snap.auditedDraftHash === contentHash) return snap.auditorGaps;
      } else if (await matchesServerContent()) {
        return snap.auditorGaps;
      }
    }
    return undefined;
  }

  /**
   * Métricas para un proyecto. Si se pasa mddContent, se usa ese; sino liveDraft o DB.
   * Los gaps del Auditor (memoria o snapshot) se usan si su `auditedDraftHash` coincide con el contenido evaluado
   * (también con override del editor); si no, se cae a regex y `mddQualitySource` queda en "regex".
   * No escribe en BD (RF-12). La persistencia del color vive en `StageSemaphoreSyncService`.
   */
  async getLiveMetricsForProject(
    projectId: string,
    mddContentOverride?: string,
    stageId?: string | null,
    _options?: {
      /**
       * @deprecated La escritura de etapa vive en `StageSemaphoreSyncService`.
       */
      syncStage?: boolean;
    },
  ): Promise<LiveMetricsResult> {
    const key = this.draftKey(projectId, stageId);
    const liveDraft = this.liveDraftByProject.get(key);
    const hasLiveDraft = (liveDraft?.trim().length ?? 0) > 0;
    const hasOverride = mddContentOverride != null && mddContentOverride.length > 0;
    const content = hasOverride
      ? mddContentOverride
      : (await this.getMddContentForProject(projectId, stageId)) ?? "";
    const auditorGaps = await this.resolveAuditorGapsForContent(projectId, stageId, content, hasOverride);
    const proj = await this.prisma.project.findUnique({
      where: { id: projectId.trim() },
      select: { complexity: true, projectType: true },
    });
    const cx = (proj?.complexity as EstimationComplexity) ?? "HIGH";
    this.cacheProjectComplexity(projectId, stageId, cx);

    // Cargar documentos de etapa + proyecto para métrica integral
    let documents: PlanningDocumentFields = {};
    let stageRow: {
      brdContent: string | null;
      designSpec: unknown;
      architectureGraph: unknown;
      architectureGraphSourceHash: string | null;
    } | null = null;
    const sid = stageId?.trim();
    if (sid) {
      stageRow = await this.prisma.stage.findUnique({
        where: { id: sid },
        select: {
          brdContent: true,
          designSpec: true,
          architectureGraph: true,
          architectureGraphSourceHash: true,
        },
      });
      if (stageRow) {
        documents = {
          brdContent: stageRow.brdContent ?? undefined,
        };
      }
    }
    let projectRec: {
      projectType: string;
      specContent: string | null;
      dbgaContent: string | null;
      architectureContent: string | null;
      useCasesContent: string | null;
      userStoriesContent: string | null;
      blueprintContent: string | null;
      apiContractsContent: string | null;
      logicFlowsContent: string | null;
      infraContent: string | null;
      tasksContent: string | null;
      complexity: string | null;
      uxUiGuideContent: string | null;
      hasUxTeam: boolean | null;
      approach: string | null;
    } | null = null;
    try {
      projectRec = await this.prisma.project.findUnique({
        where: { id: projectId.trim() },
        select: {
          projectType: true,
          complexity: true,
          specContent: true,
          dbgaContent: true,
          architectureContent: true,
          useCasesContent: true,
          userStoriesContent: true,
          blueprintContent: true,
          apiContractsContent: true,
          logicFlowsContent: true,
          infraContent: true,
          tasksContent: true,
          uxUiGuideContent: true,
          hasUxTeam: true,
          approach: true,
        },
      });
      if (projectRec) {
        documents = {
          ...documents,
          mddContent: content || undefined,
          specContent: (projectRec as { specContent?: string | null }).specContent ?? documents.specContent,
          architectureContent:
            (projectRec as { architectureContent?: string | null }).architectureContent ??
            documents.architectureContent,
          useCasesContent:
            (projectRec as { useCasesContent?: string | null }).useCasesContent ?? documents.useCasesContent,
          userStoriesContent:
            (projectRec as { userStoriesContent?: string | null }).userStoriesContent ??
            documents.userStoriesContent,
          blueprintContent:
            (projectRec as { blueprintContent?: string | null }).blueprintContent ?? documents.blueprintContent,
          apiContractsContent:
            (projectRec as { apiContractsContent?: string | null }).apiContractsContent ??
            documents.apiContractsContent,
          logicFlowsContent:
            (projectRec as { logicFlowsContent?: string | null }).logicFlowsContent ??
            documents.logicFlowsContent,
          infraContent:
            (projectRec as { infraContent?: string | null }).infraContent ?? documents.infraContent,
          tasksContent:
            (projectRec as { tasksContent?: string | null }).tasksContent ?? documents.tasksContent,
        };
      }
    } catch {
      // no-op
    }
    if (!documents.mddContent && content) {
      documents = { ...documents, mddContent: content };
    }

    const semaphoreSource: SemaphoreSource =
      hasOverride || hasLiveDraft ? "draft" : "persisted";

    let designScreenCount: number | undefined;
    if (projectRec && isDesignFirst(projectRec.projectType as import("@theforge/shared-types").ProjectType)) {
      designScreenCount = parseDesignSpec(stageRow?.designSpec ?? EMPTY_DESIGN_SPEC).screens.length;
    }

    const result = this.calculateLiveMetrics(content, {
      auditorGaps,
      complexity: cx,
      projectId: projectId.trim(),
      stageId: stageId ?? null,
      documents,
      semaphoreSource,
      designScreenCount,
      project: (projectRec ?? undefined) as BuildSemaphoreInputsParams["project"],
      stage: (stageRow ?? undefined) as BuildSemaphoreInputsParams["stage"],
    });

    const syncStageId = await this.resolveStageId(projectId, stageId);
    if (syncStageId) {
      const stageCtxRow = await this.prisma.stage.findUnique({
        where: { id: syncStageId },
        select: { shortTermContext: true },
      });
      const ctx = (stageCtxRow?.shortTermContext ?? {}) as {
        semaphoreSync?: { inputsHash?: string };
      };
      const persistedHash = ctx.semaphoreSync?.inputsHash;
      const liveHash = buildSemaphoreInputsFromLoaded(this.conformanceService, {
        projectId: projectId.trim(),
        stageId: syncStageId,
        content,
        source: semaphoreSource,
        complexity: cx,
        auditorGaps,
        documents,
        project: (projectRec ?? undefined) as BuildSemaphoreInputsParams["project"],
        stage: (stageRow ?? undefined) as BuildSemaphoreInputsParams["stage"],
      }).inputsHash;
      if (persistedHash && liveHash && persistedHash !== liveHash) {
        result.persistedStale = true;
      }
    }

    return result;
  }

  /** Evalúa métricas de stream con `source:'stream'` (paridad con el panel POST persistido). */
  evaluateForStream(
    mddContext: MDDContext,
    options?: Parameters<EstimationService["calculateLiveMetrics"]>[1],
  ): LiveMetricsResult {
    return this.calculateLiveMetrics(mddContext, {
      ...options,
      semaphoreSource: "stream",
    });
  }

  /** Desglose por sección/agente (0–100) para mostrar en la tabla del chat tras auditar. */
  getPrecisionBreakdown(
    md: string,
    options?: { complexity?: EstimationComplexity; projectId?: string; stageId?: string | null },
  ): PrecisionBreakdown {
    const cx = this.resolveEstimationComplexity(options);
    return computePrecisionBreakdown((md ?? "").trim(), cx);
  }

  /**
   * Reporte de gaps en lenguaje natural. Si se pasan auditorGaps (del Auditor LLM), se usan; si no, fallback a regex.
   */
  getGapsReport(md: string, auditorGaps?: AuditorGaps): string[] {
    if (auditorGaps) {
      const messages: string[] = [];
      for (const g of auditorGaps.critical_gaps) {
        messages.push(`[${g.sections.join(", ")}] ${g.issue} Corrección: ${g.fix}`);
      }
      for (const e of auditorGaps.syntax_errors) messages.push(e);
      return messages;
    }
    const trimmed = (md ?? "").trim();
    if (!trimmed) return [];
    const traceability = computeTraceabilityGaps(trimmed);
    const contract = computeContractGaps(trimmed);
    const messages: string[] = [];
    if (traceability.inconsistentSections.length > 0) {
      messages.push("Trazabilidad MFA: Contexto menciona MFA pero falta tablas de secretos en Modelo de Datos, endpoint /verify o /totp en Contratos de API, o algoritmo TOTP en Seguridad.");
    }
    if (contract.mermaidParityGap) {
      messages.push("El diagrama Mermaid (erDiagram) tiene entidades o atributos que no existen en el SQL; no se permiten abreviaturas.");
    }
    if (contract.infraStackGap) {
      messages.push("El stack (NestJS/Node) en Arquitectura debe reflejarse en Infraestructura (Dockerfile compatible con Node.js).");
    }
    if (contract.securityEdgeCaseGap) {
      messages.push("Lógica menciona bloqueo de cuenta pero Seguridad debe definir el número de intentos.");
    }
    return messages;
  }

  /**
   * Calcula métricas en vivo a partir del MDD. Si options.auditorGaps está presente (evaluación del Auditor LLM),
   * se usan score e infrastructure_ready para precisión y semáforo; si no, se usa lógica por regex.
   */
  calculateLiveMetrics(
    mddContext: MDDContext,
    options?: {
      auditorGaps?: AuditorGaps;
      complexity?: EstimationComplexity;
      projectId?: string;
      stageId?: string | null;
      documents?: PlanningDocumentFields;
      designScreenCount?: number;
      semaphoreSource?: SemaphoreSource;
      project?: Parameters<typeof buildSemaphoreInputsFromLoaded>[1]["project"];
      stage?: Parameters<typeof buildSemaphoreInputsFromLoaded>[1]["stage"];
    },
  ): LiveMetricsResult {
    const raw =
      typeof mddContext === "string"
        ? mddContext
        : (mddContext as { mddContent?: string })?.mddContent ?? "";
    const md = raw?.trim() ?? "";

    const cx = this.resolveEstimationComplexity(options);
    const docs = options?.documents;
    const hasDocs = docs && Object.values(docs).some((v) => String(v ?? "").trim().length > 0);
    const documents: PlanningDocumentFields =
      hasDocs && docs ? { ...docs, mddContent: docs.mddContent ?? md } : { mddContent: md };

    const built = buildSemaphoreInputsFromLoaded(this.conformanceService, {
      projectId: options?.projectId?.trim() ?? "synthetic",
      stageId: options?.stageId,
      content: md,
      source: options?.semaphoreSource ?? "stream",
      complexity: cx,
      auditorGaps: options?.auditorGaps,
      documents,
      project: options?.project,
      stage: options?.stage,
    });

    const { verdict, deliveryGateResult } = built;
    const status = verdict.status as SemaphoreStatusLive;
    const mddQualityScore = verdict.components.mddQuality;
    const consistencyScore = verdict.components.consistency ?? undefined;
    const mddQualitySource: "auditor" | "regex" =
      verdict.headlineSource === "auditor" ? "auditor" : "regex";
    const auditorScore =
      verdict.headlineSource === "auditor" ? verdict.headline : undefined;

    let completeness: DocumentCompleteness | undefined;
    if (hasDocs) {
      completeness = computeDocumentCompleteness(documents);
    } else {
      const phase = resolveCompletenessPhase(verdict.derivativesState);
      const profile = built.evaluateInput.profile;
      const overall = computeCompletenessScore(built.evaluateInput.documents, phase, profile);
      completeness = { overall, mddContent: overall } as DocumentCompleteness;
    }

    const consistency = hasDocs ? computeCrossDocumentConsistency(documents) : { gaps: [] as const, score: consistencyScore ?? 50 };
    const traceabilityHints =
      consistency.gaps.length > 0
        ? consistency.gaps.slice(0, 8).map((g) => g.hint ?? `[BRD→${g.to}] ${g.concept}`)
        : [];
    const crossDocumentGaps = consistency.gaps.length > 0 ? consistency.gaps : undefined;

    let mddReadinessHints: string[] = [];
    try {
      const sections = detectReferenceSections(md);
      const gaps = adjustGapsForEstimationComplexity(computeConsistencyGaps(md), cx);
      mddReadinessHints = buildReadinessHints(md, mddQualityScore, sections, gaps, cx).slice(0, 5);
    } catch {
      mddReadinessHints = [];
    }
    if (options?.auditorGaps?.critical_gaps?.length) {
      mddReadinessHints = options.auditorGaps.critical_gaps
        .slice(0, 5)
        .map((x) => `[${(x.sections ?? []).join(" · ")}] ${x.issue}`);
    }

    const readinessHints = mddReadinessHints;

    const { entityCount, screenCount: parsedScreens, extraEndpointCount } = countCostDrivers(md);
    const screenCount = options?.designScreenCount ?? parsedScreens;
    const metaTags = extractTechnicalMetadataTags(md);
    const costStatus =
      status === "green" ? ("VERDE" as const) : status === "yellow" ? ("AMARILLO" as const) : ("ROJO" as const);
    const cost = computeCostEstimation({
      entityCount,
      screenCount,
      extraEndpointCount,
      metadataTags: metaTags,
      infraFixedHours: 0,
      status: costStatus,
    });
    const totalHours = cost.totalHours;
    const roles = cost.teamStructure as Record<string, number>;
    const rolesHours = cost.rolesHours;
    const totalMXN = cost.totalMxn;
    const totalMXNMarket = cost.referenceSaleMxn;
    // Costo IA: tokens de salida estimados a $1/M tokens, convertido a MXN
    const totalAITokens =
      AI_BASE_OVERHEAD_TOKENS +
      entityCount * AI_TOKENS_PER_ENTITY +
      screenCount * AI_TOKENS_PER_SCREEN +
      extraEndpointCount * AI_TOKENS_PER_ENDPOINT;
    const totalMXNIA = Math.round(totalAITokens * AI_COST_PER_TOKEN_USD * MXN_PER_USD * 100) / 100;

    return {
      semaphore: verdict,
      precision: verdict.headline,
      totalMXN,
      totalMXNMarket,
      totalMXNIA,
      totalHours: Math.round(totalHours * 100) / 100,
      roles,
      rolesHours,
      status,
      readinessHints,
      mddReadinessHints,
      traceabilityHints,
      ...(consistencyScore != null ? { consistencyScore } : {}),
      ...(completeness != null ? { completeness } : {}),
      ...(mddQualityScore != null ? { mddQualityScore } : {}),
      mddQualitySource,
      ...(auditorScore != null ? { auditorScore } : {}),
      ...(crossDocumentGaps && crossDocumentGaps.length > 0
        ? { crossDocumentGaps: [...crossDocumentGaps] }
        : {}),
      deliveryGate: deliveryGateResult,
    };
  }

}

export { buildSemaphoreInputsFromLoaded, resolveSemaphoreProfile } from "./semaphore-inputs.factory.js";
export type { BuildSemaphoreInputsParams, BuiltSemaphoreInputs } from "./semaphore-inputs.factory.js";

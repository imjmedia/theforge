import {
  formatDocumentMarkdown,
  peelDocumentBodyForPersist,
  repairApiContractJsonFences,
  repairApiResponse204NoContent,
  repairCollapsedPipeTables,
  repairGluedMarkdownHeadings,
  repairOrphanFenceBeforeContractLabels,
  repairUnclosedJsonBeforeApiEndpoint,
} from "@theforge/shared-types";
import {
  ensureMddGovernanceSection,
  extractGovernanceSection,
  hasGovernanceSection,
  selectedPatternIdsFromMdd,
  updateMddGovernancePatterns,
} from "@theforge/shared-types/mdd-governance-patterns";
import { applyMddQualityAutoRepairs } from "../../../engine/mdd-quality-audit.util.js";
import { sanitizeMermaidInDraft } from "../../../engine/mdd-pre-render.js";
import { extractMddSectionBody } from "./section-body.util.js";
import {
  deduplicateAndReorderMddSections,
  ensureMissingCanonicalSections,
  extractContextSectionBody,
  replaceContextSectionBody,
  fixGluedSection6Heading,
  mddHasDuplicateSectionHeadings,
  normalizeCanonicalMddSectionHeadings,
  reattachMddUiUxDesignIntentSuffix,
  repairMisplacedCanonicalSectionsAfterUiUx,
  replaceContextWhenInstructions,
  splitMddUiUxDesignIntentSuffix,
  stripTrailingDuplicateMddSections,
} from "./section-merge.js";
import {
  fixDoubleMermaidFences,
  fixSection2UnclosedSqlAndGluedMermaid,
  repairMermaidBlocksInSectionBody,
  unescapeMermaidLiteralNewlines,
} from "./mermaid-fences.js";
import { sanitizeAllSqlBlocksInDraft } from "./sql-repair.js";
import {
  closeUnclosedCodeFencesInDraft,
  collapseConsecutiveHorizontalRules,
  collapseInlineHorizontalRules,
  demoteProseHeadingsInSectionBody,
  finalizeMddPersistFormatting,
  stripEmptyBareCodeFences,
  stripOrphanFenceWrappingProse,
  stripStrayBraceAfterJsonCodeBlocks,
  stripStrayParenAfterJsonCodeBlocks,
  stripStrayParenBeforeH2,
  ensureHorizontalRuleBeforeH2,
} from "./persist-format.util.js";
import {
  formatContratosBody,
  repairDisplacedJsonBracesInContratos,
  repairNestedJsonFencesInDraft,
} from "./contratos-format.js";
import {
  CANONICAL_HEADINGS,
  collapseDuplicateMainTitle,
  forceStripBrokenPrefix,
  normalizeMddEnglishSubheadings,
  sanitizeContextSection,
  sanitizeSeguridadIntegracionRawJson,
  stripBrokenMetadataDocumentBlock,
  stripInstructionAndFeedbackBlocks,
  stripMeshDirectivesFromDraft,
  stripUserResponsesAndConversationHistory,
  unescapeLiteralNewlines,
} from "./draft-normalize.js";
import {
  alignInfraNodeVersionWithSection2,
  applyDeterministicCrossConsistencyFixes,
  deduplicateUatSections,
  ensureSecurityLockoutInSection6,
  fixDeterministicMddCoherence,
} from "./cross-consistency.js";
import { replaceAwsProseWithGenericWhenInfraNotAws } from "./infra-manifest.js";
import {
  ensureManifestInJsonBlock,
  ensureSection2SqlBlockClosed,
  ensureSection2SqlFormattedInSection,
  ensureTechnicalMetadataAtEndOfSection2,
  fixSection6BulletedJsonToMarkdown,
  convertSection2JsonBodyToMarkdown,
  stripNotaPendienteHeadingWhenManifestComplete,
  unwrapSection2SqlBlockContainingJson,
  ensureTechnicalMetadataBlockInDraft,
  mddExcludesWebUiSurface,
} from "./internal.js";

function repairDisplacedJsonBracesInContratosSection(draft: string): string {
  const heading = "## 4. Contratos de API";
  const idx = draft.indexOf(heading);
  if (idx === -1) return draft;
  const sectionStart = idx + heading.length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const fixed = repairDisplacedJsonBracesInContratos(body);
  if (fixed === body) return draft;
  return draft.slice(0, sectionStart) + fixed + (nextH2 !== -1 ? rest.slice(nextH2) : "");
}


function fixSecuritySectionBullets(sectionBody: string): string {
  if (!sectionBody || typeof sectionBody !== "string") return sectionBody;
  return sectionBody
    .replace(/^-\s*##\s*6\.\s*Seguridad\s*$/gim, "")
    .replace(/^-\s*(6\.\d+\s+[^\n]*)$/gm, "### $1")
    .replace(/^-\s*\.\s+([^:\n]+):?\s*$/gm, "### $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripStandaloneArquitecturaFrontendSection(draft: string): string {
  const re = /\n##\s+4\.\s*Arquitectura\s+Frontend\b[^\n]*/gi;
  const match = re.exec(draft);
  if (!match || match.index == null) return draft;
  const start = match.index + 1;
  const afterHeading = start + match[0].length;
  const rest = draft.slice(afterHeading);
  const nextH2 = rest.search(/\n##\s+/);
  const end = nextH2 !== -1 ? afterHeading + nextH2 : draft.length;
  const before = draft.slice(0, start).replace(/\n*---\s*\n*$/, "\n");
  const after = draft.slice(end).replace(/^\n*---\s*\n*/, "\n");
  return (before + after).trim();
}

function stripRedundantIntegracionHeadingInSection7(draft: string): string {
  const match = draft.match(/\n(##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b[^\n]*)/i);
  if (!match || match.index == null) return draft;
  const sectionStart = match.index + match[0].length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const fixed = body.replace(/^\s*###\s+Integración\s*\n+/i, "### Resumen\n\n");
  if (fixed === body) return draft;
  return draft.slice(0, sectionStart) + fixed + (nextH2 !== -1 ? rest.slice(nextH2) : "");
}

function collapseDuplicateManifestHeadings(draft: string): string {
  const match = draft.match(/\n(##\s+(?:7\.\s+)?(?:Infraestructura|Integración)\b[^\n]*)/i);
  if (!match || match.index == null) return draft;
  const sectionStart = match.index + match[0].length;
  const rest = draft.slice(sectionStart);
  const nextH2 = rest.search(/\n##\s+/);
  const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
  const repeated = /(\n###\s*(?:\d+\.\d+\s+)?Manifest(?:\s+de\s+Infraestructura)?\s*\n*)+/gi;
  const collapsed = body.replace(repeated, "\n\n### Manifest de Infraestructura\n\n");
  if (collapsed === body) return draft;
  const newRest = collapsed + (nextH2 !== -1 ? rest.slice(nextH2) : "");
  return draft.slice(0, sectionStart) + newRest;
}


export function applyPreDeliveryGateFixes(draft: string): string {
  let out = repairMisplacedCanonicalSectionsAfterUiUx(normalizeCanonicalMddSectionHeadings(draft ?? ""));
  out = alignInfraNodeVersionWithSection2(out);
  out = repairNestedJsonFencesInDraft(out);
  out = repairDisplacedJsonBracesInContratosSection(out);
  out = closeUnclosedCodeFencesInDraft(out);
  out = repairManifestJsonClosing(out);
  out = stripStrayParenAfterJsonCodeBlocks(out);
  out = stripStrayBraceAfterJsonCodeBlocks(out);
  out = applyMddQualityAutoRepairs(out).markdown;
  out = applyDeterministicCrossConsistencyFixes(out);
  out = repairGluedMarkdownHeadings(out);
  out = repairCollapsedPipeTables(out);
  out = sanitizeMermaidInDraft(out);
  out = ensureTechnicalMetadataBlockInDraft(out);
  if (mddHasDuplicateSectionHeadings(out)) {
    out = stripTrailingDuplicateMddSections(out);
    if (mddHasDuplicateSectionHeadings(out)) {
      out = deduplicateAndReorderMddSections(out);
    }
  }
  out = deduplicateUatSections(out);
  return out;
}

export function demoteProseHeadingsInSections(draft: string): string {
  let out = draft;
  for (const heading of ["## 4. Contratos de API", "## 6. Seguridad", "## 7. Infraestructura"]) {
    const section = extractMddSectionBody(out, heading);
    if (!section) continue;
    const fixed = demoteProseHeadingsInSectionBody(section.body);
    if (fixed !== section.body) {
      out = out.slice(0, section.start) + fixed + out.slice(section.end);
    }
  }
  return out;
}

export function stripUiUxSectionForApiOnlyMvp(markdown: string): string {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed || !/##\s*UI\/UX\s+Design\s+Intent/i.test(trimmed)) return markdown;
  if (!mddExcludesWebUiSurface(trimmed)) return markdown;
  return `${trimmed.replace(/\n##\s*UI\/UX\s+Design\s+Intent[\s\S]*$/i, "").trimEnd()}\n`;
}

export function repairGarbageHeadings(draft: string): string {
  if (!draft) return draft;
  let text = draft.replace(/^#\s+([A-ZÁÉÍÓÚÑ][^\n#]{40,})$/gm, "$1");
  text = text.replace(/^#\s+(_[^\n]+_\.?)\s*$/gm, "$1");
  text = text.replace(/^#\s+(_[^\n]+)$/gm, "$1");
  const lines = text.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    // Bare "#" alone
    if (/^#\s*$/.test(t)) continue;
    // "# ---" or "# --- --- ---" (horizontal rule rendered as heading)
    if (/^#\s+[-\s]*-[-\s]*-[-\s]*[-\s]*$/.test(t)) continue;
    // "### Heading.**Label:**" — heading glued to bold label (already split by repairGluedApiContractLines)
    // but if the heading text is just punctuation, skip
    if (/^#{1,6}\s+[.\-_=]{1,3}\s*$/.test(t)) continue;
    out.push(lines[i]!);
  }
  return out.join("\n");
}

export function repairManifestJsonClosing(draft: string): string {
  const manifestIdx = draft.indexOf("### Manifest");
  if (manifestIdx === -1) return draft;
  const section7Idx = draft.indexOf("## 7.");
  if (section7Idx === -1 || manifestIdx < section7Idx) {
    // Manifest is in §7 area
  }
  // Find the ```json block after ### Manifest
  const jsonFenceStart = draft.indexOf("```json", manifestIdx);
  if (jsonFenceStart === -1) return draft;
  const fenceClose = draft.indexOf("```", jsonFenceStart + 7);
  if (fenceClose === -1) return draft;
  const inner = draft.slice(jsonFenceStart + 7, fenceClose).trim();
  if (!inner) return draft;
  // Count brace balance
  let braces = 0;
  let inString = false;
  let escape = false;
  for (const ch of inner) {
    if (escape) { escape = false; continue; }
    if (inString) { if (ch === "\\") escape = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") braces++;
    if (ch === "}") braces--;
  }
  if (braces <= 0) return draft;
  // Add missing closing braces
  const closingBraces = "}".repeat(braces);
  const before = draft.slice(0, fenceClose);
  const after = draft.slice(fenceClose);
  // Also strip any garbage between last `}` and the fence close
  const lastBrace = before.lastIndexOf("}");
  const cleaned = before.slice(0, lastBrace + 1) + closingBraces + "\n" + after;
  return cleaned;
}

export function sanitizeMddAtPersist(mddMarkdown: string): string {
  if (!mddMarkdown?.trim()) return mddMarkdown;
  let out = fixGluedSection6Heading(mddMarkdown);
  out = repairGarbageHeadings(out);
  out = stripOrphanFenceWrappingProse(out);
  out = stripEmptyBareCodeFences(out);
  out = closeUnclosedCodeFencesInDraft(out);
  out = demoteProseHeadingsInSections(out);
  out = applyDeterministicCrossConsistencyFixes(out);
  out = ensureSecurityLockoutInSection6(out);
  out = repairNestedJsonFencesInDraft(out);
  out = repairDisplacedJsonBracesInContratosSection(out);
  out = repairManifestJsonClosing(out);
  out = stripStrayParenAfterJsonCodeBlocks(out);
  out = stripStrayBraceAfterJsonCodeBlocks(out);
  out = stripStrayParenBeforeH2(out);
  out = collapseInlineHorizontalRules(out);
  out = stripUiUxSectionForApiOnlyMvp(out);
  return finalizeMddPersistFormatting(out);
}

export function prepareMddMarkdownForPersist(mddMarkdown: string): string {
  if (!mddMarkdown?.trim()) return mddMarkdown;
  const preservedGov = extractGovernanceSection(mddMarkdown);
  const lockedPatternIds = selectedPatternIdsFromMdd(mddMarkdown);
  let body = normalizeCanonicalMddSectionHeadings(mddMarkdown);
  body = peelDocumentBodyForPersist(body);
  let formatted = formatDocumentMarkdown(body);
  let sanitized = sanitizeMddAtPersist(formatted);
  formatted = formatDocumentMarkdown(sanitized);
  if (lockedPatternIds.size > 0) {
    formatted = updateMddGovernancePatterns(formatted, lockedPatternIds);
  } else if (preservedGov && !hasGovernanceSection(formatted)) {
    formatted = ensureMddGovernanceSection(formatted, preservedGov);
  }
  formatted = repairGarbageHeadings(formatted);
  formatted = repairOrphanFenceBeforeContractLabels(formatted);
  formatted = repairUnclosedJsonBeforeApiEndpoint(formatted);
  formatted = repairApiContractJsonFences(formatted);
  formatted = repairApiResponse204NoContent(formatted);
  formatted = normalizeCanonicalMddSectionHeadings(formatted);
  formatted = finalizeMddPersistFormatting(formatted);
  return formatted;
}

export function storeMddMarkdownForPersist(mddMarkdown: string): string {
  return prepareMddMarkdownForPersist(mddMarkdown);
}

export function sanitizeMddForExport(mddMarkdown: string): string {
  return sanitizeMddAtPersist(mddMarkdown);
}

export function normalizeMddFormat(draft: string): string {
  let out = repairGarbageHeadings(normalizeCanonicalMddSectionHeadings(stripTrailingDuplicateMddSections((draft || "").trim())));
  out = fixGluedSection6Heading(out);
  if (!out) return draft;
  // Muy al inicio: §6 pegada a ### (evita que deduplicateAndReorderMddSections tome heading+subheading como una línea)
  out = out.replace(/(6\.\s*Seguridad)\s*(#{1,6})/gi, "$1\n\n$2");

  out = unescapeLiteralNewlines(out);
  out = fixDoubleMermaidFences(out);
  out = unescapeMermaidLiteralNewlines(out);
  out = stripUserResponsesAndConversationHistory(out);
  out = sanitizeContextSection(out);
  out = replaceContextWhenInstructions(out);
  out = forceStripBrokenPrefix(out);
  out = collapseDuplicateMainTitle(out);
  out = out.replace(/\[object\s+Object\]/gi, "(contenido omitido)");
  out = stripBrokenMetadataDocumentBlock(out);
  out = sanitizeSeguridadIntegracionRawJson(out);
  // Quitar heading duplicado "### ## Integración" que a veces deja el LLM (dejar solo ## Integración)
  out = out.replace(/(##\s+Integración)\s*\n+\s*###\s*##\s*Integración\s*\n+/gi, "$1\n\n");
  out = stripInstructionAndFeedbackBlocks(out);
  out = replaceAwsProseWithGenericWhenInfraNotAws(out);

  for (const { pattern, replacement } of CANONICAL_HEADINGS) {
    out = out.replace(pattern, replacement);
  }
  out = normalizeMddEnglishSubheadings(out);
  // Dentro de ## 2. Arquitectura y Stack, normalizar 4.x → 2.x (subsecciones mal numeradas por el LLM)
  const archStackHeading = "## 2. Arquitectura y Stack";
  const archStackIdx = out.indexOf(archStackHeading);
  if (archStackIdx !== -1) {
    const afterArch = out.slice(archStackIdx + archStackHeading.length);
    const nextH2 = afterArch.search(/\n##\s+/);
    const body = nextH2 !== -1 ? afterArch.slice(0, nextH2) : afterArch;
    let normalizedBody = body
      .replace(/^\s*####\s+4\.(\d+)(\.?)(\s|$)/gim, (_, n, dot, rest) => `### 2.${n}${dot}${rest}`)
      .replace(/^\s*###\s+4\.(\d+)(\.?)(\s|$)/gim, (_, n, dot, rest) => `### 2.${n}${dot}${rest}`)
      .replace(/^\s*4\.(\d+)\./gm, "2.$1.");
    if (normalizedBody !== body) {
      out =
        out.slice(0, archStackIdx + archStackHeading.length) +
        normalizedBody +
        (nextH2 !== -1 ? afterArch.slice(nextH2) : "");
    }
  }
  // Quitar líneas huérfanas que son solo un número (ej. "3" entre Modelo de datos y Contratos)
  out = out.replace(/\n\s*\d+\s*\n/g, "\n");

  const modeloHeading = "## 3. Modelo de Datos";
  const modeloIdx = out.indexOf(modeloHeading);
  if (modeloIdx !== -1) {
    out = unwrapSection2SqlBlockContainingJson(out);
    out = fixSection2UnclosedSqlAndGluedMermaid(out);
    out = ensureSection2SqlBlockClosed(out);
    const sectionStart = modeloIdx + modeloHeading.length;
    const rest = out.slice(sectionStart);
    const nextH2 = rest.search(/\n##\s+/);
    const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
    let trimmedBody = body.replace(/^\s*\n+/, "").trim();
    // Quitar línea suelta "3" dentro del cuerpo por si no la pilló el replace global
    trimmedBody = trimmedBody.replace(/\n\s*\d+\s*\n/g, "\n").trim();
    trimmedBody = repairMermaidBlocksInSectionBody(trimmedBody);

    const fromJson = convertSection2JsonBodyToMarkdown(trimmedBody);
    if (fromJson) {
      out = out.slice(0, sectionStart) + fromJson + (nextH2 !== -1 ? rest.slice(nextH2) : "");
    } else if (trimmedBody && /CREATE\s+TABLE/i.test(trimmedBody) && !trimmedBody.includes("```sql")) {
      const sqlContent = trimmedBody
        .split(/\n/)
        .map((l) => l.replace(/^-\s*/, "").trim())
        .filter((l) => l.length > 0 && !/^\s*\d+\s*$/.test(l))
        .join("\n");
      if (sqlContent.length > 15) {
        const newBody = "\n\n```sql\n" + sqlContent + "\n```\n\n";
        out = out.slice(0, sectionStart) + newBody + (nextH2 !== -1 ? rest.slice(nextH2) : "");
      }
    } else if (
      !trimmedBody ||
      trimmedBody.length < 50 ||
      (!/CREATE\s+TABLE/i.test(trimmedBody) && /pendiente|placeholder/i.test(trimmedBody))
    ) {
      // Cuerpo vacío o solo placeholder: inyectar SQL mínimo (SSO/auth) para que la sección tenga contenido
      const minimalSql =
        "\n\n(Esquema mínimo; el Arquitecto debe completar con todas las tablas del dominio.)\n\n```sql\n" +
        "CREATE TABLE users (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  username VARCHAR(255) NOT NULL UNIQUE,\n  password_hash VARCHAR(255) NOT NULL,\n  mfa_enabled BOOLEAN NOT NULL DEFAULT false,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n\nCREATE TABLE sessions (\n  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  token_hash VARCHAR(255) NOT NULL,\n  expires_at TIMESTAMPTZ NOT NULL,\n  created_at TIMESTAMPTZ NOT NULL DEFAULT now()\n);\n" +
        "```\n\n";
      out = out.slice(0, sectionStart) + minimalSql + (nextH2 !== -1 ? rest.slice(nextH2) : "");
    } else {
      // Aplicar cuerpo ya limpiado (JSON dentro de mermaid quitado, duplicados truncados)
      out = out.slice(0, sectionStart) + "\n\n" + trimmedBody + (nextH2 !== -1 ? rest.slice(nextH2) : "");
    }
    out = ensureTechnicalMetadataAtEndOfSection2(out);
    out = ensureSection2SqlFormattedInSection(out);
  }

  // Formatear sección Contratos de API: JSON en bloques ```json con indentación
  const contratosHeading = "## 4. Contratos de API";
  const contratosIdx = out.indexOf(contratosHeading);
  if (contratosIdx !== -1) {
    const sectionStart = contratosIdx + contratosHeading.length;
    const rest = out.slice(sectionStart);
    const nextH2 = rest.search(/\n##\s+/);
    const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
    let formatted = formatContratosBody(body);
    formatted = repairDisplacedJsonBracesInContratos(formatted);
    if (formatted !== body) {
      out = out.slice(0, sectionStart) + formatted + (nextH2 !== -1 ? rest.slice(nextH2) : "");
    }
  }

  out = fixGluedSection6Heading(out);

  // Sección 6 Seguridad: quitar "{:" o "{" pegado al heading (ej. "## 6. Seguridad{:")
  out = out.replace(/(##\s*6\.\s*Seguridad)\s*\{:\s*/gi, "$1\n\n");
  out = out.replace(/(##\s*6\.\s*Seguridad)\s*\{\s*\n/gi, "$1\n\n");
  // "6. Seguridad- Aspectos generales" → ## 6 + ## Aspectos Generales (formato canónico)
  out = out.replace(/(?:#+\s*)?6\.\s*Seguridad\s*-\s*Aspectos\s+generales:?\s*/gi, "## 6. Seguridad\n\n## Aspectos Generales\n\n");
  // Despegar "6. Seguridad-" genérico (solo en la misma línea; no tocar viñetas "- item" en líneas siguientes)
  out = out.replace(/(?:#+\s*)?6\.\s*Seguridad[^\S\n]*-\s*/gi, "## 6. Seguridad\n\n");
  // Corregir doble guion
  out = out.replace(/(##\s*6\.\s*Seguridad\n\n)-\s*-\s*/gi, "$1- ");
  // Si queda "## 6. Seguridad" o "6. Seguridad" pegado a "###", insertar salto (varias formas por si falla el regex anterior)
  out = out.replace(/6\.\s*Seguridad\s*###/gi, "6. Seguridad\n\n###");
  out = out.replace(/(##\s*6\.\s*Seguridad)([^\n]*?)(#{1,6}\s*)/gi, "$1\n\n$3");
  const seguridadHeading = "## 6. Seguridad";
  const seguridadIdx = out.indexOf(seguridadHeading);
  if (seguridadIdx !== -1) {
    const sectionStart = seguridadIdx + seguridadHeading.length;
    const rest = out.slice(sectionStart);
    const nextH2 = rest.search(/\n##\s+/);
    const body = nextH2 !== -1 ? rest.slice(0, nextH2) : rest;
    let fixed = body.replace(/\s*--\s*\n*$/, "").trim();
    fixed = fixSection6BulletedJsonToMarkdown(fixed) ?? fixed;
    fixed = fixSecuritySectionBullets(fixed);
    fixed = fixed.replace(/(\n\s*-\s*)+$/, "").replace(/\n\s*---\s*$/, "").trim();
    if (fixed !== body) {
      out =
        out.slice(0, sectionStart) + fixed + (nextH2 !== -1 ? rest.slice(nextH2) : "");
    }
  }

  // Deduplicar y reordenar secciones (1, 2, 3, 4, Seguridad, Integración)
  out = deduplicateAndReorderMddSections(out);

  // Separación visual: --- antes de cada ## (excepto si ya hay --- justo antes)
  out = ensureHorizontalRuleBeforeH2(out);

  // Colapsar múltiples líneas "---" consecutivas (con o sin líneas en blanco) en una sola
  out = collapseConsecutiveHorizontalRules(out);

  // Si la sección Integración tiene manifest con stack definido, quitar etiqueta "Nota/Pendiente"
  out = stripNotaPendienteHeadingWhenManifestComplete(out);

  // Si la sección 7 tiene manifest como texto plano (stack/pending sin ```json), envolver en ```json
  out = ensureManifestInJsonBlock(out);

  // En sección 7: quitar ### Integración redundante justo bajo ## 7. Infraestructura
  out = stripRedundantIntegracionHeadingInSection7(out);

  // Colapsar ### Manifest / ### Manifest de Infraestructura duplicados en sección 7
  out = collapseDuplicateManifestHeadings(out);

  // Eliminar sección errónea "## 4. Arquitectura Frontend" (estructura canónica: la 4 es Contratos de API)
  out = stripStandaloneArquitecturaFrontendSection(out);

  out = fixDeterministicMddCoherence(out);
  out = sanitizeAllSqlBlocksInDraft(out);
  out = stripMeshDirectivesFromDraft(out);

  if (mddHasDuplicateSectionHeadings(out)) {
    out = deduplicateAndReorderMddSections(out);
  }
  if (mddHasDuplicateSectionHeadings(out)) {
    out = stripTrailingDuplicateMddSections(out);
  }

  const ctxAfter = extractContextSectionBody(out);
  if (!ctxAfter || ctxAfter.length < 200) {
    const ctxBefore = extractContextSectionBody(draft);
    if (ctxBefore && ctxBefore.length >= 200) {
      out = replaceContextSectionBody(out, ctxBefore);
    }
  }

  return out.trim();
}

export function finalizeMddDeliverable(
  draft: string,
  options?: { baseline?: string | null },
): string {
  let out = sanitizeMddAtPersist(stripMeshDirectivesFromDraft(draft));

  const { core, uiUxSuffix } = splitMddUiUxDesignIntentSuffix(out);

  let fixedCore = ensureMissingCanonicalSections(
    stripTrailingDuplicateMddSections(core),
    options?.baseline?.trim() || undefined,
  );
  fixedCore = deduplicateAndReorderMddSections(fixedCore);
  if (mddHasDuplicateSectionHeadings(fixedCore)) {
    fixedCore = deduplicateAndReorderMddSections(stripTrailingDuplicateMddSections(fixedCore));
  }

  out = reattachMddUiUxDesignIntentSuffix(fixedCore, uiUxSuffix);
  return stripMeshDirectivesFromDraft(out);
}

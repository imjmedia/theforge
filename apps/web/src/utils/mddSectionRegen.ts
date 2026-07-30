/** Alineado con `REGENERATE_SECTION_N_PATTERN` en `mdd-manager.node.ts` (backend). */
const REGENERATE_SECTION_N_PATTERN =
  /\b(?:regenera(?:r)?|rehacer|actualiza(?:r)?|genera(?:r)?\s+de\s+nuevo)\s+(?:solo\s+)?(?:la\s+)?(?:secci[oó]n|paso)\s*([1-7])\b/i;

export const MDD_SECTION_COMMANDS = [
  { slug: "contexto", label: "1. Contexto", section: 1 },
  { slug: "arquitectura", label: "2. Arquitectura y Stack", section: 2 },
  { slug: "modelo-datos", label: "3. Modelo de Datos", section: 3 },
  { slug: "contratos-api", label: "4. Contratos de API", section: 4 },
  { slug: "logica", label: "5. Lógica y Edge Cases", section: 5 },
  { slug: "seguridad", label: "6. Seguridad", section: 6 },
  { slug: "infraestructura", label: "7. Infraestructura", section: 7 },
] as const;

export function getRegenerateSectionFromSlashCommand(msg: string): number | null {
  const t = msg.trim().toLowerCase();
  if (!t.startsWith("/") || t.includes(" ")) return null;
  const slug = t.slice(1);
  if (!slug) return null;
  const cmd = MDD_SECTION_COMMANDS.find((c) => c.slug === slug || String(c.section) === slug);
  return cmd?.section ?? null;
}

/** Lenguaje natural: «regenera la sección 6», «rehacer paso 3», etc. (no exige fin de línea). */
export function detectNaturalRegenerateSection(msg: string): number | null {
  const m = msg.trim().match(REGENERATE_SECTION_N_PATTERN);
  if (!m) return null;
  const section = parseInt(m[1]!, 10);
  return section >= 1 && section <= 7 ? section : null;
}

export function resolveRegenerateSectionFromChatMessage(msg: string): number | null {
  return getRegenerateSectionFromSlashCommand(msg) ?? detectNaturalRegenerateSection(msg);
}

/** Heading canónico §5 presente (validación tras /logica o /5). */
export function mddHasSection5Heading(content: string): boolean {
  return /(?:^|\n)##\s*5\.\s*L[oó]gica\s+y\s*Edge\s+Cases\b/im.test((content ?? "").trim());
}

/** Heading canónico §6 presente (semáforo + validación tras /seguridad). */
export function mddHasSection6Heading(content: string): boolean {
  return /(?:^|\n)##\s+(?:6\.\s+)?Seguridad\b/im.test((content ?? "").trim());
}

/** Claves del desglose «Calidad MDD (Constitución)» en estimación / auditor. */
export type MddQualityReasonKey =
  | "contexto"
  | "modeloDatos"
  | "apiContracts"
  | "logicaEdgeCases"
  | "seguridad"
  | "integracion";

/** Filas de la tabla Calidad MDD → número de sección canónica (§1–§7). */
export const MDD_QUALITY_TABLE_ROWS = [
  { label: "Contexto y alcance", agent: "Clarificador", reasonKey: "contexto" as MddQualityReasonKey, section: 1 },
  { label: "Modelo de datos", agent: "Arquitecto de Software", reasonKey: "modeloDatos" as MddQualityReasonKey, section: 3 },
  { label: "Contratos API", agent: "Arquitecto de Software", reasonKey: "apiContracts" as MddQualityReasonKey, section: 4 },
  { label: "Lógica y edge cases", agent: "Arquitecto (§5 dedicado)", reasonKey: "logicaEdgeCases" as MddQualityReasonKey, section: 5 },
  { label: "Seguridad", agent: "Arquitecto de Seguridad", reasonKey: "seguridad" as MddQualityReasonKey, section: 6 },
  { label: "Integración", agent: "Ingeniero de Integración", reasonKey: "integracion" as MddQualityReasonKey, section: 7 },
] as const;

export const MDD_QUALITY_SCORE_COMPLETE = 100;

/** MDD visible para regenerar §N: store → etapa activa → proyecto. */
export function resolveEffectiveMddContent(input: {
  mddContent?: string | null;
  stageMddContent?: string | null;
  projectMddContent?: string | null;
}): string {
  const fromStore = (input.mddContent ?? "").trim();
  if (fromStore.length > 0) return fromStore;
  const fromStage = (input.stageMddContent ?? "").trim();
  if (fromStage.length > 0) return fromStage;
  return (input.projectMddContent ?? "").trim();
}

export type MddSectionRegenBusyState = {
  loading?: boolean;
  mddReviewing?: boolean;
  mddReapplyingFormat?: boolean;
  workshopAgentsBusy?: boolean;
};

/** Habilita «Regenerar §N» cuando hay proyecto + MDD; no exige sesión de chat (el API usa projectId). */
export function canRegenerateMddSectionFromWorkshop(
  projectId: string | null | undefined,
  effectiveMdd: string,
  busy: MddSectionRegenBusyState = {},
): boolean {
  return (
    !!(projectId ?? "").trim() &&
    effectiveMdd.trim().length > 0 &&
    !busy.loading &&
    !busy.mddReviewing &&
    !busy.mddReapplyingFormat &&
    !busy.workshopAgentsBusy
  );
}

/** Tooltip cuando el botón de regeneración parcial está deshabilitado. */
export function mddSectionRegenDisabledTitle(
  projectId: string | null | undefined,
  effectiveMdd: string,
  busy: MddSectionRegenBusyState = {},
): string {
  if (!(projectId ?? "").trim()) return "Necesitas un proyecto cargado en Workshop";
  if (!effectiveMdd.trim()) return "Necesitas MDD guardado";
  if (busy.workshopAgentsBusy || busy.loading) return "Espera a que terminen los agentes";
  if (busy.mddReviewing || busy.mddReapplyingFormat) return "Espera a que termine la revisión o el formato";
  return "Regeneración no disponible";
}

/** Mensaje de chat al disparar regeneración parcial (slash command reconocido por sendMessage). */
export function buildRegenerateSectionChatMessage(section: number): string {
  const cmd = MDD_SECTION_COMMANDS.find((c) => c.section === section);
  return cmd ? `/${cmd.slug}` : `/Regenerar sección ${section}`;
}

/** Etiqueta corta para toasts de regeneración parcial (ej. «Seguridad»). */
export function mddSectionRegenShortLabel(section: number): string {
  const cmd = MDD_SECTION_COMMANDS.find((c) => c.section === section);
  if (!cmd) return `§${section}`;
  const short = cmd.label.replace(/^\d+\.\s*/, "").trim();
  return short || cmd.label;
}

/** Texto de aviso sutil mientras corre regenerate-section (no banner de MDD completo). */
export function buildMddSectionRegenNotice(section: number): string {
  const label = mddSectionRegenShortLabel(section);
  return `Regenerando §${section} (${label})…`;
}

/** Aviso mientras corre section-pipeline §5 (paridad post-critic del MDD completo). */
export function buildMddSection5PipelineRegenNotice(): string {
  return "Regenerando §5 (Lógica) con pipeline MDD (section5 + Formatter + prepare)…";
}

export type MddReadinessHintAction =
  | { kind: "regenerate"; section: number; label: string }
  | { kind: "reapply-format"; label: string };

/** Acciones sugeridas para ítems de «Pendientes MDD» según el texto del hint. */
export function resolveMddReadinessHintActions(hint: string): MddReadinessHintAction[] {
  const actions: MddReadinessHintAction[] = [];
  if (/trazabilidad\s*§2↔§7|§2↔§7|paridad\s+mermaid\/sql/i.test(hint)) {
    actions.push({ kind: "reapply-format", label: "Re-aplicar formato" });
    actions.push({ kind: "regenerate", section: 7, label: "Regenerar §7" });
  } else if (/§3|modelo de datos|mermaid|diagrama er|tablas sql/i.test(hint)) {
    actions.push({ kind: "regenerate", section: 3, label: "Regenerar §3" });
  } else if (/contratos api|endpoints|payloads/i.test(hint)) {
    actions.push({ kind: "regenerate", section: 4, label: "Regenerar §4" });
  } else if (/§5|l[oó]gica|edge cases|bdd|aaa/i.test(hint)) {
    actions.push({ kind: "regenerate", section: 5, label: "Regenerar §5" });
  } else if (/seguridad|authn|authz/i.test(hint)) {
    actions.push({ kind: "regenerate", section: 6, label: "Regenerar §6" });
  }
  return actions;
}

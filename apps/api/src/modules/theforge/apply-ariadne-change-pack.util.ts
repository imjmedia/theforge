import type { AriadneChangePackV1, CreateStageFromAriadneChangePackOutput } from "@theforge/shared-types";
import {
  isAriadneMigrationTasksPack,
  normalizeAriadneHandoffItemsRaw,
  resolveSkipBaselineDeliverableKinds,
  shouldSkipLegacyGenerateDeliverables,
  extractIntegrationScopeFromHandoff,
  resolveStageOriginFromIntegrationScope,
  type AriadneHandoffIdRemap,
  type StageOrigin,
} from "@theforge/shared-types";

/** Clona body MCP y normaliza `pack.handoffItems[].id` antes del parse Zod (log de remaps). */
export function preprocessCreateStageFromAriadneChangePackBody(body: unknown): {
  bodyForParse: unknown;
  handoffIdRemaps: AriadneHandoffIdRemap[];
} {
  if (!body || typeof body !== "object") {
    return { bodyForParse: body ?? {}, handoffIdRemaps: [] };
  }
  const root = { ...(body as Record<string, unknown>) };
  const pack = root.pack;
  if (!pack || typeof pack !== "object") {
    return { bodyForParse: root, handoffIdRemaps: [] };
  }
  const packObj = { ...(pack as Record<string, unknown>) };
  if (!Array.isArray(packObj.handoffItems)) {
    return { bodyForParse: { ...root, pack: packObj }, handoffIdRemaps: [] };
  }
  const { items, remapped } = normalizeAriadneHandoffItemsRaw(packObj.handoffItems);
  return {
    bodyForParse: { ...root, pack: { ...packObj, handoffItems: items } },
    handoffIdRemaps: remapped,
  };
}

export function resolveStageOriginForAriadnePack(
  pack: AriadneChangePackV1,
): StageOrigin {
  const scope = extractIntegrationScopeFromHandoff(pack.handoffItems ?? []);
  return resolveStageOriginFromIntegrationScope(scope) ?? "ariadne_change_pack";
}

export function buildLegacyChangeStateFromAriadnePack(
  pack: AriadneChangePackV1,
  defaultRepoId: string | null,
): Record<string, unknown> {
  const filesToModify = (pack.filesToModify ?? [])
    .map((file) => ({
      path: file.path.trim(),
      repoId: file.repoId?.trim() || defaultRepoId?.trim() || undefined,
    }))
    .filter((file) => file.path);

  return {
    description: pack.changeDescription.trim(),
    stageOrigin: resolveStageOriginForAriadnePack(pack),
    ...(filesToModify.length ? { filesToModify } : {}),
    ...(pack.questionsToRefine?.length ? { questions: pack.questionsToRefine } : {}),
    ariadneChangePack: {
      version: pack.version,
      ariadneChangeId: pack.ariadneChangeId ?? null,
      ariadneRepositoryId: pack.ariadneRepositoryId ?? null,
      importedAt: new Date().toISOString(),
      handoffPlanType: pack.handoffPlanType ?? null,
      tasksImportedFromHandoff: isAriadneMigrationTasksPack(pack),
    },
  };
}

export function defaultStageNameFromAriadnePack(pack: AriadneChangePackV1): string {
  if (pack.ariadneChangeId?.trim()) {
    return `Ariadne — ${pack.ariadneChangeId.trim().slice(0, 80)}`;
  }
  const excerpt = pack.changeDescription.trim().replace(/\s+/g, " ").slice(0, 72);
  return excerpt.length >= pack.changeDescription.trim().length
    ? `Ariadne — ${excerpt}`
    : `Ariadne — ${excerpt}…`;
}

export function shouldRunLegacyStartForAriadnePack(
  pack: AriadneChangePackV1,
  explicit: boolean | undefined,
  autoLegacyStartEnabled: boolean,
): boolean {
  if (explicit != null) return explicit;
  if ((pack.filesToModify?.length ?? 0) > 0) return false;
  return autoLegacyStartEnabled;
}

export function buildRecommendedNextToolsAfterAriadnePack(input: {
  questionsCount: number;
  hasHandoffItems: boolean;
  migrationTasksMode?: boolean;
  integrationHandoffWithHydratedTasks?: boolean;
  skipBaselineDeliverables?: readonly string[];
}): CreateStageFromAriadneChangePackOutput["recommendedNextTools"] {
  const steps: CreateStageFromAriadneChangePackOutput["recommendedNextTools"] = [];
  const skipBaseline = input.skipBaselineDeliverables ?? [];
  const skipDeliverablesDefault = shouldSkipLegacyGenerateDeliverables(skipBaseline);
  const skipKinds = resolveSkipBaselineDeliverableKinds(skipBaseline, {
    skipTasksFromHandoff: skipDeliverablesDefault || !!input.migrationTasksMode,
  });

  if (input.questionsCount > 0) {
    steps.push({
      tool: "legacy_answer",
      reason: "El pack incluye preguntas de refinamiento; persistir respuestas antes del MDD.",
    });
  }

  if (input.integrationHandoffWithHydratedTasks) {
    steps.push({
      tool: "get_tasks_json",
      reason: "Tasks hidratadas desde Ariadne (SSOT tasksJson v2).",
    });
    steps.push({
      tool: "get_next_implementation_task",
      reason: "Primera tarea abierta del seed — iniciar implementación Cursor.",
    });
    steps.push({
      tool: "generate_agent_governance",
      reason:
        "Generar gobernanza IA desde documentos Ariadne (tasks, plan, alcance) — no esperes cascada legacy completa.",
    });
    return steps;
  }

  steps.push({
    tool: "legacy_generate_mdd",
    reason: "Generar MDD de cambio para la etapa creada/importada (incluir stageId).",
  });
  if (input.hasHandoffItems) {
    steps.push({
      tool: "sync_handoff_spec",
      reason: "Opcional: POST …/integration/stages/:stageId/sync-handoff-spec si hay ítems NEW-LEG.",
    });
  }
  if (input.migrationTasksMode && !skipDeliverablesDefault) {
    steps.push({
      tool: "legacy_generate_deliverables",
      reason: "Tras MDD en VERDE, cascada legacy excepto entregables del handoff.",
      skipDeliverableKinds: skipKinds.length ? [...skipKinds] : ["tasks"],
    });
    steps.push({
      tool: "get_next_implementation_task",
      reason: "Tasks del handoff listas — iniciar implementación Cursor.",
    });
  } else if (!skipDeliverablesDefault) {
    steps.push({
      tool: "legacy_generate_deliverables",
      reason: "Tras MDD en VERDE, cascada legacy de entregables para la etapa activa.",
      ...(skipKinds.length ? { skipDeliverableKinds: [...skipKinds] } : {}),
    });
  }
  return steps;
}

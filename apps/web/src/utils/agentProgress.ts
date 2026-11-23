import {
  normalizeMddJobProgressState,
  type MddJobProgressStep,
} from "@theforge/shared-types";

export type AgentProgressStatus = "active" | "done" | "generando" | "terminado";

export type AgentProgressItem = {
  agent: string;
  message: string;
  step?: string;
  status?: AgentProgressStatus;
  phaseGroup?: { current: number; total: number; label: string };
};

export type { MddJobProgressStep };

/** Reconstruye la lista del panel desde el estado acumulado del job MDD. */
export function agentProgressFromMddJobProgress(raw: unknown): AgentProgressItem[] {
  const state = normalizeMddJobProgressState(raw);
  const items: AgentProgressItem[] = state.steps.map((s) => ({ ...s, status: "done" as const }));
  if (state.active) {
    items.push({
      ...state.active,
      status: "generando" as const,
      ...(state.phaseGroup ? { phaseGroup: state.phaseGroup } : {}),
    });
  }
  return items;
}

export function agentProgressFromMddJobSnapshot(snapshot: {
  progressSteps?: MddJobProgressStep[];
  progressActive?: MddJobProgressStep | null;
  progressPhaseGroup?: { current: number; total: number; label: string } | null;
}): AgentProgressItem[] {
  return agentProgressFromMddJobProgress({
    steps: snapshot.progressSteps ?? [],
    active: snapshot.progressActive ?? null,
    phaseGroup: snapshot.progressPhaseGroup ?? null,
  });
}

/** Campos planos legacy en el payload `progress` del poll MDD (compat con número). */
export function mddJobProgressEventFields(raw: unknown): {
  agent?: string;
  message?: string;
  phase?: string;
} {
  if (raw == null || typeof raw === "number") return {};
  const o = raw as Record<string, unknown>;
  const latest =
    o.latest && typeof o.latest === "object" && !Array.isArray(o.latest)
      ? (o.latest as Record<string, unknown>)
      : null;
  return {
    agent:
      typeof o.agent === "string"
        ? o.agent
        : typeof latest?.agent === "string"
          ? latest.agent
          : undefined,
    message:
      typeof o.message === "string"
        ? o.message
        : typeof latest?.message === "string"
          ? latest.message
          : undefined,
    phase:
      typeof o.phase === "string"
        ? o.phase
        : typeof latest?.phase === "string"
          ? latest.phase
          : undefined,
  };
}

function sameAgentProgressStep(
  a: Pick<AgentProgressItem, "agent" | "message">,
  b: Pick<AgentProgressItem, "agent" | "message">,
): boolean {
  return a.agent === b.agent && a.message === b.message;
}

function stepIdentity(step: Pick<AgentProgressItem, "agent" | "message">): string {
  return `${step.agent}\0${step.message}`;
}

/** True si `small` aparece en orden dentro de `large` (no necesariamente contigua). */
function isProgressStepSubsequence(
  small: readonly Pick<AgentProgressItem, "agent" | "message">[],
  large: readonly Pick<AgentProgressItem, "agent" | "message">[],
): boolean {
  let j = 0;
  for (let i = 0; i < large.length && j < small.length; i++) {
    const largeStep = large[i];
    const smallStep = small[j];
    if (largeStep && smallStep && stepIdentity(largeStep) === stepIdentity(smallStep)) {
      j++;
    }
  }
  return j === small.length;
}

/** Fusiona pasos completados sin acortar el historial ya mostrado en UI. */
function mergeDoneAgentProgressSteps(
  prev: readonly AgentProgressItem[],
  incomingDone: readonly AgentProgressItem[],
): AgentProgressItem[] {
  const merged = prev
    .filter((p) => !isAgentProgressActive(p))
    .map((p) => ({ ...p, status: "done" as const }));

  if (incomingDone.length === 0) return merged;
  if (isProgressStepSubsequence(incomingDone, merged)) return merged;

  let appendFrom = 0;
  for (let k = incomingDone.length; k >= 0; k--) {
    if (isProgressStepSubsequence(incomingDone.slice(0, k), merged)) {
      appendFrom = k;
      break;
    }
  }

  let result: AgentProgressItem[] = merged;
  for (const step of incomingDone.slice(appendFrom)) {
    result = appendAgentProgressDone(result, { agent: step.agent, message: step.message });
  }
  return result;
}

function setAgentProgressActiveStep(
  prev: readonly AgentProgressItem[],
  active: { agent: string; message: string; phaseGroup?: AgentProgressItem["phaseGroup"] },
): AgentProgressItem[] {
  const done = mergeDoneAgentProgressSteps(prev, []);
  const existingActive = prev.find(isAgentProgressActive);
  const nextActive = {
    ...active,
    status: "generando" as const,
  };
  if (existingActive && sameAgentProgressStep(existingActive, active)) {
    return [...done, nextActive];
  }
  return [...done, nextActive];
}

/**
 * Unifica stream NDJSON y poll del job MDD: nunca acorta la lista visible al cambiar de fuente.
 */
export function mergeAgentProgressFromMddEvent(
  prev: readonly AgentProgressItem[],
  raw: unknown,
): AgentProgressItem[] {
  if (raw == null || typeof raw === "number") return [...prev];

  const o = raw as Record<string, unknown>;
  const isAccumulatedPayload =
    Array.isArray(o.steps) || (o.active != null && typeof o.active === "object");

  if (isAccumulatedPayload) {
    const incoming = agentProgressFromMddJobProgress(raw);
    const incomingDone = incoming.filter((p) => !isAgentProgressActive(p));
    const incomingActive = incoming.find(isAgentProgressActive);
    const mergedDone = mergeDoneAgentProgressSteps(prev, incomingDone);
    if (incomingActive) {
      return setAgentProgressActiveStep(mergedDone, incomingActive);
    }
    return mergedDone;
  }

  const ev = mddJobProgressEventFields(raw);
  if (!ev.agent || !ev.message) return [...prev];

  const phaseGroup =
    o.phaseGroup &&
    typeof o.phaseGroup === "object" &&
    typeof (o.phaseGroup as Record<string, unknown>).current === "number" &&
    typeof (o.phaseGroup as Record<string, unknown>).total === "number" &&
    typeof (o.phaseGroup as Record<string, unknown>).label === "string"
      ? (o.phaseGroup as AgentProgressItem["phaseGroup"])
      : undefined;

  if (ev.phase === "active") {
    return setAgentProgressActiveStep(prev, {
      agent: ev.agent,
      message: ev.message,
      phaseGroup,
    });
  }

  return appendAgentProgressDone(prev, { agent: ev.agent, message: ev.message });
}

/** Paso ya ejecutado: marca el activo anterior como hecho y añade uno nuevo completado. */
export function appendAgentProgressDone(
  prev: readonly AgentProgressItem[],
  item: { agent: string; message: string },
): AgentProgressItem[] {
  const last = prev[prev.length - 1];
  if (last && sameAgentProgressStep(last, item)) {
    return prev.map((p) =>
      isAgentProgressActive(p) ? { ...p, status: "done" as const } : { ...p, status: p.status ?? "done" },
    );
  }
  const normalized = prev.map((p) =>
    isAgentProgressActive(p) ? { ...p, status: "done" as const } : { ...p, status: p.status ?? "done" },
  );
  return [...normalized, { ...item, status: "done" }];
}

export function isAgentProgressActive(item: AgentProgressItem): boolean {
  return item.status === "active" || item.status === "generando";
}

/**
 * Selecciona el paso activo a mostrar: en cascadas de entregables prioriza el paso
 * marcado en ejecución (`⚡`) sobre los que aún esperan (`⚪`).
 */
export function findActiveAgentProgressStep(
  items: readonly AgentProgressItem[],
): AgentProgressItem | undefined {
  return (
    items.find((p) => isAgentProgressActive(p) && p.message.startsWith("⚡")) ??
    items.find((p) => isAgentProgressActive(p))
  );
}

/**
 * Etiqueta visible del paso en el panel «Progreso del flujo».
 * En cascadas de entregables muestra el nombre del documento (`item.step`) en lugar
 * de repetir «Entregables» / «Entregables (revisión)».
 */
export function resolveAgentProgressDisplayLabel(
  items: readonly AgentProgressItem[],
  index: number,
  active: boolean,
): string {
  const item = items[index];
  const agent = item?.agent ?? "";
  if (agent === "Entregables" && item?.step?.trim()) {
    return item.step.trim();
  }
  if (!active) return agent;
  const priorSame = items
    .slice(0, index)
    .filter((p) => p.agent === agent && (!item?.step || p.step === item.step)).length;
  if (priorSame === 0) return agent;
  // Solo el paso activo: indicar revisión sin numerar (evita «5ª pasada» alarmante).
  return `${agent} (revisión)`;
}

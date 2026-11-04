import type {
  DesignSpec,
  DesignSpecDataNeedsEntry,
  DesignSpecEntity,
  DesignSpecScreen,
} from "@theforge/shared-types";
import { designSpecDataNeedItemSchema } from "@theforge/shared-types";
import type { z } from "zod";

type DesignSpecDataNeedItem = z.infer<typeof designSpecDataNeedItemSchema>;
type DesignSpecDataNeedComponent = { componentId: string; needs: DesignSpecDataNeedItem[] };

const REMOTE_UI_STATES = ["empty", "error", "loading"] as const;

function inferEntityForScreen(
  screen: DesignSpecScreen,
  entities: DesignSpecEntity[],
): DesignSpecEntity | undefined {
  if (entities.length === 0) return undefined;
  const hay = `${screen.id} ${screen.route} ${screen.name}`.toLowerCase();
  const byId = entities.find((e) => hay.includes(e.id.toLowerCase()));
  if (byId) return byId;
  const byName = entities.find((e) => hay.includes(e.name.toLowerCase()));
  if (byName) return byName;
  return entities[0];
}

function needId(entityId: string, suffix: string): string {
  return `need-${entityId}-${suffix}`.slice(0, 64);
}

function heuristicNeedForComponent(
  component: DesignSpecScreen["components"][number],
  entity: DesignSpecEntity,
): DesignSpecDataNeedItem | null {
  const kind = component.component.trim().toLowerCase();
  const entityName = entity.name.trim() || entity.id;

  if (/datagrid|data-grid|table|list|grid/.test(kind)) {
    return {
      id: needId(entity.id, "rows"),
      name: "rows",
      type: `${entityName}[]`,
      origin: "entity",
      action: entity.id,
      required: true,
      many: true,
      provenance: "heuristic",
    };
  }

  if (/form|detail|editor|panel/.test(kind)) {
    return {
      id: needId(entity.id, "record"),
      name: "record",
      type: entityName,
      origin: "entity",
      action: entity.id,
      required: true,
      provenance: "heuristic",
    };
  }

  if (/select|combobox|autocomplete|picker/.test(kind)) {
    return {
      id: needId(entity.id, "options"),
      name: "options",
      type: `${entityName}[]`,
      origin: "entity",
      action: entity.id,
      required: true,
      many: true,
      provenance: "heuristic",
    };
  }

  if (/input|textfield|textarea/.test(kind)) {
    return {
      id: needId(entity.id, "input"),
      name: component.label?.trim() || "value",
      type: "string",
      origin: "input",
      action: entity.id,
      required: false,
      provenance: "heuristic",
    };
  }

  return null;
}

function defaultStatesForRemoteScreen(screen: DesignSpecScreen): string[] {
  if (screen.static) return [...(screen.states ?? [])];
  const base = new Set((screen.states ?? []).map((s) => s.toLowerCase()));
  for (const s of REMOTE_UI_STATES) base.add(s);
  return [...base];
}

/** Heurística determinista por tipo de componente (provenance `heuristic`). */
export function buildHeuristicDataNeeds(spec: DesignSpec): DesignSpecDataNeedsEntry[] {
  const entries: DesignSpecDataNeedsEntry[] = [];

  for (const screen of spec.screens) {
    if (screen.static || screen.components.length === 0) continue;

    const entity = inferEntityForScreen(screen, spec.entities);
    if (!entity) continue;

    const components: DesignSpecDataNeedComponent[] = [];
    for (const comp of screen.components) {
      const need = heuristicNeedForComponent(comp, entity);
      if (!need) continue;
      components.push({ componentId: comp.id, needs: [need] });
    }

    if (components.length === 0) continue;

    entries.push({
      screenId: screen.id,
      components,
      states: defaultStatesForRemoteScreen(screen),
    });
  }

  return entries.sort((a, b) => a.screenId.localeCompare(b.screenId));
}

export function mergeDataNeedsByScreen(
  current: DesignSpecDataNeedsEntry[],
  patch: DesignSpecDataNeedsEntry[],
): DesignSpecDataNeedsEntry[] {
  const byScreen = new Map<string, DesignSpecDataNeedsEntry>();
  for (const entry of current) {
    byScreen.set(entry.screenId, structuredClone(entry));
  }
  for (const patchEntry of patch) {
    const existing = byScreen.get(patchEntry.screenId);
    if (!existing) {
      byScreen.set(patchEntry.screenId, structuredClone(patchEntry));
      continue;
    }
    const byComp = new Map(existing.components.map((c) => [c.componentId, c]));
    for (const block of patchEntry.components) {
      const prev = byComp.get(block.componentId);
      if (!prev) {
        byComp.set(block.componentId, structuredClone(block));
        continue;
      }
      const byNeedId = new Map(prev.needs.map((n) => [n.id, n]));
      for (const need of block.needs) {
        byNeedId.set(need.id, need);
      }
      byComp.set(block.componentId, { componentId: block.componentId, needs: [...byNeedId.values()] });
    }
    existing.components = [...byComp.values()];
    if (patchEntry.states.length) existing.states = patchEntry.states;
    byScreen.set(patchEntry.screenId, existing);
  }
  return [...byScreen.values()].sort((a, b) => a.screenId.localeCompare(b.screenId));
}

export type DataNeedsComponentGap = {
  screenId: string;
  componentId: string;
  componentType: string;
  label?: string;
};

/** Componentes sin needs tras la heurística (candidatos al LLM). */
export function listDataNeedsGaps(
  spec: DesignSpec,
  afterHeuristic: DesignSpecDataNeedsEntry[],
): DataNeedsComponentGap[] {
  const gaps: DataNeedsComponentGap[] = [];
  const entryByScreen = new Map(afterHeuristic.map((e) => [e.screenId, e]));

  for (const screen of spec.screens) {
    if (screen.static) continue;
    const entry = entryByScreen.get(screen.id);
    for (const comp of screen.components) {
      const block = entry?.components.find((c) => c.componentId === comp.id);
      if (block && block.needs.length > 0) continue;
      gaps.push({
        screenId: screen.id,
        componentId: comp.id,
        componentType: comp.component,
        label: comp.label,
      });
    }
  }

  return gaps.sort((a, b) =>
    `${a.screenId}:${a.componentId}`.localeCompare(`${b.screenId}:${b.componentId}`),
  );
}

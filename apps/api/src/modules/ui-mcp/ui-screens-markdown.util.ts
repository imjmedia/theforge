/**
 * @fileoverview Ensamblador del deliverable **Pantallas** (formato accionable por rol/ruta).
 */
import type { ScreenSpec } from "@theforge/shared-types";
import type { PantallaPlanItem } from "./ui-screens-plan.util.js";
import { inferLayout, inferResponsive } from "./ui-screens-heuristic.util.js";

export interface UiScreensMarkdownMeta {
  projectName?: string | null;
  libraryName?: string | null;
  libraryVersion?: string | null;
  contractVersion?: string | null;
  stackBase?: string | null;
  generatedAt?: Date;
}

function componentsColumnLabel(libraryName?: string | null): string {
  const lib = (libraryName ?? "").trim();
  return lib ? `Componentes (${lib})` : "Componentes UI";
}

function implementationIntro(meta: UiScreensMarkdownMeta): string {
  const lib = (meta.libraryName ?? meta.stackBase ?? "").trim();
  if (lib) {
    return (
      `> Mapa accionable pantalla → ruta → componente → API. Catálogo: **${lib}**` +
      `${meta.libraryVersion ? ` ${meta.libraryVersion}` : ""}. Endpoints **solo** de api-contracts. ` +
      "Importar UI solo vía `packages/ui` (`@scope/ui`); prohibido vendor directo en `apps/*`."
    );
  }
  return (
    "> Mapa accionable pantalla → ruta → componente → API. Endpoints **solo** de api-contracts. " +
      "Sin MCP gráfico: convención shadcn/ui + tokens de design-system.md; adapter `packages/ui`."
  );
}
function componentLabel(c: ScreenSpec["components"][number]): string {
  const pkg = c.package ? ` \`${c.package}${c.version ? `@${c.version}` : ""}\`` : "";
  return `\`${c.component}\`${pkg}`;
}

function componentsForPlanItem(item: PantallaPlanItem, screens: ScreenSpec[]): string {
  const entity = item.source === "hu-only" ? item.name : item.name;
  const screen = screens.find(
    (s) =>
      s.name === item.screenName ||
      s.components.some((c) => c.entity === entity || c.entity === item.name),
  );
  if (!screen || screen.components.length === 0) return "—";
  return screen.components.map(componentLabel).join(", ");
}

function layoutCell(item: PantallaPlanItem, screen?: ScreenSpec): string {
  const fromProps = screen?.components[0]?.props?.layout;
  if (fromProps?.trim()) return fromProps;
  return inferLayout(item.uiHint, item.route);
}

function responsiveCell(item: PantallaPlanItem, screen?: ScreenSpec): string {
  const fromProps = screen?.components[0]?.props?.responsive;
  if (fromProps?.trim()) return fromProps;
  return inferResponsive(item.uiHint);
}

function apiCell(item: PantallaPlanItem, screen?: ScreenSpec): string {
  if (item.primaryApi?.trim()) return item.primaryApi;
  if (screen?.endpoints?.length) return screen.endpoints.slice(0, 2).join(", ");
  if (item.restEndpoint?.trim()) return item.restEndpoint;
  return "fuera de alcance v1";
}

function usCell(item: PantallaPlanItem): string {
  if (item.userStoryId) return item.userStoryId;
  const ref = item.userStoryRefs?.[0];
  if (!ref) return "—";
  const id = ref.match(/^(US-[A-Z0-9]+)/i)?.[1];
  return id ?? ref.slice(0, 32);
}

/** Genera markdown del deliverable Pantallas. Devuelve `null` si no hay filas. */
export function buildUiScreensMarkdown(
  screens: ScreenSpec[],
  plan: PantallaPlanItem[],
  meta: UiScreensMarkdownMeta = {},
): string | null {
  if (!plan.length) return null;

  const projectTitle = (meta.projectName ?? "Proyecto").trim() || "Proyecto";
  const lines: string[] = [];
  lines.push(`# Pantallas — ${projectTitle}`);
  lines.push("");
  lines.push(implementationIntro(meta));
  lines.push("");

  const componentsCol = componentsColumnLabel(meta.libraryName);

  const libLine: string[] = [];
  if (meta.libraryName) {
    libLine.push(`**Librería:** ${meta.libraryName}${meta.libraryVersion ? ` ${meta.libraryVersion}` : ""}`);
  }
  if (meta.contractVersion) libLine.push(`**Contrato UI MCP:** ${meta.contractVersion}`);
  if (libLine.length > 0) {
    lines.push(libLine.join(" · "));
    lines.push("");
  }

  const v1Plan = plan.filter((p) => p.v1InScope !== false);
  const outOfScopePlan = plan.filter((p) => p.v1InScope === false);

  const byRole = new Map<string, PantallaPlanItem[]>();
  for (const item of v1Plan) {
    const role = item.role ?? "General";
    const bucket = byRole.get(role) ?? [];
    bucket.push(item);
    byRole.set(role, bucket);
  }

  for (const [role, items] of byRole) {
    lines.push(`## ${role}`);
    lines.push("");
    lines.push(
      `| Ruta | Página | US | ${componentsCol} | API principal | Estados | Layout | Responsive |`,
    );
    lines.push("|------|--------|-----|------------------|---------------|---------|--------|------------|");
    for (const item of items) {
      const screen = screens.find((s) => s.name === item.screenName);
      const route = item.route ?? "/";
      const page = item.pageName ?? item.screenName;
      lines.push(
        `| ${route} | ${page} | ${usCell(item)} | ${componentsForPlanItem(item, screens)} | ${apiCell(item, screen)} | ${item.uiStates ?? "loading, empty, error"} | ${layoutCell(item, screen)} | ${responsiveCell(item, screen)} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Layout transversal");
  lines.push("");
  lines.push("- **AppShell / AdminShell:** producto y admin comparten DS; shells distintos (`AppShell` vs `AdminShell`).");
  lines.push("- **Layout shell:** nav por rol (ver tablas anteriores); iconos y orden según journey.");
  lines.push("- **Modales globales:** documentar impersonación, quota LLM 80%/100% en Tasks si aplican.");
  lines.push("- **Responsive (obligatorio):** mobile-first; sm 640 / md 768 / lg 1024 / xl 1280; tablas → cards/stack bajo md; sin scroll horizontal.");
  lines.push("");

  const outOfScope = [
    ...outOfScopePlan,
    ...plan.filter(
      (p) => p.v1InScope !== false && !p.primaryApi && !p.restEndpoint && p.source === "entity",
    ),
  ];
  const outUnique = [...new Map(outOfScope.map((p) => [p.name, p])).values()];
  if (outUnique.length > 0) {
    lines.push("## Fuera de alcance v1");
    lines.push("");
    lines.push("> Pantallas sin API v1: no generar ruta en MVP salvo que se añada contrato + task Frontend.");
    lines.push("");
    for (const item of outUnique.slice(0, 12)) {
      lines.push(`- CRUD admin \`${item.name}\` — sin endpoint en api-contracts v1`);
    }
    lines.push("");
  }

  const catalogTitle = meta.libraryName
    ? `## Anexo — Catálogo (${meta.libraryName})`
    : "## Anexo — Catálogo de componentes";
  lines.push(catalogTitle);
  lines.push("");
  lines.push(
    "> Referencia rápida. **Tokens visuales solo en `design-system.md`.** Detalle por pantalla en tablas anteriores.",
  );
  lines.push("");
  lines.push("| Componente | Rutas |");
  lines.push("|------------|-------|");
  const compRoutes = new Map<string, Set<string>>();
  for (const item of plan) {
    const comps = componentsForPlanItem(item, screens)
      .replace(/`/g, "")
      .split(", ")
      .filter((c) => c && c !== "—");
    const route = item.route ?? "/";
    for (const comp of comps) {
      const name = comp.replace(/\s+`.*$/, "").trim();
      if (!name) continue;
      const bucket = compRoutes.get(name) ?? new Set<string>();
      bucket.add(route);
      compRoutes.set(name, bucket);
    }
  }
  for (const [comp, routes] of [...compRoutes.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`| \`${comp}\` | ${[...routes].join(", ")} |`);
  }
  if (compRoutes.size === 0) {
    lines.push("| — | — |");
  }
  lines.push("");

  return lines.join("\n").trimEnd() + "\n";
}

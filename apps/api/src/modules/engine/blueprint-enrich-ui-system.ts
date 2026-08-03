import { extractSection3Body } from "../ai-analysis/utils/mdd-sanitize.js";
import { resolveStackPreset } from "@theforge/shared-types";
import {
  heuristicUiComponentResolver,
  type UiComponentResolver,
} from "../ui-mcp/ui-component-resolver.js";
import { extractRolesFromMdd } from "../ui-mcp/ui-screen-routes.util.js";

// ---------------------------------------------------------------------------
// UI Design System & Component Mapping — Blueprint Section 8
// ---------------------------------------------------------------------------

export interface BlueprintUiEnrichOptions {
  pantallasContent?: string | null;
  apiContractsContent?: string | null;
}

function parseEntitiesFromSection3(section3: string): string[] {
  const entities: string[] = [];
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|')?(\w+)(?:`|"|')?/gi;
  let match;
  while ((match = regex.exec(section3)) !== null) {
    const name = match[1];
    if (name && !entities.includes(name)) entities.push(name);
  }
  return entities;
}

function hasPantallasDeliverable(content: string | null | undefined): boolean {
  const t = (content ?? "").trim();
  return t.length > 0 && /#\s*Pantallas/i.test(t);
}

/**
 * Enriquecimiento del Blueprint §8: alineado a `pantallas.md` cuando existe;
 * si no, directrices de layout sin CRUD genérico por entidad.
 */
export async function enrichBlueprintWithUiDesignSystem(
  mddContent: string,
  existingBlueprint: string,
  resolver: UiComponentResolver = heuristicUiComponentResolver,
  options: BlueprintUiEnrichOptions = {},
): Promise<string> {
  if (/^##\s*9\.?\s*UI\s+Design\s+System/im.test(existingBlueprint)) {
    return existingBlueprint;
  }

  const section3 = extractSection3Body(mddContent);
  const roles = extractRolesFromMdd(mddContent);
  const pantallas = options.pantallasContent ?? null;
  const stackPreset = resolveStackPreset(mddContent, existingBlueprint);
  const uiStackLabel = stackPreset.adapterLabel;

  const lines: string[] = [];
  lines.push("");
  lines.push("## 9. UI Design System & Component Mapping");
  lines.push("");

  if (hasPantallasDeliverable(pantallas)) {
    lines.push(
      "> **SSOT de pantallas:** el detalle pantalla → ruta → componente UI → API está en `pantallas.md`. " +
        "Esta §8 documenta layout transversal y reglas de implementación; **no** contradice `pantallas.md`.",
    );
  } else {
    lines.push(
      "> Genera `pantallas.md` (MCP gráfico + Historias de Usuario) antes de implementar UI. " +
        "Esta §8 solo define layout transversal y restricciones; evita mapear cada tabla §3 a un componente.",
    );
  }
  lines.push("");

  lines.push("### Layout transversal");
  lines.push("");
  lines.push("- **Shell:** `AppLayout` con navegación por rol.");
  for (const role of roles.slice(0, 6)) {
    lines.push(`  - **${role}:** ítems de nav definidos en \`pantallas.md\` (orden, iconos, rutas protegidas).`);
  }
  lines.push("- **Auth:** guards JWT (`role`, `tenant_id`); banners globales (impersonación, quota LLM) en `pantallas.md`.");
  lines.push("- **Tokens:** `design-system.md` — tema canónico único (`light`|`dark`|`system` + preset del stack si aplica).");
  lines.push("");

  lines.push("### Reglas de componente (sin auto-CRUD)");
  lines.push("");
  lines.push("1. **No** asignes `DataTable`/`KanbanBoard` por cada entidad §3.");
  lines.push("2. **Kanban** solo si `pantallas.md` describe pipeline arrastrable visible al usuario.");
  lines.push("3. Logs, OTP, auditoría, tokens → `DataTable`, `AuditList` o `EmptyState`; **no** Kanban.");
  lines.push("4. Endpoints en UI **solo** los de `api-contracts.md` — prohibido `GET /api/v1/{tabla}` inventado.");
  lines.push("5. Formularios: React Hook Form + Zod; schemas alineados a contratos API.");
  lines.push("6. Responsive: `< md` → `MobileStackView` o cards; touch ≥ 44px; WCAG AA.");
  lines.push("");

  if (hasPantallasDeliverable(pantallas)) {
    lines.push("### Alineación a pantallas.md");
    lines.push("");
    lines.push(
      "Implementación UI según tablas por rol en `pantallas.md` (Ruta, Página, US, Componentes UI, API, Estados). " +
        `Componentes del MCP gráfico activo o convención **${uiStackLabel}** según \`design-system.md\`.`,
    );
    lines.push("");
  } else if (section3) {
    const entityNames = parseEntitiesFromSection3(section3);
    if (entityNames.length > 0) {
      lines.push("### Entidades §3 (referencia — no mapa UI)");
      lines.push("");
      lines.push(
        "Dominio modelado (" +
          entityNames.slice(0, 12).map((n) => `\`${n}\``).join(", ") +
          (entityNames.length > 12 ? ", …" : "") +
          "); definir pantallas en `pantallas.md` antes de codificar vistas.",
      );
      lines.push("");
    }
  }

  void resolver;

  return existingBlueprint.trimEnd() + "\n" + lines.join("\n") + "\n";
}

const NO_UI_SURFACE_PATTERN =
  /(?:sin|no)\s+(?:dashboard|frontend|ui|interfaz|pantalla|panel\s+web)|fuera\s+del\s+alcance[^\n]{0,60}(?:mvp|panel\s+web)|solo\s+APIs?\s+y\s+CLI|api[\s-]?only|mvp\s+api|cli[\s-]?only|solo\s+api|backend\s+only/i;

function mddExcludesUiSurface(mddContent: string): boolean {
  const sec1 = mddContent.match(/##\s*1\.[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)?.[1] ?? "";
  const sec2 = mddContent.match(/##\s*2\.[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i)?.[1] ?? "";
  return NO_UI_SURFACE_PATTERN.test(`${sec1}\n${sec2}`);
}

/** Califica menciones UI en blueprint ya generado cuando el MDD excluye panel web. */
export function qualifyBlueprintPostMvpUiMentions(
  mddContent: string,
  existingBlueprint: string,
): string {
  if (!mddExcludesUiSurface(mddContent)) return existingBlueprint;
  return existingBlueprint.replace(
    /Todos los formularios deben usar \*\*React Hook Form\*\*/gi,
    "Post-MVP panel web: formularios con **React Hook Form** + **Zod**; schemas derivados del contrato de datos",
  );
}

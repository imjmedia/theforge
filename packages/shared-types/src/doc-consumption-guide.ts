/**
 * SSOT: guía de consumo de documentos para agentes implementadores (layout spec-kit dual).
 */

import { GOVERNANCE_DOCS_PREFIX } from "./agent-governance.js";
import {
  formatDocumentPathMapTable,
  formatDocumentPathMapTableStatic,
  formatWorkshopSupplementSection,
} from "./document-layout.js";

/** Guía en raíz del ZIP handoff (misma contenido que la copia en gobernanza). */
export const ROOT_THEFORGE_DOC_CONSUMPTION_GUIDE = "THEFORGE-DOC-CONSUMPTION-GUIDE.md";

/** Copia bajo docs/agent-governance/references/ (rules/skills pueden enlazarla). */
export const GOVERNANCE_THEFORGE_DOC_CONSUMPTION_GUIDE = `${GOVERNANCE_DOCS_PREFIX}references/THEFORGE-DOC-CONSUMPTION-GUIDE.md`;

function formatPathMapTable(featureDir?: string): string {
  if (featureDir?.trim()) {
    return formatDocumentPathMapTable(featureDir.trim());
  }
  return formatDocumentPathMapTableStatic();
}

/** Genera la guía canónica (spec-kit primario ↔ docs/sdd espejo). */
export function buildTheforgeDocConsumptionGuide(featureDir?: string): string {
  const featureRef = featureDir?.trim() || "specs/NNN-slug";
  const tasksPath = `${featureRef}/tasks.md`;
  const planPath = `${featureRef}/plan.md`;
  const specPath = `${featureRef}/spec.md`;
  const contractsPath = `${featureRef}/contracts/`;
  return (
    "# Guía de consumo de documentos TheForge\n\n" +
    "Resumen para agentes que implementan desde entregables SDD incluidos en el handoff The Forge.\n\n" +
    "## Orden de lectura (primario spec-kit, espejo docs/sdd)\n\n" +
    "1. **`IMPLEMENT.md`** — bootstrap, instalación de gobernania y mapa de rutas.\n" +
    "2. **`.specify/memory/constitution.md`** — Constitución (MDD); espejo: `docs/sdd/mdd.md`.\n" +
    `3. **\`${featureRef}/research.md\`** — Paso 0 / investigación (si existe); espejo: \`docs/sdd/research.md\`.\n` +
    `4. **\`${specPath}\`** — Requisitos y criterios de aceptación; espejo: \`docs/sdd/spec.md\`.\n` +
    `5. **\`${featureRef}/architecture.md\`**, **\`use-cases.md\`**, **\`user-stories.md\`** — cuando existan.\n` +
    `6. **\`${planPath}\`** — Blueprint / plan técnico; espejo: \`docs/sdd/blueprint.md\`.\n` +
    `7. **\`${featureRef}/design-system.md\`** y **\`pantallas.md\`** — **antes de UI** (espejos \`ux-ui-guide.md\`, \`pantallas.md\`). Si existe **\`pantallas.md\`**, gana sobre heurísticas de Blueprint §8. Importar componentes **solo** vía adapter \`packages/ui\` (\`@scope/ui\`); mismo DS en producto y admin (\`AppShell\` / \`AdminShell\`). Responsive mobile-first (sm–xl) documentado en pantallas y tasks.\n` +
    `8. **\`${contractsPath}api-contracts.md\`** y **\`${featureRef}/logic-flows.md\`** — contratos y flujos (**vinculantes** si existen).\n` +
    `9. **\`${tasksPath}\`** — Checklist de implementación; espejo: \`docs/sdd/tasks.md\`.\n` +
    `10. **\`${featureRef}/infra.md\`**, **\`data-model.md\`**, **\`docs/sdd/decisions/*.md\`**, **\`quickstart.md\`** — cuando existan.\n\n` +
    "### Mapeo de rutas\n\n" +
    formatPathMapTable(featureDir) +
    "\n\n" +
    formatWorkshopSupplementSection(featureDir) +
    "\n\n" +
    "**El layout spec-kit es canónico.** Los archivos bajo `docs/sdd/` son espejo para rules/skills; ante conflicto de contenido, gana el primario.\n\n" +
    "## Prioridad ante conflictos\n\n" +
    "**El MDD manda.** Si un entregable contradice otro, sigue MDD §2–§6 y documenta la resolución en `docs/sdd/PROGRESO.md`.\n\n" +
    "## Gates antes de cerrar tareas\n\n" +
    "- Lint, typecheck y tests del paquete tocado.\n" +
    `- Contratos API alineados a \`${contractsPath}\` o \`docs/sdd/api-contracts.md\` cuando exista.\n` +
    "- Actualizar `docs/sdd/PROGRESO.md` y **`" +
    tasksPath +
    "`** al completar ítems de Tasks.\n"
  );
}

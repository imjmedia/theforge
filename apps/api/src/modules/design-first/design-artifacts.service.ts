import { Injectable } from "@nestjs/common";
import {
  buildPagFixtures,
  exportPagToMswHandlers,
  exportPagToOpenApiSpec,
  exportPagToOpenApiYaml,
  parseDesignSpec,
  projectArchitectureGraphSchema,
  renderDesignMarkdown,
  type DesignSpec,
  type ProjectArchitectureGraph,
  type SpecKitBundleFile,
} from "@theforge/shared-types";
import type { Stage } from "@theforge/database";
import { validateOpenApi31 } from "./openapi-validate.util.js";

export function buildMswReadmeMarkdown(): string {
  return [
    "# Mocks MSW (Design-First)",
    "",
    "Handlers generados determinísticamente desde el PAG del proyecto.",
    "",
    "## Dependencia",
    "",
    "Instala **msw@^2** en el frontend o en el repo destino:",
    "",
    "```bash",
    "npm install msw@^2 --save-dev",
    "```",
    "",
    "## Uso",
    "",
    "- `handlers.ts` — handlers para entorno Node/tests.",
    "- `browser.ts` — worker para el navegador.",
    "- `fixtures/*.json` — datos de ejemplo con semilla fija.",
    "",
    "Header opcional `x-mock-state`: `empty` | `error` para variantes.",
    "",
  ].join("\n");
}

export function buildDesignFirstHandoffArtifacts(input: {
  designSpec: DesignSpec;
  pag: ProjectArchitectureGraph | null;
}): SpecKitBundleFile[] {
  const md = renderDesignMarkdown(input.designSpec);
  const files: SpecKitBundleFile[] = [
    { path: "docs/sdd/pantallas.md", content: md.pantallasMd },
    { path: "docs/sdd/datos.md", content: md.datosMd },
  ];

  if (!input.pag) return files;

  files.push({ path: "openapi.yaml", content: exportPagToOpenApiYaml(input.pag) });
  const msw = exportPagToMswHandlers(input.pag);
  files.push({ path: "mocks/handlers.ts", content: msw.handlersTs });
  files.push({ path: "mocks/browser.ts", content: msw.browserTs });
  files.push({ path: "mocks/README.md", content: buildMswReadmeMarkdown() });

  const fixtures = buildPagFixtures(input.pag);
  for (const [name, payload] of Object.entries(fixtures)) {
    files.push({
      path: `mocks/fixtures/${name}`,
      content: `${JSON.stringify(payload, null, 2)}\n`,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function buildDesignFirstHandoffArtifactsFromStage(stage: Stage | null | undefined): SpecKitBundleFile[] {
  if (!stage) return [];
  const designSpec = parseDesignSpec(
    stage.designSpec ?? { schemaVersion: 1, entities: [], screens: [], navigation: [], dataNeeds: [] },
  );
  let pag: ProjectArchitectureGraph | null = null;
  if (stage.architectureGraph) {
    const parsed = projectArchitectureGraphSchema.safeParse(stage.architectureGraph);
    if (parsed.success) pag = parsed.data;
  }
  return buildDesignFirstHandoffArtifacts({ designSpec, pag });
}

@Injectable()
export class DesignArtifactsService {
  buildFromStage(stage: Stage | null | undefined): SpecKitBundleFile[] {
    return buildDesignFirstHandoffArtifactsFromStage(stage);
  }

  assertOpenApiArtifact(pag: ProjectArchitectureGraph): void {
    const result = validateOpenApi31(exportPagToOpenApiSpec(pag));
    if (!result.ok) {
      throw new Error(`OpenAPI de handoff inválido: ${result.issues.map((i) => i.message).join("; ")}`);
    }
  }
}

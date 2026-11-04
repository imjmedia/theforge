import type { DesignSpec } from "./design-spec.js";

export type DesignMarkdownExport = {
  pantallasMd: string;
  datosMd: string;
};

function stableLines(lines: string[]): string {
  return `${lines.join("\n").trimEnd()}\n`;
}

export function renderDesignPantallasMarkdown(spec: DesignSpec): string {
  const lines: string[] = [
    "# Pantallas (Design-First)",
    "",
    "> Generado determinísticamente desde `designSpec`.",
    "",
  ];

  const screens = [...spec.screens].sort((a, b) => a.id.localeCompare(b.id));
  for (const screen of screens) {
    lines.push(`## ${screen.name} (\`${screen.id}\`)`, "");
    lines.push(`- **Ruta:** \`${screen.route}\``);
    if (screen.static) lines.push("- **Estática:** sí");
    if (screen.purpose?.trim()) lines.push(`- **Propósito:** ${screen.purpose.trim()}`);
    lines.push(
      `- **Componentes:** ${screen.components.length > 0 ? screen.components.map((c) => c.id).join(", ") : "(ninguno)"}`,
    );
    lines.push("");
  }

  lines.push("## Navegación", "");
  const nav = [...spec.navigation].sort((a, b) => a.id.localeCompare(b.id));
  if (nav.length === 0) {
    lines.push("_Sin aristas de navegación._", "");
  } else {
    lines.push("| Desde | Hacia | Evento |", "|:------|:------|:-------|");
    for (const edge of nav) {
      lines.push(
        `| \`${edge.from}\` | \`${edge.to}\` | ${edge.trigger.event}${edge.trigger.componentId ? ` (${edge.trigger.componentId})` : ""} |`,
      );
    }
    lines.push("");
  }

  return stableLines(lines);
}

export function renderDesignDatosMarkdown(spec: DesignSpec): string {
  const lines: string[] = [
    "# Datos (Design-First)",
    "",
    "> Entidades y necesidades de datos del `designSpec`.",
    "",
    "## Entidades",
    "",
  ];

  const entities = [...spec.entities].sort((a, b) => a.id.localeCompare(b.id));
  if (entities.length === 0) {
    lines.push("_Sin entidades._", "");
  } else {
    lines.push("| Id | Nombre | REST |", "|:---|:-------|:-----|");
    for (const ent of entities) {
      lines.push(
        `| \`${ent.id}\` | ${ent.name} | ${ent.restEndpoint ? `\`${ent.restEndpoint}\`` : "—"} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Necesidades de datos", "");
  const needs = [...spec.dataNeeds].sort((a, b) => a.screenId.localeCompare(b.screenId));
  if (needs.length === 0) {
    lines.push("_Sin dataNeeds._", "");
  } else {
    for (const entry of needs) {
      lines.push(`### Pantalla \`${entry.screenId}\``, "");
      if (entry.states.length) {
        lines.push(`- **Estados:** ${entry.states.join(", ")}`);
      }
      for (const block of [...entry.components].sort((a, b) =>
        a.componentId.localeCompare(b.componentId),
      )) {
        lines.push(`- **Componente \`${block.componentId}\`:**`);
        for (const need of [...block.needs].sort((a, b) => a.id.localeCompare(b.id))) {
          lines.push(
            `  - \`${need.id}\` (${need.type}) → entidad \`${need.action}\`${need.endpointHint ? ` · hint \`${need.endpointHint}\`` : ""}`,
          );
        }
      }
      lines.push("");
    }
  }

  return stableLines(lines);
}

export function renderDesignMarkdown(spec: DesignSpec): DesignMarkdownExport {
  return {
    pantallasMd: renderDesignPantallasMarkdown(spec),
    datosMd: renderDesignDatosMarkdown(spec),
  };
}

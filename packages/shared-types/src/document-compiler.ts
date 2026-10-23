import type { ProjectArchitectureGraph } from "./project-architecture-graph.js";

/**
 * ═══════════════════════════════════════════════════════════
 * Document Compiler — Compilación Determinista desde PAG
 * ═══════════════════════════════════════════════════════════
 * Genera Markdown 100% válido (tablas GFM cerradas, bloques tipados)
 * directamente del grafo de arquitectura sin invocar LLMs ni parsers regex.
 */

/**
 * Compila la sección de Contratos de API a Markdown determinista.
 */
export function compilePagToApiContractsMarkdown(pag: ProjectArchitectureGraph): string {
  const lines: string[] = [
    `# Contratos de API — ${pag.projectName}`,
    "",
    "> Documento compilado determinísticamente desde el Project Architecture Graph (PAG).",
    "",
    "## 1. Catálogo de Endpoints",
    "",
    "| Método | Ruta | Descripción | Auth | Entidad |",
    "|:-------|:-----|:------------|:-----|:--------|",
  ];

  if (pag.endpoints.length === 0) {
    lines.push("| GET | /api/health | Health check del sistema | Pública | N/A |");
  } else {
    for (const ep of pag.endpoints) {
      const auth = ep.authRequired ? "Bearer JWT" : "Pública";
      const entity = ep.targetEntity ?? "—";
      const desc = ep.description ? ep.description.replace(/\|/g, "-") : "Operación de API";
      lines.push(`| **${ep.method}** | \`${ep.path}\` | ${desc} | ${auth} | ${entity} |`);
    }
  }

  lines.push("", "## 2. Esquemas de Entrada y Salida (Payloads)", "");

  for (const ep of pag.endpoints) {
    lines.push(`### ${ep.method} ${ep.path}`, "");
    if (ep.description) {
      lines.push(ep.description, "");
    }
    if (ep.requestSchema && Object.keys(ep.requestSchema).length > 0) {
      lines.push("**Request Body (JSON Schema):**", "```json", JSON.stringify(ep.requestSchema, null, 2), "```", "");
    }
    if (ep.responseSchema && Object.keys(ep.responseSchema).length > 0) {
      lines.push("**Response Body (200/201):**", "```json", JSON.stringify(ep.responseSchema, null, 2), "```", "");
    }
  }

  lines.push(
    "## 3. Códigos de Estado y Manejo de Errores",
    "",
    "| Código | Significado | Escenario |",
    "|:-------|:------------|:----------|",
    "| `200` | OK | Consulta o actualización exitosa |",
    "| `201` | Created | Creación de recurso exitosa |",
    "| `400` | Bad Request | Parámetros o DTO inválidos |",
    "| `401` | Unauthorized | Token ausente o expirado |",
    "| `403` | Forbidden | Permisos insuficientes |",
    "| `404` | Not Found | Recurso no encontrado |",
    "| `422` | Unprocessable Entity | Error de validación de negocio |",
    "| `500` | Internal Server Error | Error no controlado en servidor |",
    "",
  );

  return lines.join("\n");
}

/**
 * Compila el modelo de datos y persistencia a Markdown determinista.
 */
export function compilePagToPersistenceMarkdown(pag: ProjectArchitectureGraph): string {
  const lines: string[] = [
    `# Modelo de Datos y Persistencia — ${pag.projectName}`,
    "",
    `**Stack de Base de Datos:** ${pag.stack.database} con ORM ${pag.stack.orm}`,
    "",
    "## Entidades del Dominio",
    "",
  ];

  for (const entity of pag.entities) {
    lines.push(`### ${entity.name}`, "");
    if (entity.description) {
      lines.push(entity.description, "");
    }
    lines.push("| Campo | Tipo | Obligatorio | Restricciones / Notas |", "|:------|:-----|:------------|:----------------------|");
    for (const field of entity.fields) {
      const req = field.required ? "Sí" : "Opcional";
      const constraints = field.constraints
        .map((c) => {
          if (c.type === "foreign_key" && c.reference) {
            return `FK → \`${c.reference.entity}.${c.reference.field}\``;
          }
          return c.type;
        })
        .join(", ") || "—";
      lines.push(`| \`${field.name}\` | \`${field.type}\` | ${req} | ${constraints} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Compila el mapa de módulos NestJS / arquitectura técnica a Markdown determinista.
 */
export function compilePagToBlueprintModulesMarkdown(pag: ProjectArchitectureGraph): string {
  const lines: string[] = [
    "### 3. Mapa de contratos API → módulos de implementación",
    "",
    "| Ruta | Método | Módulo NestJS | Servicio / Handler |",
    "|:-----|:-------|:--------------|:-------------------|",
  ];

  for (const ep of pag.endpoints) {
    const matchingService =
      pag.services.find((s) => s.handledEndpoints.includes(ep.path))?.name ??
      (ep.targetEntity ? `${ep.targetEntity}Module` : "CoreModule");
    const handler = `${matchingService.replace(/Module$/, "")}Controller`;
    lines.push(`| \`${ep.path}\` | **${ep.method}** | \`${matchingService}\` | \`${handler}\` |`);
  }

  lines.push("");
  return lines.join("\n");
}

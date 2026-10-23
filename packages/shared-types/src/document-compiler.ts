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

/**
 * Compila los diagramas de secuencia Mermaid y la lógica de flujos a Markdown determinista.
 */
export function compilePagToLogicFlowsMarkdown(pag: ProjectArchitectureGraph): string {
  const lines: string[] = [
    `# Flujos Lógicos y Secuencias de Negocio — ${pag.projectName}`,
    "",
    "> Documento compilado determinísticamente desde el Project Architecture Graph (PAG).",
    "",
    "## 1. Diagramas de Secuencia y Flujos por Endpoint",
    "",
  ];

  if (pag.endpoints.length === 0) {
    lines.push(
      "```mermaid",
      "sequenceDiagram",
      "  autonumber",
      "  actor User as Usuario",
      "  participant API as Backend API",
      "  User->>API: GET /health",
      "  API-->>User: 200 OK",
      "```",
      "",
    );
  } else {
    for (const ep of pag.endpoints) {
      const serviceName =
        pag.services.find((s) => s.handledEndpoints.includes(ep.path))?.name ??
        (ep.targetEntity ? `${ep.targetEntity}Service` : "AppService");
      const entity = ep.targetEntity ?? "Persistencia";
      const successCode = ep.method === "POST" ? "201 Created" : "200 OK";

      lines.push(
        `### Flujo: ${ep.method} ${ep.path}`,
        "",
        ep.description ?? `Flujo transaccional para la operación ${ep.method} en ${ep.path}.`,
        "",
        "```mermaid",
        "sequenceDiagram",
        "  autonumber",
        "  actor Client as Cliente / Frontend",
        "  participant Controller as API Controller",
        `  participant Service as ${serviceName}`,
        `  participant DB as ${pag.stack.database} (${pag.stack.orm})`,
        `  Client->>Controller: ${ep.method} ${ep.path}`,
      );

      if (ep.authRequired) {
        const roles = ep.rolesAllowed.length > 0 ? ep.rolesAllowed.join(", ") : "Autenticado";
        lines.push(`  Note over Controller: Validar JWT Guard (${roles})`);
      }

      lines.push(
        "  Controller->>Service: invokeOperation(dto)",
        `  Service->>DB: query/persist (${entity})`,
        "  DB-->>Service: resultado / entityRecord",
        "  Service-->>Controller: domainResultDTO",
        `  Controller-->>Client: HTTP ${successCode}`,
        "```",
        "",
      );
    }
  }

  lines.push(
    "## 2. Invariantes de Negocio y Manejo de Errores",
    "",
    "| Endpoint | Invariante / Regla | Falla / Error | Código HTTP |",
    "|:---------|:-------------------|:--------------|:------------|",
  );

  for (const ep of pag.endpoints) {
    const inv = ep.description ? ep.description.replace(/\|/g, "-") : "Operación atómica";
    lines.push(`| \`${ep.method} ${ep.path}\` | ${inv} | Datos inválidos o no encontrado | 400 / 404 |`);
  }

  lines.push(
    "",
    "## 3. Registro de cambios del documento",
    "",
    "| Versión | Fecha | Autor | Descripción |",
    "|:--------|:------|:------|:------------|",
    "| 1.0 | 2026-10-22 | DocumentCompiler (PAG) | Compilación inicial determinista sin LLM |",
    "",
  );

  return lines.join("\n");
}

/**
 * Compila la topología de arquitectura, Docker Compose y variables de entorno a Markdown determinista.
 */
export function compilePagToInfraMarkdown(pag: ProjectArchitectureGraph): string {
  const dbService = pag.stack.database.toLowerCase().includes("mongo") ? "mongo" : "postgres";
  const dbImage = dbService === "postgres" ? "postgres:16-alpine" : "mongo:7-jammy";
  const dbPort = dbService === "postgres" ? "5432:5432" : "27017:27017";

  const lines: string[] = [
    `# Especificación de Infraestructura y Despliegue — ${pag.projectName}`,
    "",
    "> Documento compilado determinísticamente desde el Project Architecture Graph (PAG).",
    "",
    "## 1. Topología de Componentes de Infraestructura",
    "",
    "```mermaid",
    "graph TD",
    `  Client[Cliente / Navegador] --> WebApp[Frontend Service: ${pag.stack.frontendFramework}]`,
    `  WebApp --> API[Backend API: ${pag.stack.backendFramework} / ${pag.stack.runtime}]`,
    `  API --> DB[(${pag.stack.database} con ${pag.stack.orm})]`,
  ];

  if (pag.stack.cache) {
    lines.push(`  API --> Cache[(${pag.stack.cache})]`);
  }
  if (pag.stack.queue) {
    lines.push(`  API --> QueueService[(${pag.stack.queue})]`);
  }

  lines.push(
    "```",
    "",
    "## 2. Definición Docker Compose (`docker-compose.yml`)",
    "",
    "```yaml",
    "version: '3.8'",
    "",
    "services:",
    `  ${dbService}:`,
    `    image: ${dbImage}`,
    "    restart: unless-stopped",
    "    environment:",
  );

  if (dbService === "postgres") {
    lines.push(
      "      POSTGRES_DB: app_database",
      "      POSTGRES_USER: app_user",
      "      POSTGRES_PASSWORD: app_secure_password",
    );
  } else {
    lines.push(
      "      MONGO_INITDB_ROOT_USERNAME: app_user",
      "      MONGO_INITDB_ROOT_PASSWORD: app_secure_password",
    );
  }

  lines.push(
    "    ports:",
    `      - "${dbPort}"`,
    "    volumes:",
    `      - ${dbService}_data:/var/lib/${dbService}/data`,
    "",
    "  api:",
    "    build:",
    "      context: .",
    "      dockerfile: apps/api/Dockerfile",
    "    restart: unless-stopped",
    "    ports:",
    '      - "3000:3000"',
    "    environment:",
    `      NODE_ENV: production`,
    `      PORT: 3000`,
    `      DATABASE_URL: "${dbService === "postgres" ? "postgresql://app_user:app_secure_password@postgres:5432/app_database" : "mongodb://app_user:app_secure_password@mongo:27017/app_database"}"`,
    "    depends_on:",
    `      - ${dbService}`,
    "",
    "volumes:",
    `  ${dbService}_data:`,
    "```",
    "",
    "## 3. Matriz de Variables de Entorno",
    "",
    "| Variable | Propósito | Requerido | Ejemplo / Valor por Defecto |",
    "|:---------|:----------|:----------|:----------------------------|",
    "| `NODE_ENV` | Entorno de ejecución | Sí | `production` |",
    "| `PORT` | Puerto de escucha del servidor | Sí | `3000` |",
    "| `DATABASE_URL` | String de conexión a base de datos | Sí | `postgresql://user:pass@localhost:5432/db` |",
    "| `JWT_SECRET` | Clave secreta para tokens JWT | Sí | `super_secret_enterprise_key_2026` |",
    "",
    "## 4. Registro de cambios del documento",
    "",
    "| Versión | Fecha | Autor | Descripción |",
    "|:--------|:------|:------|:------------|",
    "| 1.0 | 2026-10-22 | DocumentCompiler (PAG) | Compilación inicial de infraestructura sin LLM |",
    "",
  );

  return lines.join("\n");
}

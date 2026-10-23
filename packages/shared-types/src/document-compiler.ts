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

/**
 * ═══════════════════════════════════════════════════════════
 * Exportador Nativo OpenAPI 3.1.0 desde PAG (Zero-LLM)
 * ═══════════════════════════════════════════════════════════
 */

/**
 * Exporta el ProjectArchitectureGraph (PAG) a una especificación OpenAPI 3.1.0 formal.
 */
export function exportPagToOpenApiSpec(pag: ProjectArchitectureGraph): Record<string, any> {
  const paths: Record<string, any> = {};
  const schemas: Record<string, any> = {};

  // 1. Schemas de componentes desde pag.entities
  for (const entity of pag.entities) {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const field of entity.fields) {
      properties[field.name] = {
        type: mapFieldTypeToOpenApiType(field.type),
        ...(field.description ? { description: field.description } : {}),
      };
      if (field.required) {
        required.push(field.name);
      }
    }

    schemas[entity.name] = {
      type: "object",
      description: entity.description ?? `Entidad de dominio ${entity.name}`,
      properties,
      ...(required.length > 0 ? { required } : {}),
    };
  }

  // 2. Paths y operaciones desde pag.endpoints
  for (const ep of pag.endpoints) {
    const openApiPath = ep.path.startsWith("/")
      ? ep.path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")
      : `/${ep.path.replace(/:([a-zA-Z0-9_]+)/g, "{$1}")}`;
    if (!paths[openApiPath]) {
      paths[openApiPath] = {};
    }

    const method = ep.method.toLowerCase();
    const pathParams = Array.from(openApiPath.matchAll(/\{([a-zA-Z0-9_]+)\}/g)).map((m) => m[1]);

    const parameters = pathParams.map((p) => ({
      name: p,
      in: "path",
      required: true,
      schema: { type: "string" },
      description: `Parámetro de ruta ${p}`,
    }));

    const responses: Record<string, any> = {};
    const successCode = method === "post" ? "201" : "200";

    responses[successCode] = {
      description: "Operación completada con éxito",
      content: {
        "application/json": {
          schema:
            ep.responseSchema ??
            (ep.targetEntity && schemas[ep.targetEntity]
              ? { $ref: `#/components/schemas/${ep.targetEntity}` }
              : { type: "object" }),
        },
      },
    };

    for (const code of ep.errorCodes) {
      responses[String(code)] = {
        description: `Respuesta de error ${code}`,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                statusCode: { type: "integer", example: code },
                message: { type: "string" },
                error: { type: "string" },
              },
            },
          },
        },
      };
    }

    const operation: Record<string, any> = {
      summary: ep.description ? ep.description.slice(0, 80) : `${ep.method} ${openApiPath}`,
      description: ep.description ?? `Operación ${ep.method} sobre ${ep.targetEntity ?? "recurso"}`,
      responses,
    };

    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    if (ep.targetEntity) {
      operation.tags = [ep.targetEntity];
    }

    if (ep.authRequired) {
      operation.security = [{ bearerAuth: ep.rolesAllowed.length ? ep.rolesAllowed : [] }];
    }

    if (ep.requestSchema && ["post", "put", "patch"].includes(method)) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: ep.requestSchema,
          },
        },
      };
    }

    paths[openApiPath][method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: pag.projectName,
      version: pag.version ?? "1.0.0",
      description: `Especificación OpenAPI 3.1 generada determinísticamente desde el Project Architecture Graph (PAG) para ${pag.projectName}.`,
    },
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Autenticación Bearer JWT",
        },
      },
    },
  };
}

function mapFieldTypeToOpenApiType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("int") || t.includes("number")) return "integer";
  if (t.includes("float") || t.includes("decimal") || t.includes("double")) return "number";
  if (t.includes("bool")) return "boolean";
  if (t.includes("date") || t.includes("time")) return "string";
  if (t.includes("json")) return "object";
  if (t.includes("array") || t.endsWith("[]")) return "array";
  return "string";
}

/**
 * Convierte un objeto de JavaScript en una cadena YAML válida de manera determinista.
 */
export function stringifyToYaml(data: any, indentLevel = 0): string {
  const indent = "  ".repeat(indentLevel);
  if (data === null || data === undefined) {
    return "null";
  }
  if (typeof data === "boolean" || typeof data === "number") {
    return String(data);
  }
  if (typeof data === "string") {
    if (data === "" || /[\n:#\-\[\]{},"']/.test(data)) {
      return JSON.stringify(data);
    }
    return data;
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return "[]";
    const lines: string[] = [];
    for (const item of data) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const objYaml = stringifyToYaml(item, indentLevel + 1);
        const [first, ...rest] = objYaml.split("\n");
        lines.push(`${indent}- ${(first ?? "").trimStart()}`);
        for (const r of rest) {
          lines.push(r);
        }
      } else {
        lines.push(`${indent}- ${stringifyToYaml(item, indentLevel + 1)}`);
      }
    }
    return lines.join("\n");
  }
  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length === 0) return "{}";
    const lines: string[] = [];
    for (const key of keys) {
      const val = data[key];
      if (val === undefined) continue;
      if (typeof val === "object" && val !== null) {
        if (Array.isArray(val) && val.length === 0) {
          lines.push(`${indent}${key}: []`);
        } else if (!Array.isArray(val) && Object.keys(val).length === 0) {
          lines.push(`${indent}${key}: {}`);
        } else {
          lines.push(`${indent}${key}:`);
          lines.push(stringifyToYaml(val, indentLevel + 1));
        }
      } else {
        lines.push(`${indent}${key}: ${stringifyToYaml(val, indentLevel + 1)}`);
      }
    }
    return lines.join("\n");
  }
  return String(data);
}

/**
 * Exporta el ProjectArchitectureGraph (PAG) a una especificación OpenAPI 3.1.0 en formato YAML.
 */
export function exportPagToOpenApiYaml(pag: ProjectArchitectureGraph): string {
  const spec = exportPagToOpenApiSpec(pag);
  return stringifyToYaml(spec);
}


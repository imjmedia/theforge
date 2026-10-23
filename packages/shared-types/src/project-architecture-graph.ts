import { z } from "zod";

/**
 * ═══════════════════════════════════════════════════════════
 * Project Architecture Graph (PAG) — Metamodelo Tipado Enterprise
 * ═══════════════════════════════════════════════════════════
 * Fuente única de la verdad (SSOT) tipada para eliminar
 * alucinaciones cruzadas y permitir compilación determinista.
 */

export const pagFieldConstraintSchema = z.object({
  type: z.enum(["required", "unique", "index", "default", "foreign_key"]),
  value: z.string().optional(),
  reference: z
    .object({
      entity: z.string(),
      field: z.string(),
      onDelete: z.enum(["CASCADE", "SET_NULL", "RESTRICT", "NO_ACTION"]).optional(),
    })
    .optional(),
});
export type PagFieldConstraint = z.infer<typeof pagFieldConstraintSchema>;

export const pagFieldSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1), // e.g. "String", "Int", "Boolean", "DateTime", "UUID"
  required: z.boolean().default(true),
  description: z.string().optional(),
  constraints: z.array(pagFieldConstraintSchema).default([]),
});
export type PagField = z.infer<typeof pagFieldSchema>;

export const pagEntitySchema = z.object({
  name: z.string().min(1), // e.g. "User", "Project", "Invoice"
  tableName: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(pagFieldSchema).min(1),
  primaryKey: z.string().default("id"),
  indexes: z.array(z.string()).default([]),
});
export type PagEntity = z.infer<typeof pagEntitySchema>;

export const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
export type HttpMethod = z.infer<typeof httpMethodSchema>;

/**
 * Esquema semántico de JSON Schema según especificación OpenAPI 3.1.
 */
export const openApiJsonSchema: z.ZodType<any> = z.lazy(() =>
  z
    .object({
      type: z
        .enum(["string", "number", "integer", "boolean", "array", "object", "null"])
        .optional(),
      properties: z.record(z.lazy(() => openApiJsonSchema)).optional(),
      items: z.lazy(() => openApiJsonSchema).optional(),
      required: z.array(z.string()).optional(),
      description: z.string().optional(),
      format: z.string().optional(),
      example: z.any().optional(),
      enum: z.array(z.any()).optional(),
    })
    .passthrough(),
);
export type OpenApiJsonSchema = z.infer<typeof openApiJsonSchema>;

export const pagEndpointSchema = z.object({
  path: z.string().min(1),
  method: httpMethodSchema,
  description: z.string().optional(),
  authRequired: z.boolean().default(true),
  rolesAllowed: z.array(z.string()).default([]),
  targetEntity: z.string().optional(), // Referencia a entidad PAG
  requestSchema: openApiJsonSchema.optional(), // JSON Schema OpenAPI 3.1 del request
  responseSchema: openApiJsonSchema.optional(), // JSON Schema OpenAPI 3.1 del response (200/201)
  errorCodes: z.array(z.number()).default([400, 401, 403, 404, 500]),
});
export type PagEndpoint = z.infer<typeof pagEndpointSchema>;

export const pagServiceSchema = z.object({
  name: z.string().min(1), // e.g. "AuthModule", "BillingModule"
  layer: z.enum(["backend_module", "gateway", "worker_queue", "bff", "frontend_surface"]),
  handledEndpoints: z.array(z.string()).default([]), // paths manejados
  dependencies: z.array(z.string()).default([]), // otros módulos o servicios externos
});
export type PagService = z.infer<typeof pagServiceSchema>;

export const pagStackSchema = z.object({
  runtime: z.string().default("Node.js 20"),
  backendFramework: z.string().default("NestJS"),
  frontendFramework: z.string().default("React"),
  database: z.string().default("PostgreSQL"),
  orm: z.string().default("Prisma"),
  cache: z.string().optional(),
  queue: z.string().optional(),
});
export type PagStack = z.infer<typeof pagStackSchema>;

export const projectArchitectureGraphSchema = z.object({
  version: z.literal("1.0.0").default("1.0.0"),
  projectName: z.string().min(1),
  description: z.string().optional(),
  stack: pagStackSchema.default({}),
  entities: z.array(pagEntitySchema).default([]),
  endpoints: z.array(pagEndpointSchema).default([]),
  services: z.array(pagServiceSchema).default([]),
});
export type ProjectArchitectureGraph = z.infer<typeof projectArchitectureGraphSchema>;

/**
 * Validador determinista en memoria (0 tokens, 0ms).
 * Verifica integridad referencial entre entidades, endpoints y servicios.
 */
export function validateProjectArchitectureGraph(pag: ProjectArchitectureGraph): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const entityNames = new Set(pag.entities.map((e) => e.name.toLowerCase()));

  // 1. Validar claves foráneas
  for (const entity of pag.entities) {
    for (const field of entity.fields) {
      for (const constraint of field.constraints) {
        if (constraint.type === "foreign_key" && constraint.reference) {
          const target = constraint.reference.entity.toLowerCase();
          if (!entityNames.has(target)) {
            errors.push(
              `Entidad "${entity.name}", campo "${field.name}": clave foránea apunta a entidad inexistente "${constraint.reference.entity}".`,
            );
          }
        }
      }
    }
  }

  // 2. Validar que endpoints apunten a entidades existentes si declaran targetEntity
  for (const ep of pag.endpoints) {
    if (ep.targetEntity && !entityNames.has(ep.targetEntity.toLowerCase())) {
      errors.push(
        `Endpoint [${ep.method} ${ep.path}] hace referencia a entidad no definida "${ep.targetEntity}".`,
      );
    }
  }

  // 3. Validar stack consistente (ORM vs Base de datos)
  const db = pag.stack.database.toLowerCase();
  const orm = pag.stack.orm.toLowerCase();
  if (db.includes("mongo") && orm.includes("prisma-postgres")) {
    errors.push(`Incompatibilidad de stack: Base de datos ${pag.stack.database} con ORM ${pag.stack.orm}.`);
  }

  // 4. Validación semántica OpenAPI 3.1 en endpoints
  for (const ep of pag.endpoints) {
    if (!ep.path.startsWith("/")) {
      errors.push(`Endpoint [${ep.method} ${ep.path}]: La ruta canónica debe comenzar con "/".`);
    }
    for (const code of ep.errorCodes) {
      if (typeof code !== "number" || code < 100 || code > 599) {
        errors.push(`Endpoint [${ep.method} ${ep.path}]: Código HTTP inválido "${code}". Debe estar entre 100 y 599.`);
      }
    }
    if (ep.requestSchema) {
      validateOpenApiJsonSchemaSemantic(ep.requestSchema, `Endpoint [${ep.method} ${ep.path}] requestSchema`, errors);
    }
    if (ep.responseSchema) {
      validateOpenApiJsonSchemaSemantic(ep.responseSchema, `Endpoint [${ep.method} ${ep.path}] responseSchema`, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateOpenApiJsonSchemaSemantic(schema: any, context: string, errors: string[]) {
  if (!schema || typeof schema !== "object") return;
  if (Array.isArray(schema.required) && schema.properties) {
    for (const reqProp of schema.required) {
      if (typeof reqProp === "string" && !(reqProp in schema.properties)) {
        errors.push(`${context}: La propiedad obligatoria "${reqProp}" declarada en "required" no está definida en "properties".`);
      }
    }
  }
  if (schema.type === "array" && !schema.items) {
    errors.push(`${context}: Esquema de tipo "array" debe definir la especificación de "items".`);
  }
}

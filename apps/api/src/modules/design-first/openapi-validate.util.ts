import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export type OpenApiValidationIssue = {
  path: string;
  message: string;
};

export type OpenApiValidationResult =
  | { ok: true }
  | { ok: false; issues: OpenApiValidationIssue[] };

const openApi31DocumentSchema = {
  type: "object",
  additionalProperties: true,
  required: ["openapi", "info", "paths"],
  properties: {
    openapi: { type: "string", pattern: "^3\\.1\\.\\d+$" },
    info: {
      type: "object",
      required: ["title", "version"],
      additionalProperties: true,
      properties: {
        title: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        description: { type: "string" },
      },
    },
    paths: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: {
          type: "object",
          additionalProperties: true,
          required: ["responses"],
          properties: {
            operationId: { type: "string" },
            summary: { type: "string" },
            description: { type: "string" },
            parameters: { type: "array" },
            requestBody: { type: "object" },
            responses: {
              type: "object",
              minProperties: 1,
              additionalProperties: {
                type: "object",
                additionalProperties: true,
              },
            },
          },
        },
      },
    },
    components: {
      type: "object",
      additionalProperties: true,
      properties: {
        schemas: { type: "object", additionalProperties: true },
        securitySchemes: { type: "object", additionalProperties: true },
      },
    },
  },
} as const;

let compiledValidator: ReturnType<Ajv2020["compile"]> | null = null;

function getValidator(): ReturnType<Ajv2020["compile"]> {
  if (compiledValidator) return compiledValidator;
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  compiledValidator = ajv.compile(openApi31DocumentSchema);
  return compiledValidator;
}

function mapAjvErrors(errors: Ajv2020["errors"] | null | undefined): OpenApiValidationIssue[] {
  if (!errors?.length) {
    return [{ path: "", message: "Documento OpenAPI inválido" }];
  }
  return errors.map((err) => ({
    path: err.instancePath || err.schemaPath || "",
    message: translateAjvMessage(err),
  }));
}

function translateAjvMessage(err: NonNullable<Ajv2020["errors"]>[number]): string {
  const keyword = err.keyword;
  if (keyword === "required") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return missing ? `Falta la propiedad obligatoria «${missing}»` : "Falta una propiedad obligatoria";
  }
  if (keyword === "pattern" && err.instancePath === "/openapi") {
    return "La versión OpenAPI debe ser 3.1.x";
  }
  if (keyword === "type") {
    return `Tipo inválido (se esperaba ${(err.params as { type?: string }).type ?? "otro"})`;
  }
  if (keyword === "minLength") {
    return "El valor no puede estar vacío";
  }
  if (keyword === "minProperties") {
    return "Debe definir al menos una respuesta HTTP";
  }
  return err.message || "Valor inválido según el esquema OpenAPI 3.1";
}

function validateComponentSchemas(doc: Record<string, unknown>): OpenApiValidationIssue[] {
  const components = doc.components as { schemas?: Record<string, unknown> } | undefined;
  const schemas = components?.schemas;
  if (!schemas) return [];
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateSchema: false });
  addFormats(ajv);
  const issues: OpenApiValidationIssue[] = [];
  for (const [name, schema] of Object.entries(schemas)) {
    if (schema && typeof schema === "object" && "$ref" in (schema as object)) {
      const ref = String((schema as { $ref?: string }).$ref ?? "");
      if (ref && !ref.startsWith("#/components/schemas/")) {
        issues.push({
          path: `/components/schemas/${name}/$ref`,
          message: "Referencia $ref debe apuntar a #/components/schemas/",
        });
      }
      continue;
    }
    try {
      ajv.compile(schema as object);
    } catch (e) {
      issues.push({
        path: `/components/schemas/${name}`,
        message: e instanceof Error ? e.message : "Esquema JSON inválido",
      });
    }
  }
  return issues;
}

export function validateOpenApi31(doc: unknown): OpenApiValidationResult {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      ok: false,
      issues: [{ path: "", message: "El documento OpenAPI debe ser un objeto JSON" }],
    };
  }
  const record = doc as Record<string, unknown>;
  const validate = getValidator();
  if (!validate(record)) {
    return { ok: false, issues: mapAjvErrors(validate.errors) };
  }
  const schemaIssues = validateComponentSchemas(record);
  if (schemaIssues.length) {
    return { ok: false, issues: schemaIssues };
  }
  return { ok: true };
}

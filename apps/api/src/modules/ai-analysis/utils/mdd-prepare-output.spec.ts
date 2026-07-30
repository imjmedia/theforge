import { describe, it } from "node:test";
import assert from "node:assert";
import { prepareMddForOutput, shouldPreferDraftOverStructured } from "./mdd-prepare-output.js";
import { guardValidatedSectionsForPersist } from "./mdd-section-preserve.util.js";
import { mddHasDuplicateSectionHeadings } from "./mdd-sanitize.js";
import { getSection6Or7Range, replaceSection6Or7InDraft, seguridadItemsToSection6Markdown } from "./mdd-sanitize.js";
import { mddSeguridadItemSchema } from "../state/mdd-structured.schema.js";
import { extractSection3Body } from "./mdd-sanitize/section-merge.js";

const FULL_MDD_PREFIX = `# Master Design Document

## 1. Contexto

Contexto extenso con visión del producto y requisitos funcionales en formato EARS para validar que no se pierde al regenerar secciones posteriores del documento.

## 2. Arquitectura y Stack

NestJS con PostgreSQL y Redis para colas. Patrón modular por dominio.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE roles (id UUID PRIMARY KEY, name TEXT NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /auth/login | Inicio de sesión |

## 5. Lógica y Edge Cases

Dado un usuario autenticado cuando solicita recurso entonces se valida ownership.

`;

const EXISTING_SECTION6 = `## 6. Seguridad

- **Autenticación:**
    - Argon2id para contraseñas con política de complejidad mínima de 12 caracteres.
    - JWT con refresh rotativo y revocación en logout global.
    - MFA TOTP obligatorio para roles admin y operador de plataforma.
- **Autorización:**
    - RBAC con roles project_admin, developer y auditor de solo lectura.
    - Validación de ownership en cada endpoint mutante antes de persistir cambios.
- **Auditoría:**
    - Log estructurado de accesos con userId, resourceId, action y correlationId.

## 7. Infraestructura

Kubernetes con despliegue blue-green, HPA por CPU y memoria, y secrets manager externo para credenciales rotativas.
`;

describe("shouldPreferDraftOverStructured", () => {
  it("prefiere borrador multi-sección aunque structured solo tenga seguridad placeholder", () => {
    const draft = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const structured = {
      seguridad: [mddSeguridadItemSchema.parse({ title: "Seguridad", content: ["(Pendiente de definir.)"] })],
    };
    assert.ok(shouldPreferDraftOverStructured(draft, structured));
  });
});

describe("prepareMddForOutput", () => {
  it("inyecta Diagrama de componentes propuesto en §2 para MDD greenfield", async () => {
    const out = await prepareMddForOutput({ mddDraft: FULL_MDD_PREFIX });
    assert.match(out, /### Diagrama de componentes propuesto/);
    assert.match(out, /```mermaid/);
    assert.match(out, /NestJS/);
  });

  it("conserva §1–§5 del draft cuando structured es parcial tras fallo de §6", async () => {
    const draft = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const structured = {
      seguridad: [mddSeguridadItemSchema.parse({ title: "Seguridad", content: ["(Pendiente de definir.)"] })],
    };
    const out = await prepareMddForOutput({ mddDraft: draft, mddStructured: structured });
    assert.ok(out.includes("## 1. Contexto"), "debe conservar §1");
    assert.ok(out.includes("CREATE TABLE users"), "debe conservar §3");
    assert.ok(out.includes("Argon2id"), "debe conservar §6 previa, no Pendiente");
    assert.ok(!/## 1\. Contexto[\s\S]*\(Pendiente\)[\s\S]*## 2\./.test(out), "§2 no debe ser solo Pendiente");
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
  });

  it("no reintroduce duplicados desde source corrupto y quita directivas mesh", async () => {
    const good = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const corrupted =
      good +
      `
---
## 5. Lógica y Edge Cases

Cola duplicada.

## 6. Seguridad

- [DIRECTIVE: software_architect] Campo totp_secret en users.
`;
    const out = await prepareMddForOutput({ mddDraft: corrupted });
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
    assert.ok(!out.includes("[DIRECTIVE:"));
    assert.ok(!out.includes("Cola duplicada"));
    assert.ok(out.includes("Argon2id"));
  });

  it("formatForPersist=false omite pipeline pesado de persistencia (streaming/gate)", async () => {
    const draft = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const gateOut = await prepareMddForOutput({ mddDraft: draft }, { formatForPersist: false });
    const persistOut = await prepareMddForOutput({ mddDraft: draft }, { formatForPersist: true });
    assert.ok(gateOut.includes("CREATE TABLE users"));
    assert.ok(persistOut.includes("CREATE TABLE users"));
    assert.ok(gateOut.length <= persistOut.length + 500, "gate no debe inflar más que persist");
  });

  it("preserveExcludeSections [5] permite restaurar §6/§7 desde baseline en regen section-pipeline", () => {
    const baseline = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const postRegen5Only = baseline
      .replace(EXISTING_SECTION6, "")
      .replace(
        "Dado un usuario autenticado cuando solicita recurso entonces se valida ownership.",
        "Nuevo contenido BDD regenerado con escenarios Given When Then y reglas de negocio detalladas.",
      );
    const defaultGuard = guardValidatedSectionsForPersist(baseline, postRegen5Only, "test");
    assert.ok(defaultGuard.restored, "sin exclude, el guard restaura cola §6/§7 perdida");
    assert.ok(defaultGuard.markdown.includes("Argon2id"));
    const pipelineGuard = guardValidatedSectionsForPersist(baseline, postRegen5Only, "test", {
      excludeSections: [5],
    });
    assert.ok(pipelineGuard.restored, "exclude solo §5: §6/§7 deben restaurarse desde baseline");
    assert.ok(pipelineGuard.markdown.includes("Argon2id"));
    const tailFrozenGuard = guardValidatedSectionsForPersist(baseline, postRegen5Only, "test", {
      excludeSections: [5, 6, 7],
    });
    assert.strictEqual(tailFrozenGuard.restored, false);
    assert.ok(!tailFrozenGuard.markdown.includes("Argon2id"));
  });

  it("streamPreview omite dedupe reorder en preview intermedio", async () => {
    const block = `## 4. Contratos de API(Pendiente)
## 5. Lógica y Edge Cases

(Pendiente: paso dedicado Lógica y Edge Cases)
## 6. Seguridad(Pendiente)

### Gestión de Secretos

Las credenciales de servicio y secretos de aplicación se almacenan en un almacén de credenciales (secrets manager).`;
    const corrupted =
      FULL_MDD_PREFIX +
      block +
      "\n\n" +
      block;
    const previewOut = await prepareMddForOutput(
      { mddDraft: corrupted },
      { formatForPersist: false, streamPreview: true, baselineDraft: corrupted },
    );
    const fullOut = await prepareMddForOutput(
      { mddDraft: corrupted },
      { formatForPersist: false, baselineDraft: corrupted },
    );
    assert.ok(previewOut.includes("Gestión de Secretos"));
    assert.strictEqual(mddHasDuplicateSectionHeadings(previewOut), false);
    assert.ok(fullOut.includes("Gestión de Secretos"));
  });

  it("aplica platformStripped del SSOT repair al markdown final", async () => {
    const draft =
      `# Master Design Document

## 1. Contexto

KMS interno: claves, secretos, certificados. Sin chat ni MCP.

## 2. Arquitectura y Stack

NestJS con PostgreSQL.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);
CREATE TABLE mcp_plugins (id UUID PRIMARY KEY);
CREATE TABLE roles (id UUID PRIMARY KEY, name TEXT NOT NULL);
\`\`\`

## 4. Contratos de API

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | /auth/login | Inicio de sesión |

## 5. Lógica y Edge Cases

Dado un usuario autenticado cuando solicita recurso entonces se valida ownership.

` + EXISTING_SECTION6;
    const brd = "KMS interno: claves, secretos, certificados. Sin chat ni MCP.";
    const out = await prepareMddForOutput(
      { mddDraft: draft },
      { formatForPersist: false, brdMarkdown: brd, dbgaMarkdown: brd },
    );
    assert.doesNotMatch(extractSection3Body(out) ?? "", /CREATE TABLE mcp_plugins/i);
  });

  it("conserva §2–§4 sustanciales tras duplicados §7/UI aunque normalize colapse el cuerpo", async () => {
    const core =
      FULL_MDD_PREFIX +
      `## 6. Seguridad

JWT y bcrypt.

## 7. Infraestructura

Kubernetes prod.

## UI/UX Design Intent

Panel admin.
`;
    const duplicatedTail = `
## 7. Infraestructura

Cola duplicada infra.

## UI/UX Design Intent

Cola duplicada ui.
`;
    const corrupted = core + duplicatedTail + duplicatedTail;
    const out = await prepareMddForOutput(
      { mddDraft: corrupted },
      { formatForPersist: false, baselineDraft: core },
    );
    assert.ok(out.includes("CREATE TABLE users"), "debe conservar §3");
    assert.ok(out.includes("POST | /auth/login"), "debe conservar §4");
    assert.ok(out.includes("NestJS con PostgreSQL"), "debe conservar §2");
    assert.strictEqual(mddHasDuplicateSectionHeadings(out), false);
    assert.ok(out.length > core.length * 0.7, "no debe colapsar por debajo del 70% del baseline");
  });
});

describe("getSection6Or7Range", () => {
  it("encuentra §6 tras §5 sin exigir salto de línea extra en el patrón", () => {
    const draft = "## 5. Lógica\n\nx\n## 6. Seguridad\n\nviejo";
    const range = getSection6Or7Range(draft, 6);
    assert.ok(range);
    assert.match(range!.heading, /Seguridad/i);
  });
});

describe("replaceSection6Or7InDraft", () => {
  it("inserta §6 antes de §7 cuando falta Seguridad (salto 5→7)", async () => {
    const draft = `# Master Design Document

## 1. Contexto

Contexto.

## 2. Arquitectura y Stack

Stack.

## 3. Modelo de Datos

\`\`\`sql
CREATE TABLE users (id UUID PRIMARY KEY);
\`\`\`

## 4. Contratos de API

Endpoints.

## 5. Lógica y Edge Cases

Contenido de lógica.

---
## 7. Infraestructura

Kubernetes.

## UI/UX Design Intent

Extra.
`;
    const newSec6 = seguridadItemsToSection6Markdown([
      { title: "Autenticación", content: ["JWT validado vía JWKS."] },
    ]);
    const updated = replaceSection6Or7InDraft(draft, 6, newSec6);
    assert.ok(updated.includes("## 6. Seguridad"), "debe insertar §6");
    assert.ok(updated.indexOf("## 5.") < updated.indexOf("## 6. Seguridad"));
    assert.ok(updated.indexOf("## 6. Seguridad") < updated.indexOf("## 7. Infraestructura"));
    assert.ok(getSection6Or7Range(updated, 6), "getSection6Or7Range debe localizar §6 tras insert");
    const out = await prepareMddForOutput({ mddDraft: updated });
    assert.ok(out.includes("## 6. Seguridad"), "prepareMddForOutput debe conservar §6 tras normalize");
    assert.ok(out.includes("JWT validado"), "contenido §6 preservado");
  });

  it("reemplaza solo §6 preservando §1–§5 y §7", () => {
    const draft = FULL_MDD_PREFIX + EXISTING_SECTION6;
    const newSec6 = seguridadItemsToSection6Markdown([
      {
        title: "Autenticación",
        content: ["OAuth2 con PKCE.", "MFA TOTP para admins."],
      },
    ]);
    const updated = replaceSection6Or7InDraft(draft, 6, newSec6);
    assert.ok(updated.includes("CREATE TABLE users"), "§3 intacto");
    assert.ok(updated.includes("OAuth2 con PKCE"), "§6 actualizado");
    assert.ok(updated.includes("Kubernetes"), "§7 intacto");
    const sec6Count = (updated.match(/##\s*6\.\s*Seguridad/gi) ?? []).length;
    assert.strictEqual(sec6Count, 1, "no debe duplicar heading §6");
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import {
  isCorruptedSecurityLlmText,
  isCorruptedSeguridadSlice,
  isPlaceholderSeguridad,
  parseSecurityLlmResponse,
  sanitizeSeguridadItems,
  seguridadItemsFromDraftSection6,
} from "./mdd-security-parse.js";
import { getSection6Or7Range, replaceSection6Or7InDraft, seguridadItemsToSection6Markdown } from "./mdd-sanitize.js";

describe("parseSecurityLlmResponse", () => {
  it("parsea JSON estructurado válido", () => {
    const text = JSON.stringify({
      seguridad: [
        {
          title: "Autenticación y Autorización",
          content: ["Argon2id para contraseñas.", "JWT con rotación de refresh tokens."],
        },
        {
          title: "Protección de Datos",
          content: ["Cifrado en tránsito con TLS 1.3."],
        },
      ],
    });
    const items = parseSecurityLlmResponse(text);
    assert.ok(items, "debe parsear JSON estructurado válido");
    assert.strictEqual(items!.length, 2);
    assert.ok(items![0]!.content[0]!.includes("Argon2id"));
    const md = seguridadItemsToSection6Markdown(items!);
    assert.ok(md.startsWith("## 6. Seguridad"));
    assert.ok(md.includes("Autenticación"));
    assert.ok(!md.includes('"seguridad"'));
  });

  it("rechaza salida corrupta con placeholder, thinking y JSON a medias", () => {
    const corrupted = `## 6. Seguridad
{
  "placeholder": true,
  "note": "Will rewrite this section later"
}
<thinking>
Let me draft the security section...
</thinking>
- "title": "## Seguridad",
- "content": [
- { "heading": "1. Auth"`;
    assert.ok(isCorruptedSecurityLlmText(corrupted));
    assert.strictEqual(parseSecurityLlmResponse(corrupted), null);
  });

  it("rechaza slice con contenido mayormente JSON", () => {
    const slice = [
      {
        title: "Seguridad",
        content: ['{', '"title": "Auth",', '"details": [', "- fragment"],
      },
    ];
    assert.ok(isCorruptedSeguridadSlice(slice));
    assert.strictEqual(sanitizeSeguridadItems(slice), null);
  });

  it("parsea JSON con fences ```json y content string", () => {
    const text = `\`\`\`json
{
  "seguridad": [
    {
      "title": "Autenticación",
      "content": "Argon2id y JWT RS256 con rotación de refresh tokens en cookies httpOnly."
    }
  ]
}
\`\`\``;
    const items = parseSecurityLlmResponse(text);
    assert.ok(items && items.length >= 1);
    assert.ok(items![0]!.content.join(" ").includes("Argon2id"));
  });

  it("parsea variantes heading/details (DeepSeek)", () => {
    const text = JSON.stringify({
      seguridad: [
        {
          heading: "Protección de Datos",
          details: ["TLS 1.3 obligatorio.", "Cifrado AES-256 en reposo para PII."],
        },
      ],
    });
    const items = parseSecurityLlmResponse(text);
    assert.ok(items && items.length === 1);
    assert.ok(items![0]!.title.includes("Protección"));
    assert.ok(items![0]!.content.some((c) => c.includes("TLS")));
  });

  it("recoverSeguridadItemsFromRawLlmText rescata JSON válido tras fallo intermedio", () => {
    const text = `{ "seguridad": [{ "title": "Auth", "content": ["MFA TOTP", "Lockout 5 intentos"] }] }`;
    const items = parseSecurityLlmResponse(text);
    assert.ok(items && items.length === 1);
    assert.ok(!isPlaceholderSeguridad(items));
  });

  it("parsea JSON job-69-like con title 6.1 y content anidado", () => {
    const text = JSON.stringify({
      seguridad: [
        {
          title: "6.1. Autenticación y Autorización",
          content: [
            "Política Argon2id con rotación de refresh tokens.",
            {
              heading: "MFA",
              details: ["TOTP obligatorio para administradores", "Lockout tras 5 intentos fallidos"],
            },
          ],
        },
        {
          title: "6.2. Protección de Datos",
          content: ["TLS 1.3 obligatorio.", "Cifrado AES-256 en reposo para PII."],
        },
      ],
    });
    const items = parseSecurityLlmResponse(text);
    assert.ok(items && items.length === 2, `esperaba 2 items, got ${items?.length ?? "null"}`);
    assert.ok(items![0]!.title.includes("Autenticación"));
    assert.ok(items![0]!.content.some((c) => c.includes("MFA")));
    assert.ok(items![0]!.content.some((c) => c.includes("Argon2id")));
    assert.ok(!isPlaceholderSeguridad(items));
    const md = seguridadItemsToSection6Markdown(items!);
    assert.ok(md.includes("## 6. Seguridad"));
    assert.ok(!md.includes('"seguridad"'));
  });
});

describe("seguridadItemsFromDraftSection6", () => {
  it("extrae §6 canónica ## 6. Seguridad del borrador", () => {
    const draft = `# MDD

## 1. Contexto

Texto.

## 6. Seguridad

- **Auth:** JWT y Argon2id.

## 7. Infraestructura

K8s.
`;
    assert.ok(getSection6Or7Range(draft.trim(), 6), "debe localizar ## 6. Seguridad en el borrador");
    const items = seguridadItemsFromDraftSection6(draft);
    assert.ok(items && items.length > 0, `seguridadItemsFromDraftSection6 devolvió ${String(items)}`);
    const combined = items!.map((i) => `${i.title} ${(i.content ?? []).join(" ")}`).join(" ");
    assert.ok(combined.includes("Argon2id"), `contenido extraído: ${combined.slice(0, 200)}`);
    assert.ok(!isPlaceholderSeguridad(items));
  });

  it("ignora placeholder del arquitecto (Pendiente: Arquitecto de Seguridad)", () => {
    const draft = `## 6. Seguridad

(Pendiente: Arquitecto de Seguridad)

## 7. Infraestructura

K8s.
`;
    assert.strictEqual(seguridadItemsFromDraftSection6(draft), null);
  });

  it("replaceSection6Or7 preserva §1 al actualizar desde items del draft", () => {
    const draft = `# MDD

## 1. Contexto

Contenido importante de contexto que no debe perderse.

## 6. Seguridad

- **Auth:** tokens.

## 7. Infra

Cloud.
`;
    const items = seguridadItemsFromDraftSection6(draft);
    assert.ok(items && items.length > 0, "debe extraer items de §6 antes de reemplazar");
    const updated = replaceSection6Or7InDraft(draft, 6, seguridadItemsToSection6Markdown(items));
    assert.ok(updated.includes("Contenido importante de contexto"));
    assert.ok(updated.includes("Cloud."));
  });
});

describe("seguridadItemsToSection6Markdown", () => {
  it("genera markdown canónico para items normales", () => {
    const md = seguridadItemsToSection6Markdown([
      {
        title: "Autenticación",
        content: ["MFA TOTP obligatorio para administradores.", "Bloqueo tras 5 intentos fallidos."],
      },
    ]);
    assert.match(md, /^## 6\. Seguridad/);
    assert.ok(md.includes("Autenticación"));
    assert.ok(md.includes("MFA TOTP"));
    assert.ok(!md.includes("{"));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert";
import { fallbackClarifierQuestions, parseClarifierQuestions } from "./mdd-clarifier-questions.util.js";

describe("parseClarifierQuestions", () => {
  it("JSON con 3 preguntas → se conservan las 2 primeras (antes: ZodError por max(2))", () => {
    const text = JSON.stringify({
      questions: [
        "¿Propongo PostgreSQL con PostGIS para las geometrías; lo validas?",
        "¿Docker Compose o Kubernetes para el despliegue inicial?",
        "¿Las sesiones expiran a los 30 minutos de inactividad?",
      ],
    });
    const out = parseClarifierQuestions(text);
    assert.equal(out.length, 2);
    assert.ok(out[0].startsWith("¿Propongo PostgreSQL"));
    assert.ok(out[1].startsWith("¿Docker Compose"));
  });

  it("JSON dentro de ```json con texto alrededor", () => {
    const text = "Aquí van:\n```json\n{\"questions\":[\"¿Usamos JWT RS256 con rotación de llaves?\"]}\n```\nGracias.";
    assert.deepEqual(parseClarifierQuestions(text), ["¿Usamos JWT RS256 con rotación de llaves?"]);
  });

  it("prosa sin JSON → rescata las preguntas ¿…? y deduplica", () => {
    const text =
      "Para avanzar necesito dos validaciones. ¿Confirmas transacciones ACID en pedidos? " +
      "Y además, ¿prefieres Docker Compose o Kubernetes? ¿Confirmas transacciones ACID en pedidos?";
    const out = parseClarifierQuestions(text);
    assert.deepEqual(out, [
      "¿Confirmas transacciones ACID en pedidos?",
      "¿prefieres Docker Compose o Kubernetes?",
    ]);
  });

  it("items objeto {question} y viñetas → limpias", () => {
    const text = JSON.stringify({ questions: [{ question: "- ¿Se requiere MFA para administradores?" }] });
    assert.deepEqual(parseClarifierQuestions(text), ["¿Se requiere MFA para administradores?"]);
  });

  it("texto vacío o sin preguntas → []", () => {
    assert.deepEqual(parseClarifierQuestions(""), []);
    assert.deepEqual(parseClarifierQuestions("Todo está documentado, no hay huecos."), []);
  });
});

describe("fallbackClarifierQuestions", () => {
  it("sin feedback → las dos genéricas", () => {
    assert.equal(fallbackClarifierQuestions(undefined).length, 2);
    assert.ok(fallbackClarifierQuestions("")[0].includes("objetivos principales"));
  });

  it("feedback estructurado del Auditor → una pregunta de validación por corrección (máx. 2)", () => {
    const feedback =
      "[Sección 3, Sección 4] MFA sin tabla de secretos. Corrección: Añadir tabla mfa_secrets y endpoint POST /auth/mfa/verify. " +
      "[Sección 7] Manifest sin postgis. Corrección: Incluir postgis en database.extensions. " +
      "[Sección 2] Stack sin justificar. Corrección: Añadir ADR breve por decisión.";
    const out = fallbackClarifierQuestions(feedback);
    assert.equal(out.length, 2);
    assert.ok(out[0].startsWith("¿Validas aplicar esta corrección en Sección 3, Sección 4: Añadir tabla mfa_secrets"));
    assert.ok(out[1].includes("Sección 7: Incluir postgis"));
  });

  it("feedback en prosa → una pregunta que cita al Auditor", () => {
    const out = fallbackClarifierQuestions("Faltan decisiones de seguridad y estrategia de despliegue.");
    assert.equal(out.length, 1);
    assert.ok(out[0].includes("Faltan decisiones de seguridad"));
  });
});

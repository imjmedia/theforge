/**
 * @fileoverview Mapeo complejidad→rigor: determina nivel de procesamiento MDD.
 */

import type { MddComplexityLevel } from "../state/mdd-state.schema.js";

function level(cx: MddComplexityLevel | undefined): MddComplexityLevel {
  return cx ?? "HIGH";
}

/** Anexo al sintetizador de §1 (regenerar sección 1): evita inflar contexto en LOW/MEDIUM. */
export function contextSynthesizerComplexityAppendix(cx: MddComplexityLevel | undefined): string {
  const L = level(cx);
  if (L === "LOW") {
    return `

**Complejidad LOW:** La síntesis de §1 puede ser **breve**. No exijas mapa DDD de tres listas ni glosario extenso si las secciones 2–7 del documento son acotadas (bugfix/MVP).`;
  }
  if (L === "MEDIUM") {
    return `

**Complejidad MEDIUM:** §1 debe incluir **todas** las subsecciones ### del esqueleto constitución (Propósito, Alcance y fronteras, Mapa de contextos DDD, Actores, Glosario). Pueden ser **concisas**, pero **no omitir** headings ni dejar solo un párrafo de propósito.`;
  }
  return "";
}

/** Anexo al prompt del Clarificador: alinea §1 con la política LOW/MEDIUM del Manager. */
export function clarifierComplexityAppendix(cx: MddComplexityLevel | undefined): string {
  const L = level(cx);
  if (L === "LOW") {
    return `

**Complejidad del proyecto: LOW.** No exijas el paquete completo «Constitución Cursor» en §1. Prioriza contexto y alcance claros + fronteras en prosa. Las subsecciones ### Mapa de contextos DDD, ### Actores del documento, ### Glosario y ### Bloqueantes pueden ser **breves**, **combinadas en un solo párrafo** u **omitidas** si el alcance es un bugfix/MVP y no aportan valor. Bloqueantes solo ante ambigüedad que rompa el diseño.`;
  }
  if (L === "MEDIUM") {
    return `

**Complejidad del proyecto: MEDIUM.** §1 debe tener **Propósito**, **Alcance y fronteras**, **Mapa de contextos DDD** (tres listas), **Actores del documento** y **Glosario mínimo** (términos que afecten §3–§4). Cada bloque puede ser breve, pero **prohibido** entregar §1 con un solo ### Propósito. Bloqueantes solo si el riesgo es relevante para el dominio.`;
  }
  return "";
}

/** Anexo al prompt del Arquitecto: relaja Screaming / Gherkin en LOW/MEDIUM. */
export function softwareArchitectComplexityAppendix(cx: MddComplexityLevel | undefined): string {
  const L = level(cx);
  if (L === "LOW") {
    return `

**Complejidad LOW:** §2 puede ser stack estándar sin diagrama de carpetas «screaming» exhaustivo ni ADR por cada librería; una lista de módulos por dominio basta si encaja el alcance. §5: criterios de aceptación en prosa numerada es suficiente; **Gherkin obligatorio solo** para la regla más crítica si existe.`;
  }
  if (L === "MEDIUM") {
    return `

**Complejidad MEDIUM:** §2: propuesta de carpetas alineada a dominio (**Screaming** resumido) y al menos **dos** decisiones de stack con **¿Por qué?**. §5: al menos **un** escenario **Gherkin** (Dado/Cuando/Entonces) para la regla de negocio principal **y** el resto puede ser prosa con criterios medibles.`;
  }
  return "";
}

/** Anexo al prompt del Auditor: aplica o relaja el paso «Constitución Cursor». */
export function auditorConstitutionRigorAppendix(cx: MddComplexityLevel | undefined): string {
  const L = level(cx);
  if (L === "LOW") {
    return `

---
**Anexo: rigor según complejidad LOW (prioridad sobre el paso 6 anterior donde entre en conflicto)**

- **Constitución Cursor:** No penalices por ausencia de mapa DDD de tres listas, glosario extenso, Screaming Architecture detallado, ADR por cada tecnología ni múltiples escenarios Gherkin.
- Exige coherencia básica entre §1 y lo que exista de §3–§5; sanidad SQL/Mermaid/JSON (pasos 2–3 y 8); y ausencia de placeholders graves en §4 si el alcance pedía API.
- Un MDD **mínimo viable** puede merecer **≥ 85** si es coherente y útil para el alcance LOW.`;
  }
  if (L === "MEDIUM") {
    return `

---
**Anexo: rigor según complejidad MEDIUM**

- **§1:** Debe incluir subsecciones ### de constitución (Propósito, Fronteras, Mapa DDD, Actores, Glosario). Si falta más de una subsección obligatoria, penaliza fuerte (score < 85) y pide regenerar §1.
- **§2:** Al menos **una** estructura modular por dominio y **al menos un** «¿Por qué?» en stack; no exijas ADR exhaustivo.
- **§5:** Al menos **un** bloque Gherkin **o** criterios numerados equivalentes para el flujo principal.
- No bloquees **≥ 85** por omisiones propias de HIGH si el documento es sólido para MEDIUM.`;
  }
  return `

---
**Complejidad HIGH:** Aplica el **paso 6. Constitución Cursor** del protocolo principal **sin relajación** (mapa de contextos, glosario, Screaming + ADR, Gherkin donde haya reglas comprobables, bloqueantes HITL).`;
}

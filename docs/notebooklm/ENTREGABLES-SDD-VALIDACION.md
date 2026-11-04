# Validación de entregables frente a SDD y Architecting Agentic Systems

**Fuentes:** Cuadernos NotebookLM _Specification-Driven Development and the Evolution of AI Engineering_ y _Architecting Agentic Systems: Frameworks, Patterns, and Advanced Workflows_.

---

## 0. Estructura canónica del MDD (Constitución)

El MDD debe generarse con **exactamente siete secciones**. Esta estructura es la que usan los agentes (Clarifier, Software Architect, Security, Integration, Auditor), el semáforo, el parser de markdown y el estimador de costos. Cualquier cambio de títulos o numeración debe reflejarse en prompts, `mdd-markdown-parser.ts`, `estimation.service.ts` y `semaphore.service.ts`.

| #   | Sección              | Agente responsable   | Uso en estimador/semáforo                                            |
| --- | -------------------- | -------------------- | -------------------------------------------------------------------- |
| 1   | Contexto (y alcance) | Clarifier            | Fronteras, audiencia; congruencia documento↔modelo                   |
| 2   | Arquitectura y Stack | Software Architect   | TechnicalMetadata (etiquetas de coste); Frontend como subsección ### |
| 3   | Modelo de Datos      | Software Architect   | `db_entities`, `field_types`; integridad SQL                         |
| 4   | Contratos de API     | Software Architect   | Endpoints, payloads; `extra_endpoints` para horas                    |
| 5   | Lógica y Edge Cases  | Software Architect   | `business_core`, `edge_cases`                                        |
| 6   | Seguridad            | Security Architect   | Sustancia técnica (MFA, hashes, RBAC)                                |
| 7   | Infraestructura      | Integration Engineer | Variables de entorno, CI/CD, manifest                                |

**Reglas avanzadas del estimador (matriz de trazabilidad, contratos estrictos, pre-render):**

- **Matriz de trazabilidad:** Si el Contexto (1) menciona un concepto que exige reflejo en otras secciones (ej. MFA → §3 tablas de secretos, §4 endpoint /verify, §6 algoritmo TOTP), y falta un eslabón, las secciones involucradas pasan a "Estado Inconsistente" y su calificación se capa.
- **Contratos estrictos:** Modelo de Datos↔Contratos API (campos JSON 1:1 con columnas SQL); Modelo↔Diagrama Mermaid (paridad absoluta, sin abreviaturas en Mermaid que no existan en SQL); Arquitectura↔Infraestructura (si stack pide NestJS, Infra debe proveer Dockerfile Node); Lógica↔Seguridad (si hay edge case "Bloqueo de cuenta", Seguridad debe definir número de intentos).
- **Pre-render (sanidad de sintaxis):** Antes de persistir el MDD se valida: bloques Mermaid (sin coma entre PK y FK en atributos; espacios no ruptura normalizados). Tablas markdown en §4: sin líneas en blanco en medio; fila de alineación `|:---|` como segunda fila. Si falla: `ERR_MERMAID_SYNTAX` o `ERR_TABLE_SYNTAX` (API devuelve 400 y no se guarda).
- **Agente Auditor:** Si **auditorScore < 85**, el Manager devuelve el documento a agentes especializados con `critical_gaps` estructurados; si **>= 85** se cede al usuario. El umbral operativo es **85%** (no 95%).

**Alineación con los cuadernos:**

- **SDD:** La Constitución (Constitution) debe cubrir qué/por qué (Contexto), cómo a nivel técnico (Arquitectura, Modelo, Contratos, Lógica), y requisitos no funcionales (Seguridad, Infra). Nuestra estructura 1–7 mapea a esas dimensiones; no hay sección "Integración" como H2 — el contenido de integración/CI-CD vive en §7 Infraestructura.
- **Architecting Agentic Systems:** El patrón _Structured output / Planner_ exige salida con secciones concretas; los agentes rellenan cada sección según la matriz de delegación; el Auditor valida las 7 con las mismas reglas que el semáforo.

---

## 1. Mapeo SDD (Specification-Driven Development)

En SDD la jerarquía es: **Constitution → Spec → Plan → Tasks → Implementation**. Los artefactos típicos son `spec.md`, `plan.md`, `tasks.md`, `contracts/` (API), y opcionales `data-model.md`, `research.md`, `quickstart.md`.

| Artefacto SDD                       | En TheForge                               | Validación                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Constitution**                    | **MDD** (Master Design Document)           | Correcto. El MDD es la Constitución del proyecto; se establece primero y gobierna el resto.                                                                                                                                                  |
| **Spec** (what/why)                 | **Benchmark (DBGA)** + clarifiedScope      | Correcto. El benchmark descubre funcionalidades y requisitos; alimenta la Constitución (MDD).                                                                                                                                                |
| **Plan** (how: stack, arquitectura) | **Blueprint**                              | Correcto. El Blueprint es el plan técnico (estructura, módulos, persistencia, backend/frontend). SDD: "plan.md" o arquitectura; nosotros lo tenemos como documento dedicado.                                                                 |
| **Contratos API**                   | **Contratos de API** (apiContractsContent) | **Requerido en SDD.** Tenemos documento dedicado; se genera desde MDD + Blueprint. Alineado con `contracts/` (OpenAPI/Swagger).                                                                                                              |
| **Logic flows / User journeys**     | **Flujos de lógica** (logicFlowsContent)   | En SDD los flujos viven en Spec (user journeys) o Plan (data flows). Tener un documento dedicado es una implementación válida (extracción explícita). Correcto.                                                                              |
| **Infraestructura**                 | **Infra** (infraContent)                   | En SDD la infra forma parte del Plan. Tener documento dedicado (Dockerfile, docker-compose, .env) es correcto; en SDD avanzado se trata como IaC. Correcto.                                                                                  |
| **Design system / UX**              | **Guía UX/UI** (uxUiGuideContent)          | En SDD: design system y estándares de accesibilidad en Constitution o Spec; user journeys en Spec. Nuestra Guía UX/UI actúa como contrato de handoff y design system; se construye con entrevista (chat) y recibe MDD + Blueprint. Correcto. |
| **Gobernanza de agentes IA**        | **Agent Governance** (agentGovernanceContent) | Artefactos ejecutables (`AGENTS.md`, `.cursor/rules`, `.cursor/skills`, workflows) derivados del MDD §1–§7; scaffold JSON + ZIP en Workshop (Fase A). No sustituye la Constitución; complementa SDD en la fase Implementation. Stack-agnóstico; IMJ solo si el MDD lo menciona. |

**Conclusión SDD:** Los cinco documentos (Guía UX/UI, Blueprint, API, Flujos, Infra) están justificados. Blueprint = plan técnico; API = contratos (requeridos en SDD); Flujos = flujos de lógica/journeys; Infra = parte del plan; Guía UX/UI = design system/handoff. Todos se derivan de la Constitución (MDD) y, donde aplica, del Plan (Blueprint).

**Spec como paso explícito antes del MDD:** En TheForge, **Spec = Benchmark + clarifiedScope** (alcance aclarado por el Clarifier). Es el artefacto explícito que debe existir o revisarse antes de dar por cerrado el MDD: el Clarifier usa el Spec (si está presente) como entrada principal para la sección 1. Contexto y alcance. Generar o revisar el Spec desde Paso 0/Benchmark antes de cerrar el MDD mejora la trazabilidad SDD (Constitution → Spec → Plan → Tasks).

---

## 2. Validación frente a Architecting Agentic Systems

El cuaderno recomienda:

| Patrón / práctica               | En TheForge                                                                                                                                                                                                                                                                                                                                                                      | Validación                                                                                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plan-then-Execute (P-t-E)**   | El "plan" es el **MDD** (Constitución); la "ejecución" es la generación de cada entregable (Blueprint, API, Flujos, Infra) desde el MDD.                                                                                                                                                                                                                                          | Correcto. No ejecutamos código sin un plan (MDD); generamos artefactos en orden (Blueprint → API, etc.).                                                      |
| **Chain (waterfall)**           | El **MDD** se construye con un pipeline en cadena (Clarifier → Software Architect → Security → Integration → Auditor). Los entregables posteriores (Blueprint, API, Infra) se generan uno a uno desde el MDD (y Blueprint cuando aplica).                                                                                                                                         | Correcto. El flujo "Generar Entregables" ejecuta Blueprint → API → Flujos → Infra en secuencia; API e Infra reciben además el Blueprint como entrada.         |
| **Structured output / Planner** | Los prompts exigen markdown con secciones concretas; el MDD tiene estructura canónica (7 secciones). Los entregables incluyen "Cumplimiento con el MDD" (checklist).                                                                                                                                                                                                              | Correcto. No hay salida JSON estructurada para Blueprint/API/Flujos/Infra (son documentos markdown); la estructura está en los prompts.                       |
| **Reflection / Self-Refine**    | El **Auditor** del MDD hace reflexión (score, feedback, Validation Checklist); si &lt;95% se vuelve al Clarifier. Además, **Architect Critic** verifica §3 y §4 frente a la directiva del usuario y puede volver al Software Architect una vez con feedback. Auto-chequeo en el prompt del Arquitecto. Para Blueprint, API, Flujos, Infra no hay loop de refinamiento automático. | Parcial. El MDD tiene ciclo de refinamiento + Critic tras Arquitecto; los demás entregables son one-shot. Ver [MDD-PATRONES-FLUJO.md](MDD-PATRONES-FLUJO.md). |
| **Verifier / HITL**             | El semáforo (VERDE) actúa como compuerta antes de "Generar Entregables"; el usuario debe revisar y puede editar manualmente cualquier documento.                                                                                                                                                                                                                                  | Correcto. No hay verifier automático post-generación para cada documento; el humano revisa en la UI.                                                          |
| **Sandboxed execution**         | Solo generamos **documentos** (markdown); no ejecutamos IaC ni código en el servidor.                                                                                                                                                                                                                                                                                             | Correcto. No aplica sandbox para ejecución de código; solo generación de texto.                                                                               |

**Conclusión Architecting:** La implementación sigue Plan-then-Execute (MDD como plan) y Chain (orden Blueprint → API → Flujos → Infra; API e Infra usan Blueprint). En el flujo MDD se añadió Reflection (Architect Critic + auto-chequeo en prompts). No tenemos Reflection en los entregables individuales (Blueprint, API, Infra) ni Verifier automático post-generación; es una decisión aceptable. Ver [MDD-PATRONES-FLUJO.md](MDD-PATRONES-FLUJO.md) para el mapa de patrones del flujo MDD.

---

## 3. Orden de generación y dependencias

- **Recomendado (SDD + Architecting):** Plan primero (Blueprint), luego contratos (API), luego flujos e infra.
- **Implementación actual:** La cascada **no** es un único waterfall fijo para todos los tipos. `DeliverablesCascadeService` resuelve oleadas con `DELIVERABLE_WAVES_BY_COMPLEXITY` (NEW/HIGH) o `DELIVERABLE_WAVES_DESIGN_FIRST_BY_COMPLEXITY` (`projectType === DESIGN_FIRST`). Dentro de cada oleada, los pasos respetan dependencias (p. ej. W2 en HIGH: spec/architecture → UC/HU/API/flujos/**Guía UX/UI**/blueprint en paralelo controlado → pantallas → tasks/infra). API e Infra reciben el MDD de la **etapa activa** y `blueprintContent` cuando aplica. **Enmiendas constitucionales:** la tool `propose_mdd_amendment` (agentes) puede alinear §3/§4 del MDD con deltas detectados en Blueprint/API.
- **Guía UX/UI:** El paso `ux_ui_guide` **sí está en la matriz de cascada** (`deliverables-matrix.ts`: oleadas W2 para HIGH/MEDIUM y oleadas Design-First). Además existe flujo **por chat** (`generateUxUiGuide` / entrevista) para iterar design system y handoff con MDD + Blueprint; no sustituye al paso de cascada cuando el usuario ejecuta «Generar entregables» completo.

---

## 4. Resumen

| Documento           | ¿Requerido en SDD?                        | Implementación TheForge                                                            | Alineado |
| ------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- | -------- |
| **Guía UX/UI**      | Design system / UX en Constitution o Spec | Chat con MDD + Blueprint; documento markdown con tokens, prioridades, accesibilidad | Sí       |
| **Blueprint**       | Plan (arquitectura, stack)                | Un LLM desde MDD; markdown con estructura, persistencia, backend/frontend           | Sí       |
| **API (Contratos)** | Sí, `contracts/` (OpenAPI)                | Un LLM desde MDD + Blueprint; markdown con endpoints, request/response              | Sí       |
| **Flujos**          | En Spec/Plan (user journeys, data flows)  | Un LLM desde MDD; documento dedicado con diagramas Mermaid, reglas                  | Sí       |
| **Infra**           | En Plan (IaC)                             | Un LLM desde MDD + Blueprint; markdown con Dockerfile, docker-compose, .env         | Sí       |

Todos los documentos se generan **después** de la Constitución (MDD) y, donde aplica, del Plan (Blueprint). La implementación es coherente con SDD y con los patrones de Architecting Agentic Systems (Plan-then-Execute, Chain, compuerta por semáforo).

---

## 5. Mejoras opcionales (futuro)

- **Reflection en entregables:** Añadir un paso opcional de verificación (p. ej. "¿Los endpoints del documento API aparecen en el MDD?") y un loop de refinamiento si falla.
- **Verifier/HITL:** Antes de persistir cada entregable, mostrar un diff o resumen y pedir confirmación (ya se puede hacer manualmente editando en la UI).
- **Orden explícito en UI:** En la columna de documentos, indicar brevemente el orden recomendado (p. ej. "Generar en orden: Blueprint → API → Flujos → Infra") para usuarios que generen uno a uno.

---

## 6. Plan para llegar a 10/10 (SDD)

Objetivo: cerrar los huecos que dejan la evaluación en ~7.5 y alcanzar alineación plena con _Specification-Driven Development and the Evolution of AI Engineering_.

### Huecos actuales (resumen)

| Hueco                                      | Impacto en nota | Qué falta                                                                    |
| ------------------------------------------ | --------------- | ---------------------------------------------------------------------------- |
| Sin verificación automática de conformidad | -1.0            | Que Blueprint/API/Infra se comprueben contra el MDD (no solo prompts).       |
| Spec no es artefacto explícito             | -0.5            | `spec.md` (o equivalente versionado) que alimente el MDD.                    |
| Sin artefacto Tasks                        | -0.5            | `tasks.md` o breakdown explícito derivado del Plan.                          |
| Sin reflection en entregables              | -0.5            | Verificación/refinamiento automático en Blueprint, API, Infra (no solo MDD). |

### Fase 1: Spec explícito y Tasks (≈ +0.5–1.0)

**1.1 Spec como artefacto**

- **Qué:** Persistir el “spec” como documento versionado. Hoy vive en Benchmark + clarifiedScope + chat.
- **Opciones (elegir una):**
  - **A)** Campo `specContent` en Project: al cerrar Benchmark o al tener clarifiedScope estable, el backend genera/persiste un markdown “Spec” (objetivos, alcance, criterios de éxito, user journeys resumidos) y se muestra en una pestaña “Spec” en Workshop.
  - **B)** Exportar/etiquetar: botón “Exportar Spec” que genera un `spec.md` desde Benchmark + última clarifiedScope y lo descarga o lo guarda en `specContent`.
- **Criterio de éxito:** Existe un artefacto “Spec” recuperable (DB o archivo) que se usa como entrada explícita al construir/actualizar el MDD (referencia en prompt del Clarifier: “El Spec del proyecto es: …”).

**1.2 Tasks (breakdown del plan)**

- **Qué:** Documento “Tasks” derivado del Blueprint + MDD: lista de tareas de implementación (módulos, endpoints a implementar, flujos a codificar, ítems de infra).
- **Implementación:** Nuevo contenido `tasksContent` en Project (o documento generado bajo demanda). Un prompt “Tasks” que recibe MDD + Blueprint y devuelve markdown con secciones tipo: Backend tasks, Frontend tasks, Infra tasks, con ítems comprobables (checklist). Opcional: generación automática al pasar a VERDE o al generar Blueprint.
- **Criterio de éxito:** Existe `tasksContent` (o equivalente) que lista tareas derivadas del Plan y se puede mostrar en Workshop o exportar.

**Entregables Fase 1:** Spec explícito + Tasks; docs y prompts actualizados; índice THEFORGE-INDEX menciona Spec y Tasks.

---

### Fase 2: Verificación de conformidad (≈ +1.0–1.5)

**2.1 Conformance check (Blueprint vs MDD)**

- **Qué:** Tras generar el Blueprint, un paso automático (o botón “Verificar”) que compara:
  - Stack/tecnologías del Blueprint vs §2 del MDD.
  - Entidades/módulos del Blueprint vs §3 Modelo de Datos del MDD.
- **Implementación:** Servicio `ConformanceService` (o funciones en `engine/`) que: (1) parsean MDD (secciones 2 y 3) y Blueprint (markdown o estructura); (2) extraen listas de stack y entidades; (3) devuelven `{ ok: boolean, gaps: string[] }`. Si `ok === false`, el resultado se muestra en UI y opcionalmente se reinyecta en el prompt de regeneración.
- **Criterio de éxito:** La UI muestra “Cumple MDD” o “Gaps: …” después de generar Blueprint; opcionalmente se bloquea “Generar API” hasta que no haya gaps críticos o el usuario confirme.

**2.2 Conformance check (API vs MDD)**

- **Qué:** Tras generar Contratos de API, verificar que los endpoints del documento aparecen en el MDD (§4) y que no hay endpoints en el doc que no estén respaldados por el modelo/alcance.
- **Implementación:** Parser ligero de la sección §4 del MDD (rutas, métodos) y del documento de API generado; comparación; `{ ok, missingInApi, extraInApi }`. Mostrar en UI; opcional loop: si `ok === false`, botón “Regenerar API para alinear con MDD” con prompt enriquecido con los gaps.
- **Criterio de éxito:** Usuario ve si el documento API está alineado con el MDD; opcional refinamiento guiado.

**2.3 Conformance check (Infra vs MDD)**

- **Qué:** Comprobar que el documento de Infra menciona variables de entorno, despliegue y opciones (Docker, etc.) coherentes con §7 del MDD.
- **Implementación:** Similar a 2.1: extraer requisitos de §7 (env vars, CI/CD, manifest) y comprobar presencia en el doc de Infra; `{ ok, gaps }`.
- **Criterio de éxito:** Resultado de verificación visible en UI; gaps corregibles por regeneración o edición.

**Entregables Fase 2:** Servicio(s) de conformance; integración en flujo de generación (post-generación o botón); UI con resultado y, si se desea, bloqueo o sugerencia de regeneración.

---

### Fase 3: Reflection en entregables (≈ +0.5)

**3.1 Paso de reflexión opcional**

- **Qué:** Tras Blueprint/API/Infra generados, un agente “Verifier” o prompt de reflexión que responde: “¿El documento X cumple el MDD? Lista los ítems que faltan o sobran.”
- **Implementación:** Prompt que recibe MDD + documento generado y devuelve texto estructurado (o JSON) con veredicto y lista de ítems. Se muestra en la misma pestaña del entregable o en un panel “Verificación”. Opcional: si el veredicto es “no cumple”, sugerir “Regenerar con los siguientes requisitos: …”.
- **Criterio de éxito:** Cada entregable (Blueprint, API, Infra) tiene al menos una verificación por reflexión (manual o automática) y el resultado es visible.

**3.2 Loop de refinamiento (opcional)**

- **Qué:** Si la verificación falla, permitir “Regenerar con feedback” pasando al LLM los gaps detectados, sin borrar el documento anterior (diff o comparación lado a lado).
- **Criterio de éxito:** Una iteración de refinamiento guiado por gaps está disponible para al menos API (y si se quiere, Blueprint e Infra).

**Entregables Fase 3:** Paso de reflexión para Blueprint, API, Infra; opcional loop de refinamiento; documentación en README del módulo y en ENTREGABLES-SDD-VALIDACION.

---

### Fase 4: HITL y pulido (≈ +0.5 para 10)

**4.1 Verifier/HITL antes de persistir**

- **Qué:** Antes de guardar un entregable generado, mostrar diff o resumen (ej. “Se va a guardar el Blueprint con N secciones. ¿Continuar?”) y botón Confirmar / Editar / Descartar.
- **Implementación:** En Workshop, al recibir la respuesta del backend con el documento generado, no persistir de inmediato; mostrar vista previa + diff con la versión anterior (si existe) y botones Confirmar / Editar / Descartar. Sólo al confirmar se llama a `update(projectId, { blueprintContent: ... })`.
- **Criterio de éxito:** Usuario confirma explícitamente antes de que cualquier entregable generado por IA se persista.

**4.2 Orden explícito en UI**

- **Qué:** En la columna de documentos, texto o tooltip: “Orden recomendado: Blueprint → API → Flujos → Infra”.
- **Criterio de éxito:** Visible en la misma pantalla donde se generan los entregables.

**4.3 Documentación y re-evaluación**

- **Qué:** Actualizar THEFORGE-INDEX y ENTREGABLES-SDD-VALIDACION con: Spec, Tasks, Conformance, Reflection, HITL. Re-evaluar contra SDD y fijar la meta en 10/10.
- **Criterio de éxito:** Doc describe el flujo completo SDD (Constitution → Spec → Plan → Tasks → Implementation) con artefactos y verificaciones; evaluación interna 10/10.

**Entregables Fase 4:** HITL antes de persistir; orden recomendado en UI; documentación actualizada.

---

### Resumen del plan

| Fase | Objetivo                                    | Incremento estimado    | Prioridad |
| ---- | ------------------------------------------- | ---------------------- | --------- |
| 1    | Spec explícito + Tasks                      | +0.5–1.0               | Alta      |
| 2    | Conformance Blueprint/API/Infra vs MDD      | +1.0–1.5               | Alta      |
| 3    | Reflection en entregables (+ loop opcional) | +0.5                   | Media     |
| 4    | HITL antes de persistir + orden UI + docs   | +0.5 (y redondeo a 10) | Media     |

Orden sugerido: **Fase 1** (Spec + Tasks) → **Fase 2** (conformance) → **Fase 3** (reflection) → **Fase 4** (HITL y pulido). Con Fases 1 y 2 se llega a ~9; con 3 y 4 se cierra el 10.

---

## 7. Estado de implementación del plan 10/10

| Fase  | Entregable                                                                                    | Estado          |
| ----- | --------------------------------------------------------------------------------------------- | --------------- |
| **1** | Spec explícito (`specContent`, pestaña Spec, generateSpec desde Benchmark + phase0)           | ✅ Implementado |
| **1** | Tasks (`tasksContent`, pestaña Tasks, generateTasks desde MDD + Blueprint)                    | ✅ Implementado |
| **A** | Agent Governance (`agentGovernanceContent`, `generateAgentGovernance` desde MDD + Blueprint + complejidad; cascada `agent_governance` en matriz LOW/MEDIUM/HIGH) | ✅ Backend Fase A |
| **2** | ConformanceService (Blueprint/API/Infra vs MDD), GET `:id/conformance`, UI Conformance vs MDD | ✅ Implementado |
| **3** | Verifier/reflection (verifyDeliverable LLM), POST `:id/verify-deliverable`                    | ✅ Implementado |
| **4** | HITL: vista previa antes de persistir (preview: true, modal Confirmar/Descartar)              | ✅ Implementado |
| **4** | Orden recomendado en UI: "Blueprint → API → Flujos → Infra"                                   | ✅ Implementado |

**Modelo datos (actual):** MDD, semáforo, `precisionScore` y `Estimation` están en **`Stage`** (1:N con `Project`); el API sigue exponiendo `mddContent` / `status` / `estimation` aplanados en la respuesta de proyecto. Migraciones en `packages/database/migrations/`.

---

## 8. Mejoras adicionales (Spec paso explícito, Conformance Flujos, Regenerar con gaps)

| Mejora                                                                           | Estado                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spec = Benchmark + clarifiedScope** como paso explícito antes de cerrar el MDD | Documentado en §1 y THEFORGE-INDEX; nota en UI (pestaña Spec).                                                                                                                                                                           |
| **Conformance Flujos vs §5** (Lógica y Edge Cases)                               | `checkLogicFlowsVsMdd` en ConformanceService; GET conformance incluye `logicFlows`; UI muestra Flujos en panel Conformance vs MDD.                                                                                                        |
| **Analyze SDD ampliado (P1/P2)**                                                 | `analyzeArtifacts`: UC/HU/UX, Spec↔MDD, HU↔UC, Tasks↔Blueprint/API, puente Phase0→BRD→Spec; post-gen reflection en Flujos/Infra; `verifyDeliverable` incluye `logicFlows`.                                                           |
| **Regenerar con gaps**                                                           | Parámetro `gapsFeedback` en generateBlueprint, generateApiContracts, generateLogicFlows, generateInfra; prompts reciben "Los siguientes puntos deben corregirse..."; botones "Regenerar X con gaps" en panel Conformance cuando hay gaps. |
| **Spec obligatorio en flujo**                                                    | "Generar entregables" solo habilitado cuando Semáforo VERDE y Spec existe (specContent no vacío). Mensaje: "Genera o revisa el Spec antes de generar entregables" cuando falta Spec.                                                      |
| **Conformance más robusto**                                                      | Heurísticas refinadas: Blueprint acepta coincidencia parcial de entidades; API case-insensitive; Flujos exige diagramas solo si §5 los menciona. Opción "Incluir verificación con IA" (GET conformance?useLlm=true) complementa con LLM.  |
| **Estructura 7 secciones obligatoria**                                           | En el Auditor: si validateMddStructure detecta missingSections, score se capa a 94 y decision = "clarifier"; el MDD no se da por válido hasta tener las 7 secciones canónicas.                                                            |

---

*Corpus «The Forge - by Kreo» — NotebookLM sync 2026-06-10 (pnpm). Rutas relativas al monorepo `theforge`.*

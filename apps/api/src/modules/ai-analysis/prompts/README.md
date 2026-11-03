# Prompts (ai-analysis)

Prompts de los agentes organizados por **dominio de problema**:

- **benchmark/** – Domain Benchmark & Gap Analysis (DBGA)

  - `scout-prompt.md` – Market Scout (competidores, URLs)
  - `auditor-prompt.md` – Tech Auditor (tech stack)
  - `critic-prompt.md` – Critic (validación, re-research o synthesis)
  - `synthesis-prompt.md` – Synthesis (documento Gap Analysis en markdown)

- **mdd/** – Master Design Document (MDD) – Prompts agnósticos de dominio
  - **Estructura canónica (7 secciones):** 1. Contexto | 2. Arquitectura y Stack | 3. Modelo de Datos | 4. Contratos de API | 5. Lógica y Edge Cases | 6. Seguridad | 7. Infraestructura. **Matriz de delegación:** Clarificador → 1; Software Architect → 2, 3, 4, 5; Security → 6; Integration → 7. Sin traslape (la §3 la elabora el Arquitecto de Software, no un prompt aparte).
  - **Elaboración:** Clarificador (1) → Software Architect (2, 3, 4, 5) → Security (6) → Integration (7) → Redactor (unifica) → Auditor (evalúa).
  - `manager-prompt.md` – Manager como Entrevistador de Estados; reply o delegate; usa matriz sección → agente(s); **Fase 0 (DBGA):** preguntas de escala si el alcance no es claro; **HITL de complejidad:** si hay propuesta pendiente, no asumir nivel aplicado hasta confirmación del usuario; **política por `ComplexityLevel` (LOW / MEDIUM / HIGH)** para no forzar MDD de 7 secciones en alcances pequeños y anti-redundancia Blueprint vs §2–§3 en HIGH; al delegar, cada agente recibe el objetivo del usuario (brief); done si score >= 85% o usuario pide parar (umbral 85 = ceder intervención al usuario)
  - `manager-plan-generator-prompt.md` – Generador de plan (Planner–Executor): interpreta la intención del usuario y produce una lista de tareas con `step_id`, `node`, `task_description` y `goal` explícito por paso; el Manager invoca este prompt al delegar y usa el plan generado (fallback a buildMddPlan si el LLM falla)
  - `clarifier-prompt.md` – **Clarificador:** solo **sección 1. Contexto**; borrador con placeholders para 2–7; DBGA + feedback + respuestas usuario
  - `clarifier-questions-only-prompt.md` – Mismo Clarificador, modo solo preguntas: 2 preguntas (no borrador)
  - `software-architect-prompt.md` – **Arquitecto de Software:** secciones 2, 3, 4 y 5 (Arquitectura, Modelo de Datos, Contratos API, Lógica); copia 1; placeholders 6 y 7; regla explícita: si el usuario indica que un campo no debe persistirse en BD (ej. jwt_token), eliminarlo de §3 y diagrama ER y documentar alternativa en §4 (ej. refresh_token); self-check (Reflection) antes de entregar
  - `architect-critic-prompt.md` – **Architect Critic:** verifica si §3 y §4 cumplen la directiva/requisitos del usuario; salida `{ verdict: "ok"|"gap", gaps?: string[] }`; usado tras Software Architect para un reintento guiado
  - `security-architect-prompt.md` – Solo **sección 6. Seguridad**; evaluado por Auditor (20 pts)
  - `integration-engineer-prompt.md` – Solo **sección 7. Infraestructura**; al final **Manifest de Infraestructura** en formato exclusivo (project_id, stack.backend/database/security, deployment, integration_metadata); reglas: no alucinación tecnológica (§2), paridad con §3, estructura rígida, cero texto libre; evaluado por Auditor (15+10 pts)
  - `redactor-prompt.md` – **Redactor:** unifica MDD; protocolo de formato; estructura 1–7; español técnico
  - `auditor-prompt.md` – Evalúa documento completo; rúbrica; auditorFeedback y critical_gaps si score < 85 (protocolo de auditoría 5 pasos)

`load-prompts.ts` carga cada archivo desde su subcarpeta; si falla la lectura, usa el fallback inline.

**Versión de caché:** `MDD_PROMPT_VERSION` en `prompt-version.ts` es el SHA-256 hex del contenido de todos los `mdd/*.md` y `benchmark/*.md` (ordenados), calculado en `compute-mdd-prompt-version.ts` al cargar el módulo. Forma parte de la clave de la caché de nodos (`checkpoint/node-cache-key.ts`); editar un prompt invalida salidas cacheadas sin bump manual.

# Generación en segundo plano

The Forge encola la **generación y regeneración de entregables SDD** como jobs en background. Puedes cerrar el navegador o apagar la computadora: con **Redis** (`REDIS_URL` en el servidor) el job sigue en BullMQ hasta terminar. Al volver, abre el proyecto y verás el documento ya persistido.

## Qué va en cola

| Acción | Comportamiento |
|--------|----------------|
| **Generar todos los documentos** (cascada) | Un job `cascade` recorre las oleadas W0→W4 según complejidad |
| **Regenerar Spec, Arquitectura, Blueprint, API, Tasks, etc.** | Un job por entregable (`?queue=true` por defecto) |
| **Regenerar MDD** (pipeline / sección / upstream-sync / legacy) | Job en cola `theforge-mdd`; persiste en servidor; **bloquea** otros entregables mientras corre |

## Reglas de orden (importante)

1. **Un solo job activo por proyecto** — no puedes encolar Spec mientras Blueprint sigue generándose.
2. **Estar en cola no cuenta como listo** — si el MDD o la Spec están *en cola o ejecutándose*, no puedes generar downstream (p. ej. Spec o Blueprint).
3. **Upstream persistido al 100 %** — cada entregable exige que los de oleadas anteriores existan en BD con contenido sustancial (≥ 48 caracteres), según `DELIVERABLE_WAVES_BY_COMPLEXITY`.
4. **MDD en cola o ejecutándose** — mientras un job MDD está activo o encolado, ningún otro documento puede encolarse.

### Ejemplo (complejidad HIGH)

```text
W0  MDD canonical (persistido)
W1  Spec + Arquitectura        ← en paralelo, pero ambos requieren MDD listo
W2  UC, HU, API, flujos, UX, Blueprint
W2b Pantallas (sync UI MCP)
W3  Tasks + Infra + Gobernanza
W4  Post-pase SDD (cascada)
```

No puedes pulsar «Regenerar Spec» si el MDD acaba de encolarse en cascada pero aún no terminó W0.

## Cómo saber el estado

- **Workshop:** banner cuando hay generación en curso (MDD, cascada o entregable suelto); botón **Cancelar generación**; botones de regenerar deshabilitados si el gate lo impide.
- **API:** `GET /projects/:id/generation-status` devuelve `{ busy, activeJob, queuedJobs, mddStreamActive, mddJobs, gates, mddUpstreamSync }`. Los jobs MDD (`mddJobs`) incluyen `jobId`, `mode`, `status`, `progressSteps[]` (historial) y `progressActive` (nodo en curso). Análisis upstream: `GET /ai-analysis/mdd/upstream-sync/analysis?projectId=`. Acknowledge sin regenerar: `POST /ai-analysis/mdd/upstream-sync/accept-baseline?projectId=` (banner «Marcar MDD como sincronizado»).
- **Cancelación:** `DELETE /projects/:id/mdd-jobs/:jobId` (MDD), `DELETE /projects/:id/deliverables-jobs/:jobId` (cascada, spec, blueprint, plugin-artifact, etc.) o `DELETE /projects/jobs/:jobId?projectId=` (genérico). Jobs en cola se eliminan al instante; jobs activos reciben abort entre oleadas/nodos (puede tardar unos segundos).
- **Job concreto:** `GET /projects/:id/deliverables-jobs/:jobId`, `GET /projects/:id/mdd-jobs/:jobId` (MDD greenfield) o `GET /projects/jobs/:jobId`.

## Sin Redis (desarrollo local)

Sin `REDIS_URL`, la API usa una **cola in-memory secuencial por proyecto** en el mismo proceso Node. El job sobrevive si cierras el navegador, pero **no** si reinicias el servidor API. En producción (Dokploy) configura Redis para jobs persistentes.

## Errores 409 (Conflict)

Si intentas generar fuera de orden, la API responde **409** con un mensaje explícito (p. ej. «Spec está en cola…» o «Falta el entregable upstream mdd_canonical»). Espera a que termine el job activo o completa el documento previo.

## Buenas prácticas

1. Tras **Regenerar MDD** o **Sincronizar desde upstream**, espera a que termine y se persista antes de la cascada o entregables sueltos.
2. Usa **Generar todos** cuando quieras el orden completo; usa regeneración individual solo para un artefacto concreto.
3. Si vuelves al día siguiente, **recarga el proyecto** — no hace falta dejar la pestaña abierta durante horas (igual que con entregables).

**Nota:** el chat interactivo del Manager (HITL, aprobación de plan) sigue usando SSE en vivo; solo el arranque masivo (benchmark, legacy, `/sección`) va en cola.

## Relacionado

- Semáforo MDD y gates de entrega: ayuda **MDD** y **Specification Driven Development**.
- Cascada legacy: flujo aparte en proyectos `LEGACY` (`POST …/legacy/generate-deliverables`).

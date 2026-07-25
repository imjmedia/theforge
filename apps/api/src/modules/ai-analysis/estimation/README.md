# AI Analysis / Estimation

Módulo de estimación: completitud, consistencia y semáforo en tiempo real para proyectos.

## Capa

- **`estimation.service.ts`** — servicio principal de estimación (horas, costo MXN).
- **`estimation.types.ts`** — tipos: `EstimationResult`, `SemaphoreStatus`.
- **`completeness.util.ts`** — chequeo de completitud de artifactos SDD.
- **`consistency.util.ts`** — validación de consistencia cruzada entre documentos.
- **`live-semaphore-status.util.ts`** — polling del semáforo (rojo/amarillo/verde) en tiempo real.
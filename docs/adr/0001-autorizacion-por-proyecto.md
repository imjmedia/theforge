# ADR 0001: Autorización por proyecto

- **Estado:** aceptada (2026-11-02), lote 1 de seguridad, rama `fix/seguridad-lote-1`.
- **Ámbito:** `apps/api` (todas las rutas con `projectId`, `:id` de proyecto, o proyecto resuelto desde una sesión o un job).
- **Referencias:** ID-103 de `docs/seguridad/auditoria-2026-11-02-app-infra.md`; `apps/api/src/common/access/README.md`.

## Contexto

La autorización por proyecto estaba repartida por módulo y servicio. Cada controlador comprobaba (o no) si el usuario podía tocar el proyecto, así que el olvido era silencioso. La auditoría del 2026-11-02 (ID-103) encontró IDOR en `projects`, `integration`, `sessions`, `ai-analysis`, `legacy-flow`, `plugins` y otros módulos.

El modelo de tenencia es simple: cada proyecto tiene un dueño (`Project.userId`) y una visibilidad (`PRIVATE` o `SHARED`). No hay organizaciones. Las acciones que llaman a un LLM consumen créditos del dueño, así que un colaborador no debe disparar generación por su cuenta.

Un guard global que resuelva el proyecto no basta: el `projectId` puede venir en la ruta, en la query o en el body, y cada ruta necesita un nivel distinto.

## Decisión

1. **Política pura.** `canAccessProject(actor, target, level, options)` no depende de Nest ni de Prisma. Se prueba en aislamiento.
2. **Guard declarativo.** `@ProjectScoped` indica dónde está el proyecto (`param`, `query` o `body`), el nivel (`read | contribute | spend | manage`) y, si aplica, la etapa. `ProjectAccessGuard` aplica la política. `@ProjectAccessExempt(motivo)` documenta las rutas que autorizan en el handler, como las de sesiones o jobs.
3. **Cobertura por defecto.** `route-coverage.spec.ts` lee la metadata real de Nest de todos los controladores y falla si una ruta que requiere alcance no tiene decorador ni exención con motivo. La lista `PENDING` solo puede encoger, y hoy está vacía.
4. **Semántica SHARED.** Un no dueño de un proyecto `SHARED` tiene `read` y `contribute`. `spend` (LLM y encolado de generación) y `manage` (borrado, ajustes) son solo del dueño. Un admin obtiene `manage` sobre un `SHARED` ajeno únicamente cuando la ruta lo pide con `allowAdmin` (hoy, el borrado). Un admin no ve proyectos `PRIVATE` ajenos.
5. **Códigos de error.** `404 Project not found` si el proyecto no existe o el actor ni siquiera puede leerlo. `403` con `{ code: "PROJECT_LEVEL_FORBIDDEN", level, message }` si puede leerlo pero le falta el nivel. Los jobs responden `404` en toda denegación.

## Consecuencias

- Una ruta nueva con proyecto no pasa el spec de cobertura hasta que se decora o se exime con motivo. El coste es decorar cada handler; a cambio, el olvido deja de pasar desapercibido.
- Cambian contratos: las denegaciones de jobs pasan a 404, y los colaboradores reciben 403 al intentar gastar LLM. La web ya omite ese 403 en la bienvenida; el resto de la UI debe mostrarlo como falta de permiso.
- El 404 de lectura denegada oculta que el proyecto existe. El 403 de nivel revela solo lo que el actor ya puede leer.
- Los prefijos donde `:id` no es un proyecto (usuarios, grupos, instancias, etc.) se excluyen en el spec. Cualquier prefijo nuevo debe justificarse ahí.
- Las exenciones confían en el handler. El spec exige el motivo, pero no comprueba que el handler autorice. Eso queda en los specs de cableado por módulo (`mdd-jobs.access.spec.ts`, `ai-analysis.access-wiring.spec.ts`, `change-interview.access.spec.ts`, etc.).
- La decisión no cierra tres residuales: `convergeWebhookSecret` sigue legible por colaboradores `SHARED` (ID-206), una sesión o un stream abierto no revalida el acceso tras pasar el proyecto a `PRIVATE` (ID-205), y el guard omite valores no string en especificaciones opcionales (ID-204).

## Alternativas descartadas

- **Guard global (`APP_GUARD`) que infiere el proyecto.** No sabe en qué parte de la petición está el id ni qué nivel exige cada ruta. Obligaría a heurísticas por nombre de ruta. Se descarta: el guard se aplica por ruta y un spec verifica que ninguna ruta se queda sin él.
- **`SHARED` solo de lectura.** Impediría que un colaborador trabaje en el Workshop, que es el caso de uso de `SHARED`. Se descarta: el colaborador tiene `contribute`, que no consume LLM.
- **403 uniforme para toda denegación.** Revelaría que el proyecto existe a quien no puede leerlo. Se descarta: 404 cuando no hay lectura y 403 solo cuando el actor ya ve el proyecto.

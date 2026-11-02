# Acceso a proyectos (`common/access`)

Autorización centralizada por proyecto. La tenencia es `Project.userId` (dueño) más `Project.visibility` (`PRIVATE` | `SHARED`); no hay organizaciones.

## Niveles

| Nivel | Significa |
|---|---|
| `read` | Ver proyecto y entregables |
| `contribute` | Aportar contenido sin coste de LLM |
| `spend` | Generar con LLM (consume créditos del dueño) |
| `manage` | Borrar o cambiar ajustes |

## Política (`canAccessProject`, función pura)

- **Dueño**: todos los niveles.
- **No dueño en SHARED**: `read` y `contribute` (`SHARED_NON_OWNER_LEVELS`). `spend` y `manage` solo el dueño.
- **No dueño en PRIVATE**: nada. Admin y super_admin **no** tienen bypass de lectura.
- **`allowAdmin: true`**: un admin o super_admin obtiene `manage` sobre un proyecto ajeno SHARED (paridad con el borrado actual). No abre proyectos PRIVATE ajenos.
- **Errores de `assertProject`** (servicio y guard):
  - Inexistente, o el actor ni siquiera tiene `read`: `NotFoundException("Project not found")` (mismo mensaje, no revela existencia). Ej.: B pide `spend` sobre un PRIVATE de A.
  - El actor **sí tiene `read`** pero no el nivel pedido (colaborador en SHARED pidiendo `spend` o `manage`): `ForbiddenException` con cuerpo `{ code: "PROJECT_LEVEL_FORBIDDEN", level, message: "Solo el dueño del proyecto puede ejecutar esta acción" }`. Así la UI distingue "no puedes hacer esto" de "no existe". No revela nada nuevo: el actor ya ve el proyecto.
  - Helpers: `isProjectLevelForbidden(err)` e `isProjectAccessDenied(err)` (404 o 403 de nivel).
  - **Jobs** (`projects/job-access.util.ts`, `assertMddJobReadable` en ai-analysis): toda denegación, incluido ese 403, se convierte en 404 "Job no encontrado" (el polling no debe detenerse ni revelar el job).

## Uso desde servicios

```ts
constructor(private readonly access: ProjectAccessService) {}

const actor = this.access.actorFromRequest();
const project = await this.access.assertProject(actor, projectId, "spend");
await this.access.assertStageInProject(project.id, stageId);

// Borrado: el dueño o un admin
await this.access.assertProject(actor, id, "manage", { allowAdmin: true });

// Filtrar una lista de ids a los legibles (dueño o SHARED), en una sola query
const readable = await this.access.filterReadable(actor, ids);
```

`AccessModule` es `@Global()`: basta inyectar `ProjectAccessService`, sin importar el módulo.
`assertProject` y `assertStageInProject` recortan (`trim`) los ids y tratan el vacío como no encontrado.

## Uso desde controllers: `@ProjectScoped`

`@ProjectScoped(...)` fija la metadata y aplica `ProjectAccessGuard` (`UseGuards`). Defaults: `from: "param"`, `key: "id"`. Va en handler o clase; el handler manda sobre la clase, y una `@ProjectAccessExempt` en el handler también anula el `@ProjectScoped` de la clase.

```ts
@ProjectScoped("read")                       // :id de la ruta, nivel read
@Get(":id")
get() {}

// projectId opcional en query (sin valor: el spec se omite)
@ProjectScoped({ from: "query", key: "projectId", level: "spend", optional: true })

// proyecto en la ruta + etapa opcional en el body (se verifica que sea del proyecto)
@ProjectScoped({ level: "contribute", stage: { from: "body", key: "stageId", optional: true } })

// borrado: dueño o admin
@ProjectScoped({ level: "manage", allowAdmin: true })

// varios proyectos (p. ej. merge): se evalúan todos
@ProjectScoped([
  { level: "read" },
  { from: "body", key: "targetId", level: "contribute" },
])
```

Reglas del guard:

- Orden: guard JWT global (`APP_GUARD`, deja `req.user = { userId, email, role }`) → guard de ruta `ProjectAccessGuard` → `UserContextInterceptor`. Por eso el guard lee `req.user` y no el AsyncLocalStorage. Sin `req.user` responde 403.
- El valor se recorta (`trim`). Si no es un string no vacío: `optional: true` omite el spec; si no, 404 "Project not found". Con `stage`, igual: 404 "Etapa no encontrada" salvo `stage.optional`.
- `from: "body"` no funciona en rutas multipart (multer aún no parseó el body en el guard; `body-parser` deja `req.body = {}`). Se detecta por la cabecera `Content-Type: multipart/...` y se responde 400; usa `param`/`query` o verifica en el servicio con `ProjectAccessService`.
- Las excepciones del servicio (404 y 403 `PROJECT_LEVEL_FORBIDDEN`) se propagan tal cual. Rol ausente cae a `developer`.
- Sin metadata `@ProjectScoped` el guard deja pasar (y solo actúa en contexto `http`).

### `req.projectAccess`

Tras autorizar, el guard deja el resultado en `req.projectAccess`:

- Con **un solo spec**: un `AuthorizedProject` (`{ id, userId, visibility, isOwner }`).
- Con **varios specs**: un `AuthorizedProject[]` en el orden de los specs, solo con los evaluados (los `optional` omitidos no aparecen). Un array de un solo spec cuenta como un spec (objeto).
- Si todos los specs se omitieron, `req.projectAccess` no se define.

### Exenciones

```ts
@ProjectAccessExempt("Lista solo proyectos del usuario; filtra por userId en el servicio")
@Get()
list() {}
```

Marca una ruta o controller como exento con el motivo obligatorio. Solo marca metadata (`PROJECT_ACCESS_EXEMPT_KEY`); el spec de cobertura (sección Cobertura) exige que toda ruta con projectId esté decorada o exenta.

## Pruebas

`pnpm --filter @theforge/api test -- --test-path-pattern='common/access'` (política, servicio con Prisma mock y guard con matriz IDOR).

## Cobertura

`route-coverage.spec.ts` deniega por defecto. Importa todos los `*.controller.ts` de `src/`, lee la metadata de Nest (`PATH_METADATA`, `METHOD_METADATA`, `IS_PUBLIC_KEY`, `PROJECT_SCOPED_KEY`, `PROJECT_ACCESS_EXEMPT_KEY`; handler antes que clase) y exige que toda ruta que **requiere scope** tenga una de estas:

- `@ProjectScoped(...)` en el handler o la clase.
- `@ProjectAccessExempt("motivo")` con motivo no vacío (la ruta toca un proyecto pero la autorización se resuelve por otro camino, y se explica cuál).
- Estar en la constante `PENDING` del spec (deuda aún sin migrar).

**Qué requiere scope** (función `requiresProjectScope`, listas explícitas al inicio del spec): toda ruta no `@Public` con `:projectId`; o bajo el prefijo `projects/`; o con `:id` fuera de los prefijos donde `:id` no es un proyecto (`users`, `project-groups`, `ui-mcp`, `provider-instances`, `admin`, `auth`, `design-refs`, `user-providers`, `ai-analysis/eval`). `sessions/:id*` SÍ requiere scope aunque `:id` sea de sesión: cada ruta carga la sesión (scope por usuario), exige nivel sobre `session.projectId` en el handler y lleva `@ProjectAccessExempt("motivo")` (`findOne` read; `chat` y `messages` con imágenes spend; `messages` sin imágenes y `PATCH context` contribute); o en los controllers que reciben el proyecto por body/query (`ai-analysis`, `ai-orchestrator`, más `POST /sessions`), salvo `NO_PROJECT_ROUTES`. Las rutas `@Public` nunca lo requieren y tampoco pueden llevar `@ProjectScoped` (otro test lo comprueba).

**`PENDING` solo puede encoger.** El spec falla si:

1. una ruta que requiere scope no está decorada ni en `PENDING` (una ruta nueva debe nacer decorada; el fallo lista `archivo`, controller y método);
2. una entrada de `PENDING` ya está cubierta, ya no existe o ya no requiere scope;
3. `PENDING` no está en orden alfabético.

**Cómo retirar una ruta de `PENDING`:** decora el handler (o la clase) con `@ProjectScoped` o `@ProjectAccessExempt("motivo")`, borra su línea `"METODO /path"` de `PENDING` y corre `node scripts/run-tests.mjs --test-path-pattern='route-coverage'`. Cuando `PENDING` quede vacía, elimínala y deja solo la regla 1. Para una ruta que de verdad no maneja proyecto (p. ej. `GET /ai-analysis/mdd/config`), agrégala a `NO_PROJECT_ROUTES` en lugar de exentarla.

Los alias apilados (dos `@Post` sobre un mismo handler) no se ven: Nest solo conserva el decorador superior, y el spec mide lo que Nest registra de verdad.

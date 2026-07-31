# Admin

Endpoints de administración y diagnóstico. Acceso según rol.

## Endpoints

- **`GET /admin/worker-jobs`** — lista colas BullMQ/in-memory, workers Redis y jobs activos (admin / super_admin).
- **`POST /admin/worker-jobs/:jobId/stop`** — detiene el worker y limpia cola/Redis del job (admin / super_admin). **No** borra checkpoint LangGraph, `threadId` ni contenido MDD en BD; el usuario puede reanudar el flujo desde el Workshop. Body: `{ queue, projectId }`.
- **`GET /admin/system-config`** — snapshot de configuración de plataforma (solo super_admin).
- **`PATCH /admin/system-config`** — actualiza llaves de plataforma (solo super_admin).
- **`POST /admin/ariadne-config/test`** — prueba conexión MCP Ariadne.
- **`POST /admin/tech-docs-config/test`** — prueba conexión MCP docs técnicas.

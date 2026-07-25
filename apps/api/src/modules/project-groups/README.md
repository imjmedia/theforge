# Project Groups

Agrupación de proyectos para organización en el dashboard. CRUD con ordenamiento. Roles: `admin` y `super_admin`.

## Endpoints

- **`POST /project-groups`** — crear grupo (name, 1–120 chars).
- **`GET /project-groups`** — listar todos los grupos.
- **`GET /project-groups/:id`** — detalle de un grupo.
- **`PATCH /project-groups/:id`** — renombrar grupo.
- **`DELETE /project-groups/:id`** — eliminar grupo (proyectos se reasignan al grupo default).
- **`POST /project-groups/:id/move-first`** — priorizar grupo en el dashboard.

## Capa

- **`project-groups.service.ts`** — lógica CRUD + reasignación.
- **`project-groups.controller.ts`** — endpoints REST.
- **`project-group-order.util.ts`** — utilidad de ordenamiento (sortOrder).
# Change Log

Bitácora de cambios de proyectos: quién modificó qué artifacto y cuándo. Auditoría de trazabilidad para el Workshop.

## Capa

- **`change-log.service.ts`** — consulta paginada vía Prisma sobre la tabla `ChangeLog`.
- **`change-log.controller.ts`** — `GET /projects/:projectId/changelog`.
- **`change-log.module.ts`** — módulo NestJS.
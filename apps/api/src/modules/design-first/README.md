# DesignFirstModule

Expone el slice **Design-First** del Workshop: lectura del `designSpec`, actualización con CAS por revisión y compilación determinista del contrato (PAG + OpenAPI 3.1).

## Rutas (`projects/:id/design*`)

| Método | Ruta | Nivel |
|--------|------|-------|
| `GET` | `/projects/:id/design` | `read` |
| `PUT` | `/projects/:id/design/screens` | `contribute` |
| `PUT` | `/projects/:id/design/data-needs` | `contribute` |
| `POST` | `/projects/:id/design/compile-contract` | `contribute` |

## Flags

- `DESIGN_FIRST_ENABLED`: creación de proyectos `DESIGN_FIRST` y escrituras en `/design*` (lectura permitida con flag apagado).
- `DESIGN_FIRST_MAX_SPEC_BYTES`: límite de tamaño del JSON `designSpec`.

## Dependencias

Importa **Prisma** vía `PrismaService`; **no** importa `ProjectsModule`. Exporta `DesignSpecReader` y servicios de spec/contrato para handoff y cascada (pasos posteriores).

## Errores tipados

Códigos principales: `ERR_DESIGN_FIRST_DISABLED`, `ERR_DESIGN_FIRST_NOT_ALLOWED`, `ERR_DESIGN_REVISION_CONFLICT`, `ERR_DESIGN_PHASE_GATE`, `ERR_DESIGN_INVARIANT`, `ERR_PAG_INVALID`, `ERR_OPENAPI_INVALID`.

# DesignFirstModule

Expone el slice **Design-First** del Workshop: lectura del `designSpec`, actualización con CAS por revisión y compilación determinista del contrato (PAG + OpenAPI 3.1).

## Rutas (`projects/:id/design*`)

| Método | Ruta | Nivel |
|--------|------|-------|
| `GET` | `/projects/:id/design` | `read` |
| `PUT` | `/projects/:id/design/screens` | `contribute` |
| `PUT` | `/projects/:id/design/data-needs` | `contribute` |
| `POST` | `/projects/:id/design/compile-contract` | `contribute` |
| `POST` | `/projects/:id/design/data-needs/propose` | `spend` |
| `POST` | `/projects/:id/design/import/images` | `spend` |
| `POST` | `/projects/:id/design/proposals/:pid/accept` | `contribute` |
| `POST` | `/projects/:id/design/proposals/:pid/reject` | `contribute` |

## Flags

- `DESIGN_FIRST_ENABLED`: creación de proyectos `DESIGN_FIRST` y escrituras en `/design*` (lectura permitida con flag apagado).
- `DESIGN_FIRST_MAX_SPEC_BYTES`: límite de tamaño del JSON `designSpec`.

## Dependencias

Exporta `DesignSpecReader`, `DesignProposalService`, `DesignArtifactsService` y servicios de spec/contrato para handoff y cascada (pasos 18–20).

Propuestas HITL: Redis clave `design-first:proposal:{projectId}:{proposalId}` con TTL **24 h** (`DESIGN_PROPOSAL_TTL_SECONDS`); en dev/test sin `REDIS_URL` usa memoria en proceso.

## Errores tipados

Códigos principales: `ERR_DESIGN_FIRST_DISABLED`, `ERR_DESIGN_FIRST_NOT_ALLOWED`, `ERR_DESIGN_REVISION_CONFLICT`, `ERR_DESIGN_PHASE_GATE`, `ERR_DESIGN_INVARIANT`, `ERR_PAG_INVALID`, `ERR_OPENAPI_INVALID`, `ERR_DESIGN_EXTRACT_INVALID`, `ERR_DESIGN_IMAGES_TOO_LARGE`, `ERR_DESIGN_PROPOSAL_EXPIRED`.

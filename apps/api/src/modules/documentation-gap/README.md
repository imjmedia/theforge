# Documentation Gap

Detección, reporte y reconciliación de gaps en la documentación SDD. Permite a los agentes IA reportar desviaciones entre el código y el SDD vía `report_documentation_gap`, y a los humanos aprobarlas/rechazarlas en el Workshop.

## Flujo

1. Agente IA detecta desvío código vs SDD → `report_documentation_gap`
2. Gap queda pendiente de aprobación (`pendingApproval`) en el panel `PendingDocumentationGapsPanel`
3. Humano aprueba/rechaza → regeneración parcial de los artifactos afectados

## Capa

- **`documentation-gap.service.ts`** — lógica de negocio (crear, aprobar, rechazar gaps).
- **`documentation-gap.controller.ts`** — endpoints CRUD + reconciliación.
- **`architecture-decision.service.ts`** — registro de ADRs (Architecture Decision Records).
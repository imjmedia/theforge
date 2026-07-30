# constants

- **`legacy-workshop-loading-steps.ts`** — Textos que rotan cada ~6s en **WorkshopView** (panel central) y **ChatContainer** (columna chat) mientras `loadingReason` es `legacy-codebase-doc`, `legacy-mdd`, `legacy-deliverables`, `legacy-brd-suggest`, `legacy-as-is`, o **`brd-from-dbga`** (usa **`BRD_TOBE_FROM_DBGA_STEPS`** — nombre pendiente de renombrar). No reflejan eventos reales del API (la generación es una petición larga); sirven de feedback de UX.
- **`agent-governance-loading-steps.ts`** — Pasos del modal de progreso al generar gobernanza (detectar → LLM → reconciliar → persistir). No invoca `agent-governance-export` ni descargas ZIP; el export handoff es solo desde botones del header Workshop.

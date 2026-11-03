# docs

Punto de entrada para humanos y agentes. **Arquitectura y producto (NotebookLM):** carpeta **[notebooklm/](notebooklm/README.md)** — ahí vive el índice principal, SDD, MCP, despliegue y planes vigentes.

## Enlaces rápidos

| Necesitas… | Documento |
|------------|-------------|
| Release v1 — generación v2, Excalidraw híbrido, formateador Markdown | [THE-FORGE-V1-RELEASE.md](THE-FORGE-V1-RELEASE.md) |
| Comparativa spec-kit vs The Forge (SDD, gaps, alineación) | [speckit-vs-theforge.md](speckit-vs-theforge.md) |
| Agente IA implementando desde docs TheForge | [THEFORGE-DOC-CONSUMPTION-GUIDE.md](THEFORGE-DOC-CONSUMPTION-GUIDE.md) |
| MCP gráfico (componentes UI, Kreo, Pantallas) | [MCP_GRAFICO.md](MCP_GRAFICO.md) |
| Visión técnica única (flujo, semáforo, costos, Docker) | [notebooklm/THEFORGE-INDEX.md](notebooklm/THEFORGE-INDEX.md) |
| Etapas `Stage`, API aplanada, Falkor | [notebooklm/STAGE-SDD.md](notebooklm/STAGE-SDD.md) |
| Legacy etapa 1 AS-IS (MDD Inicial → MDD) | [notebooklm/LEGACY-FLOW-AS-IS-MDD.md](notebooklm/LEGACY-FLOW-AS-IS-MDD.md) |
| Integración legacy ↔ nuevo (guía de usuario) | [notebooklm/LEGACY-NEW-INTEGRATION-GUIDE.md](notebooklm/LEGACY-NEW-INTEGRATION-GUIDE.md) |
| Planes de implementación (índice) | [plans/README.md](plans/README.md) |
| Cliente HTTP The Forge ↔ MCP AriadneSpecs | [notebooklm/integracion-theforge/README.md](notebooklm/integracion-theforge/README.md) |
| Despliegue Coolify (override compose) | [DEPLOY-COOLIFY.md](DEPLOY-COOLIFY.md) |
| Migración env → Ajustes → Sistema (Dokploy v1.3.0+) | [DOKPLOY-MIGRACION-CONFIG-SISTEMA.md](DOKPLOY-MIGRACION-CONFIG-SISTEMA.md) |
| Seguridad: auditoría de aplicación, secretos e infra (ID-101 a ID-125) | [seguridad/auditoria-2026-11-02-app-infra.md](seguridad/auditoria-2026-11-02-app-infra.md) |
| Seguridad: revisión del lote 1, veredicto por ID | [seguridad/auditoria-2026-11-02-lote1.md](seguridad/auditoria-2026-11-02-lote1.md) |
| Lote 1 de seguridad: pasos operativos antes del deploy y pendientes | [handoffs/2026-11-02-seguridad-lote1-handoff.md](handoffs/2026-11-02-seguridad-lote1-handoff.md) |
| Auditoría global 2026-11-02 | [handoffs/2026-11-02-auditoria-global.md](handoffs/2026-11-02-auditoria-global.md) |
| Calidad del MDD, lote 2: pasos antes del deploy, contratos nuevos y deuda | [handoffs/2026-11-03-calidad-mdd-lote2-handoff.md](handoffs/2026-11-03-calidad-mdd-lote2-handoff.md) |
| Decisiones de arquitectura (ADR) | [adr/0001-autorizacion-por-proyecto.md](adr/0001-autorizacion-por-proyecto.md) |
| ADR 0002: reparar Mermaid solo si el parser rechaza el original | [adr/0002-reparacion-mermaid-solo-si-el-parser-rechaza.md](adr/0002-reparacion-mermaid-solo-si-el-parser-rechaza.md) |
| ADR 0003: lease por hilo MDD que falla cerrado | [adr/0003-lease-por-hilo-falla-cerrado.md](adr/0003-lease-por-hilo-falla-cerrado.md) |
| ADR 0004: fencing token en las escrituras del MDD | [adr/0004-fencing-token-escrituras-mdd.md](adr/0004-fencing-token-escrituras-mdd.md) |
| Histórico / roadmaps no prioritarios | [archive/README.md](archive/README.md) |

## Raíz del monorepo (no están en `docs/`)

- `blueprint.md`, `mdd.md` — especificación de producto viva. Actualizadas a v2.0 (mayo 2026).

## Limpieza reciente (2026-04)

Se **eliminaron** planes ya cubiertos por el código o duplicados: post-mortem §3 implementado, notas sueltas Ariadne+Forge, plan de etapas Workshop desactualizado, plan web TheForge-Web (la integración vive en `apps/api` + `apps/web`). El detalle operativo sigue en **notebooklm** e **archive**.

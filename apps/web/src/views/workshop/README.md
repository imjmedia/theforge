# views/workshop

Subcomponentes extraídos de `WorkshopView.tsx` (Fase 5b del [GOD-REFACTOR](../../../docs/GOD-REFACTOR.md)).

| Archivo | Uso |
| ------- | --- |
| **WorkshopDocToolbarHint.tsx** | Hint de orden de pestañas según complejidad (LOW / MEDIUM / HIGH) y tipo de proyecto (legacy vs greenfield). En HIGH muestra resumen compacto; el flujo completo se abre desde el modal del toolbar. |
| **WorkshopHeaderBar.tsx** | Header global: título, badge Legacy, visibilidad privado/compartido, estado de sync, selector de etapa, nueva etapa, descarga ZIP, export SDD spec-kit, ayuda y línea MCP en proyectos legacy. |
| **WorkshopDocPanel.tsx** | Columna B: envuelve toolbar + área scrollable + bubble menu (desktop). |
| **WorkshopDocToolbar.tsx** | Toolbar del documento (preview/source, regen, imprimir, acciones móvil). Tipos en `workshopDocToolbar.types.ts`. |
| **WorkshopAuditModal.tsx** | Modal inline de auditoría MDD (calidad, gaps, regeneración por sección). |
| **WorkshopModals.tsx** | Agrupa todos los overlays al final del root (`AlertDialog`, patrones MDD, regen, AEM, etapa, flujo, DBGA, ayuda, modelos no disponibles). Tipos en `workshopModals.types.ts`. |
| **WorkshopStandardDocPanels.tsx** | Ocho entregables con `StandardDocPanel` (arquitectura, casos de uso, historias, blueprint, tasks, API, flujos, infra). Tipos en `workshopStandardDocPanels.types.ts`. |
| **WorkshopLegacyPanels.tsx** | Banner AS-IS, MDD Inicial, Integración y flujo de modificación legacy. Tipos en `workshopLegacyPanels.types.ts`. |
| **WorkshopBenchmarkPanel.tsx** | Pestaña Benchmark (Fase 0 + Deep Research). Toggle **Modo asistido**: al activar analiza DBGA existente, detecta plantilla A/B/C, lista gaps y lanza primera pregunta en el chat (visible aunque solo haya respuesta del asistente). Tipos en `workshopBenchmarkPanel.types.ts`. |
| **WorkshopMddPanel.tsx** | Panel MDD: gates legacy, acciones (generar, formato, patrones, cascade), auditoría manual y editor. Tipos en `workshopMddPanel.types.ts`. |
| **WorkshopSpecBrdAemPanels.tsx** | Spec, AEM, UI Screens y BRD de etapa. Tipos en `workshopSpecBrdAemPanels.types.ts`. |
| **WorkshopAgentPanels.tsx** | Gobernanza de agentes, gaps pendientes y log de sesión. Tipos en `workshopAgentPanels.types.ts`. La vista previa usa `agentGovernanceContent` persistido; el export ZIP (`agent-governance-export`) solo al pulsar descarga en el header. |
| **WorkshopUxGuidePanel.tsx** | Design System / UX guide (preview, design, source). Tipos en `workshopUxGuidePanel.types.ts`. |
| **WorkshopAdrsPluginPanels.tsx** | ADRs del grafo y paneles plugin dinámicos. Tipos en `workshopAdrsPluginPanels.types.ts`. |
| **WorkshopDocPanelContent.tsx** | Compositor del área scroll: encadena todos los subpaneles anteriores. Tipos en `workshopDocPanelContent.types.ts`. |
| **useWorkshopDocPanelProps.ts** | Hook que consolida los `useMemo` de props de todos los subpaneles del documento. Tipos de entrada en `useWorkshopDocPanelProps.types.ts`. |
| **useWorkshopDocToolbarProps.ts** | Hook que construye `WorkshopDocToolbarProps`, `docEditToolbarToggle` y `phase0EntryModeToolbarToggle`. Tipos en `useWorkshopDocToolbarProps.types.ts`. |
| **useWorkshopDocBubbleMenuItems.ts** | Hook del bubble menu contextual del documento (regenerar, limpiar, descargar, imprimir). Tipos en `useWorkshopDocBubbleMenuItems.types.ts`. |
| **useWorkshopModalsProps.ts** | Hook que construye `WorkshopModalsProps`. Tipos en `useWorkshopModalsProps.types.ts`. |
| **WorkshopMetricsColumn.tsx** | Columna métricas: panel móvil + flyout desktop (semáforo). Tipos en `workshopMetricsColumn.types.ts`. Usa `WorkshopMetricsColumnInner` (semáforo, gate MDD, brechas SDD vía auditoría/conformance, **Corregir auto/LLM** → `POST …/repair-sdd-gaps`, **Abrir BRD**, link a auditoría). La heurística legacy «Coherencia §3/§4» (ex-Falkor) ya no se muestra en panel; sigue en backend solo como `sddDomainGraphOk` opcional al persistir MDD. |
| **WorkshopLayoutShell.tsx** | Grid principal lg (chat + docs + métricas) con slots para overlays móviles y modales. |
| **WorkshopChatColumn.tsx** | Columna A: chat redimensionable + rail de expansión en desktop. |
| **WorkshopMobileNav.tsx** | Barra inferior móvil Chat / Docs / Estado. |
| **WorkshopMobileFabs.tsx** | FABs flotantes móviles (scroll, preview/source, orden de flujo). Tipos en `workshopMobileFabs.types.ts`. |
| **useLgChatPanel.ts** | Hook: colapso y resize del chat en desktop (localStorage por proyecto). |
| **useWorkshopMobileScrollFab.ts** | Hook: visibilidad y dirección del FAB de scroll móvil. |
| **workshopScroll.util.ts** / **workshopChatPanel.util.ts** | Utilidades puras de scroll y ancho del panel chat. |

Utilidades compartidas con otros módulos también viven en `utils/workshopDocToolbar.ts`.

Próximas extracciones planificadas: slices de `workshopStore`.

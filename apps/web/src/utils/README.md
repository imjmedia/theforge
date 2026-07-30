# Utils (web)

Utilidades del Workshop y plugins.

| Archivo | Rol |
|---------|-----|
| `workshop-document-content.util.ts` | Normaliza markdown del editor Workshop: quita stamp API, limpia residuos (`cleanDocForWorkshop`) y aplica **`formatDocumentMarkdown`** (misma SSOT que `MddViewer` y persist API). `workshopDocumentBodiesEqual` compara cuerpos ya formateados. |
| `workshop-mdd-sync.util.ts` | **`resolveMddFetchMerge`**: decide servidor vs local en `fetchProject` (refresh, cambio de proyecto, fetch obsoleto post-grabar, cambios sin guardar). Con **`preferServerMdd`** (job MDD en background) aplica el markdown del servidor aunque local === baseline. Tests en `workshop-mdd-sync.util.spec.ts`. |
| `workshopAgentsBusy.ts` | **`isWorkshopAgentsBusy`**: bloquea salir del Workshop solo con trabajo en primer plano (chat streaming, benchmark). Jobs encolados en servidor (`isServerSideQueuedWork`, `generationStatus.busy`) no bloquean navegación. |
| `tasksGenerationPrerequisites.ts` | Prerrequisitos UI para **Generar Tasks** (MDD, Spec, Blueprint, API si §4, Pantallas si `hasUxTeam`; legacy relaja Spec). Alineado con `runTasksPreflightStrict`. |
| `pluginApi.ts` | HTTP: artifacts, plugin-data, generación encolada, polling |
| `pluginArtifactContent.ts` | Serialización editor ↔ payload según `contentType` |
| `triggerBrowserBlobDownload.ts` | Descarga de blobs/ZIP: mantiene el object URL ~60s antes de revocarlo (ZIPs grandes del Workshop). |
| `stageWorkflowStatusLabel.ts` | Etiquetas en español para `StageStatus` en el selector del Workshop. |
| `stageTransitionLabels.ts` | Etiquetas y descripciones de acciones `activate` / `complete` / `archive` / `reopen` en el modal de ciclo de vida de etapa. |
| `readApiErrorMessage.ts` | Mensajes legibles desde respuestas API fallidas (export SDD/handoff). |
| `downloadSpecKitBundle.ts` / `downloadRepoHandoff.ts` | Export spec-kit y handoff (API + fallback cliente). |

Ver `apps/web/src/components/PluginDocPanel.tsx`, `MddViewer.tsx` y `apps/web/src/store/workshopStore.ts`.

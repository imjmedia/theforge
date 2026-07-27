# Coherencia MDD §3/§4 (markdown)

Reemplaza el grafo FalkorDB descontinuado. Inferencia de tablas SQL, endpoints API y relaciones CONSUMES desde el markdown del MDD.

| Archivo | Rol |
|---------|-----|
| `mdd-coherence.util.ts` | `evaluateMddCoherenceFromMarkdown`, `buildSddStageSnapshotFromMdd` |
| `mdd-graph-expectations.util.ts` | Parse §3/§4 indexables |
| `sdd-consumes-link.util.ts` | FK + matching ruta→tabla |
| `mdd-coherence.service.ts` | `MddCoherenceService` — semáforo (`sddDomainGraphOk`) y `generation-status.sddGraph` |
| `sdd-graph-context.util.ts` | Snapshot en `Stage.shortTermContext.sddGraph` |

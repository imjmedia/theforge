# Coherencia MDD §3/§4 (markdown)

Inferencia de tablas SQL, endpoints API y enlaces ruta→tabla desde el markdown del MDD (sin grafo externo).

| Archivo | Rol |
|---------|-----|
| `mdd-coherence.util.ts` | `evaluateMddCoherenceFromMarkdown`, `buildSddStageSnapshotFromMdd` |
| `mdd-graph-expectations.util.ts` | Parse §3/§4 indexables |
| `sdd-consumes-link.util.ts` | FK + matching ruta→tabla |
| `mdd-coherence.service.ts` | `MddCoherenceService` — al persistir MDD HIGH puede marcar `sddDomainGraphOk` en el semáforo (no expuesto en UI del Workshop) |
| `sdd-graph-context.util.ts` | Snapshot opcional en `Stage.shortTermContext.sddGraph` al persistir MDD (huella histórica; no bloquea la UI) |

## Lectura en vivo

`evaluateFromMdd` sigue disponible para pipeline interno y `GET …/generation-status` (campo `sddGraph`, legacy). **El panel Semáforo del Workshop ya no muestra la tarjeta «Coherencia §3/§4»** — la métrica era confusa tras retirar FalkorDB y el matching ruta→tabla genera muchos falsos positivos.

Estados (`resolveMddCoherenceState`): **Coherente**, **Incoherente**, **Sin §3/§4**, **No evaluable**.

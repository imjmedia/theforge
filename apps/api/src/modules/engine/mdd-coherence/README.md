# Coherencia MDD §3/§4 (markdown)

Inferencia de tablas SQL, endpoints API y enlaces ruta→tabla desde el markdown del MDD (sin grafo externo).

| Archivo | Rol |
|---------|-----|
| `mdd-coherence.util.ts` | `evaluateMddCoherenceFromMarkdown`, `buildSddStageSnapshotFromMdd` |
| `mdd-graph-expectations.util.ts` | Parse §3/§4 indexables |
| `sdd-consumes-link.util.ts` | FK + matching ruta→tabla |
| `mdd-coherence.service.ts` | `MddCoherenceService` — semáforo (`sddDomainGraphOk`) y `generation-status.sddGraph` |
| `sdd-graph-context.util.ts` | Snapshot opcional en `Stage.shortTermContext.sddGraph` al persistir MDD (huella histórica; no bloquea la UI) |

## Lectura en vivo (`generation-status`)

`evaluateFromMdd` y `GET …/generation-status` evalúan **siempre** el `mddContent` actual. No comparan la huella `mddGraphFingerprint` persistida: el panel «Coherencia §3/§4» refleja el markdown en BD, no un snapshot desfasado tras cascada o auto-repair del gate.

Estados UI (`resolveMddCoherenceState`): **Coherente**, **Incoherente**, **Sin §3/§4**, **No evaluable**.

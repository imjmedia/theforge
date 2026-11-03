# ADR 0002: Reparación de Mermaid solo si el parser rechaza el original

- **Estado:** aceptada (2026-11-03), lote 2 de calidad del MDD, rama `fix/calidad-mdd-lote-2`.
- **Ámbito:** `packages/shared-types` (reparación de Markdown y Mermaid), `apps/api/src/modules/mermaid-oracle` (oráculo de pruebas) y el formateador del MDD en `apps/api/src/modules/ai-analysis`.
- **Referencias:** H1 y el hallazgo 4 de `docs/handoffs/2026-11-02-auditoria-global.md`; `packages/shared-types/README.md`; `apps/api/src/modules/mermaid-oracle/README.md`; `docs/handoffs/2026-11-03-calidad-mdd-lote2-handoff.md`.

## Contexto

El reparador de Mermaid y de Markdown acumuló reglas por regex, muchas escritas para un caso concreto de un cliente (Odoo, OBP4MO, tablas espejo, un webhook de sincronización, títulos fijos de una plantilla). Más de quince commits sucesivos añadieron o ajustaron esas reglas sin una referencia común de validez.

La regla más grave era `looksLikeJsonFlattenFlowchart` (H1, crítica). Sustituía cualquier `flowchart TD` con ≥ 8 nodos `sN(...)` por un webhook inventado, en cada persist. Un diagrama válido del usuario desaparecía sin aviso. La regla de oro del corpus solo exigía que la salida fuera válida e idempotente, así que un webhook inventado (que es válido) la pasaba: nada comprobaba que se conservara el contenido.

## Decisión

1. **Regla de oro.** Un diagrama que el parser acepta no se toca. Solo se repara lo que el parser rechaza, y una reparación se acepta únicamente si el parser la acepta. Con el parser caído el resultado es `unverified`, nunca `invalid` (`packages/shared-types/src/mermaid-oracle.ts`).
2. **Oráculo de preservación.** `mermaid-corpus.spec.ts` exige que, en las etapas de documento, un diagrama válido salga igual salvo espacios en blanco. Los cambios que hoy ocurren están en `PRESERVATION_KNOWN_CHANGES` con su motivo y su regla. Una entrada nueva fuera de esa lista hace fallar el spec, y una que deja de cambiar se poda.
3. **Sin reglas de cliente en `shared-types`.** Las reglas que nombran un proyecto, un proveedor o un título concreto se eliminan. Se mantienen las reglas genéricas (fences, comillas, sintaxis de cada tipo) y cada una debe pasar el oráculo.
4. **Sin parser en runtime todavía.** La API no ejecuta el parser de Mermaid; la garantía en CI la da el spec. La Fase 2 llevará el parser a runtime, en un `worker_thread` con timeout.

## Consecuencias

- Un diagrama válido del usuario ya no se reescribe por una regla de cliente. Se pierde la "reparación" de casos que no eran un fallo del parser.
- Hoy 66 válidos del corpus siguen cambiando por reglas genéricas (cifra del momento de la decisión; el addendum de 2026-11-03 la baja a 1, `spec-054`) (comillas en flowcharts, `graph` a `flowchart`, comentarios, secuencias S1–S5, ER E1–E3). Quedan como deuda explícita para las fases 2 y 3; el spec los registra por motivo.
- La corrida 3 del eval no es comparable con la 2 en markdown, porque se retiraron reglas y el one-shot quedó en serie.
- Un diagrama que el parser rechaza y ninguna regla genérica arregla sale sin cambios. El fence se conserva: la reparación nunca degrada un fence a prosa.
- Sin parser en runtime, la validación de la salida en producción sigue siendo determinista. Que el navegador acepte el diagrama no se comprueba en el servidor hasta la Fase 2.

## Alternativas descartadas

- **Mantener las reglas de cliente con un golden por caso.** Cada caso nuevo pide otra regla, y el golden fija como esperado el comportamiento malo. Se descarta.
- **Parser en runtime en este mismo lote.** Requiere `worker_threads`, timeout y degradación, y mezclaría un cambio de infraestructura con el cambio de contrato. Se pospone a la Fase 2.
- **Quitar el reparador por completo.** Los LLM producen fences rotos y tablas partidas con frecuencia; el reparador genérico sigue siendo necesario. Se descarta.
- **Regenerar con el LLM cuando el parser rechaza.** Gasta tokens, cambia el documento entero y no es determinista. Queda para la Fase 3, con validación contra el parser (`POST /ai/mermaid/regenerate`, ver el README del oráculo).

## Addendum: medición 2026-11-03 (retirada de reglas y acotado de comillas)

Medición por ablación de cada regla de `MERMAID_BODY_RULES` (`normalizeMermaidDiagramBody`) sobre el corpus de 270 diagramas (58 inválidos, 212 válidos). `repairLost` = inválidos que dejan de parsear al quitar la regla; `preservationGained` = válidos que dejan de cambiar al quitarla. Criterio: borrar si `repairLost = 0` y `preservationGained > 0`; acotar si repara y cambia válidos manteniendo `repairLost = 0`; mantener el resto.

| Regla | repairLost (antes) | preservationGained (antes) | Decisión |
|---|---:|---:|---|
| `strip-comments` | 0 | 3 | Retirada del registro. `stripMermaidComments` se conserva (la usan specs). |
| `graph-to-flowchart` | 0 | 8 | Retirada. `normalizeGraphKeywordToFlowchart` eliminada (sin consumidores). |
| `er-drop-default-attr` | 0 | 1 | Retirada. `stripErDiagramSqlDefaultArtifacts` se conserva (la usa `mdd-diagram-suggestions`). |
| `er-pg-types` | 0 | 3 | Retirada. `normalizeErDiagramPgTypes` eliminada (sin consumidores). |
| `sequence-declare-participants` | 0 | 1 | Retirada. `normalizeSequenceDiagramSyntax` se conserva (la usan specs). |
| `sequence-arrow-parties` | 0 | 6 | Retirada. `repairSequenceArrowParties` eliminada (sin consumidores). |
| `sequence-activation-order` | 0 | 2 | Retirada. `normalizeSequenceActivationOrder` eliminada (sin consumidores). |
| `br-self-closing` | 0 | 2 | Retirada. |
| `inline-label-quoting` | 0 | 1 | Retirada. Sus reparaciones de `{}`, `:`, `?`, `<` en rectángulos, rombos y aristas quedan a cargo de las reglas acotadas y de `quote-flowchart-paren-labels`. |
| `quoted-label-cleanup` | 0 | 1 | Retirada. |
| `sequence-repair-line` | 0 | 4 | Retirada. `repairSequenceDiagramLine` y sus auxiliares eliminadas. |
| `er-pk-fk-commas` | 1 (`spec-033`) | 0 | **Acotada** a `PK FK` sin coma y vuelta al registro (ver «Recuperación»). Solo transforma dos o más claves `PK`/`FK`/`UK` separadas por espacio al final de una línea de atributo de `erDiagram`. `repairLost` 1 (`spec-033-mermaid-document`), `preservationGained` 0. `repairErDiagramPkFkCommas` conserva nombre y firma. |
| `quote-flowchart-spaced-labels` | 1 | 16 | **Acotada:** solo cita el rectángulo `id[…]` con un `[` sin cerrar o con `{}` dentro. Tras acotar: `repairLost` 2 (`broken-fc_label_unclosed_bracket`, `spec-028`), `preservationGained` 0. |
| `quote-flowchart-edge-labels` | 2 | 3 | **Acotada:** solo cita etiquetas de arista con comillas internas, paréntesis o llaves. Tras acotar: `repairLost` 3 (`broken-fc_inner_quotes_edge`, `broken-fc_edge_text_parens`, `spec-016`), `preservationGained` 0. |
| `quote-flowchart-chinese-labels` | 0 | 0 (tras retirar otras reglas: 2) | Retirada al re-medir: `preservationGained` > 0 con `repairLost` = 0. `quoteFlowchartChineseLabels` se conserva (la usan specs). |
| `sequence-activation-pairs` | 0 | 0 (tras retirar otras reglas: 2) | Retirada al re-medir: `preservationGained` > 0 con `repairLost` = 0. `normalizeSequenceActivation` se conserva (la usan specs). |
| `par-ticipant` | 1 | 0 | Mantenida. Interdependiente con `block-balance`: `spec-054` se rompe sin cualquiera de las dos. |
| `block-balance` | 3 | 0 | Mantenida (ver `par-ticipant`). |

Las reglas con `preservationGained = 0` y `repairLost = 0` no cambian.

**Válidos que siguen cambiando.** Antes, 67 válidos del corpus cambiaban en el registro (268 pares etapa × id en `PRESERVATION_KNOWN_CHANGES`). Ahora cambia 1:

- `spec-054` (`par ticipant` → `participant`, por `par-ticipant` y `block-balance`): en el registro, en las 4 etapas que normalizan.

`er-pk-fk-commas` acotada ya no toca `PK, FK` válido (`broken-er_pk_fk_comma`, `spec-114` y `spec-115` salen de la lista). `formatDocumentMarkdown.preserve` no cambia ninguno. `PRESERVATION_KNOWN_CHANGES` queda en 4 pares etapa × id (1 válido).

**Recuperación.** Los reparados por `normalizeMermaidDiagramBody` vuelven de 29 a 30 de 58. `spec-033` (`uuid id PK FK`, sin coma) se repara otra vez con `er-pk-fk-commas` acotada a esa forma, sin tocar `PK, FK` válido. `REPAIR_BASELINE_MIN` vuelve a 30.

**Pendiente: `erDiagramHasPkFkComma`.** `mermaid.ts` la usa para detectar `PK, FK`: llama a `repairErDiagramPkFkCommas` y busca `PK, FK` en el resultado. Antes de este cambio el reparador quitaba toda coma, así que la detección no podía dar positivo. Ahora conserva `PK, FK` válido y la detección lo marca: `validateMermaidSyntax` y `preRenderMddSanity` (`apps/api/src/modules/engine/mdd-pre-render.ts`) rechazan ese erDiagram con «no se permite coma entre PK y FK». Ese comportamiento queda sin decidir. Dos tests de `mdd-pre-render.spec.ts` lo afirman en sentido contrario y quedan en rojo hasta esa decisión.

**Test de regresión de comportamiento.** Los casos del corpus y de las specs que afirmaban las reglas retiradas se invirtieron: ahora aseguran que la entrada válida se conserva. Ningún caso se borró.

**Corrección posterior (2026-11-03, G1):** `quoteFlowchartSpacedLabels` deja de citar etiquetas que contienen un operador de arista (`-->`, `---`, `-.->`, `==>`, `<--`, `--x`, `--o`) o un `[` interior con texto tras el `]`. La "reparación" de `broken-fc_label_unclosed_bracket` (`A[Inicio --> B[Fin]` → `A["Inicio --> B[Fin"]`) parseaba pero fusionaba dos nodos y una arista en un solo nodo, es decir, cambiaba el significado. Por eso el suelo `REPAIR_BASELINE_MIN` pasa de 30 a 29 de 58; es una pérdida aceptada por tratarse de una regla que alteraba el sentido del diagrama. Válidos que siguen cambiando: 1 (`spec-054`).

**Cierre del pendiente (lote 2b, 2026-11-03):** `erDiagramHasPkFkComma` se retiró de `mermaid.ts` y `apps/api/src/modules/engine/mdd-pre-render.ts` ya no la usa: un `PK, FK` válido se conserva sin rechazo. Los dos tests de `mdd-pre-render.spec.ts` afirman ahora ese comportamiento; no quedan tests en rojo por este punto.

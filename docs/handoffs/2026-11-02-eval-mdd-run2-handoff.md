# Handoff — Eval MDD, segunda corrida (caso `clinica-citas-historial`)

Análisis: Fable. Ejecución: tres agentes Haiku en paralelo, archivos disjuntos. Fecha: 2026-11-02.

## 1. Lo que mostró la corrida

| Métrica | Valor | Lectura |
|---|---|---|
| Rúbrica | 39 | estructura 44 (= 100 − 4 × 14: §4, §5, §6 y §7 "ausentes"), seguridad 0, infraestructura 0 |
| Auditor LLM | 15 | penaliza §4 ausente y secciones que no ve |
| Delivery gate | 1 blocker | "§4 Contratos de API ausente"; no ve nada raro en §5–§7 |
| Coste / tokens | $0.00 / 0 | igual que en la corrida 1, pese al parche de contexto |
| Resumen | 1/12 PASS, Auditor medio 33.8 | |

El documento pegado por Jorge es una copia del render del visor, no el markdown crudo (perdió `##` en casi todos los encabezados y las tablas vienen separadas por tabulador). Aun así deja ver la secuencia de fences de §3: `\`\`\`sql` sin cerrar → `### Diagrama entidad-relación` → `\`\`\`mermaid` → erDiagram → la línea `\`\`\`TechnicalMetadata` pegada inmediatamente después de la última relación (sin `\`\`\`` de cierre del mermaid) → JSON → `\`\`\``.

## 2. Diagnóstico

### 2.1 "Desalineación de semáforo": tres semánticas de fences

| Componente | Cómo decide si una línea está dentro de un bloque de código |
|---|---|
| Rúbrica del eval (`eval/mdd-eval-rubric.ts`, `scanFences`) | CommonMark por líneas: abre `\`\`\`lang`, cierra solo una línea `\`\`\`` sola. Dentro de un bloque, `\`\`\`mermaid` es contenido. Igual que los renderers. |
| Helpers del pipeline (`utils/mdd-sanitize/section-fence.util.ts`, `persist-format.util.ts`) | Paridad por conteo de ocurrencias de `\`\`\`` en cualquier posición. Para ellos `\`\`\`sql … \`\`\`mermaid … \`\`\`TechnicalMetadata … \`\`\`` está balanceado. |
| Delivery gate (`utils/mdd-delivery-gate.util.ts`, `extractSectionBody`) | Busca el heading por regex sin mirar fences. |

Con la secuencia real, la paridad por conteo queda impar al llegar a `## 5.` y `closeUnclosedFencesBeforeCanonicalH2` inserta un `\`\`\`` antes de `## 5.`. En CommonMark ese `\`\`\`` **abre** un bloque nuevo que se traga §5, §6 y §7 hasta el siguiente `\`\`\`` suelto (el manifest de §7). Resultado: el pipeline y el gate creen que el documento está bien, la rúbrica y el visor ven cuatro secciones ausentes. La rúbrica tiene razón; el semáforo del pipeline es el que está mal calibrado. El mismo origen explica el "firma.sql": un opener `\`\`\`sql` pegado a la prosa anterior.

Fuentes del pegado: los post-procesadores que insertan el ER regenerado (`regenerateErDiagramFromSql`, `injectMddDiagrams`) y el bloque `TechnicalMetadata` (`draft-normalize.ts`) junto a un `\`\`\`sql` que el modelo dejó sin cerrar (tope `data_model` 8192 tokens, 20 tablas + índices). La corrección no persigue cada fuente: unifica la semántica y normaliza antes del gate.

### 2.2 §4 perdida en la ruta HIGH con chunks

`nodes/mdd-post-critic-parallel.node.ts` → `runApiContractsArchitectWithChunks` → `mergePostCriticParallelResults`. Con 20 tablas se hace fan-out por chunks; cada resultado pasa por `extractContratosChunkBody`, que solo acepta un cuerpo bajo `## 4. Contratos de API` o texto con `### METODO /ruta`. Si el modelo del chunk usa `#### GET /ruta`, `**GET /ruta**` o una tabla GFM, el cuerpo se descarta en silencio, `bodies` queda vacío y el draft sale sin §4. No hay log ni fallback. El loop del gate reintentó `api_contracts` hasta 3 veces con el mismo resultado: la pérdida es determinista.

### 2.3 Coste $0.00

`generate()` del eval envuelve cada `next()` en `runWithTokenUsageContext`; los adapters registran uso solo si `getActiveTokenUsageContext()` no es null, y callan si lo es. Dos hipótesis: el worker no corría aún el commit con el parche, o el contexto AsyncLocalStorage no llega a alguna continuación dentro del generador. Sin acceso a producción, el harness debe poder distinguirlas (test unitario de propagación + mensaje explícito en el auditTrail + `gitSha` del resumen).

### 2.4 Ruido de plataforma (decisión de producto, sin cambio de código en este lote)

- Tablas `outbox`, `security_events`, `refresh_tokens` en §3: las inyectan `ensureOutboxTableInDraft` y `ensureSecurityTableStubsFromSection6` cuando §6/§7 las mencionan, y el párrafo `CREDENTIAL_STORAGE_INJECTION` de §6 las menciona por diseño. Es coherencia impuesta por el checker de credenciales, no un defecto del generador. Quitarlo rompe `isCredentialStorageSatisfied`.
- Bloque "UI/UX Design Intent" con referencias a `pantallas.md` y `GET /api/v1/{tabla}`: boilerplate de `enrichMddWithUiUxDesignIntent`, se añade a todo MDD con superficie web. Para el lector del MDD es ruido; para el spec-kit es contrato. Decidir si se omite cuando no hay spec-kit activo.
- Expectativas del caso: `consulting_rooms` vs `offices` generado, `prescriptions` como columna en vez de tabla. Son discrepancias del caso, no del generador.

## 3. Lotes para los agentes Haiku (archivos disjuntos)

### Agente A — una sola semántica de fences
- Nuevo `utils/mdd-sanitize/fence-scan.util.ts`: `scanMarkdownFences` (CommonMark por líneas) y `normalizeMarkdownFences` (idempotente): cierre pegado `X --> Y\`\`\`` → dos líneas; opener pegado a prosa `firma.\`\`\`sql` → salto de línea; opener anidado con info string mientras hay bloque abierto → cierre antes; heading canónico dentro de bloque → cierre antes; bloque abierto al EOF → cierre.
- `section-fence.util.ts`: los seis helpers delegan en el scan, misma API pública (15 consumidores).
- `persist-format.util.ts`: `stripEmptyBareCodeFences` y `closeUnclosedCodeFencesInDraft` sobre el scan.
- `mdd-delivery-gate.util.ts`: `extractSectionBody` ignora headings dentro de fence; blocker nuevo "Bloque \`\`\` abierto (lang, línea) se traga los encabezados §N…".
- `mdd-prepare-output.ts`: `applyPreDeliveryGateFixes` normaliza fences como primer paso si no lo hacía.
- `eval/mdd-eval-rubric.ts`: importa el scan compartido; detalle "encabezado dentro de un bloque de código abierto (lang, línea)".
- Golden test con la secuencia del caso clínica.

### Agente B — §4 en chunks HIGH
- `mdd-api-contracts-chunk.util.ts`: `normalizeEndpointHeadingsForChunkMerge` (`####`, negrita, tabla GFM → `### METODO /ruta`).
- `mdd-api-contracts-chunk.runner.ts`: normaliza antes de extraer, acepta cuerpo por `CONTRATOS_HAS_ENDPOINTS`, log por chunk, fallback a `baseFn` sin chunking cuando §4 no es persistible.
- `mergePostCriticParallelResults`: warn explícito cuando §4 sigue ausente.
- Spec nuevo del runner (tres casos) + casos del util + spec del merge.

### Agente D — coste $0 diagnosticable
- Spec nuevo `eval/mdd-eval-nest-deps.spec.ts`: prueba de propagación del contexto de tokens a través del generador (incluida una promesa creada en un paso y resuelta en otro).
- `mdd-eval-runner.ts`: auditTrail explícito cuando no hay filas de TokenUsage; campos de coste/tokens `undefined` en vez de 0; agregados `null` cuando ningún caso tiene uso.

## 4. Verificación prevista
`pnpm test:types` (api, web), `pnpm test` en apps/api (14 fallos preexistentes por `vitest`), `eval:mdd --dry-run`, entrada en CHANGELOG `[Unreleased]`. Commit, PR a kreodevs/theforge y sincronización solo cuando Jorge lo pida.

## 5. Qué esperar en la tercera corrida
- Estructura de la clínica debe subir de 44 a ≥ 86 (solo §4 podría seguir ausente si el modelo falla también en el fallback), seguridad e infraestructura dejan de ser 0.
- Si §4 sigue ausente, los logs del worker dirán por qué (`[MDD:ApiContractsChunks]`, `[MDD:PostCriticMerge]`).
- Si el coste sigue en $0.00, el auditTrail lo dirá y el `gitSha` del resumen confirma qué commit corre el worker.

## 6. Resultado de la ejecución (2026-11-02)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` (apps/api) | sin errores |
| Suite API (`pnpm test`) | 4257 de 4272; los 14 fallos son los preexistentes (specs que importan `vitest`, recursion limit, checklists legacy, auditor gaps, executor plan); ninguno toca fences, §4 ni eval |
| Specs nuevos | fence-scan 15, chunk runner 3 + util 7, nest-deps 4, rubric/gate/section-fence/persist-format +13 |
| `eval:mdd --dry-run` | bueno 100, bueno con subsecciones 100, malo 32 (igual que antes) |
| Caso real `clinica-citas-historial` | no ejecutado (requiere LLM); pendiente tercera corrida |

Desviaciones del agente de fences que quedan aceptadas: un `###` dentro de un bloque abierto de sql/mermaid/json/TechnicalMetadata cierra el bloque (necesario para "### Diagrama entidad-relación"); `closeUnclosedCodeFencesInDraft` conserva su código por líneas porque `repairNestedJsonFencesInDraft` cuenta profundidad de ```json anidados; la regla de heading canónico aplica también dentro de bloques ```markdown (caso improbable en un MDD).

Hallazgo adicional del agente de coste: en `utils/mdd-scoped-stream.util.ts` los pases scoped de la ruta HIGH abortan el stream al detectar el segundo encabezado canónico y el chunk final con `usage_metadata` no llega, así que esas llamadas no registran uso aunque el contexto esté presente. Decisión pendiente: registrar una estimación marcada o aceptar el hueco.

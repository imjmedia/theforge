# mermaid-oracle

Oráculo de pruebas para Mermaid: el parser real de mermaid decide si un diagrama es válido. Este módulo es, por ahora, infraestructura de pruebas (Fase 1 del plan "Mermaid que no se rompe"); **no es un módulo Nest ni se registra en ningún `AppModule`**. La Fase 2 añadirá el servicio de runtime (worker, timeout y degradación a `unverified`).

## Contenido

- `node-mermaid-parser.ts`: `createNodeMermaidParser()` devuelve un `MermaidParser` (`(text) => Promise<MermaidParseResult>`). Monta las globales mínimas de jsdom (`window`, `document`, `navigator`), importa `mermaid` de forma perezosa y llama a `mermaid.parse(text, { suppressErrors: false })`. Resultados:
  - `ok` (con `diagramType`): el parser acepta el diagrama.
  - `invalid` (con el mensaje real del parser): el parser lo rechaza.
  - `unavailable`: fallo de entorno (import o DOM); nunca significa "diagrama inválido".
- `__fixtures__/mermaid-corpus.ts`: `MERMAID_CORPUS`, 270 diagramas (escritos a mano, roturas típicas de LLM, cuerpos de specs, los bloques ER de los fixtures de eval y 3 goldens `hw-fc_flatten_*`: flowcharts TD válidos con >= 8 nodos `sN(...)`, repro de la regla del webhook inventado). `expectedValid` es el veredicto de Chrome headless con mermaid 11.15.0 (`parse` + `render`).
- `mermaid-corpus.spec.ts`: spec `node:test` contra el parser real. Los tipos `MermaidParseResult` y `MermaidParser` vienen de `@theforge/shared-types/mermaid-oracle` (contrato único con la web y con `resolveMermaidWithOracle`).

## Spec de corpus (`mermaid-corpus.spec.ts`)

- **Regla de oro sobre válidos:** para cada diagrama con `expectedValid: true` y cada una de las 10 etapas (`shared.repairMermaidBlockBody`, `shared.normalizeMermaid`, `shared.resolveMermaidBlockForRender`, `shared.prepareMermaidDiagramForRender`, `api.sanitizeMermaidBlock`, `shared.normalizeMermaidInDocument`, `shared.formatDocumentMarkdown`, `shared.formatDocumentMarkdown.preserve`, `api.sanitizeMermaidInDraft`, `api.prepareMddMarkdownForPersist`) se asertan: la salida sigue siendo `ok`, en las etapas de documento el fence ` ```mermaid ` existe una vez y el ` ```sql ` vecino queda intacto, y `f(f(x)) === f(x)`.
- **Preservación:** para cada válido y cada etapa de documento (`normalizeMermaidInDocument`, `formatDocumentMarkdown`, `formatDocumentMarkdown.preserve`, `sanitizeMermaidInDraft`, `prepareMddMarkdownForPersist`) el cuerpo mermaid de salida debe ser igual al de entrada salvo espacios (trim por línea, espacios colapsados, sin líneas vacías). Una regla que sustituya un válido por otro válido e idempotente pasa la regla de oro pero cambia el contenido del usuario; este bloque la detecta. Los cambios que hoy ocurren están en `PRESERVATION_KNOWN_CHANGES` (por motivo y regla): 4 pares etapa × id, de 1 válido (`spec-054` por `par ticipant`, en las 4 etapas que normalizan). Una entrada nueva fuera de la lista falla, una que ya no cambia emite el diagnóstico `RESUELTO` para podarla. Medición y decisiones en ADR 0002, addendum 2026-11-03. `MERMAID_PRESERVATION_STRICT=1` ignora la lista (ver los cambios reales) y `MERMAID_PRESERVATION_DUMP=1` los imprime.
- **Fixtures de eval:** los bloques ER de `apps/api/eval/mdd/fixtures` sobreviven a `prepareMddMarkdownForPersist`.
- **Suelo de reparación:** de los inválidos, `repairMermaidBlockBody` debe dejar al menos `REPAIR_BASELINE_MIN = 29` como `ok` (29/58). Es un suelo de regresión, no una meta. Bajó de 30 el 2026-11-03 porque `broken-fc_label_unclosed_bracket` solo se "reparaba" fusionando dos nodos y una arista en uno (cambio de significado). `er-pk-fk-commas` vuelve al registro acotada a `PK FK` sin coma, y así `spec-033` (`uuid id PK FK`) se repara de nuevo (ADR 0002, addendum).
- **Resultado del lote 2 (2026-11-03):** `BASELINE reparación repairMermaidBlockBody: 29/58`. Con `MERMAID_PRESERVATION_STRICT=1` falla solo `spec-054-mermaid-fix`, en sus cuatro etapas que normalizan (`normalizeMermaidInDocument`, `formatDocumentMarkdown`, `sanitizeMermaidInDraft` y `prepareMddMarkdownForPersist`).
- **Concordancia:** el parser jsdom coincide con `expectedValid` en todo el corpus.
- `KNOWN_FAILURES` está vacío: todo el corpus válido pasa las 10 etapas de la regla de oro (la preservación tiene su propia lista, `PRESERVATION_KNOWN_CHANGES`, que `MERMAID_CORPUS_STRICT` no ignora). Un `todo` nuevo debe ir acompañado del motivo; con `MERMAID_CORPUS_STRICT=1` se ignoran los `todo` para ver los rojos reales.

Ejecución (la misma que usa CI):

```bash
pnpm --filter @theforge/shared-types build   # el spec lee dist-cjs de shared-types
cd apps/api && node scripts/run-tests.mjs --test-path-pattern=mermaid-oracle
```

## Advertencias

- `node-mermaid-parser.ts` y `__fixtures__/` están excluidos de `tsconfig.build.json`: no se compilan a `dist` ni viajan a la imagen Docker. Además, el parser lanza al cargarse si es el hilo principal y `NODE_ENV=production`.
- Importar el parser deja `window`, `document` y `navigator` definidos en `globalThis` del proceso. Úsalo solo en tests y scripts; en la API en ejecución irá en un `worker_thread` (Fase 2).
- `mermaid` y `jsdom` están fijados a versión exacta (`11.15.0` y `26.1.0`) como `devDependencies` de `apps/api`. Cambiar cualquiera exige repetir la concordancia.
- `apps/api` aún no usa el oráculo en producción: la reparación de la API es determinista y su garantía en CI la da este spec.

## Concordancia jsdom vs Chrome

```bash
node apps/api/scripts/mermaid-oracle-concordance.mjs
```

Ejecuta cada entrada del corpus en el parser jsdom y en Chrome headless (puppeteer hoisted por `@mermaid-js/mermaid-cli`, mismo `mermaid.min.js` instalado) e imprime `acuerdo X/N` más la lista de discrepancias. Código de salida 0 con 100 % de acuerdo, 1 si hay discrepancias, 2 si el entorno falla (por ejemplo, Chrome no instalado). Requiere Chrome de puppeteer en la caché local (`npx puppeteer browsers install chrome`); no corre en CI.

## Pendiente (Fase 2 y 3)

- Parser en runtime de la API (`worker_threads`, timeout, reciclado y degradación a `unverified`).
- Gate de entrega con contador de `invalid`/`unverified`, sin bloquear.
- Regeneración validada: `POST /ai/mermaid/regenerate` debe consumir el `error` del parser y validar la salida.
- Unificar los escáneres de fences y retirar `@mermaid-js/mermaid-cli` y `puppeteer-core`.
- Subir mermaid a 11.17.x tras repetir la concordancia.
- Reglas por tipo de diagrama, con ADR en `docs/`.

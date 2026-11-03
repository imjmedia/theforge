# mermaid-oracle

Oráculo Mermaid: el parser real (`mermaid.parse` en jsdom) decide si un diagrama es válido. La regla de oro vive en `@theforge/shared-types/mermaid-oracle`; este módulo aporta el parser en Node y el runtime de la API.

## Runtime (Fase 2)

- **`MermaidOracleModule`** (`mermaid-oracle.module.ts`): módulo global Nest que exporta `MermaidRuntimeService`.
- **`MermaidRuntimeService`** (`mermaid-runtime.service.ts`): un `worker_thread` dedicado ejecuta `mermaid-parse.worker.ts` (sin montar `window`/`document` en el hilo HTTP). Timeout por petición: `MERMAID_PARSE_TIMEOUT_MS` (default **8000** ms). Si el worker no responde, falla o se detiene el proceso, el parser devuelve `unavailable` (degradación; nunca `invalid`).
- **`mermaid-parse-logic.ts`**: carga perezosa de jsdom + mermaid y `parseMermaidDiagram(text)`.
- **`mermaid-oracle-persist.util.ts`**: `storeMddMarkdownForPersistWithOracle` — `prepareMddMarkdownForPersist` con `preserveMermaid` + `resolveMermaidBlocksInDocument`. Lo usa `ProjectMddPersistService`.
- **`POST /ai/mermaid/regenerate`**: acepta `{ content, error? }`, incluye el error del parser en el prompt y valida la salida del LLM con `resolveMermaidWithOracle`.

## Pruebas y corpus (Fase 1)

- `node-mermaid-parser.ts`: `createNodeMermaidParser()` para specs y scripts. Excluido de `tsconfig.build.json`; lanza si se carga en el hilo principal con `NODE_ENV=production`.
- `__fixtures__/mermaid-corpus.ts`: corpus de 270 diagramas con veredicto Chrome.
- `mermaid-corpus.spec.ts`: regla de oro, preservación, suelo de reparación.

Ejecución (CI):

```bash
pnpm --filter @theforge/shared-types build
cd apps/api && node scripts/run-tests.mjs --test-path-pattern=mermaid-oracle
```

Specs adicionales: `mermaid-runtime.service.spec.ts` (timeout y mock de worker, sin jsdom en el hilo de test).

## Persistencia MDD

En producción, el persist del MDD (`ProjectMddPersistService`) no normaliza fences mermaid en `formatDocumentMarkdown` (`mermaid: "preserve"`) y solo sustituye bloques **`repaired`** tras consultar al parser. Los válidos (p. ej. `spec-054`, bloque `par` en sequenceDiagram) no se reescriben.

La función síncrona `prepareMddMarkdownForPersist()` sin oráculo sigue disponible para snapshots y corpus; el camino de escritura en BD usa el runtime.

## Advertencias

- `node-mermaid-parser.ts` y `__fixtures__/` no van a `dist` de producción como entry de tests; el worker y la lógica sí se compilan.
- `mermaid` (`11.15.0`) y `jsdom` (`26.1.0`) son **dependencies** de `apps/api` (runtime del worker).
- Concordancia jsdom vs Chrome: `node apps/api/scripts/mermaid-oracle-concordance.mjs` (no CI).

## Pendiente (Fase 3)

- Gate de entrega con contador de `invalid`/`unverified`, sin bloquear.
- Unificar escáneres de fences; retirar `@mermaid-js/mermaid-cli` / `puppeteer-core` donde aplique.
- Subir mermaid a 11.17.x tras repetir concordancia.
- Reglas por tipo de diagrama con ADR.

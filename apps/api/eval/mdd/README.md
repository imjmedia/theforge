# Eval de MDDs

Banco de pruebas del generador de MDD (Master Design Document). Cada **caso** es un brief de usuario
realista con expectativas verificables. El CLI genera el MDD con el pipeline real, lo puntúa con una
rúbrica determinista (sin LLM) y registra métricas del harness (score del Auditor, gate de entrega,
tokens, coste, tiempo). Sirve para comparar cambios en prompts, nodos o modelos entre corridas.

## Estructura

```
eval/mdd/
  cases/        Casos (un JSON por caso, nombre = <id>.json)
  fixtures/     MDD de prueba para --dry-run (ver convención más abajo)
  results/      Salidas de cada corrida (ignorado por git, salvo su .gitignore)
```

Código: `src/modules/ai-analysis/eval/` (contrato `mdd-eval.types.ts`, rúbrica `mdd-eval-rubric.ts`,
runner `mdd-eval-runner.ts`, informes `mdd-eval-report.util.ts`) y el CLI `scripts/eval-mdd.ts`.

## Añadir un caso

1. Crea `eval/mdd/cases/<id>.json`. El `id` es kebab-case (`^[a-z0-9][a-z0-9-]{2,60}$`) y debe
   coincidir con el nombre del fichero.
2. Campos (ver `mddEvalCaseSchema` en `mdd-eval.types.ts`):
   - `title`, `domain`, `complexity` (`LOW` | `MEDIUM` | `HIGH`).
   - `brief`: lo que escribiría un usuario en el chat, en español, 200-4000 caracteres, sin jerga del harness.
   - `dbga` (opcional): benchmark DBGA. Si falta, el pipeline recibe `Idea del usuario:` + `brief`.
   - `brd` (opcional): requisitos de negocio para los jueces de trazabilidad.
   - `expect`:
     - `entities`: tablas esperadas en §3 (snake_case; singular o plural se aceptan).
     - `entitySynonyms`: alternativas aceptadas por entidad.
     - `capabilities`: `{ name, endpointHints }[]`; una pista (p. ej. `/orders`) debe aparecer en §4.
     - `security` (§6), `infra` (§7): tokens que deben aparecer. `a|b` admite alternativas.
     - `forbidden`: tokens que no deben aparecer en todo el documento (fugas de otros dominios).
     - `mustMentionInContext`: conceptos que §1 Contexto debe mencionar.
   - `thresholds`: `minRubric` (default 80) y `minAuditor` (default 85).
3. Comprueba que el caso carga y pasa el schema: `node --import tsx scripts/eval-mdd.ts --cases <id> --dry-run --input <carpeta>`
   con un `good-<id>.md` de prueba en esa carpeta. Si el JSON no valida, el CLI falla al cargar los casos.

## Prerrequisitos (modo real)

- PostgreSQL accesible con `DATABASE_URL` (el mismo `.env` que usa la API). Redis es opcional.
- Un usuario real (`--user`) con un proveedor de LLM configurado (BYOK). El pipeline resuelve el
  LLM a partir del `userId` del proyecto temporal, así que sin proveedor el caso falla.
- Un grupo de proyectos existente (`--group`).

Los proyectos temporales se crean con nombre `eval-mdd-<caso>-<timestamp>` y se borran al terminar
(salvo `--keep`).

## Cómo ejecutar

Desde `apps/api`:

```bash
pnpm --filter @theforge/api eval:mdd -- --user <userId> --group <groupId>
pnpm --filter @theforge/api eval:mdd -- --user <userId> --group <groupId> --cases ecommerce-tienda-artesanias,fintech-billetera-pagos --concurrency 2
pnpm --filter @theforge/api eval:mdd -- --user <userId> --group <groupId> --compare eval/mdd/results/<runIdAnterior>/summary.json
```

Equivalente directo: `node --import tsx scripts/eval-mdd.ts …`.

| Flag | Por defecto | Descripción |
|---|---|---|
| `--cases a,b` | todos | Subconjunto de casos |
| `--user`, `--group` | — | Obligatorios salvo en `--dry-run` |
| `--concurrency n` | 1 | Casos en paralelo, máximo 3 |
| `--timeout-ms` | 1800000 | Tiempo máximo por caso; al agotarse, el caso falla |
| `--keep` | off | No borrar los proyectos temporales (quedan anotados en `auditTrail`) |
| `--out dir` | `eval/mdd/results/<runId>` | Carpeta de salida |
| `--compare file` | — | Imprime deltas contra un `summary.json` previo |
| `--json` | off | Summary en JSON por stdout (el resto va a stderr) |
| `--dry-run` | off | Sin Nest ni LLM (ver abajo) |
| `--input dir` | `eval/mdd/fixtures` | Fixtures del dry-run |

Códigos de salida: `0` todo aprobado · `1` algún caso fallido (o una expectativa good/bad incumplida
en dry-run) · `2` error de uso.

### Dry-run (sin LLM ni base de datos)

Puntúa `.md` ya existentes contra la rúbrica. Útil para depurar la rúbrica o los casos sin gastar tokens.

Convención de nombres en `--input` (por defecto `eval/mdd/fixtures`):

- `good-<caso>.md`: debe **aprobar**. Si falla, el run marca una expectativa incumplida y sale con 1.
- `bad-<caso>.md`: debe **fallar** (fixture negativo). Si aprueba, sale con 1.
- `<caso>.md`: sin expectativa; solo informa.

`<caso>` se resuelve al caso así: id exacto; luego el id de caso más largo contenido en el nombre; por
último, un id de caso que contenga `<caso>` como segmentos (`good-ecommerce-tienda-basica.md` casa con
`ecommerce-tienda-artesanias`). Si ese último paso casa con varios casos, el fichero se ignora con aviso.
Un mismo caso puede tener varios fixtures (good y bad); en ese caso el segundo registro se
identifica como `<caso>-2` en los ficheros de salida.

## Qué mide cada métrica

| Columna | Origen | Significado |
|---|---|---|
| rúbrica | `scoreMddAgainstCase` (determinista) | 0-100 ponderado sobre estructura, entidades, capacidades, seguridad, infra, contexto, idioma y diagramas, menos penalización por tokens prohibidos. Aprueba si ≥ `minRubric`. |
| auditor | `precision` del evento `done` (juez único) | Score del Auditor LLM. Aprueba si ≥ `minAuditor`. No se evalúa si el Auditor no corrió (`failedStep`). |
| gate | `deliveryGate.ok` | Gate de entrega del pipeline. `KO` falla el caso. |
| % | `precision` (en vivo) | Porcentaje mostrado al usuario. Informativo. |
| duración | tiempo de pared del caso | Incluye generación; no incluye el borrado del proyecto temporal. |
| coste | `TokenUsageService.getSummary` | Coste USD de todas las llamadas del proyecto temporal. |
| estado | `passed` | `PASS` si la rúbrica aprueba, el auditor (si existe) llega al umbral, el gate no es KO y no hubo error. |

`passRate` en `summary.json` es una fracción (0-1); el texto la muestra como porcentaje.

## Ficheros de una corrida

```
results/<runId>/
  summary.json          Summary completo (agregados, registros por caso, args, commit)
  summary.md            Tabla por caso + lista de fallos por caso
  <caso>.md             MDD generado (o último borrador si el caso no llegó a done)
  <caso>.score.json     Rúbrica completa de ese caso (dimensiones, detalles, penalizaciones)
```

## Cómo leer los deltas (`--compare`)

Los casos se emparejan por id (y por ocurrencia, si se repiten). Para cada caso emparejado:

- **rúbrica** y **auditor**: `Δ = nueva − previa`. Positivo es mejora.
- **duración** y **coste**: `Δ = nueva − previa`. Positivo es más lento o más caro.
- **estado**: cambios de PASS a FAIL o al revés.

Los casos que solo están en una de las dos corridas se marcan como `solo en previa` / `solo en nueva`.
Un cambio de rúbrica de pocos puntos con el mismo estado es ruido; compara varias corridas antes de
concluir. Comprueba también que el `gitSha` de ambas corridas sea el esperado.

## Desde la web

Ajustes → **Evaluación MDD** (solo administradores) lanza el mismo eval sin CLI: elige casos,
concurrencia (1-3), grupo de proyectos y si conservar los proyectos temporales; la corrida se encola
y la pestaña muestra progreso, resultados por caso, el MDD generado y comparaciones entre corridas.
API: `ai-analysis/eval/mdd/*` (contrato en `packages/shared-types/src/mdd-eval-api.ts`; todos los
endpoints exigen rol `admin` o `super_admin`).

Qué hace una corrida:

- Crea un proyecto temporal por caso, genera el MDD con el pipeline real, lo puntúa y lo borra
  (salvo "conservar proyectos"), exactamente como el CLI: comparten `buildMddEvalDeps`
  (`src/modules/ai-analysis/eval/mdd-eval-nest-deps.ts`).
- Se ejecuta en una cola BullMQ dedicada `mdd-eval` (job id = `runId`, un solo intento, un worker con
  concurrencia 1: las corridas van en serie). Si el worker se cae a medias la corrida pasa a `failed`;
  no se reintenta para no gastar tokens dos veces.
- **Usa el proveedor de LLM del administrador que la lanza** (BYOK): los proyectos temporales son suyos
  y el pipeline resuelve el LLM con su `userId`. Si no tiene proveedor configurado, el alta responde 400
  con un mensaje en español antes de encolar. El coste/tokens se cargan a ese usuario.
- Cancelar: una corrida en espera se saca de la cola; una activa se aborta de forma cooperativa
  (clave Redis `theforge:mdd-eval-cancel:<runId>` sondeada cada 500 ms por el worker) y termina como
  `cancelled` sin escribir resultados.

Dónde quedan los resultados: `eval/mdd/results/<runId>/` (ids `AAAAMMDDTHHMMSSZ-web`), con los mismos
ficheros que el CLI más `run.json` (estado, solicitante, grupo, casos, concurrencia, progreso, error).
Una corrida terminada se reconstruye por completo desde disco tras un reinicio, y las del CLI
(sin `run.json`) también aparecen en el listado. Cambia la carpeta con `MDD_EVAL_RESULTS_DIR`.

Prerrequisitos:

- **Producción**: `REDIS_URL` y un proceso con rol worker (`THEFORGE_RUNTIME_ROLE=worker` o `all`) que
  consuma `mdd-eval`. Con rol `http` solo se encola. Los procesos HTTP y worker deben **compartir la
  carpeta `eval/mdd/results`** (volumen) para que la web lea `summary.json` y los `.md`; sin volumen
  compartido el listado y el estado funcionan (vía Redis, 24 h) pero no el markdown de cada caso.
- **Desarrollo sin `REDIS_URL`**: la corrida se ejecuta en el propio proceso de la API, en serie y de
  forma asíncrona (la petición responde enseguida con estado `queued`). El estado vive en memoria y en
  `run.json`; si reinicias la API a mitad de corrida queda como `failed` (interrumpida).
- Un usuario administrador con proveedor de LLM configurado y un grupo de proyectos existente
  (por defecto el grupo "Proyectos").

## Problemas frecuentes

- `timeout tras N ms`: sube `--timeout-ms` o revisa si el proveedor está lento.
- Error de DI al arrancar Nest: falta `DATABASE_URL` o Postgres no responde.
- `usuario no encontrado` / `grupo no encontrado`: revisa los ids.
- Casos con `error` que menciona el proveedor o el LLM: configura el proveedor de LLM para ese usuario en la aplicación.

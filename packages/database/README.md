# @theforge/database

Prisma schema y client compartido.

- **Schema:** `schema.prisma` — **`User`** (email único; JWT `sub` tras OTP), `Project` (**`userId`** → propietario), `Session` (**`userId`** redundante con propietario del proyecto), `Estimation`, `Status`, **`Stage`**, **`EpisodicMemory`**, `ArchitecturalPreference`, `AgentStateCheckpoint`, **`ProjectAriadneLink`** (enlace Forge ↔ Ariadne).
- **Migración `20260326150000_user_project_session_ownership`:** crea `User`, enlaza proyectos/sesiones existentes al primer usuario insertado (`jorge.correa@kreoint.mx` si la tabla está vacía) y exige `userId` NOT NULL.
- **Migración `20260327140000_ensure_pg_enums_idempotent`:** crea con `IF NOT EXISTS` los ENUM de Prisma (`Status`, `ProjectType`, `ComplexityLevel`, `StageStatus`, `EpisodicMemoryKind`) para desbloquear deploys donde faltaba el tipo antes de `ADD COLUMN …`.
- **Migración `20260718100000_project_ariadne_links`:** tabla `project_ariadne_links` (enlace primario Forge ↔ Ariadne; upsert en alta brownfield / handoff).
- **Client:** generado en `src/generated`; exportado por el package.

- **Migración `20261104090000_stage_architecture_graph`:** columnas `Stage.architectureGraph` / `architectureGraphSourceHash` y backfill idempotente desde `documentAst` cuando contiene `endpoints` (CL-24); réplica en `scripts/safe-schema-sync.sql`. Spec estática: `scripts/stage-architecture-graph-migration.spec.ts`.

Desde la **raíz** del monorepo: `pnpm run db:generate` (o el `build` del paquete) genera el client. `pnpm run db:push` aplica el schema a la DB. `pnpm run db:migrate` ejecuta migraciones en producción.

**LangGraph (Paso 0 / DBGA):** las tablas `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations` en `public` las crea la migración `20260513180000_langgraph_checkpoint_tables` (idempotente) y/o `ensureLangGraphCheckpointSchema` al arrancar la API (advisory lock, sin race multi-réplica). Si ves `relation "public.checkpoints" does not exist`, aplica migraciones pendientes y redeploy. Si ves `pg_type_typname_nsp_index`, redeploy con la versión que incluye el setup idempotente.

**Imagen Docker (API):** el `ENTRYPOINT` del contenedor ejecuta `prisma migrate deploy` en cada arranque antes de levantar Nest; el CLI `prisma` va en `dependencies` de este package para que el deploy no dependa de devDependencies.

**Memoria agéntica:** `Stage.shortTermContext` (JSON, STM); `EpisodicMemory` con `kind` (`REASONING_TRACE`, `ARCHITECTURE_DECISION`, `REFLEXION_FEEDBACK`, `EVALUATOR_REJECTION`, `TOOL_OUTPUT`). `Stage.isLegacy` y `Stage.theforgeProjectId` enrutan el flujo legacy; si `theforgeProjectId` es null en stage, aplica el del `Project`.

**Si la BD fue creada con `db push`** y ya tiene las tablas, marcar la migración inicial como aplicada (solo una vez):

```bash
cd packages/database
DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied 20250309000000_initial_schema
```

**Si `20250311000000_add_project_type_relic` falla por "ProjectType already exists"** (p. ej. tras un `db push` previo), marcar como aplicada y volver a desplegar:

```bash
cd packages/database
DATABASE_URL="postgresql://user:pass@host:5432/theforge" npx prisma migrate resolve --applied 20250311000000_add_project_type_relic
```

### P3018 — `relation "Project" does not exist` (20250311100000_add_legacy_flow_state)

Ocurre cuando la BD está vacía pero `20250311000000_add_project_type_relic` fue marcada como aplicada (p. ej. por un entrypoint que ejecutaba `resolve --applied` en cada arranque). **Solución:** la migración `20250309000000_initial_schema` crea Project, Session, Estimation y ArchitecturalPreference. Redespliega con la imagen que incluye esta migración; el entrypoint ya no marca migraciones como aplicadas en cada arranque.

### P3009 — `20250319140000_stage_sdd_deliverables` failed (migrate deploy bloqueado)

Suele deberse a que en PostgreSQL **no existía el tipo** `"Status"` al ejecutar `ADD COLUMN "status" "Status"` en `Stage` (las migraciones SQL del repo no creaban ese enum; solo aparecía vía `schema.prisma` / push). El `migration.sql` del repo **ya incluye** `CREATE TYPE "Status"` al inicio; hace falta **desbloquear** el registro fallido en `_prisma_migrations`.

#### Atajo (caso típico: Postgres hizo rollback y solo quedó marcada como fallida)

El **entrypoint de la API** ejecuta en cada arranque, **antes** de `migrate deploy`:

`prisma migrate resolve --rolled-back 20250319140000_stage_sdd_deliverables`  
(solo desbloquea si esa migración sigue en estado fallido; si ya está aplicada o no aplicaba, Prisma sale con error y el script lo ignora sin ensuciar el log.)

1. Despliega una imagen **con el `migration.sql` actualizado** (enum `Status` al inicio).
2. **Redeploy** del servicio API — no hace falta variable de entorno para esta migración.

Manual (misma `DATABASE_URL` que producción):

```bash
cd packages/database
export DATABASE_URL="postgresql://..."
npx prisma migrate resolve --rolled-back 20250319140000_stage_sdd_deliverables
npx prisma migrate deploy
```

**1. Ver el registro y el estado real** (contra la misma `DATABASE_URL` que usa el contenedor API):

```sql
SELECT migration_name, finished_at, logs, started_at
FROM "_prisma_migrations"
WHERE migration_name = '20250319140000_stage_sdd_deliverables';

-- ¿Existe el enum?
SELECT typname FROM pg_type WHERE typname = 'Status';

-- Columnas relevantes (ajusta si tu baseline difiere)
SELECT column_name, data_type, udt_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('Project', 'Stage', 'Estimation')
ORDER BY table_name, ordinal_position;
```

**2. Si la migración quedó a medias** (p. ej. ya existe `workflowStatus` en `Stage` pero el deploy sigue fallando): no reintentes `deploy` a ciegas. Opciones:

- **A) Deshacer lo aplicado** (solo si puedes borrar datos de prueba / snapshot previo): revertir manualmente los `ALTER` de esa migración hasta un estado coherente con la migración anterior, luego:

  ```bash
  npx prisma migrate resolve --rolled-back 20250319140000_stage_sdd_deliverables
  ```

  Vuelve a desplegar con una imagen que incluya el `migration.sql` actualizado (crea el enum `Status` al inicio).

- **B) Completar a mano** el SQL restante de `migrations/20250319140000_stage_sdd_deliverables/migration.sql` (crear enum `Status` si falta, luego el resto según lo que ya tengas) y marcar aplicada:

  ```bash
  npx prisma migrate resolve --applied 20250319140000_stage_sdd_deliverables
  ```

**3. Si aún no tocaste la DB** y solo falló por el enum: con el `migration.sql` corregido (enum al inicio), `resolve --rolled-back` y otro `migrate deploy` deberían aplicar la migración entera de nuevo.

### P3018 — `constraint "Estimation_projectId_key" does not exist` (u otro nombre)

La migración `stage_sdd_deliverables` asumía nombres fijos de FK/UNIQUE en `Estimation`. Bases creadas con `db push` u otra versión de Prisma pueden tener **otro nombre** o solo un índice único. El `migration.sql` del repo usa bloques `DO` que buscan en `pg_catalog` el FK a `Project` y el `UNIQUE` sobre `projectId`, más `DROP INDEX IF EXISTS` para nombres habituales.

Tras un fallo **P3018**, vuelve a ejecutar `migrate resolve --rolled-back` para esa migración (el entrypoint de la API lo intenta solo) y redeploy con el SQL actualizado.

### P3009 — `20260609120000_add_agent_governance_content` o `20260612120000_project_merge_suite` failed

Suele ocurrir cuando **`db push` del entrypoint ya creó la columna** pero la migración versionada no está en `_prisma_migrations` (deploy de imagen nuevo tras builds fallidos, o `ADD COLUMN` sin `IF NOT EXISTS`).

El **entrypoint** (imagen reciente):

1. Ejecuta `safe-schema-sync.sql` (DDL idempotente, incluye merge + agent governance).
2. `migrate resolve --rolled-back` para esas migraciones si quedaron en estado fallido.
3. Si la columna ya existe, `migrate resolve --applied <nombre>` antes de `deploy`.

Manual:

```bash
cd packages/database
export DATABASE_URL="postgresql://..."
npx prisma migrate resolve --rolled-back 20260609120000_add_agent_governance_content   # si falló
npx prisma migrate resolve --applied 20260609120000_add_agent_governance_content    # si la columna ya existe
npx prisma migrate deploy
```

### P3009 — `20260702_add_ui_mcp_instance` failed (`relation "UiMcpInstance" already exists`)

Ocurre cuando la tabla ya existe por **`db push`** del entrypoint, por una copia previa en `packages/database/prisma/migrations`, o porque el DDL se aplicó sin registrar la migración en `_prisma_migrations` (p. ej. tras mover la migración a `packages/database/migrations` en #396).

El **entrypoint** reciente:

1. Ejecuta `safe-schema-sync.sql` (incluye `UiMcpInstance` + columnas con `IF NOT EXISTS`).
2. `migrate resolve --rolled-back` para `20260702_add_ui_mcp_instance` y `20260703180000_ui_mcp_adapter_id` si quedaron fallidas.
3. `migrate resolve --applied` si la tabla `UiMcpInstance` o la columna `adapterId` ya existen.
4. `migrate deploy` con SQL idempotente en esas migraciones.

**Desbloqueo inmediato** (misma `DATABASE_URL` que Dokploy, sin esperar rebuild):

```bash
cd packages/database
export DATABASE_URL="postgresql://..."
npx prisma migrate resolve --rolled-back 20260702_add_ui_mcp_instance
npx prisma migrate resolve --applied 20260702_add_ui_mcp_instance
npx prisma migrate resolve --applied 20260703180000_ui_mcp_adapter_id
npx prisma migrate deploy
```

O en Dokploy (un solo redeploy): `PRISMA_RESOLVE_ROLLED_BACK=20260702_add_ui_mcp_instance` **más** imagen con entrypoint que marca `--applied` si la tabla existe.

### P3009 — `20260319130000_agent_checkpoint_mdd_stage` failed

El entrypoint ya incluye `resolve --rolled-back` para esta migración. Si falla de nuevo tras redeploy:

**Opción A — Sin rebuild:** Añadir en el environment del contenedor API:
```
PRISMA_RESOLVE_ROLLED_BACK=20260319130000_agent_checkpoint_mdd_stage
```
Redeploy. En el siguiente arranque el entrypoint desbloqueará y `migrate deploy` reintentará.

**Opción B — Manual** (con la misma `DATABASE_URL` de producción):
```bash
cd packages/database
export DATABASE_URL="postgresql://theforge:theforge@theforge-db:5432/theforge"
npx prisma migrate resolve --rolled-back 20260319130000_agent_checkpoint_mdd_stage
npx prisma migrate deploy
```

### Design-First (`20261104*`) — P3009 tras `safe-schema-sync`

El entrypoint ejecuta `safe-schema-sync.sql` (incluye `architectureGraph`, `designSpec`, `UserFigmaCredential` y el enum `DESIGN_FIRST`) **antes** de `migrate deploy`. Si una migración queda en estado fallido o el DDL ya existe sin registro en `_prisma_migrations`, el API sale con código 1.

**Redeploy:** el `docker-entrypoint.sh` intenta `resolve --rolled-back` y `--applied` para:

- `20261104090000_stage_architecture_graph`
- `20261104100000_project_type_design_first`
- `20261104110000_design_first_spec_figma`

**Manual** (misma `DATABASE_URL` del compose):

```bash
cd packages/database
export DATABASE_URL="postgresql://..."
npx prisma migrate resolve --rolled-back 20261104110000_design_first_spec_figma  # si aplica
npx prisma migrate resolve --applied 20261104090000_stage_architecture_graph      # si Stage.architectureGraph existe
npx prisma migrate resolve --applied 20261104100000_project_type_design_first     # si enum DESIGN_FIRST existe
npx prisma migrate resolve --applied 20261104110000_design_first_spec_figma       # si designSpec / UserFigmaCredential existen
npx prisma migrate deploy
```

Si el contenedor arranca pero Nest aborta, revisa `docker logs theforge-api`: variables `DESIGN_FIRST_*` / `FIGMA_API_BASE_URL` deben ser booleanos o https válido (ver `apps/api/src/config/README.md`).

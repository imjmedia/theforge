/**
 * Setup idempotente de tablas LangGraph PostgresSaver.
 * Evita race pg_type_typname_nsp_index cuando varias réplicas llaman setup() concurrentemente.
 *
 * ⚠️  Las tablas viven en el schema `langgraph`, NO en `public`. Esto es defensa
 * en profundidad frente a `prisma db push --accept-data-loss`: aunque alguien
 * lo habilite en prod (THEFORGE_ALLOW_DB_PUSH=1), las tablas checkpoint_*
 * están fuera del schema gestionado por Prisma (`public`) y不会被 dropeadas.
 * El setup se ejecuta siempre en arranque; si en BD vieja aún existen
 * `public.checkpoint_*`, la migración `20260722*_move_langgraph_checkpoints_to_dedicated_schema`
 * las mueve a `langgraph.checkpoint_*` antes de la primera lectura.
 */

import pg from "pg";

type PgPoolClient = pg.PoolClient;

/** Schema dedicado para los checkpoints de LangGraph. NO usar `public`: ahí
 *  vive el modelo de Prisma y un `prisma db push --accept-data-loss` los borraría. */
export const LANGGRAPH_CHECKPOINT_SCHEMA = "langgraph";

/** Última versión de migración LangGraph JS (@langchain/langgraph-checkpoint-postgres). */
export const LANGGRAPH_CHECKPOINT_LATEST_VERSION = 4;

const ADVISORY_LOCK_KEY = 7_482_910_34;

const CHECKPOINT_TABLES = [
  "checkpoint_migrations",
  "checkpoints",
  "checkpoint_blobs",
  "checkpoint_writes",
] as const;

function migrationsForSchema(schema: string): string[] {
  const t = (name: string) => `"${schema}".${name}`;
  return [
    `CREATE TABLE IF NOT EXISTS ${t("checkpoint_migrations")} (
    v INTEGER PRIMARY KEY
  );`,
    `CREATE TABLE IF NOT EXISTS ${t("checkpoints")} (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    parent_checkpoint_id TEXT,
    type TEXT,
    checkpoint JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
  );`,
    `CREATE TABLE IF NOT EXISTS ${t("checkpoint_blobs")} (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    channel TEXT NOT NULL,
    version TEXT NOT NULL,
    type TEXT NOT NULL,
    blob BYTEA,
    PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
  );`,
    `CREATE TABLE IF NOT EXISTS ${t("checkpoint_writes")} (
    thread_id TEXT NOT NULL,
    checkpoint_ns TEXT NOT NULL DEFAULT '',
    checkpoint_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    channel TEXT NOT NULL,
    type TEXT,
    blob BYTEA NOT NULL,
    PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
  );`,
    `ALTER TABLE ${t("checkpoint_blobs")} ALTER COLUMN blob DROP NOT NULL;`,
  ];
}

export function isLangGraphCheckpointSetupRaceError(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : String(err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code?: string }).code ?? "")
      : "";
  return (
    code === "23505" &&
    (/pg_type_typname_nsp_index/i.test(message) ||
      /duplicate key value violates unique constraint/i.test(message))
  );
}

export async function probeLangGraphCheckpointReady(
  client: PgPoolClient,
  schema: string = LANGGRAPH_CHECKPOINT_SCHEMA,
): Promise<{ ready: boolean; maxVersion: number }> {
  const tables = await client.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
     FROM information_schema.tables
     WHERE table_schema = $1
       AND table_name = ANY($2::text[])`,
    [schema, CHECKPOINT_TABLES],
  );
  if ((tables.rows[0]?.n ?? 0) !== CHECKPOINT_TABLES.length) {
    return { ready: false, maxVersion: -1 };
  }

  try {
    const mig = await client.query<{ v: number }>(
      `SELECT COALESCE(MAX(v), -1)::int AS v FROM "${schema}"."checkpoint_migrations"`,
    );
    const maxVersion = mig.rows[0]?.v ?? -1;
    return {
      ready: maxVersion >= LANGGRAPH_CHECKPOINT_LATEST_VERSION,
      maxVersion,
    };
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
    if (code === "42P01") return { ready: false, maxVersion: -1 };
    throw err;
  }
}

async function runMigrationsOnClient(client: PgPoolClient, schema: string): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);

  let version = -1;
  try {
    const result = await client.query<{ v: number }>(
      `SELECT v FROM "${schema}"."checkpoint_migrations" ORDER BY v DESC LIMIT 1`,
    );
    if (result.rows.length > 0) version = result.rows[0]!.v;
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? String((err as { code?: string }).code ?? "")
        : "";
    if (code !== "42P01") throw err;
  }

  const migrations = migrationsForSchema(schema);
  for (let v = version + 1; v < migrations.length; v += 1) {
    await client.query(migrations[v]!);
    await client.query(
      `INSERT INTO "${schema}"."checkpoint_migrations" (v) VALUES ($1) ON CONFLICT (v) DO NOTHING`,
      [v],
    );
  }
}

/**
 * Asegura tablas LangGraph con lock advisory (una réplica a la vez).
 * Sustituye PostgresSaver.setup() en arranque multi-réplica / migrate+setup concurrente.
 */
export async function ensureLangGraphCheckpointSchema(
  connString: string,
  schema: string = LANGGRAPH_CHECKPOINT_SCHEMA,
): Promise<void> {
  const pool = new pg.Pool({ connectionString: connString.trim(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    try {
      const probe = await probeLangGraphCheckpointReady(client, schema);
      if (probe.ready) return;

      try {
        await runMigrationsOnClient(client, schema);
      } catch (err) {
        if (isLangGraphCheckpointSetupRaceError(err)) {
          const after = await probeLangGraphCheckpointReady(client, schema);
          if (after.ready) return;
        }
        throw err;
      }

      const after = await probeLangGraphCheckpointReady(client, schema);
      if (!after.ready) {
        throw new Error(
          `LangGraph checkpoint schema incomplete after migrate (max v=${after.maxVersion}, expected ${LANGGRAPH_CHECKPOINT_LATEST_VERSION})`,
        );
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

/** Subconjunto de `pg.PoolClient` que usa la purga (facilita tests con un cliente falso). */
export type CheckpointQueryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
};

export const DEFAULT_CHECKPOINT_TTL_DAYS = 14;
const PURGE_BATCH_LIMIT = 200;

/** Días de retención de checkpoints (`LANGGRAPH_CHECKPOINT_TTL_DAYS`, default 14). */
export function resolveCheckpointTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number.parseFloat(env.LANGGRAPH_CHECKPOINT_TTL_DAYS?.trim() ?? "");
  const days = Number.isFinite(n) && n > 0 ? n : DEFAULT_CHECKPOINT_TTL_DAYS;
  return Math.round(days * 24 * 60 * 60 * 1000);
}

/**
 * Borra hilos LangGraph inactivos: `checkpoints`, `checkpoint_writes` y `checkpoint_blobs` de los
 * `thread_id` cuyo último checkpoint (`checkpoint->>'ts'`) es anterior a `olderThanMs` Y cuya fila
 * `AgentStateCheckpoint` no existe o tampoco se tocó en ese plazo. Un hilo vivo (turno reciente o fila
 * reciente) nunca se purga. Devuelve los `thread_id` eliminados.
 */
export async function purgeStaleLangGraphThreads(
  client: CheckpointQueryable,
  options: { olderThanMs: number; schema?: string; limit?: number },
): Promise<{ threadIds: string[] }> {
  const schema = options.schema ?? LANGGRAPH_CHECKPOINT_SCHEMA;
  const limit = options.limit ?? PURGE_BATCH_LIMIT;
  const secs = Math.max(60, Math.floor(options.olderThanMs / 1000));
  const t = (name: string) => `"${schema}".${name}`;

  const stale = await client.query(
    `SELECT l.thread_id AS thread_id
     FROM (
       SELECT thread_id, MAX(NULLIF(checkpoint->>'ts', '')::timestamptz) AS last_ts
       FROM ${t("checkpoints")}
       GROUP BY thread_id
     ) l
     LEFT JOIN public."AgentStateCheckpoint" a ON a."threadId" = l.thread_id
     WHERE l.last_ts < now() - make_interval(secs => $1::double precision)
       AND (a."threadId" IS NULL OR a."updatedAt" < now() - make_interval(secs => $1::double precision))
     ORDER BY l.last_ts ASC
     LIMIT $2`,
    [secs, limit],
  );
  const threadIds = stale.rows.map((r) => String(r.thread_id)).filter(Boolean);
  if (threadIds.length === 0) return { threadIds: [] };

  await client.query("BEGIN");
  try {
    for (const table of ["checkpoint_writes", "checkpoint_blobs", "checkpoints"] as const) {
      await client.query(`DELETE FROM ${t(table)} WHERE thread_id = ANY($1::text[])`, [threadIds]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
  return { threadIds };
}

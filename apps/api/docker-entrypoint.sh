#!/bin/sh
set -e

# --- Helpers: host/credenciales desde DATABASE_URL (no usar localhost: el DB está en otro contenedor) ---
db_host_from_url() {
  echo "$DATABASE_URL" | sed -n 's|.*@\([^:/]*\).*|\1|p'
}
db_user_from_url() {
  echo "$DATABASE_URL" | sed -n 's|postgresql://\([^:]*\):.*|\1|p'
}
db_password_from_url() {
  echo "$DATABASE_URL" | sed -n 's|postgresql://[^:]*:\([^@]*\)@.*|\1|p'
}
db_name_from_url() {
  echo "$DATABASE_URL" | sed -n 's|.*/\([^?]*\).*|\1|p'
}

project_column_exists() {
  col="$1"
  host="$(db_host_from_url)"
  user="$(db_user_from_url)"
  pass="$(db_password_from_url)"
  db="$(db_name_from_url)"
  [ -n "$host" ] && [ -n "$user" ] && [ -n "$db" ] || return 1
  PGPASSWORD="${pass}" psql -h "$host" -U "$user" -d "$db" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='Project' AND column_name='${col}'" \
    2>/dev/null | grep -q 1
}

table_exists() {
  tbl="$1"
  host="$(db_host_from_url)"
  user="$(db_user_from_url)"
  pass="$(db_password_from_url)"
  db="$(db_name_from_url)"
  [ -n "$host" ] && [ -n "$user" ] && [ -n "$db" ] || return 1
  PGPASSWORD="${pass}" psql -h "$host" -U "$user" -d "$db" -tAc \
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${tbl}'" \
    2>/dev/null | grep -q 1
}

table_column_exists() {
  tbl="$1"
  col="$2"
  host="$(db_host_from_url)"
  user="$(db_user_from_url)"
  pass="$(db_password_from_url)"
  db="$(db_name_from_url)"
  [ -n "$host" ] && [ -n "$user" ] && [ -n "$db" ] || return 1
  PGPASSWORD="${pass}" psql -h "$host" -U "$user" -d "$db" -tAc \
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='${tbl}' AND column_name='${col}'" \
    2>/dev/null | grep -q 1
}

resolve_applied_if_project_column() {
  mig="$1"
  col="$2"
  if project_column_exists "$col"; then
    if npx prisma migrate resolve --applied "$mig" 2>/dev/null; then
      echo "migrate resolve --applied $mig (column Project.${col} already present)"
    fi
  fi
}

resolve_applied_if_table() {
  mig="$1"
  tbl="$2"
  if table_exists "$tbl"; then
    if npx prisma migrate resolve --applied "$mig" 2>/dev/null; then
      echo "migrate resolve --applied $mig (table ${tbl} already present)"
    fi
  fi
}

resolve_applied_if_table_column() {
  mig="$1"
  tbl="$2"
  col="$3"
  if table_column_exists "$tbl" "$col"; then
    if npx prisma migrate resolve --applied "$mig" 2>/dev/null; then
      echo "migrate resolve --applied $mig (column ${tbl}.${col} already present)"
    fi
  fi
}

# Esperar a que Postgres acepte TCP (Dokploy / orquestadores pueden levantar api antes que db)
node /app/apps/api/scripts/wait-for-postgres.cjs

# Dokploy a veces inyecta CORS_ORIGINS="" y anula el default de compose → Nest aborta en producción
if [ -z "${CORS_ORIGINS:-}" ]; then
  export CORS_ORIGINS="https://theforge.kreoint.mx,http://localhost:5173,http://127.0.0.1:5173"
  echo "CORS_ORIGINS unset/empty; using default origins"
fi

if [ -z "${TOKEN_MASTER_KEYS:-}" ]; then
  echo "ERROR: TOKEN_MASTER_KEYS is required. Define JSON {\"1\":\"<base64-32-bytes>\"} in Dokploy (theforge-api)."
  exit 1
fi

if [ -z "${JWT_SECRET:-}" ]; then
  echo "WARN: JWT_SECRET unset; using insecure compose fallback — set a strong secret in Dokploy."
  export JWT_SECRET="local-dev-jwt-secret-replace-in-dokploy"
fi

if [ "${NODE_ENV:-}" = "production" ] && [ -z "${REDIS_URL:-}" ]; then
  echo "ERROR: REDIS_URL is required in production (BullMQ queue). Set redis://theforge-redis-queue:6379 or equivalent."
  exit 1
fi

RUNTIME_ROLE="${THEFORGE_RUNTIME_ROLE:-all}"

start_api_process() {
  cd /app/apps/api
  if [ "$RUNTIME_ROLE" = "worker" ]; then
    MAIN_JS="./dist/worker.js"
  else
    MAIN_JS="./dist/main.js"
  fi
  if [ ! -f "$MAIN_JS" ]; then
    echo "WARNING: $MAIN_JS not found. Attempting to build on container start..."
    echo "Contents of dist/:"
    ls -la dist/ 2>/dev/null || echo "(dist/ does not exist)"
    echo "Running pnpm build..."
    pnpm run build || {
      echo "ERROR: Build failed"
      exit 1
    }
    if [ ! -f "$MAIN_JS" ]; then
      echo "ERROR: Build completed but $MAIN_JS still not found"
      exit 1
    fi
  fi
  echo "Starting process role=${RUNTIME_ROLE} ($MAIN_JS)..."
  exec node "$MAIN_JS"
}

# Worker: migraciones las ejecuta theforge-api; evita ~20 round-trips Prisma/Postgres por deploy.
if [ "$RUNTIME_ROLE" = "worker" ]; then
  start_api_process
fi

run_migration_healing() {
  # P3018: 20250311100000 falló por "Project does not exist" (20250309000000 crea el schema). Desbloquear.
  if npx prisma migrate resolve --rolled-back 20250311100000_add_legacy_flow_state 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20250311100000_add_legacy_flow_state"
  fi

  # P3009: migración stage_sdd fallida en deploys viejos (enum Status). Idempotente: solo actúa si sigue en estado fallido.
  if npx prisma migrate resolve --rolled-back 20250319140000_stage_sdd_deliverables 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20250319140000_stage_sdd_deliverables"
  fi

  # P3009: agent_checkpoint_mdd_stage fallida (p. ej. constraint/index ya existente o tabla no creada).
  if npx prisma migrate resolve --rolled-back 20260319130000_agent_checkpoint_mdd_stage 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260319130000_agent_checkpoint_mdd_stage"
  fi

  # P3009: columnas ya existentes por db push (agent governance / merge)
  if npx prisma migrate resolve --rolled-back 20260609120000_add_agent_governance_content 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260609120000_add_agent_governance_content"
  fi
  if npx prisma migrate resolve --rolled-back 20260612120000_project_merge_suite 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260612120000_project_merge_suite"
  fi

  # P3009: UI MCP — tabla/columnas ya creadas por db push o migración en ruta prisma/migrations previa
  if npx prisma migrate resolve --rolled-back 20260702_add_ui_mcp_instance 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260702_add_ui_mcp_instance"
  fi
  if npx prisma migrate resolve --rolled-back 20260703180000_ui_mcp_adapter_id 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260703180000_ui_mcp_adapter_id"
  fi

  # Otra migración atascada (opcional): PRISMA_RESOLVE_ROLLED_BACK=<nombre_carpeta>
  if [ -n "$PRISMA_RESOLVE_ROLLED_BACK" ]; then
    echo "prisma migrate resolve --rolled-back $PRISMA_RESOLVE_ROLLED_BACK"
    npx prisma migrate resolve --rolled-back "$PRISMA_RESOLVE_ROLLED_BACK" || true
  fi

  # P3009: imageModel columns — limpiar antes de migrate deploy
  if npx prisma migrate resolve --rolled-back 20260714120000_add_image_model_columns 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260714120000_add_image_model_columns"
  fi

  # P3009: tasksJson — limpiar antes de migrate deploy
  if npx prisma migrate resolve --rolled-back 20260714130000_add_tasks_json 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260714130000_add_tasks_json"
  fi

  # P3009: sync schema drift — limpiar antes de migrate deploy
  if npx prisma migrate resolve --rolled-back 20260714140000_sync_schema_drift 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260714140000_sync_schema_drift"
  fi

  # P3009: RFC-001 Document Ast columns — limpiar antes de migrate deploy
  if npx prisma migrate resolve --rolled-back 20260715100000_add_document_ast_columns 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260715100000_add_document_ast_columns"
  fi

  # P3009: evdContent — limpiar antes de migrate deploy (la columna ya existe o se crea por db push)
  if npx prisma migrate resolve --rolled-back 20260712_add_evd_content_column 2>/dev/null; then
    echo "migrate resolve: cleared failed record for 20260712_add_evd_content_column"
  fi

  # Si db push / safe-schema-sync adelantó las columnas, marcar como aplicadas
  resolve_applied_if_table_column "20260714120000_add_image_model_columns" "ProviderInstance" "imageModel"
  resolve_applied_if_project_column "20260714130000_add_tasks_json" "tasksJson"
  resolve_applied_if_table_column "20260714150000_stage_domain_inventory" "Stage" "domainInventory"

  # Si db push adelantó el DDL, marcar migración como aplicada sin re-ejecutar ADD COLUMN
  resolve_applied_if_project_column "20260609120000_add_agent_governance_content" "agentGovernanceContent"
  resolve_applied_if_project_column "20260612120000_project_merge_suite" "archivedAt"
  resolve_applied_if_table "20260702_add_ui_mcp_instance" "UiMcpInstance"
  resolve_applied_if_table_column "20260703180000_ui_mcp_adapter_id" "UiMcpInstance" "adapterId"

  # TokenUsage (telemetría; migración 20260724_add_token_usage; safe-schema-sync.sql
  # ya crea la tabla idempotente si falta). Marcamos como applied para que
  # `migrate deploy` no falle al re-ejecutar la migración en BD ya sincronizada.
  resolve_applied_if_table "20260724_add_token_usage" "TokenUsage"
  # Checkpoints de LangGraph ahora viven en `langgraph.checkpoints` (no en `public`).
  # Si la tabla existe en el schema dedicado pero la migración está sin registrar,
  # la marcamos como aplicada para que un re-deploy no intente recrearla.
  if table_exists "checkpoints"; then
    host="$(db_host_from_url)"
    user="$(db_user_from_url)"
    pass="$(db_password_from_url)"
    db="$(db_name_from_url)"
    if PGPASSWORD="${pass}" psql -h "$host" -U "$user" -d "$db" -tAc \
      "SELECT 1 FROM information_schema.tables WHERE table_schema='langgraph' AND table_name='checkpoints'" \
      2>/dev/null | grep -q 1; then
      if npx prisma migrate resolve --applied "20260513180000_langgraph_checkpoint_tables" 2>/dev/null; then
        echo "migrate resolve --applied 20260513180000_langgraph_checkpoint_tables (langgraph.checkpoints present)"
      fi
    fi
  fi
}

cd /app/packages/database

# DDL idempotente antes de migrate (db push previo puede haber creado columnas sin registrar migración)
echo "Running safe-schema-sync.sql..."
npx prisma db execute --file /app/packages/database/scripts/safe-schema-sync.sql 2>&1 || true

# NOTA: No marcar migraciones como applied en cada arranque. Eso provocaba que en BD vacías
# se saltara 20250311000000 y fallara 20250311100000 (Project no existe).
# Si db push creó el schema y "ProjectType already exists", ejecutar manualmente una vez:
#   prisma migrate resolve --applied 20250311000000_add_project_type_relic

# Fast path: en redeploys normales migrate deploy basta; healing solo si falla (evita ~20 npx/psql por arranque).
echo "Running prisma migrate deploy..."
if ! npx prisma migrate deploy; then
  echo "migrate deploy failed; running migration healing and retrying..."
  run_migration_healing
  npx prisma migrate deploy || {
    echo "ERROR: prisma migrate deploy failed after healing. Check DATABASE_URL and that migrations exist."
    echo "Si es P3009 con otra migración: packages/database/README.md — PRISMA_RESOLVE_ROLLED_BACK o resolve manual."
    exit 1
  }
fi

# Opcional (una vez): tras rotar TOKEN_MASTER_KEYS sin la clave vieja. Idempotente; quitar env tras el deploy.
if [ "${WIPE_BYOK_ON_START:-}" = "1" ]; then
  echo "WIPE_BYOK_ON_START=1: wiping ProviderInstance and UserProviderConfig..."
  npx prisma db execute --file /app/apps/api/scripts/wipe-byok-ciphertext.sql
  echo "WIPE_BYOK_ON_START: done. Unset WIPE_BYOK_ON_START in Dokploy before the next redeploy."
fi

# ---------------------------------------------------------------------------
# ⚠️  DESHABILITADO POR DEFECTO — NO EJECUTAR `prisma db push` EN PRODUCCIÓN
# ---------------------------------------------------------------------------
# Razón histórica: cuando el `worker` se reinicia, este paso DROPPA cualquier
# tabla del esquema gestionado por Prisma que no esté en `schema.prisma`,
# INCLUIDAS las tablas de checkpoints de LangGraph (`checkpoint_migrations`,
# `checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) que `CheckpointerService`
# crea por DDL directo en `ensureLangGraphCheckpointSchema`. La consecuencia
# fue que la generación stream del MDD perdió el checkpoint a mitad de un
# `/mdd-completo` y la última respuesta del LLM (incompleta) sobrescribió el
# documento. Ver CHANGELOG [Unreleased] → Fixed → "MDD se borra tras restart".
#
# El esquema se mantiene con `prisma migrate deploy` (línea ~197) + el
# `safe-schema-sync.sql` aditivo (línea ~114). `db push` queda reservado
# para entornos de desarrollo explícitos y se activa sólo si se define
# `THEFORGE_ALLOW_DB_PUSH=1` en el .env del contenedor. Ese flag debe estar
# APAGADO en Dokploy/prod; si lo prendes en prod, aceptas que cualquier
# tabla fuera de `schema.prisma` puede ser eliminada al reiniciar.
# ---------------------------------------------------------------------------
if [ "${THEFORGE_ALLOW_DB_PUSH:-0}" = "1" ]; then
  echo "WARN: THEFORGE_ALLOW_DB_PUSH=1 — running prisma db push (puede borrar tablas no modeladas)"
  npx prisma db push --accept-data-loss || true
else
  echo "Skipping prisma db push (default; THEFORGE_ALLOW_DB_PUSH!=1). Use sólo en dev."
fi

# Fallback aditivo vía Prisma (imagen Alpine no incluye psql).
# Sólo ALTER ... ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS —
# nunca DROP. Esto es lo único seguro fuera de `migrate deploy`.
echo "Checking mcpSecret column via SQL..."
npx prisma db execute --stdin <<'SQL' 2>&1 || true
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mcpSecret" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_mcpSecret_key" ON "User"("mcpSecret");
SQL

start_api_process

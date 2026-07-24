-- Safe schema sync: align PostgreSQL with schema.prisma without dropping LangGraph checkpoints or row data.
-- Idempotent: safe to run multiple times.

-- 1. FavoriteProject (missing in some deploys; migration file is not in _prisma_migrations)
CREATE TABLE IF NOT EXISTS "FavoriteProject" (
    "id"        TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FavoriteProject_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FavoriteProject_userId_projectId_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'FavoriteProject_userId_projectId_key'
  ) THEN
    ALTER TABLE "FavoriteProject"
      ADD CONSTRAINT "FavoriteProject_userId_projectId_key" UNIQUE ("userId", "projectId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FavoriteProject_userId_fkey'
  ) THEN
    ALTER TABLE "FavoriteProject"
      ADD CONSTRAINT "FavoriteProject_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FavoriteProject_projectId_fkey'
  ) THEN
    ALTER TABLE "FavoriteProject"
      ADD CONSTRAINT "FavoriteProject_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "FavoriteProject_userId_idx" ON "FavoriteProject"("userId");

-- 2. Project: merge relicProjectId into theforgeProjectId before dropping orphan column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Project' AND column_name = 'relicProjectId'
  ) THEN
    UPDATE "Project"
    SET "theforgeProjectId" = "relicProjectId"
    WHERE "theforgeProjectId" IS NULL AND "relicProjectId" IS NOT NULL;

    ALTER TABLE "Project" DROP COLUMN "relicProjectId";
  END IF;
END $$;

-- 3. LangGraph checkpoint tables (keep data; create if missing)
CREATE TABLE IF NOT EXISTS "public"."checkpoint_migrations" (
  v INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS "public"."checkpoints" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  parent_checkpoint_id TEXT,
  type TEXT,
  checkpoint JSONB NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE TABLE IF NOT EXISTS "public"."checkpoint_blobs" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  channel TEXT NOT NULL,
  version TEXT NOT NULL,
  type TEXT NOT NULL,
  blob BYTEA,
  PRIMARY KEY (thread_id, checkpoint_ns, channel, version)
);

CREATE TABLE IF NOT EXISTS "public"."checkpoint_writes" (
  thread_id TEXT NOT NULL,
  checkpoint_ns TEXT NOT NULL DEFAULT '',
  checkpoint_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  channel TEXT NOT NULL,
  type TEXT,
  blob BYTEA NOT NULL,
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
);

ALTER TABLE "public"."checkpoint_blobs" ALTER COLUMN "blob" DROP NOT NULL;

INSERT INTO "public"."checkpoint_migrations" (v) VALUES (0) ON CONFLICT (v) DO NOTHING;
INSERT INTO "public"."checkpoint_migrations" (v) VALUES (1) ON CONFLICT (v) DO NOTHING;
INSERT INTO "public"."checkpoint_migrations" (v) VALUES (2) ON CONFLICT (v) DO NOTHING;
INSERT INTO "public"."checkpoint_migrations" (v) VALUES (3) ON CONFLICT (v) DO NOTHING;
INSERT INTO "public"."checkpoint_migrations" (v) VALUES (4) ON CONFLICT (v) DO NOTHING;

-- 4. User: MCP / Ariadne columns (present in schema.prisma; add if missing on older DBs)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mcpSecret" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ariadneMcpUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "ariadneMcpToken" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "techDocsMcpUrl" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "techDocsMcpToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "User_mcpSecret_key" ON "User"("mcpSecret");

-- 5. Project: Fase 0 interactive interview columns
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "phase0Gaps" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "phase0Status" TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "phase0Questions" INTEGER NOT NULL DEFAULT 0;

-- 6. Project: gobernanza de agentes (migración 20260609120000; db push puede adelantarla)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "agentGovernanceContent" TEXT;

-- 8. Project integration NEW ↔ LEGACY (migración 20260616120000)
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "linkedLegacyProjectId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "linkedNewProjectId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "integrationHandoff" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "integrationHandoffUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "linkedNewProjectId" TEXT;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "handoffSnapshot" JSONB;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "handoffImportedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "mergedFrom" JSONB;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "parentProjectId" TEXT;

CREATE INDEX IF NOT EXISTS "Project_archivedAt_idx" ON "Project"("archivedAt");
CREATE INDEX IF NOT EXISTS "Project_parentProjectId_idx" ON "Project"("parentProjectId");

-- 9. UI MCP (migraciones 20260702 / 20260703180000; db push o ruta prisma/migrations previa)
CREATE TABLE IF NOT EXISTS "UiMcpInstance" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tokenCiphertext" TEXT,
    "tokenKeyVersion" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "teamVisible" BOOLEAN NOT NULL DEFAULT true,
    "compatible" BOOLEAN NOT NULL DEFAULT false,
    "contractVersion" TEXT,
    "libraryName" TEXT,
    "libraryVersion" TEXT,
    "capabilitiesJson" JSONB,
    "lastCheckedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UiMcpInstance_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UiMcpInstance_isActive_idx" ON "UiMcpInstance"("isActive");
CREATE INDEX IF NOT EXISTS "UiMcpInstance_enabled_idx" ON "UiMcpInstance"("enabled");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UiMcpInstance_createdByUserId_fkey'
  ) THEN
    ALTER TABLE "UiMcpInstance"
      ADD CONSTRAINT "UiMcpInstance_createdByUserId_fkey"
      FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "UiMcpInstance" ADD COLUMN IF NOT EXISTS "adapterId" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "uiScreensContent" TEXT;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "uiScreensContent" TEXT;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "domainInventory" JSONB;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Project_parentProjectId_fkey'
  ) THEN
    ALTER TABLE "Project"
      ADD CONSTRAINT "Project_parentProjectId_fkey"
      FOREIGN KEY ("parentProjectId") REFERENCES "Project"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

-- 10. TokenUsage (telemetría de tokens LLM; migración 20260724_add_token_usage).
-- La migración está en migrations/, pero en deploys donde la BD tiene
-- drift (workspace image stale, image sin la migración aplicada a _prisma_migrations),
-- esta entrada idempotente la recrea sin DROP. El entrypoint añade
-- `resolve_applied_if_table "20260724_add_token_usage" "TokenUsage"` justo
-- después de correr este script para que migrate deploy no falle al reintentar.
CREATE TABLE IF NOT EXISTS "TokenUsage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "stageId" TEXT,
    "documentField" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "node" TEXT,
    "providerId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL,
    "completionTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DOUBLE PRECISION NOT NULL,
    "costMxn" DOUBLE PRECISION NOT NULL,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TokenUsage_projectId_documentField_createdAt_idx"
    ON "TokenUsage"("projectId", "documentField", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "TokenUsage_stageId_documentField_idx"
    ON "TokenUsage"("stageId", "documentField");

CREATE INDEX IF NOT EXISTS "TokenUsage_projectId_providerId_modelId_idx"
    ON "TokenUsage"("projectId", "providerId", "modelId");

CREATE INDEX IF NOT EXISTS "TokenUsage_projectId_createdAt_idx"
    ON "TokenUsage"("projectId", "createdAt" DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TokenUsage_projectId_fkey'
  ) THEN
    ALTER TABLE "TokenUsage"
      ADD CONSTRAINT "TokenUsage_projectId_fkey"
      FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TokenUsage_stageId_fkey'
  ) THEN
    ALTER TABLE "TokenUsage"
      ADD CONSTRAINT "TokenUsage_stageId_fkey"
      FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

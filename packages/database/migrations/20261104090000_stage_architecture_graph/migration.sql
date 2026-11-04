-- Stage.architectureGraph: PAG separado del AST del MDD (Design-First, migración B).
-- Idempotente: ADD COLUMN IF NOT EXISTS + backfill solo donde documentAst tiene endpoints (CL-24).

ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "architectureGraph" JSONB;
ALTER TABLE "Stage" ADD COLUMN IF NOT EXISTS "architectureGraphSourceHash" TEXT;

UPDATE "Stage"
SET "architectureGraph" = "documentAst"
WHERE "architectureGraph" IS NULL
  AND "documentAst" IS NOT NULL
  AND "documentAst" ? 'endpoints';

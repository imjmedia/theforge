-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ProjectApproach" AS ENUM ('DOMAIN_FIRST', 'UX_FIRST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "approach" "ProjectApproach" NOT NULL DEFAULT 'DOMAIN_FIRST';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "uxDesignSource" TEXT;

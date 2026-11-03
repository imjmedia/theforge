-- Telemetría por llamada en TokenUsage (O14): latencia, intentos, resultado,
-- coste conocido, estimación chars/4 y modelo real. Aditiva y nullable: las filas
-- existentes quedan en NULL.
-- AlterTable
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "latencyMs" INTEGER;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "attempts" INTEGER;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "outcome" TEXT;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "costKnown" BOOLEAN;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "estimated" BOOLEAN;
ALTER TABLE "TokenUsage" ADD COLUMN IF NOT EXISTS "modelActual" TEXT;

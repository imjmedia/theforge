-- CreateTable
CREATE TABLE "TokenUsage" (
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

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_documentField_createdAt_idx" ON "TokenUsage"("projectId", "documentField", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "TokenUsage_stageId_documentField_idx" ON "TokenUsage"("stageId", "documentField");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_providerId_modelId_idx" ON "TokenUsage"("projectId", "providerId", "modelId");

-- CreateIndex
CREATE INDEX "TokenUsage_projectId_createdAt_idx" ON "TokenUsage"("projectId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenUsage" ADD CONSTRAINT "TokenUsage_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

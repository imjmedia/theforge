/**
 * Backfill CLI: recalcula Stage.status / precisionScore con StageSemaphoreSyncService (CAS).
 * Uso: npx tsx scripts/recalc-stage-semaphores.ts --dry-run --limit 50 [--project <id>]
 */
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../src/app.module.js";
import { StageSemaphoreSyncService } from "../src/modules/projects/stage-semaphore-sync.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";

function parseArgs(argv: string[]) {
  const dryRun = argv.includes("--dry-run");
  const limitIdx = argv.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : undefined;
  const projectIdx = argv.indexOf("--project");
  const projectId = projectIdx >= 0 ? String(argv[projectIdx + 1] ?? "").trim() : undefined;
  return { dryRun, limit, projectId };
}

async function main() {
  const { dryRun, limit, projectId } = parseArgs(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error", "warn", "log"] });
  const prisma = app.get(PrismaService);
  const sync = app.get(StageSemaphoreSyncService);

  const stages = await prisma.stage.findMany({
    where: projectId ? { projectId } : undefined,
    select: { id: true, projectId: true, mddContent: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  let changed = 0;
  for (const stage of stages) {
    if (dryRun) {
      console.log(`[dry-run] project=${stage.projectId} stage=${stage.id}`);
      continue;
    }
    const r = await sync.syncFromPersisted(stage.projectId, stage.id, { reason: "backfill-cli" });
    if (r?.changed) {
      changed += 1;
      console.log(`[changed] project=${stage.projectId} stage=${stage.id} status=${r.status} score=${r.precisionScore}`);
    }
  }

  console.log(`[Semaphore backfill] stages=${stages.length} changed=${changed} dryRun=${dryRun}`);
  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

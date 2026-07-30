/**
 * @fileoverview Trazador estructurado del pipeline de regeneración MDD.
 */

/**
 * Tracer estructurado para la pipeline de regeneración MDD (section / upstream-sync / pipeline / manager).
 *
 * Log por línea (greppable con `docker logs | grep "[MDD:Regen]"`):
 *   [MDD:Regen] job=abc mode=section §1 step=fetch-mdd        status=start
 *   [MDD:Regen] job=abc mode=section §1 step=fetch-mdd        status=done  duration=120ms  mddLen=8421
 *   [MDD:Regen] job=abc mode=section §1 step=llm-invoke       status=start prompt=4200
 *   [MDD:Regen] job=abc mode=section §1 step=llm-invoke       status=done  duration=47000ms  outputLen=8200
 *   [MDD:Regen] job=abc mode=section §1 status=done  totalDuration=92340ms  steps=6
 *
 * Cada `step()` envuelve una función async y registra:
 *   - start/end con durationMs
 *   - metadatos arbitrarios (mddLen, promptLen, outputLen, etc.)
 *   - errores con stack trace
 */

export type MddRegenMode = "section" | "section-pipeline" | "upstream-sync" | "pipeline" | "manager";

export interface MddRegenContext {
  jobId?: string;
  mode: MddRegenMode;
  projectId: string;
  section?: number;
  stageId?: string;
}

type StepMeta = Record<string, string | number | boolean | undefined>;

const LOG_PREFIX = "[MDD:Regen]";

function fmtMeta(meta?: StepMeta): string {
  if (!meta) return "";
  const parts: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === "") continue;
    parts.push(`${k}=${typeof v === "string" ? v : String(v)}`);
  }
  return parts.length ? `  ${parts.join("  ")}` : "";
}

function ctxTag(ctx: MddRegenContext): string {
  const sec = ctx.section ? `§${ctx.section}` : "";
  const job = ctx.jobId ? `job=${ctx.jobId}  ` : "";
  return `${job}mode=${ctx.mode}  ${sec}`;
}

export class MddRegenTracer {
  private readonly startedAt = Date.now();
  private readonly steps: Array<{ name: string; durationMs: number; ok: boolean; error?: string }> = [];
  private stepCounter = 0;

  constructor(
    private readonly ctx: MddRegenContext,
    private readonly log: (msg: string) => void = (m) => console.log(m),
  ) {
    this.log(`${LOG_PREFIX} ${ctxTag(ctx)} status=start  mddInput=${ctx.projectId}`);
  }

  /** Envuelve una función async con timing automático. */
  async step<T>(name: string, fn: () => Promise<T>, meta?: StepMeta): Promise<T> {
    const stepId = ++this.stepCounter;
    const startMeta = meta ? { ...meta } : {};
    this.log(`${LOG_PREFIX} ${ctxTag(this.ctx)} step=${name}  #${stepId}  status=start${fmtMeta(startMeta)}`);
    const t0 = Date.now();
    try {
      const result = await fn();
      const dur = Date.now() - t0;
      this.steps.push({ name, durationMs: dur, ok: true });
      const doneMeta: StepMeta = { ...meta, duration: `${dur}ms` };
      this.log(`${LOG_PREFIX} ${ctxTag(this.ctx)} step=${name}  #${stepId}  status=done${fmtMeta(doneMeta)}`);
      return result;
    } catch (err) {
      const dur = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);
      this.steps.push({ name, durationMs: dur, ok: false, error: errMsg });
      const errMeta: StepMeta = { ...meta, duration: `${dur}ms`, error: errMsg };
      this.log(`${LOG_PREFIX} ${ctxTag(this.ctx)} step=${name}  #${stepId}  status=error${fmtMeta(errMeta)}`);
      throw err;
    }
  }

  /** Registra un evento puntual (sin medir durión) — útil para heartbeat del LLM. */
  event(name: string, meta?: StepMeta): void {
    this.log(`${LOG_PREFIX} ${ctxTag(this.ctx)} step=${name}  event${fmtMeta(meta)}`);
  }

  /** Heartbeat: el LLM sigue corriendo tras N ms sin respuesta. */
  heartbeat(name: string, elapsedMs: number): void {
    this.log(`${LOG_PREFIX} ${ctxTag(this.ctx)} step=${name}  heartbeat  elapsed=${elapsedMs}ms`);
  }

  /** Resume todos los pasos con duración y estado final. Llamar al final del flujo. */
  summary(ok: boolean, meta?: StepMeta): void {
    const total = Date.now() - this.startedAt;
    const stepSummary = this.steps
      .map((s) => `${s.name}=${s.durationMs}ms${s.ok ? "" : "❌"}`)
      .join("  →  ");
    this.log(
      `${LOG_PREFIX} ${ctxTag(this.ctx)} status=${ok ? "done" : "failed"}  totalDuration=${total}ms  steps=${this.steps.length}${fmtMeta({ ...meta, stepBreakdown: stepSummary })}`,
    );
  }
}

import { useState } from "react";
import { GitCompare, Loader2 } from "lucide-react";
import type { MddEvalCompareDto, MddEvalRunDto } from "@theforge/shared-types";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { compareMddEvalRuns } from "@/utils/mddEvalApi";
import {
  computeDelta,
  deltaInfo,
  formatCost,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatScore,
  passTransition,
  type DeltaTone,
} from "@/utils/mddEvalFormat";

interface MddEvalCompareProps {
  runs: MddEvalRunDto[];
}

const TONE_CLASS: Record<DeltaTone, string> = {
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  neutral: "text-[var(--foreground-muted)]",
};

function Delta({
  value,
  higherIsBetter = true,
  format,
  epsilon,
}: {
  value: number | undefined;
  higherIsBetter?: boolean;
  format?: (abs: number) => string;
  epsilon?: number;
}) {
  const info = deltaInfo(value, { higherIsBetter, format, epsilon });
  return (
    <span className={cn("whitespace-nowrap font-medium", TONE_CLASS[info.tone])}>
      {info.arrow} {info.text}
    </span>
  );
}

function runOptionLabel(run: MddEvalRunDto): string {
  const agg = run.aggregates;
  return `${formatDateTime(run.startedAt)} · ${run.runId.slice(0, 8)}${agg ? ` · ${agg.passed}/${agg.cases} PASS` : ""}`;
}

export function MddEvalCompare({ runs }: MddEvalCompareProps) {
  const comparable = runs.filter((r) => r.status === "completed" || r.records.length > 0);
  const [base, setBase] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<MddEvalCompareDto | null>(null);

  const canCompare = base !== "" && target !== "" && base !== target && !loading;

  const handleCompare = async () => {
    setLoading(true);
    setError("");
    try {
      setResult(await compareMddEvalRuns(base, target));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "No se pudo comparar las corridas.");
    } finally {
      setLoading(false);
    }
  };

  if (comparable.length < 2) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--foreground-muted)]">
        Necesitas al menos dos corridas con resultados para compararlas.
      </p>
    );
  }

  const before = result?.aggregatesBefore;
  const after = result?.aggregatesAfter;

  const selectClass =
    "h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-2 text-sm text-[var(--foreground)]";

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Base (antes)
          </span>
          <select value={base} onChange={(e) => setBase(e.target.value)} className={selectClass}>
            <option value="">Selecciona una corrida…</option>
            {comparable.map((r) => (
              <option key={r.runId} value={r.runId}>
                {runOptionLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
            Objetivo (después)
          </span>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className={selectClass}>
            <option value="">Selecciona una corrida…</option>
            {comparable.map((r) => (
              <option key={r.runId} value={r.runId}>
                {runOptionLabel(r)}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" onClick={() => void handleCompare()} disabled={!canCompare}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitCompare className="h-4 w-4" />}
          Comparar
        </Button>
      </div>
      {base !== "" && base === target ? (
        <p className="text-xs text-[var(--warning)]">Elige dos corridas distintas.</p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-3 text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="space-y-3">
          {before && after ? (
            <p className="rounded-md border border-[var(--border)] p-3 text-sm">
              <strong>Resumen:</strong> rúbrica prom. <Delta value={computeDelta(before.avgRubric, after.avgRubric)} /> ·
              auditor prom.{" "}
              <Delta value={computeDelta(before.avgAuditor ?? undefined, after.avgAuditor ?? undefined)} /> ·
              aprobación {formatPercent(before.passRate)} → {formatPercent(after.passRate)}{" "}
              (<Delta
                value={computeDelta(before.passRate * 100, after.passRate * 100)}
                format={(abs) => `${Math.round(abs)}pp`}
                epsilon={0.5}
              />) · duración prom.{" "}
              <Delta
                value={computeDelta(before.avgDurationMs, after.avgDurationMs)}
                higherIsBetter={false}
                format={formatDuration}
                epsilon={500}
              />{" "}
              · coste{" "}
              <Delta
                value={computeDelta(before.totalCostUsd ?? undefined, after.totalCostUsd ?? undefined)}
                higherIsBetter={false}
                format={formatCost}
                epsilon={0.0001}
              />
            </p>
          ) : (
            <p className="text-sm text-[var(--foreground-muted)]">
              Una de las corridas no tiene agregados; solo se muestran las diferencias por caso.
            </p>
          )}

          {result.rows.length === 0 ? (
            <p className="text-sm text-[var(--foreground-muted)]">No hay casos comparables entre ambas corridas.</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-[var(--border)]">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead className="bg-[var(--muted)]/50 text-left text-xs uppercase tracking-wide text-[var(--foreground-muted)]">
                  <tr>
                    <th className="px-3 py-2">Caso</th>
                    <th className="px-3 py-2 text-right">Rúbrica</th>
                    <th className="px-3 py-2 text-right">Δ rúbrica</th>
                    <th className="px-3 py-2 text-right">Auditor</th>
                    <th className="px-3 py-2 text-right">Δ auditor</th>
                    <th className="px-3 py-2 text-right">Duración</th>
                    <th className="px-3 py-2 text-right">Δ duración</th>
                    <th className="px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {result.rows.map((row) => {
                    const pass = passTransition(row.passedBefore, row.passedAfter);
                    return (
                      <tr key={row.caseId}>
                        <td className="px-3 py-2 font-mono text-xs">{row.caseId}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatScore(row.rubricBefore)} → {formatScore(row.rubricAfter)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={row.rubricDelta ?? computeDelta(row.rubricBefore, row.rubricAfter)} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatScore(row.auditorBefore)} → {formatScore(row.auditorAfter)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Delta value={row.auditorDelta ?? computeDelta(row.auditorBefore, row.auditorAfter)} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          {formatDuration(row.durationBeforeMs)} → {formatDuration(row.durationAfterMs)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Delta
                            value={computeDelta(row.durationBeforeMs, row.durationAfterMs)}
                            higherIsBetter={false}
                            format={formatDuration}
                            epsilon={500}
                          />
                        </td>
                        <td className={cn("whitespace-nowrap px-3 py-2 font-medium", TONE_CLASS[pass.tone])}>
                          {pass.label}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

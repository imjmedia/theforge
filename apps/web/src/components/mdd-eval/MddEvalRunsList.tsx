import type { MddEvalRunDto } from "@theforge/shared-types";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  formatCost,
  formatDateTime,
  formatPercent,
  formatScore,
  runStatusLabel,
  runStatusTone,
} from "@/utils/mddEvalFormat";

interface MddEvalRunsListProps {
  runs: MddEvalRunDto[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

export function MddEvalRunsList({ runs, selectedRunId, onSelect }: MddEvalRunsListProps) {
  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)]">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead className="bg-[var(--muted)]/50 text-left text-xs uppercase tracking-wide text-[var(--foreground-muted)]">
          <tr>
            <th className="px-3 py-2">Estado</th>
            <th className="px-3 py-2">Fecha</th>
            <th className="px-3 py-2 text-right">Casos</th>
            <th className="px-3 py-2 text-right">Aprobación</th>
            <th className="px-3 py-2 text-right">Rúbrica</th>
            <th className="px-3 py-2 text-right">Auditor</th>
            <th className="px-3 py-2 text-right">Coste</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {runs.map((run) => {
            const selected = run.runId === selectedRunId;
            const agg = run.aggregates;
            return (
              <tr
                key={run.runId}
                tabIndex={0}
                aria-selected={selected}
                onClick={() => onSelect(run.runId)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(run.runId);
                  }
                }}
                className={cn(
                  "cursor-pointer hover:bg-[var(--muted)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ring)]",
                  selected && "bg-[var(--primary)]/10",
                )}
              >
                <td className="px-3 py-2">
                  <Badge variant={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
                </td>
                <td className="whitespace-nowrap px-3 py-2">
                  {formatDateTime(run.startedAt)}
                  <span className="block font-mono text-[10px] text-[var(--foreground-muted)]">
                    {run.runId.slice(0, 12)}
                    {run.gitSha ? ` · ${run.gitSha.slice(0, 7)}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">{agg ? agg.cases : run.caseIds.length}</td>
                <td className="px-3 py-2 text-right">
                  {agg ? `${formatPercent(agg.passRate)} (${agg.passed}/${agg.cases})` : "—"}
                </td>
                <td className="px-3 py-2 text-right">{formatScore(agg?.avgRubric)}</td>
                <td className="px-3 py-2 text-right">{formatScore(agg?.avgAuditor)}</td>
                <td className="px-3 py-2 text-right">{formatCost(agg?.totalCostUsd)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

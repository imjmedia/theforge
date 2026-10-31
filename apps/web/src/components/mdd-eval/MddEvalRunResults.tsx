import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import type { MddEvalRunDto, MddEvalRunRecordDto } from "@theforge/shared-types";
import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  complexityLabel,
  complexityTone,
  dimensionLabel,
  formatCost,
  formatDateTime,
  formatDuration,
  formatPercent,
  formatPoints,
  formatScore,
  passLabel,
  runStatusLabel,
  runStatusTone,
} from "@/utils/mddEvalFormat";

interface MddEvalRunResultsProps {
  run: MddEvalRunDto;
  onViewMarkdown: (caseId: string) => void;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--border)] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-[var(--foreground-muted)]">{label}</p>
      <p className="text-sm font-semibold text-[var(--foreground)]">{value}</p>
    </div>
  );
}

function StringList({ title, items, tone }: { title: string; items: string[]; tone?: "bad" | "warn" }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">{title}</p>
      <ul
        className={cn(
          "list-disc space-y-0.5 pl-5 text-sm",
          tone === "bad" && "text-[var(--destructive)]",
          tone === "warn" && "text-[var(--warning)]",
        )}
      >
        {items.map((item, i) => (
          <li key={`${i}-${item}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function RecordDetail({ record }: { record: MddEvalRunRecordDto }) {
  const { rubric } = record;
  return (
    <div className="space-y-4 p-3 text-sm">
      {record.error ? (
        <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-2 text-[var(--destructive)]">
          <strong>Error:</strong> {record.error}
        </p>
      ) : null}
      {record.failedStep ? (
        <p className="rounded-md border border-[var(--destructive)]/40 p-2">
          <strong>Paso fallido:</strong> <span className="font-mono text-xs">{record.failedStep.node}</span> —{" "}
          {record.failedStep.error}
        </p>
      ) : null}

      <div>
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">
          Dimensiones de la rúbrica
        </p>
        {rubric.dimensions.length === 0 ? (
          <p className="text-[var(--foreground-muted)]">Sin dimensiones.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--border)]">
            <table className="w-full min-w-[28rem] border-collapse text-xs">
              <thead className="bg-[var(--muted)]/40 text-left text-[var(--foreground-muted)]">
                <tr>
                  <th className="px-2 py-1.5">Dimensión</th>
                  <th className="px-2 py-1.5 text-right">Score</th>
                  <th className="px-2 py-1.5 text-right">Peso</th>
                  <th className="px-2 py-1.5">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rubric.dimensions.map((dim) => (
                  <tr key={dim.key} className="align-top">
                    <td className="px-2 py-1.5 font-medium">{dimensionLabel(dim.key)}</td>
                    <td className="px-2 py-1.5 text-right">{formatScore(dim.score)}</td>
                    <td className="px-2 py-1.5 text-right">{formatScore(dim.weight)}</td>
                    <td className="px-2 py-1.5 text-[var(--foreground-muted)]">
                      {dim.details.length === 0 ? (
                        "—"
                      ) : (
                        <ul className="list-disc space-y-0.5 pl-4">
                          {dim.details.map((d, i) => (
                            <li key={`${i}-${d}`}>{d}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <StringList title="Fallos de la rúbrica" items={rubric.failures} tone="bad" />
      <StringList
        title={`Términos prohibidos detectados${rubric.forbiddenPenalty ? ` (penalización ${formatScore(rubric.forbiddenPenalty)})` : ""}`}
        items={rubric.forbiddenHits}
        tone="bad"
      />
      <StringList title="Bloqueantes del gate" items={record.gateBlockers} tone="bad" />
      <StringList title="Avisos del gate" items={record.gateWarnings} tone="warn" />

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--foreground-muted)]">
        {record.precision !== undefined ? <span>Precisión: {formatPoints(record.precision)}</span> : null}
        {record.llmCalls !== undefined ? <span>Llamadas LLM: {record.llmCalls}</span> : null}
        {record.promptTokens !== undefined ? <span>Tokens entrada: {record.promptTokens}</span> : null}
        {record.completionTokens !== undefined ? <span>Tokens salida: {record.completionTokens}</span> : null}
        <span>Tamaño MDD: {record.markdownLen} caracteres</span>
        {record.projectId ? <span className="font-mono">Proyecto: {record.projectId}</span> : null}
      </div>
    </div>
  );
}

export function MddEvalRunResults({ run, onViewMarkdown }: MddEvalRunResultsProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const agg = run.aggregates;

  const toggle = (caseId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(caseId)) next.delete(caseId);
      else next.add(caseId);
      return next;
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
        <span>{formatDateTime(run.startedAt)}</span>
        <span className="font-mono text-xs text-[var(--foreground-muted)]">{run.runId}</span>
        {run.gitSha ? (
          <span className="font-mono text-xs text-[var(--foreground-muted)]">git {run.gitSha.slice(0, 7)}</span>
        ) : null}
      </div>

      {run.error ? (
        <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-3 text-sm text-[var(--destructive)]">
          {run.error}
        </p>
      ) : null}

      {agg ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Casos" value={`${agg.passed}/${agg.cases} PASS`} />
          <Stat label="Aprobación" value={formatPercent(agg.passRate)} />
          <Stat label="Rúbrica prom." value={formatScore(agg.avgRubric)} />
          <Stat label="Auditor prom." value={formatScore(agg.avgAuditor)} />
          <Stat label="Duración prom." value={formatDuration(agg.avgDurationMs)} />
          <Stat label="Coste total" value={formatCost(agg.totalCostUsd)} />
        </div>
      ) : null}

      {run.records.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--foreground-muted)]">
          Esta corrida no tiene resultados por caso.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-[var(--border)]">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead className="bg-[var(--muted)]/50 text-left text-xs uppercase tracking-wide text-[var(--foreground-muted)]">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-3 py-2">Caso</th>
                <th className="px-3 py-2">Complejidad</th>
                <th className="px-3 py-2 text-right">Rúbrica</th>
                <th className="px-3 py-2 text-right">Auditor</th>
                <th className="px-3 py-2">Gate</th>
                <th className="px-3 py-2 text-right">%</th>
                <th className="px-3 py-2 text-right">Duración</th>
                <th className="px-3 py-2 text-right">Coste</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {run.records.map((record) => {
                const open = expanded.has(record.caseId);
                const blockers = record.gateBlockers.length;
                return (
                  <Fragment key={record.caseId}>
                    <tr
                      className="cursor-pointer border-t border-[var(--border)] align-top hover:bg-[var(--muted)]/30"
                      onClick={() => toggle(record.caseId)}
                    >
                      <td className="px-2 py-2">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? "Contraer" : "Expandir"} ${record.caseId}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(record.caseId);
                          }}
                          className="rounded p-0.5 text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
                        >
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{record.caseId}</td>
                      <td className="px-3 py-2">
                        <Badge variant={complexityTone(record.complexity)}>{complexityLabel(record.complexity)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">{formatScore(record.rubric.total)}</td>
                      <td className="px-3 py-2 text-right">{formatScore(record.auditorScore)}</td>
                      <td className="px-3 py-2">
                        {record.gateOk === undefined ? (
                          "—"
                        ) : record.gateOk ? (
                          <Badge variant="success">OK</Badge>
                        ) : (
                          <Badge variant="destructive">{blockers} bloq.</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">{formatPoints(record.precision)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">{formatDuration(record.durationMs)}</td>
                      <td className="px-3 py-2 text-right">{formatCost(record.costUsd)}</td>
                      <td className="px-3 py-2">
                        <Badge variant={record.passed ? "success" : "destructive"}>{passLabel(record.passed)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={!record.hasMarkdown}
                          onClick={(e) => {
                            e.stopPropagation();
                            onViewMarkdown(record.caseId);
                          }}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Ver MDD
                        </Button>
                      </td>
                    </tr>
                    {open ? (
                      <tr className="bg-[var(--muted)]/20">
                        <td colSpan={11}>
                          <RecordDetail record={record} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

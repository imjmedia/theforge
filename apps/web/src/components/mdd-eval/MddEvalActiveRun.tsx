import { useEffect, useState } from "react";
import { Loader2, OctagonX } from "lucide-react";
import type { MddEvalRunDto } from "@theforge/shared-types";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import {
  elapsedSince,
  formatDuration,
  progressPercent,
  runStatusLabel,
  runStatusTone,
} from "@/utils/mddEvalFormat";

interface MddEvalActiveRunProps {
  run: MddEvalRunDto;
  cancelling: boolean;
  onCancel: () => void;
  pollError?: string;
}

export function MddEvalActiveRun({ run, cancelling, onCancel, pollError }: MddEvalActiveRunProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { done, total, running, lastMessage } = run.progress;
  const pct = progressPercent(done, total);
  const elapsed = elapsedSince(run.startedAt, now);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--primary)]" aria-hidden />
          Corrida activa
          <Badge variant={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
          <span className="font-mono text-xs font-normal text-[var(--foreground-muted)]">{run.runId}</span>
        </CardTitle>
        <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={cancelling}>
          {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <OctagonX className="h-4 w-4" />}
          Cancelar
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-[var(--foreground-muted)]">
            <span>
              {done} de {total} casos
            </span>
            <span>
              {pct}% · {formatDuration(elapsed)}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label="Progreso de la evaluación"
            className="h-2 overflow-hidden rounded-full bg-[var(--muted)]"
          >
            <div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>

        {running.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="text-[var(--foreground-muted)]">En ejecución:</span>
            {running.map((id) => (
              <Badge key={id} variant="outline" className="font-mono font-normal">
                {id}
              </Badge>
            ))}
          </div>
        ) : null}

        {lastMessage ? <p className="text-sm text-[var(--foreground)]">{lastMessage}</p> : null}
        {run.status === "queued" ? (
          <p className="text-xs text-[var(--foreground-muted)]">En cola, esperando a un worker…</p>
        ) : null}
        {pollError ? (
          <p role="alert" className="text-xs text-[var(--warning)]">
            {pollError}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Activity,
  ChevronDown,
  Info,
  Loader2,
  OctagonX,
  RefreshCw,
} from "lucide-react";
import type { AdminWorkerJobRow, AdminWorkerJobsSnapshot } from "@theforge/shared-types";
import { ADMIN_WORKER_JOB_QUEUE_LABELS } from "@theforge/shared-types";
import { api } from "@/lib/api";
import { ListRowIconButton } from "@/components/ListRowIconButton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<AdminWorkerJobRow["status"], string> = {
  queued: "En cola",
  active: "En ejecución",
  retrying: "Reintentando",
  cancelling: "Cancelando",
};

const RUNTIME_ROLE_LABELS: Record<AdminWorkerJobsSnapshot["runtimeRole"], string> = {
  all: "API + worker",
  http: "Solo API",
  worker: "Solo worker",
};

const STORAGE_LABELS: Record<AdminWorkerJobRow["storage"], string> = {
  bullmq: "BullMQ (Redis)",
  "in-memory": "En memoria",
};

/** Etiquetas legibles (ES) para valores técnicos en `progressSummary`. */
const PROGRESS_STEP_LABELS: Record<string, string> = {
  mdd_canonical: "MDD canónico",
  spec: "Spec",
  architecture: "Arquitectura",
  use_cases: "Casos de uso",
  blueprint: "Blueprint",
  api_contracts: "Contratos API",
  logic_flows: "Flujos de lógica",
  ux_ui_guide: "Guía UX/UI",
  user_stories: "Historias de usuario",
  agent_governance: "Gobernanza de agentes",
  tasks: "Tareas",
  infra: "Infraestructura",
  preflight: "Comprobación inicial",
  legacy_deliverables: "Entregables legacy",
};

const PROGRESS_PHASE_LABELS: Record<string, string> = {
  active: "En ejecución",
  done: "Completado",
  draft: "Borrador",
  persisted: "Persistido",
  cache: "Caché",
  section: "Sección MDD",
  "section-pipeline": "Pipeline de sección",
  legacy: "Legacy",
  "upstream-sync": "Sincronización upstream",
  legacy_deliverables: "Cascada legacy",
  planner: "Planificación",
  auditor: "Auditoría",
  repair: "Reparación",
  redactor: "Redacción",
  "pattern-compat": "Compatibilidad de patrones",
};

const PROGRESS_FIELD_LABELS: Record<string, string> = {
  step: "Paso",
  phase: "Fase",
  message: "Mensaje",
  agent: "Agente",
  percent: "Avance",
  index: "Índice",
  total: "Total",
};

function statusVariant(status: AdminWorkerJobRow["status"]): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active") return "default";
  if (status === "cancelling") return "destructive";
  if (status === "retrying") return "secondary";
  return "outline";
}

function formatCreatedAt(ts: number | null): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function jobRowKey(job: AdminWorkerJobRow): string {
  return `${job.queue}:${job.jobId}`;
}

function humanizeProgressValue(key: string, value: string): string {
  if (key === "step") return PROGRESS_STEP_LABELS[value] ?? value.replace(/_/g, " ");
  if (key === "phase") return PROGRESS_PHASE_LABELS[value] ?? value.replace(/_/g, " ");
  if (key === "percent") return `${value}%`;
  if (key === "agent") return value;
  return value;
}

function humanizeProgressSummary(raw: string | null): { display: string; parts: { label: string; value: string }[] } {
  if (!raw) return { display: "—", parts: [] };

  const segments = raw.split(" · ");
  const parts: { label: string; value: string }[] = [];

  for (const segment of segments) {
    const colonIdx = segment.indexOf(": ");
    if (colonIdx === -1) {
      parts.push({ label: "Estado", value: segment });
      continue;
    }
    const key = segment.slice(0, colonIdx).trim();
    const value = segment.slice(colonIdx + 2).trim();
    const fieldLabel = PROGRESS_FIELD_LABELS[key] ?? key;
    parts.push({ label: fieldLabel, value: humanizeProgressValue(key, value) });
  }

  const display =
    parts.length > 0
      ? parts
          .map((part) => (part.label === "Mensaje" || part.label === "Agente" ? part.value : `${part.label}: ${part.value}`))
          .join(" · ")
      : raw;

  return { display, parts };
}

function describeRedisLock(job: AdminWorkerJobRow): { summary: string; detail: string[] } {
  const detail: string[] = [];

  if (job.redisCancelKey) {
    detail.push(
      job.redisCancelKeyPresent
        ? "Bandera de cancelación activa en Redis"
        : "Sin bandera de cancelación en Redis",
    );
    detail.push(`Clave: ${job.redisCancelKey}`);
  } else {
    detail.push("Sin clave de cancelación Redis");
  }

  if (job.bullmqLockHeld != null) {
    detail.push(job.bullmqLockHeld ? "Lock BullMQ activo" : "Sin lock BullMQ");
  }

  const summary =
    job.redisCancelKeyPresent
      ? "Cancelación pendiente"
      : job.bullmqLockHeld
        ? "Lock activo"
        : job.redisCancelKey || job.bullmqLockHeld != null
          ? "Normal"
          : "N/A";

  return { summary, detail };
}

function WorkerJobProgressCell({ summary }: { summary: string | null }) {
  const { display } = humanizeProgressSummary(summary);
  if (!summary || display === "—") {
    return <span className="text-[var(--foreground-muted)]">—</span>;
  }

  return (
    <TooltipProvider delayDuration={280}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="line-clamp-2 cursor-help text-[var(--foreground)]">{display}</span>
        </TooltipTrigger>
        <TooltipContent side="top" align="start" className="max-w-sm font-mono text-xs">
          {summary}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function WorkerJobDetailPanel({ job }: { job: AdminWorkerJobRow }) {
  const redisLock = describeRedisLock(job);

  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Cola</p>
        <p>{ADMIN_WORKER_JOB_QUEUE_LABELS[job.queue]}</p>
        <p className="font-mono text-xs text-[var(--foreground-muted)]">{job.queue}</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Almacenamiento</p>
        <Badge variant="outline">{STORAGE_LABELS[job.storage]}</Badge>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Creado</p>
        <p className="text-[var(--foreground)]">{formatCreatedAt(job.createdAt)}</p>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Redis / lock</p>
        <p>{redisLock.summary}</p>
        <ul className="mt-1 space-y-0.5 font-mono text-xs text-[var(--foreground-muted)]">
          {redisLock.detail.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="space-y-1 sm:col-span-2 lg:col-span-3">
        <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">ID del job</p>
        <p className="break-all font-mono text-xs text-[var(--foreground-muted)]">{job.jobId}</p>
      </div>
    </div>
  );
}

export function WorkerJobsConfigCard() {
  const [snapshot, setSnapshot] = useState<AdminWorkerJobsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [stoppingJobId, setStoppingJobId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [expandedJobKey, setExpandedJobKey] = useState<string | null>(null);
  const [stopConfirmJob, setStopConfirmJob] = useState<AdminWorkerJobRow | null>(null);

  const fetchSnapshot = useCallback(async () => {
    setError("");
    try {
      const res = await api.get("/api/admin/worker-jobs");
      if (!res.ok) {
        if (res.status === 403) throw new Error("Se requiere rol admin o super_admin");
        throw new Error("No se pudieron cargar los jobs activos");
      }
      setSnapshot((await res.json()) as AdminWorkerJobsSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
    const timer = window.setInterval(() => {
      void fetchSnapshot();
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [fetchSnapshot]);

  const handleStop = async (job: AdminWorkerJobRow) => {
    setStoppingJobId(job.jobId);
    setActionMessage("");
    setError("");
    try {
      const res = await api.post(`/api/admin/worker-jobs/${encodeURIComponent(job.jobId)}/stop`, {
        queue: job.queue,
        projectId: job.projectId,
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { message?: string | string[] };
        const msg = Array.isArray(payload.message) ? payload.message.join("; ") : payload.message;
        throw new Error(msg ?? "No se pudo detener el job");
      }
      const result = (await res.json()) as { status: string; cancelled: boolean };
      setActionMessage(
        result.cancelled
          ? job.queue === "mdd"
            ? `Job ${job.jobId.slice(0, 8)}… detenido (${result.status}). El flujo MDD del proyecto se conserva; reanuda desde el Workshop.`
            : `Job ${job.jobId.slice(0, 8)}… detenido (${result.status})`
          : `Job ${job.jobId.slice(0, 8)}…: ${result.status}`,
      );
      setStopConfirmJob(null);
      await fetchSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al detener el job");
    } finally {
      setStoppingJobId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 shrink-0 text-[var(--primary)]" />
            Jobs de workers activos
          </CardTitle>
          <CardDescription>
            Monitorea colas BullMQ/in-memory y detén workers en ejecución sin borrar el flujo MDD del
            proyecto (checkpoint LangGraph, threadId y borradores en BD). Requiere workers con{" "}
            <code className="text-xs">THEFORGE_RUNTIME_ROLE=worker|all</code> para consumir la cola Redis.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setLoading(true);
            void fetchSnapshot();
          }}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {error ? (
          <p className="rounded-md border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-3 py-2 text-sm text-[var(--destructive)]">
            {error}
          </p>
        ) : null}
        {actionMessage ? (
          <p className="rounded-md border border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-sm text-[var(--foreground)]">
            {actionMessage}
          </p>
        ) : null}

        {snapshot ? (
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Resumen del runtime</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{RUNTIME_ROLE_LABELS[snapshot.runtimeRole]}</Badge>
              <Badge variant={snapshot.redisConfigured ? "default" : "outline"}>
                Redis {snapshot.redisConfigured ? "configurado" : "no configurado"}
              </Badge>
              {snapshot.mddStreamProjectIds.length > 0 ? (
                <Badge variant="outline">
                  {snapshot.mddStreamProjectIds.length} stream
                  {snapshot.mddStreamProjectIds.length === 1 ? "" : "s"} MDD activo
                  {snapshot.mddStreamProjectIds.length === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">Colas</p>
              <div className="flex flex-col gap-2">
                {snapshot.queues.map((queue) => (
                  <div
                    key={queue.queue}
                    className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/10 px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                      <span className="text-sm font-medium">{ADMIN_WORKER_JOB_QUEUE_LABELS[queue.queue]}</span>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                        <Badge variant="outline">{STORAGE_LABELS[queue.storage]}</Badge>
                        {queue.localWorkerRunning ? <Badge>Worker local</Badge> : null}
                        <Badge variant="secondary">
                          {queue.jobCounts.waiting} en espera · {queue.jobCounts.active} activos ·{" "}
                          {queue.jobCounts.delayed} retrasados
                        </Badge>
                      </div>
                    </div>
                    {queue.redisWorkers.length > 0 ? (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-[var(--foreground-muted)]">Workers Redis:</span>
                        {queue.redisWorkers.map((worker) => (
                          <Badge key={worker} variant="outline" className="font-mono text-[10px]">
                            {worker}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs text-[var(--foreground-muted)]">Sin workers Redis registrados</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        {loading && !snapshot ? (
          <div className="flex items-center justify-center py-10 text-[var(--foreground-muted)]">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Cargando jobs…
          </div>
        ) : null}

        {!loading && snapshot && snapshot.jobs.length === 0 ? (
          <EmptyState
            title="Sin jobs activos"
            description="No hay trabajos en cola ni en ejecución en este momento."
          />
        ) : null}

        {snapshot && snapshot.jobs.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--foreground)]">Jobs activos</h3>
              <Badge variant="outline">{snapshot.jobs.length}</Badge>
            </div>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-[var(--muted)]/30 text-left text-xs text-[var(--foreground-muted)]">
                  <tr>
                    <th className="w-[28%] px-3 py-2.5 font-medium">Proyecto</th>
                    <th className="w-[22%] px-3 py-2.5 font-medium">Acción</th>
                    <th className="w-[14%] px-3 py-2.5 font-medium">Estado</th>
                    <th className="w-[26%] px-3 py-2.5 font-medium">Progreso</th>
                    <th className="w-[10%] px-3 py-2.5 text-right font-medium">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {snapshot.jobs.map((job) => {
                    const rowKey = jobRowKey(job);
                    const expanded = expandedJobKey === rowKey;
                    const stopDisabled = stoppingJobId === job.jobId;
                    const forceCancel = job.status === "cancelling";

                    return (
                      <Fragment key={rowKey}>
                        <tr className="align-middle">
                          <td className="px-3 py-3">
                            <p className="truncate font-medium" title={job.projectName ?? job.projectId}>
                              {job.projectName ?? job.projectId}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="line-clamp-2 text-[var(--foreground)]">{job.actionLabel}</p>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant={statusVariant(job.status)}>{STATUS_LABELS[job.status]}</Badge>
                          </td>
                          <td className="px-3 py-3">
                            <WorkerJobProgressCell summary={job.progressSummary} />
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <ListRowIconButton
                                variant="outline"
                                tooltip={expanded ? "Ocultar detalle" : "Ver detalle técnico"}
                                aria-expanded={expanded}
                                onClick={() => setExpandedJobKey(expanded ? null : rowKey)}
                              >
                                <ChevronDown
                                  className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
                                  aria-hidden
                                />
                              </ListRowIconButton>
                              <ListRowIconButton
                                variant="destructive"
                                tooltip={forceCancel ? "Forzar cancelación (job atascado)" : "Detener job"}
                                disabled={stopDisabled}
                                onClick={() => setStopConfirmJob(job)}
                              >
                                {stoppingJobId === job.jobId ? (
                                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                ) : (
                                  <OctagonX className="h-4 w-4" aria-hidden />
                                )}
                              </ListRowIconButton>
                            </div>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-[var(--muted)]/15">
                            <td colSpan={5} className="border-t border-[var(--border)]/60 px-4 py-3">
                              <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
                                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                Detalle técnico del job
                              </div>
                              <WorkerJobDetailPanel job={job} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </CardContent>

      <AlertDialog
        open={stopConfirmJob != null}
        onOpenChange={(open) => {
          if (!open && !stoppingJobId) setStopConfirmJob(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {stopConfirmJob?.status === "cancelling" ? "¿Forzar cancelación?" : "¿Detener este job?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-[var(--muted-foreground)]">
                <p>
                  {stopConfirmJob?.status === "cancelling"
                    ? "El job sigue activo en Redis tras una cancelación previa. Se forzará el fallo en BullMQ y se limpiará la clave de cancelación."
                    : "Se solicitará la cancelación del job"}{" "}
                  <span className="font-mono">{stopConfirmJob?.jobId.slice(0, 8)}…</span> en la cola{" "}
                  {stopConfirmJob ? ADMIN_WORKER_JOB_QUEUE_LABELS[stopConfirmJob.queue] : ""}.
                </p>
                {stopConfirmJob?.queue === "mdd" ? (
                  <p>
                    El flujo MDD del proyecto (checkpoint LangGraph, threadId y borradores) se conserva; podrás
                    reanudar desde el Workshop.
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={stoppingJobId != null}>Cancelar</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={stoppingJobId != null || stopConfirmJob == null}
              onClick={() => {
                if (stopConfirmJob) void handleStop(stopConfirmJob);
              }}
            >
              {stoppingJobId != null ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Deteniendo…
                </>
              ) : stopConfirmJob?.status === "cancelling" ? (
                "Forzar cancelación"
              ) : (
                "Detener job"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

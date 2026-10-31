import { useCallback, useEffect, useState } from "react";
import { FlaskConical, GitCompare, ListChecks, Loader2, RefreshCw, Table2 } from "lucide-react";
import type { MddEvalCaseSummaryDto, MddEvalRunDto } from "@theforge/shared-types";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  UnderlineTabs,
  type UnderlineTabItem,
} from "@/components/ui";
import { MddEvalActiveRun } from "@/components/mdd-eval/MddEvalActiveRun";
import { MddEvalCaseDetailDialog } from "@/components/mdd-eval/MddEvalCaseDetailDialog";
import { MddEvalCasesTable } from "@/components/mdd-eval/MddEvalCasesTable";
import { MddEvalCompare } from "@/components/mdd-eval/MddEvalCompare";
import {
  MddEvalMarkdownDialog,
  type MddEvalMarkdownTarget,
} from "@/components/mdd-eval/MddEvalMarkdownDialog";
import { MddEvalRunControls } from "@/components/mdd-eval/MddEvalRunControls";
import { MddEvalRunResults } from "@/components/mdd-eval/MddEvalRunResults";
import { MddEvalRunsList } from "@/components/mdd-eval/MddEvalRunsList";
import {
  cancelMddEvalRun,
  fetchMddEvalCases,
  fetchMddEvalRun,
  fetchMddEvalRuns,
  pollMddEvalRun,
  startMddEvalRun,
} from "@/utils/mddEvalApi";
import { isActiveRunStatus } from "@/utils/mddEvalFormat";

type PanelTab = "cases" | "results" | "compare";

const PANEL_TABS: UnderlineTabItem<PanelTab>[] = [
  { id: "cases", label: "Casos", icon: ListChecks },
  { id: "results", label: "Resultados", icon: Table2 },
  { id: "compare", label: "Comparar", icon: GitCompare },
];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

function byNewest(runs: MddEvalRunDto[]): MddEvalRunDto[] {
  return [...runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-[var(--foreground-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-3 text-sm text-[var(--destructive)]">
      {message}
    </p>
  );
}

/**
 * Pestaña "Evaluación MDD" de Ajustes (solo admin; `SettingsView` la oculta y el API responde 403
 * a no-admins). Ejecuta el conjunto de evaluación, sigue el progreso, muestra resultados y compara corridas.
 */
export function MddEvalPanel() {
  const [tab, setTab] = useState<PanelTab>("cases");

  const [cases, setCases] = useState<MddEvalCaseSummaryDto[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [detailCaseId, setDetailCaseId] = useState<string | null>(null);

  const [concurrency, setConcurrency] = useState(1);
  const [keepProjects, setKeepProjects] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const [runs, setRuns] = useState<MddEvalRunDto[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState("");

  const [activeRun, setActiveRun] = useState<MddEvalRunDto | null>(null);
  const [pollError, setPollError] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<MddEvalRunDto | null>(null);
  const [selectedRunLoading, setSelectedRunLoading] = useState(false);
  const [selectedRunError, setSelectedRunError] = useState("");
  const [markdownTarget, setMarkdownTarget] = useState<MddEvalMarkdownTarget | null>(null);

  const activeRunId = activeRun?.runId ?? null;

  const loadRuns = useCallback(async (): Promise<MddEvalRunDto[]> => {
    setRunsError("");
    try {
      const list = byNewest(await fetchMddEvalRuns());
      setRuns(list);
      return list;
    } catch (err) {
      setRunsError(errorMessage(err, "No se pudieron cargar las corridas."));
      return [];
    } finally {
      setRunsLoading(false);
    }
  }, []);

  // Carga inicial: casos y corridas (si hay una activa, se retoma el seguimiento).
  useEffect(() => {
    let cancelled = false;
    fetchMddEvalCases()
      .then((list) => {
        if (cancelled) return;
        setCases(list);
        setSelected(new Set(list.map((c) => c.id)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setCasesError(errorMessage(err, "No se pudieron cargar los casos."));
      })
      .finally(() => {
        if (!cancelled) setCasesLoading(false);
      });
    void loadRuns().then((list) => {
      if (cancelled) return;
      const live = list.find((r) => isActiveRunStatus(r.status));
      if (live) setActiveRun(live);
      else if (list[0]) setSelectedRunId(list[0].runId);
    });
    return () => {
      cancelled = true;
    };
  }, [loadRuns]);

  // Sondeo de la corrida activa: 3 s (10 s tras 5 min); se detiene en estado terminal.
  useEffect(() => {
    if (!activeRunId) return;
    const controller = new AbortController();
    setPollError("");
    pollMddEvalRun(activeRunId, {
      signal: controller.signal,
      onUpdate: (run) => {
        setPollError("");
        setActiveRun(run);
      },
      onTransientError: (err) =>
        setPollError(`Reintentando seguimiento… (${errorMessage(err, "error de red")})`),
    })
      .then(async (finished) => {
        if (!finished || controller.signal.aborted) return;
        await loadRuns();
        setActiveRun(null);
        setCancelling(false);
        setSelectedRunId(finished.runId);
        setSelectedRun(finished);
        setTab("results");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setPollError(errorMessage(err, "Se perdió el seguimiento de la corrida."));
        setActiveRun(null);
        setCancelling(false);
        void loadRuns();
      });
    return () => controller.abort();
  }, [activeRunId, loadRuns]);

  // Detalle de la corrida seleccionada en la pestaña Resultados.
  useEffect(() => {
    if (!selectedRunId) {
      setSelectedRun(null);
      return;
    }
    let cancelled = false;
    setSelectedRunError("");
    setSelectedRunLoading(true);
    fetchMddEvalRun(selectedRunId)
      .then((run) => {
        if (!cancelled) setSelectedRun(run);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSelectedRun(null);
          setSelectedRunError(errorMessage(err, "No se pudo cargar la corrida."));
        }
      })
      .finally(() => {
        if (!cancelled) setSelectedRunLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  const handleStart = async () => {
    setStarting(true);
    setStartError("");
    try {
      const allSelected = cases.length > 0 && cases.every((c) => selected.has(c.id));
      const run = await startMddEvalRun({
        caseIds: allSelected ? undefined : [...selected],
        concurrency,
        keepProjects,
      });
      setActiveRun(run);
      void loadRuns();
    } catch (err) {
      setStartError(errorMessage(err, "No se pudo iniciar la evaluación."));
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeRunId) return;
    setCancelling(true);
    try {
      const run = await cancelMddEvalRun(activeRunId);
      setActiveRun(run);
    } catch (err) {
      setPollError(errorMessage(err, "No se pudo cancelar la corrida."));
      setCancelling(false);
    }
  };

  const runActive = activeRun !== null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 shrink-0 text-[var(--primary)]" />
            Evaluación MDD
          </CardTitle>
          <CardDescription>
            Ejecuta el conjunto de casos de evaluación del generador de MDD, sigue el progreso, revisa la
            rúbrica y el auditor por caso y compara corridas entre sí. Solo administradores.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={runsLoading}
          onClick={() => {
            setRunsLoading(true);
            void loadRuns();
          }}
        >
          {runsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </CardHeader>

      <CardContent className="space-y-5">
        {activeRun ? (
          <MddEvalActiveRun run={activeRun} cancelling={cancelling} onCancel={() => void handleCancel()} pollError={pollError} />
        ) : pollError ? (
          <ErrorNote message={pollError} />
        ) : null}

        <UnderlineTabs
          tabs={PANEL_TABS}
          value={tab}
          onValueChange={setTab}
          ariaLabel="Secciones de la evaluación MDD"
          idPrefix="mdd-eval"
        />

        {tab === "cases" ? (
          <div className="space-y-4" role="tabpanel" id="mdd-eval-panel-cases" aria-labelledby="mdd-eval-tab-cases">
            {casesLoading ? <Loading label="Cargando casos…" /> : null}
            {casesError ? <ErrorNote message={casesError} /> : null}
            {!casesLoading && !casesError && cases.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--foreground-muted)]">
                No hay casos de evaluación disponibles.
              </p>
            ) : null}
            {cases.length > 0 ? (
              <>
                <MddEvalCasesTable
                  cases={cases}
                  selected={selected}
                  onSelectionChange={setSelected}
                  onOpenDetail={setDetailCaseId}
                  disabled={runActive}
                />
                <MddEvalRunControls
                  selectedCount={selected.size}
                  concurrency={concurrency}
                  onConcurrencyChange={setConcurrency}
                  keepProjects={keepProjects}
                  onKeepProjectsChange={setKeepProjects}
                  onStart={() => void handleStart()}
                  starting={starting}
                  runActive={runActive}
                />
                {startError ? <ErrorNote message={startError} /> : null}
              </>
            ) : null}
          </div>
        ) : null}

        {tab === "results" ? (
          <div className="space-y-4" role="tabpanel" id="mdd-eval-panel-results" aria-labelledby="mdd-eval-tab-results">
            {runsLoading && runs.length === 0 ? <Loading label="Cargando corridas…" /> : null}
            {runsError ? <ErrorNote message={runsError} /> : null}
            {!runsLoading && !runsError && runs.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--foreground-muted)]">
                Aún no hay corridas. Ejecuta una evaluación desde la pestaña «Casos».
              </p>
            ) : null}
            {runs.length > 0 ? (
              <>
                <MddEvalRunsList runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
                {selectedRunLoading ? <Loading label="Cargando corrida…" /> : null}
                {selectedRunError ? <ErrorNote message={selectedRunError} /> : null}
                {selectedRun && !selectedRunLoading ? (
                  isActiveRunStatus(selectedRun.status) ? (
                    <p className="text-sm text-[var(--foreground-muted)]">
                      Esta corrida sigue en curso; los resultados aparecerán al terminar.
                    </p>
                  ) : (
                    <MddEvalRunResults
                      run={selectedRun}
                      onViewMarkdown={(caseId) => setMarkdownTarget({ runId: selectedRun.runId, caseId })}
                    />
                  )
                ) : null}
                {!selectedRunId ? (
                  <p className="text-sm text-[var(--foreground-muted)]">Selecciona una corrida para ver sus resultados.</p>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        {tab === "compare" ? (
          <div className="space-y-4" role="tabpanel" id="mdd-eval-panel-compare" aria-labelledby="mdd-eval-tab-compare">
            {runsLoading && runs.length === 0 ? <Loading label="Cargando corridas…" /> : null}
            {runsError ? <ErrorNote message={runsError} /> : null}
            {!runsLoading || runs.length > 0 ? <MddEvalCompare runs={runs} /> : null}
          </div>
        ) : null}
      </CardContent>

      <MddEvalCaseDetailDialog caseId={detailCaseId} onClose={() => setDetailCaseId(null)} />
      <MddEvalMarkdownDialog target={markdownTarget} onClose={() => setMarkdownTarget(null)} />
    </Card>
  );
}

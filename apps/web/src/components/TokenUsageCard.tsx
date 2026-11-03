/**
 * @fileoverview Sección colapsable que muestra el consumo de tokens por documento
 * generado (incluyendo regeneraciones) con cálculo USD/MXN a partir del catálogo
 * de pricing del proveedor IA activo.
 *
 * Patrón visual: `<details>` nativo con marker oculto (mismo estilo que el resto
 * de métricas en `WorkshopMetricsColumnInner.tsx`).
 *
 * El contrato de respuesta vive en `@theforge/shared-types` (`token-usage-api.ts`).
 */
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Coins, Info, Loader2 } from "lucide-react";
import type {
  TokenUsageDocumentSummary,
  TokenUsageModelSummary,
  TokenUsageSummary,
} from "@theforge/shared-types";
import { cn } from "@/lib/utils";
import { apiFetch, API_BASE } from "@/utils/apiClient";

const DOCUMENT_LABELS: Record<string, string> = {
  mddContent: "MDD",
  specContent: "Spec",
  architectureContent: "Arquitectura",
  useCasesContent: "Casos de uso",
  blueprintContent: "Blueprint",
  tasksContent: "Tasks",
  apiContractsContent: "Contratos API",
  logicFlowsContent: "Lógica y edge cases",
  infraContent: "Infraestructura",
  agentGovernanceContent: "Gobernanza IA",
  uxUiGuideContent: "Guía UX/UI",
  phase0SummaryContent: "Fase 0 (resumen)",
  aemContent: "AEM",
  uiScreensContent: "UI Screens",
  brdContent: "BRD",
  dbgaContent: "Benchmark (DBGA)",
  chat: "Chat del Workshop",
};

const CARD_BASE =
  "rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--card)_78%,var(--background))]";

const FAILED_CALLS_TITLE =
  "Llamadas que fallaron por error, timeout o cancelación; no se facturan";
const ESTIMATED_COST_TITLE =
  "Parte de las llamadas no trajo uso real del proveedor: tokens estimados (caracteres/4).";
const UNKNOWN_COST_TITLE =
  "Hay llamadas con tokens sin tarifa en el catálogo: el coste mostrado no es completo.";

const FAILED_TONE = "text-[color-mix(in_oklch,var(--destructive)_86%,var(--foreground))]";
const BADGE_BASE =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap";
const BADGE_INFO =
  "bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]";
const BADGE_WARN =
  "bg-[color-mix(in_oklch,var(--destructive)_12%,transparent)] text-[color-mix(in_oklch,var(--destructive)_86%,var(--foreground))]";

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function formatMxn(n: number): string {
  return `$${n.toFixed(2)} MXN`;
}

/** Sin tarifa y sin importe, el "$0" sería engañoso: se muestra el rótulo en su lugar. */
function usdText(amount: number, costUnknown: boolean): string {
  if (costUnknown && amount === 0) return "coste desconocido";
  return `${formatUsd(amount)} USD`;
}

/** En columnas MXN sin importe conocido se muestra un guion en vez de $0. */
function mxnCellText(amount: number, costUnknown: boolean): string {
  if (costUnknown && amount === 0) return "—";
  return formatMxn(amount);
}

function formatModelLabel(providerId: string, modelId: string): string {
  if (providerId === "openrouter") {
    const stripped = modelId.replace(/^openai\/|^anthropic\/|^google\//, "");
    return `openrouter / ${stripped}`;
  }
  return `${providerId} / ${modelId}`;
}

function formatDocumentLabel(field: string): string {
  return DOCUMENT_LABELS[field] ?? field;
}

function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("es-MX", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** "(+N fallidas)" con tooltip explicativo; no renderiza nada si no hay fallidas. */
function FailedCallsNote({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span className={cn(FAILED_TONE, className)} title={FAILED_CALLS_TITLE}>
      (+{formatNumber(count)} fallidas)
    </span>
  );
}

interface CostCellProps {
  amount: number;
  format: (n: number) => string;
  costUnknown: boolean;
  estimated: boolean;
}

/**
 * Importe con rótulos: "coste desconocido" sustituye al $0 cuando no hay tarifa (y acompaña a un
 * importe parcial), y "coste estimado" marca importes calculados con tokens estimados.
 */
function CostCell({ amount, format, costUnknown, estimated }: CostCellProps) {
  const showAmount = !(costUnknown && amount === 0);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
      {showAmount ? <span>{format(amount)}</span> : null}
      {costUnknown ? (
        <span className={cn(BADGE_BASE, BADGE_WARN)} title={UNKNOWN_COST_TITLE}>
          coste desconocido
        </span>
      ) : null}
      {estimated ? (
        <span className={cn(BADGE_BASE, BADGE_INFO)} title={ESTIMATED_COST_TITLE}>
          coste estimado
        </span>
      ) : null}
    </span>
  );
}

export interface TokenUsageCardProps {
  projectId: string;
  stageId?: string;
}

export function TokenUsageCard({ projectId, stageId }: TokenUsageCardProps) {
  const [summary, setSummary] = useState<TokenUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ projectId });
      if (stageId) params.set("stageId", stageId);
      const response = await apiFetch(
        `${API_BASE}/ai-analysis/token-usage?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = (await response.json()) as TokenUsageSummary;
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [projectId, stageId]);

  useEffect(() => {
    if (open && !summary && !loading) {
      void fetchSummary();
    }
  }, [open, summary, loading, fetchSummary]);

  // Refrescar cuando el documento etapa cambie (entre regeneraciones)
  useEffect(() => {
    setSummary(null);
  }, [projectId, stageId]);

  if (!summary && !loading && !error) {
    return (
      <details
        className="group shrink-0"
        open={open}
        onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-1.5 px-0.5 py-1 text-sm font-semibold tracking-tight text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-0"
            aria-hidden
          />
          <Coins className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          Consumo IA (tokens &amp; coste)
          <span
            className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]"
            title="Conversión USD→MXN estimada; el usuario la mantiene en Ajustes → Sistema. No es un feed live."
          >
            <Info className="h-2.5 w-2.5" aria-hidden />
            MXN estimado
          </span>
        </summary>
        <div className={cn(CARD_BASE, "px-3 py-2.5 text-[11px] leading-snug")}>
          <p className="text-[color-mix(in_oklch,var(--muted-foreground)_92%,var(--foreground))]">
            Aún no hay telemetría registrada para este proyecto. Empieza una generación de
            MDD, Spec, Blueprint, etc. para empezar a trackear uso de tokens.
          </p>
        </div>
      </details>
    );
  }

  return (
    <details
      className="group shrink-0"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-0.5 py-1 text-sm font-semibold tracking-tight text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-0"
          aria-hidden
        />
        <Coins className="h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]" aria-hidden />
        Consumo IA (tokens &amp; coste)
        <span
          className="ml-1 inline-flex items-center gap-0.5 rounded-full bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] px-1.5 py-0.5 text-[10px] font-medium text-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]"
          title="Conversión USD→MXN estimada; el usuario la mantiene en Ajustes → Sistema. No es un feed live."
        >
          <Info className="h-2.5 w-2.5" aria-hidden />
          MXN estimado
        </span>
      </summary>
      <div className={cn(CARD_BASE, "space-y-2 overflow-hidden p-0 text-[11px] leading-snug")}>
        {loading ? (
          <div className="flex items-center gap-2 px-3 py-2.5 text-[color-mix(in_oklch,var(--muted-foreground)_88%,var(--foreground))]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Cargando telemetría de tokens…
          </div>
        ) : error ? (
          <div className="px-3 py-2.5 text-[color-mix(in_oklch,var(--destructive)_86%,var(--foreground))]">
            Error al cargar: {error}
          </div>
        ) : summary ? (
          <TokenUsageBody summary={summary} />
        ) : null}
      </div>
    </details>
  );
}

function TokenUsageBody({ summary }: { summary: TokenUsageSummary }) {
  const documents = summary.documents;
  if (documents.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[color-mix(in_oklch,var(--muted-foreground)_92%,var(--foreground))]">
        Sin generaciones registradas todavía.
      </p>
    );
  }

  const totals = documents.reduce(
    (acc, doc) => ({
      calls: acc.calls + doc.generations,
      failed: acc.failed + (doc.failedCalls ?? 0),
      estimated: acc.estimated + (doc.estimatedCalls ?? 0),
      costUnknown: acc.costUnknown || doc.costUnknown === true,
    }),
    { calls: 0, failed: 0, estimated: 0, costUnknown: false },
  );

  return (
    <div>
      <div className="border-b border-[var(--border)]/60 bg-[color-mix(in_oklch,var(--muted)_18%,transparent)] px-3 py-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] font-medium text-[color-mix(in_oklch,var(--foreground)_94%,var(--muted-foreground))]">
            Total acumulado
          </span>
          <span className="text-sm font-semibold tabular-nums text-[var(--foreground)]">
            <CostCell
              amount={summary.totalCostMxn}
              format={formatMxn}
              costUnknown={totals.costUnknown}
              estimated={totals.estimated > 0}
            />
          </span>
        </div>
        <p className="mt-0.5 text-[10px] text-[color-mix(in_oklch,var(--muted-foreground)_94%,var(--foreground))]">
          {formatNumber(totals.calls)} llamadas
          <FailedCallsNote count={totals.failed} className="ml-1" />
          {" · "}
          {usdText(summary.totalCostUsd, totals.costUnknown)} · {formatNumber(summary.totalTokens)} tokens (
          {formatNumber(summary.totalPromptTokens)} in · {formatNumber(summary.totalCompletionTokens)} out) · TC {summary.mxnPerUsd} MXN/USD (estimado)
        </p>
        <p
          className="mt-1 text-[10px] italic text-[color-mix(in_oklch,var(--muted-foreground)_90%,var(--foreground))]"
          title="Los importes en MXN son una estimación calculada con el tipo de cambio configurado en Ajustes → Sistema (no es un feed live)."
        >
          La conversión USD→MXN usa el TC estimado configurado en Ajustes → Sistema; ajústalo si el coste real no encaja.
        </p>
      </div>
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-[color-mix(in_oklch,var(--muted)_10%,transparent)] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th scope="col" className="px-2 py-1 text-left font-medium">
                Documento
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                Regens
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                Tokens
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                USD
              </th>
              <th scope="col" className="px-2 py-1 text-right font-medium">
                MXN (est.)
              </th>
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <DocumentRow key={doc.documentField} doc={doc} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DocumentRow({ doc }: { doc: TokenUsageDocumentSummary }) {
  const costUnknown = doc.costUnknown === true;
  const estimated = (doc.estimatedCalls ?? 0) > 0;
  return (
    <>
      <tr className="border-t border-[var(--border)]/40 align-top">
        <td className="px-2 py-1.5">
          <div className="font-medium text-[var(--foreground)]">
            {formatDocumentLabel(doc.documentField)}
          </div>
          <div className="text-[10px] text-[var(--muted-foreground)]">
            {formatDate(doc.firstAt)} → {formatDate(doc.lastAt)}
          </div>
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[var(--foreground)]">
          {doc.generations}
          <FailedCallsNote count={doc.failedCalls ?? 0} className="block text-[10px]" />
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">
          {formatNumber(doc.totalTokens)}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-[color-mix(in_oklch,var(--foreground)_92%,var(--muted-foreground))]">
          <CostCell
            amount={doc.totalCostUsd}
            format={formatUsd}
            costUnknown={costUnknown}
            estimated={estimated}
          />
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums font-medium text-[var(--foreground)]">
          {mxnCellText(doc.totalCostMxn, costUnknown)}
        </td>
      </tr>
      {doc.byModel.map((m) => (
        <ModelRow key={`${doc.documentField}-${m.providerId}-${m.modelId}`} model={m} />
      ))}
    </>
  );
}

function ModelRow({ model: m }: { model: TokenUsageModelSummary }) {
  const costUnknown = m.costUnknown === true;
  const estimated = (m.estimatedCalls ?? 0) > 0;
  return (
    <tr className="bg-[color-mix(in_oklch,var(--muted)_6%,transparent)]">
      <td className="pl-6 pr-2 py-1 text-[10px] text-[color-mix(in_oklch,var(--muted-foreground)_88%,var(--foreground))]" colSpan={1}>
        {formatModelLabel(m.providerId, m.modelId)}
        <span className="ml-1 text-[var(--muted-foreground)]">({m.calls} call{m.calls === 1 ? "" : "s"})</span>
        <FailedCallsNote count={m.failedCalls ?? 0} className="ml-1" />
      </td>
      <td className="px-2 py-1 text-right text-[10px] text-[var(--muted-foreground)]">
        {formatNumber(m.totalTokens)}
      </td>
      <td className="px-2 py-1 text-right text-[10px] text-[var(--muted-foreground)]">
        <CostCell
          amount={m.costUsd}
          format={formatUsd}
          costUnknown={costUnknown}
          estimated={estimated}
        />
      </td>
      <td className="px-2 py-1 text-right text-[10px] text-[var(--muted-foreground)]">
        {mxnCellText(m.costMxn, costUnknown)}
      </td>
      <td />
    </tr>
  );
}

/**
 * Viewer + download for Ariadne handoff artifacts on LEGACY stages.
 */
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ARIADNE_HANDOFF_KIND_LABELS,
  formatHandoffItemPreview,
  handoffItemDownloadFilename,
  handoffItemIsJsonBody,
  handoffItemKind,
  listAriadneSeedHandoffItems,
  readHandoffItemBody,
} from "@theforge/shared-types";
import type { IntegrationHandoffItem } from "@theforge/shared-types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

function downloadTextFile(filename: string, body: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function HandoffKindBadge({ kind }: { kind: string }) {
  return (
    <Badge variant="outline" className="text-[10px] font-normal uppercase tracking-wide">
      {ARIADNE_HANDOFF_KIND_LABELS[kind] ?? kind}
    </Badge>
  );
}

function HandoffMarkdownPreview({ item }: { item: IntegrationHandoffItem }) {
  const md = readHandoffItemBody(item);
  const [open, setOpen] = useState(false);
  if (!md) return null;
  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Ocultar preview" : "Ver markdown"}
      </button>
      {open ? (
        <div className="prose prose-sm mt-2 max-h-64 max-w-none overflow-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))] p-3 dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md.slice(0, 12000)}</ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

function HandoffSeedItemSummary({ item }: { item: IntegrationHandoffItem }) {
  return (
    <p className="mt-1 text-xs leading-relaxed text-[var(--foreground-muted)] font-mono">
      {formatHandoffItemPreview(item)}
    </p>
  );
}

export { HandoffKindBadge, HandoffMarkdownPreview, HandoffSeedItemSummary };

function HandoffArtifactBody({ item }: { item: IntegrationHandoffItem }) {
  const body = readHandoffItemBody(item);
  const kind = handoffItemKind(item);
  const [open, setOpen] = useState(false);
  if (!body) return null;

  const isMarkdown =
    kind === "cursor_tasks_markdown" ||
    kind === "change_work_description" ||
    (!handoffItemIsJsonBody(item) && body.includes("\n"));

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
          {open ? "Ocultar" : "Ver documento"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            downloadTextFile(
              handoffItemDownloadFilename(item),
              body,
              isMarkdown ? "text/markdown;charset=utf-8" : "application/json;charset=utf-8",
            )
          }
        >
          Descargar
        </Button>
      </div>
      {open ? (
        isMarkdown ? (
          <div className="prose prose-sm max-h-72 max-w-none overflow-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))] p-3 dark:prose-invert">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{body.slice(0, 48_000)}</ReactMarkdown>
          </div>
        ) : (
          <pre className="max-h-72 overflow-auto rounded-md border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))] p-3 text-xs">
            {body.slice(0, 48_000)}
          </pre>
        )
      ) : (
        <p className="text-xs leading-relaxed text-[var(--foreground-muted)] font-mono">
          {formatHandoffItemPreview(item)}
        </p>
      )}
    </div>
  );
}

export function HandoffImportedItemsPreview({ items }: { items: IntegrationHandoffItem[] }) {
  const seedItems = useMemo(() => listAriadneSeedHandoffItems(items), [items]);
  if (!seedItems.length) return null;

  const downloadAll = () => {
    for (const item of seedItems) {
      const body = readHandoffItemBody(item);
      if (!body) continue;
      downloadTextFile(handoffItemDownloadFilename(item), body);
    }
  };

  return (
    <details open className="rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_10%,var(--card))] px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-[var(--foreground)]">
        Documentos Ariadne ({seedItems.length})
      </summary>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={downloadAll}>
          Descargar todos
        </Button>
      </div>
      <ul className="mt-2 space-y-2" role="list">
        {seedItems.map((item) => (
          <li key={item.id} className="rounded border border-[var(--border)] px-2 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-[var(--primary)]">{item.id}</span>
              <HandoffKindBadge kind={handoffItemKind(item)} />
            </div>
            <p className="mt-1 text-xs font-medium">{item.title}</p>
            <HandoffArtifactBody item={item} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function StageOriginBadge({ origin }: { origin: string | null | undefined }) {
  if (!origin || origin === "forge_native") return null;
  const label =
    origin === "ariadne_integration_handoff"
      ? "Origen: Ariadne (integración)"
      : origin === "ariadne_change_pack"
        ? "Origen: Ariadne (cambio)"
        : origin === "integration_promote"
          ? "Origen: Integración NEW→LEG"
          : origin;
  return (
    <Badge variant="secondary" className="font-normal">
      {label}
    </Badge>
  );
}

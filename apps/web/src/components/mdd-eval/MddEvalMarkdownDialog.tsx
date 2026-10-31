import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import MddViewer from "@/components/MddViewer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { fetchMddEvalCaseMarkdown } from "@/utils/mddEvalApi";

export interface MddEvalMarkdownTarget {
  runId: string;
  caseId: string;
}

interface MddEvalMarkdownDialogProps {
  target: MddEvalMarkdownTarget | null;
  onClose: () => void;
}

export function MddEvalMarkdownDialog({ target, onClose }: MddEvalMarkdownDialogProps) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const runId = target?.runId;
  const caseId = target?.caseId;

  useEffect(() => {
    if (!runId || !caseId) return;
    let cancelled = false;
    setMarkdown(null);
    setError("");
    setLoading(true);
    fetchMddEvalCaseMarkdown(runId, caseId)
      .then((text) => {
        if (!cancelled) setMarkdown(text);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el MDD.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, caseId]);

  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="full" className="max-h-[90vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>MDD generado</DialogTitle>
          <DialogDescription>
            <span className="font-mono text-xs">{caseId}</span>
            {runId ? <span className="font-mono text-xs"> · {runId}</span> : null}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[var(--foreground-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando MDD…
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-3 text-sm text-[var(--destructive)]">
            {error}
          </p>
        ) : null}
        {markdown !== null ? (
          markdown.trim() ? (
            <MddViewer content={markdown} className="pb-4" />
          ) : (
            <p className="py-4 text-sm text-[var(--foreground-muted)]">El MDD generado está vacío.</p>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

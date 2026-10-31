import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { MddEvalCaseDetailDto } from "@theforge/shared-types";
import {
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { fetchMddEvalCase } from "@/utils/mddEvalApi";
import { complexityLabel, complexityTone } from "@/utils/mddEvalFormat";

interface MddEvalCaseDetailDialogProps {
  caseId: string | null;
  onClose: () => void;
}

function ChipList({ items, empty = "—" }: { items: string[]; empty?: string }) {
  if (items.length === 0) return <span className="text-[var(--foreground-muted)]">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <Badge key={item} variant="outline" className="font-normal">
          {item}
        </Badge>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--foreground-muted)]">{title}</h3>
      <div className="text-sm text-[var(--foreground)]">{children}</div>
    </section>
  );
}

export function MddEvalCaseDetailDialog({ caseId, onClose }: MddEvalCaseDetailDialogProps) {
  const [detail, setDetail] = useState<MddEvalCaseDetailDto | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!caseId) return;
    let cancelled = false;
    setDetail(null);
    setError("");
    setLoading(true);
    fetchMddEvalCase(caseId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "No se pudo cargar el caso.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  return (
    <Dialog open={caseId !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="xl" className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{detail?.title ?? caseId ?? "Caso"}</DialogTitle>
          <DialogDescription>
            {detail ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs">{detail.id}</span>
                <span>· {detail.domain}</span>
                <Badge variant={complexityTone(detail.complexity)}>{complexityLabel(detail.complexity)}</Badge>
              </span>
            ) : (
              "Detalle del caso de evaluación"
            )}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-[var(--foreground-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando caso…
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-md border border-[var(--destructive)]/40 p-3 text-sm text-[var(--destructive)]">
            {error}
          </p>
        ) : null}

        {detail ? (
          <div className="space-y-4">
            <Section title="Brief">
              <p className="whitespace-pre-wrap">{detail.brief}</p>
            </Section>

            <Section title="Umbrales">
              Rúbrica ≥ {detail.minRubric} · Auditor ≥ {detail.minAuditor}
            </Section>

            {detail.dbga ? (
              <Section title="DBGA">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-2 text-xs">
                  {detail.dbga}
                </pre>
              </Section>
            ) : null}
            {detail.brd ? (
              <Section title="BRD">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/40 p-2 text-xs">
                  {detail.brd}
                </pre>
              </Section>
            ) : null}

            <Section title="Entidades esperadas">
              <ChipList items={detail.expect.entities} />
            </Section>

            <Section title="Capacidades esperadas">
              {detail.expect.capabilities.length === 0 ? (
                <span className="text-[var(--foreground-muted)]">—</span>
              ) : (
                <ul className="space-y-1.5">
                  {detail.expect.capabilities.map((cap) => (
                    <li key={cap.name} className="rounded-md border border-[var(--border)] p-2">
                      <p className="font-medium">{cap.name}</p>
                      {cap.endpointHints.length > 0 ? (
                        <p className="mt-0.5 font-mono text-xs text-[var(--foreground-muted)]">
                          {cap.endpointHints.join(" · ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Section title="Seguridad">
              <ChipList items={detail.expect.security} />
            </Section>
            <Section title="Infraestructura">
              <ChipList items={detail.expect.infra} />
            </Section>
            <Section title="Debe mencionar en contexto">
              <ChipList items={detail.expect.mustMentionInContext} />
            </Section>
            <Section title="Prohibido">
              <ChipList items={detail.expect.forbidden} empty="Sin términos prohibidos" />
            </Section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

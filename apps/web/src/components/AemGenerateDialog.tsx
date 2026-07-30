/**
 * Modal para generar AEM con selector de alcance geográfico.
 */

import { useState } from "react";
import { Sparkles } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import type { AemMarketScope } from "@theforge/shared-types";
import { AEM_MARKET_SCOPE_LABELS } from "@theforge/shared-types";

const SCOPES: AemMarketScope[] = ["global", "mexico", "latam"];

export interface AemGenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading?: boolean;
  error?: string | null;
  onGenerate: (marketScope: AemMarketScope) => void | Promise<void>;
}

export function AemGenerateDialog({
  open,
  onOpenChange,
  loading,
  error,
  onGenerate,
}: AemGenerateDialogProps) {
  const [marketScope, setMarketScope] = useState<AemMarketScope>("mexico");

  const handleOpenChange = (next: boolean) => {
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generar Análisis y Estudio de Mercado</DialogTitle>
          <DialogDescription>
            Se usarán Benchmark (Deep Research), Fase 0 (DBGA) y BRD disponibles. El documento incluirá
            glosario, planes de monetización y un dictamen de inversión digital (SEGUIR / NO SEGUIR / SEGUIR CON
            CONDICIONES) que analiza el AEM.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p
            role="alert"
            className="rounded-md border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_10%,transparent)] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--destructive)_75%,var(--foreground))]"
          >
            {error}
          </p>
        ) : null}

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-[var(--foreground)]">Alcance geográfico</legend>
          {SCOPES.map((scope) => (
            <label
              key={scope}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm hover:bg-[color-mix(in_oklch,var(--muted)_40%,transparent)]"
            >
              <input
                type="radio"
                name="aem-market-scope"
                value={scope}
                checked={marketScope === scope}
                onChange={() => setMarketScope(scope)}
                disabled={loading}
              />
              <span>{AEM_MARKET_SCOPE_LABELS[scope]}</span>
            </label>
          ))}
        </fieldset>

        {loading ? (
          <p className="text-sm text-[var(--foreground-muted)]">
            Generando AEM en segundo plano… Puedes cerrar este modal; el documento aparecerá al terminar.
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void onGenerate(marketScope)}
            disabled={loading}
            loading={loading}
          >
            {!loading ? <Sparkles className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden /> : null}
            Generar AEM
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

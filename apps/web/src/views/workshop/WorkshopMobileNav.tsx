import { FileText, MessageSquare, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkshopMobileColumn } from "./workshopMetricsColumn.types";

export interface WorkshopMobileNavProps {
  mobileWorkshopColumn: WorkshopMobileColumn;
  onMobileWorkshopColumnChange: (column: WorkshopMobileColumn) => void;
  /** Post-MDD SSOT freeze — sin columna chat. */
  hideChat?: boolean;
}

/** Barra inferior móvil: Chat / Docs / Estado. */
export function WorkshopMobileNav({
  mobileWorkshopColumn,
  onMobileWorkshopColumnChange,
  hideChat = false,
}: WorkshopMobileNavProps) {
  return (
    <nav
      className={cn(
        "lg:hidden shrink-0 sticky bottom-0 z-10 border-t border-[var(--border)] bg-[color-mix(in_oklch,var(--background)_92%,black)] pb-[max(4px,env(safe-area-inset-bottom))]",
        hideChat ? "grid grid-cols-2" : "grid grid-cols-3",
      )}
      aria-label="Cambiar panel del workshop"
    >
      {!hideChat ? (
        <button
          type="button"
          onClick={() => onMobileWorkshopColumnChange("chat")}
          aria-current={mobileWorkshopColumn === "chat" ? "page" : undefined}
          className={cn(
            "flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium touch-manipulation",
            mobileWorkshopColumn === "chat"
              ? "text-[var(--primary)] bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] border-t-2 border-t-[var(--primary)] -mt-px"
              : "text-[var(--foreground-subtle)] border-t-2 border-t-transparent active:bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))]",
          )}
        >
          <MessageSquare className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
          Chat
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onMobileWorkshopColumnChange("workspace")}
        aria-current={mobileWorkshopColumn === "workspace" ? "page" : undefined}
        className={cn(
          "flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium touch-manipulation",
          mobileWorkshopColumn === "workspace"
            ? "text-[var(--primary)] bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] border-t-2 border-t-[var(--primary)] -mt-px"
            : "text-[var(--foreground-subtle)] border-t-2 border-t-transparent active:bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))]",
        )}
      >
        <FileText className="h-5 w-5 shrink-0 opacity-90" aria-hidden />
        Docs
      </button>
      <button
        type="button"
        onClick={() => onMobileWorkshopColumnChange("metrics")}
        aria-current={mobileWorkshopColumn === "metrics" ? "page" : undefined}
        className={cn(
          "flex min-h-[52px] flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium touch-manipulation",
          mobileWorkshopColumn === "metrics"
            ? "text-[var(--primary)] bg-[color-mix(in_oklch,var(--card)_92%,var(--background))] border-t-2 border-t-[var(--primary)] -mt-px"
            : "text-[var(--foreground-subtle)] border-t-2 border-t-transparent active:bg-[color-mix(in_oklch,var(--muted)_50%,var(--card))]",
        )}
      >
        <Package className="w-5 h-5 shrink-0 opacity-90" aria-hidden />
        Estado
      </button>
    </nav>
  );
}

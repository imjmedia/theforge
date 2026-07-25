/**
 * Selector de patrones de desarrollo (SSOT): primera generación o edición sin regenerar el MDD.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  buildGovernanceBodySelectedOnly,
  buildMddWithGovernanceSkeleton,
  listGovernancePatternOptions,
  selectedPatternIdsFromMdd,
  updateMddGovernancePatterns,
} from "@theforge/shared-types/mdd-governance-patterns";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";

export type MddPatternsWizardMode = "initial" | "edit";

export interface MddPatternsWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode?: MddPatternsWizardMode;
  /** MDD actual (preselección de [X] y, en modo edit, documento a fusionar). */
  initialMddContent?: string | null;
  /** Preselección tras análisis Fase 0 / Benchmark / BRD (prioridad sobre initialMddContent). */
  preselectedIds?: ReadonlySet<string> | null;
  /** Refinando preselección en servidor (no bloquea la lista de patrones). */
  analyzing?: boolean;
  analyzeMessage?: string | null;
  loading?: boolean;
  onConfirm: (markdown: string, selectedIds: ReadonlySet<string>) => void | Promise<void>;
}

function groupTabId(group: string, index: number): string {
  const num = group.match(/(\d+)\./)?.[1] ?? String(index + 1);
  return `g-${num}`;
}

function PatternOptionList({
  items,
  selected,
  onToggle,
}: {
  items: ReturnType<typeof listGovernancePatternOptions>;
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <label
            className={cn(
              "flex gap-3 rounded-md border border-border/60 p-3 cursor-pointer hover:bg-muted/40",
              selected.has(item.id) && "border-primary/50 bg-primary/5",
            )}
          >
            <input
              type="checkbox"
              className="mt-1 shrink-0"
              checked={selected.has(item.id)}
              onChange={() => onToggle(item.id)}
            />
            <span className="text-sm leading-snug">
              <span className="font-medium">{item.label}</span>
              {item.description ? (
                <span className="text-muted-foreground"> — {item.description}</span>
              ) : null}
              {item.affects ? (
                <span className="block text-xs text-muted-foreground mt-1">
                  Afecta a: {item.affects}
                </span>
              ) : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function MddPatternsWizardDialog({
  open,
  onOpenChange,
  mode = "initial",
  initialMddContent,
  preselectedIds = null,
  analyzing = false,
  analyzeMessage,
  loading = false,
  onConfirm,
}: MddPatternsWizardDialogProps) {
  const options = useMemo(() => listGovernancePatternOptions(), []);
  const grouped = useMemo(() => {
    const map = new Map<string, typeof options>();
    for (const o of options) {
      const list = map.get(o.group) ?? [];
      list.push(o);
      map.set(o.group, list);
    }
    return [...map.entries()];
  }, [options]);

  const groupTabs = useMemo(
    () =>
      grouped.map(([group, items], index) => ({
        id: groupTabId(group, index),
        label: group,
        items,
      })),
    [grouped],
  );

  const [selected, setSelected] = useState<Set<string>>(() =>
    selectedPatternIdsFromMdd(initialMddContent ?? ""),
  );
  const [activeGroupId, setActiveGroupId] = useState<string>(() => groupTabs[0]?.id ?? "");
  /** MDD base al abrir / terminar análisis; no sigue props mientras el usuario edita. */
  const editBaselineMddRef = useRef("");
  const prevAnalyzingRef = useRef(false);
  const selectionSyncedRef = useRef(false);
  const userEditedSelectionRef = useRef(false);

  useEffect(() => {
    if (!open) {
      prevAnalyzingRef.current = false;
      selectionSyncedRef.current = false;
      userEditedSelectionRef.current = false;
      editBaselineMddRef.current = "";
      return;
    }
    const analysisJustFinished = prevAnalyzingRef.current && !analyzing;
    prevAnalyzingRef.current = analyzing;

    if (preselectedIds && preselectedIds.size > 0 && !userEditedSelectionRef.current) {
      setSelected(new Set(preselectedIds));
      selectionSyncedRef.current = true;
      if (!analyzing) {
        editBaselineMddRef.current = (initialMddContent ?? "").trim();
      }
      return;
    }

    if (analyzing) return;

    const shouldSyncSelection = !selectionSyncedRef.current || analysisJustFinished;
    if (!shouldSyncSelection) return;

    selectionSyncedRef.current = true;
    editBaselineMddRef.current = (initialMddContent ?? "").trim();
    if (preselectedIds && preselectedIds.size > 0) {
      setSelected(new Set(preselectedIds));
      return;
    }
    setSelected(selectedPatternIdsFromMdd(editBaselineMddRef.current));
  }, [open, analyzing, initialMddContent, preselectedIds]);

  useEffect(() => {
    if (!open || groupTabs.length === 0) return;
    setActiveGroupId((prev) => (groupTabs.some((t) => t.id === prev) ? prev : groupTabs[0]!.id));
  }, [open, groupTabs]);

  const selectedCountByGroup = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of groupTabs) {
      counts.set(tab.id, tab.items.filter((item) => selected.has(item.id)).length);
    }
    return counts;
  }, [groupTabs, selected]);

  const activeGroup = groupTabs.find((t) => t.id === activeGroupId) ?? groupTabs[0];

  const toggle = useCallback((id: string) => {
    userEditedSelectionRef.current = true;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    const body = buildGovernanceBodySelectedOnly(selected);
    const markdown =
      mode === "edit"
        ? updateMddGovernancePatterns(
            editBaselineMddRef.current || (initialMddContent ?? "").trim(),
            selected,
          )
        : buildMddWithGovernanceSkeleton("Master Design Document", body);
    await onConfirm(markdown, selected);
  }, [mode, onConfirm, selected, initialMddContent]);

  const isEdit = mode === "edit";
  const defaultDescription = isEdit ? (
    <>
      Solo se actualiza la sección <strong>[ARQUITECTURA - SECCIÓN INMUTABLE]</strong>. Las secciones §1–§7
      del MDD no se regeneran.
    </>
  ) : (
    <>
      Primera vez: preselección desde Fase 0 / Benchmark / BRD. Solo los patrones marcados van al MDD. Para
      regenerar sin volver a elegir, usa «Regenerar MDD»; para empezar de cero, «Limpiar MDD».
    </>
  );

  return (
    <Dialog open={open} onOpenChange={loading ? undefined : onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-4xl flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>
            {isEdit ? "Editar patrones de desarrollo (SSOT)" : "Patrones de desarrollo (SSOT)"}
          </DialogTitle>
          <DialogDescription>{analyzeMessage?.trim() || defaultDescription}</DialogDescription>
        </DialogHeader>
        {analyzing ? (
          <div
            className="flex items-center gap-2 border-b border-border/60 bg-muted/30 px-6 py-2 text-sm text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden />
            <span>Refinando preselección con IA…</span>
          </div>
        ) : null}
        <div className="flex flex-1 min-h-0 border-t border-border/60">
          <nav
            className="flex w-[13.5rem] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border/60 px-2 py-3 sm:w-[15.5rem]"
            role="tablist"
            aria-label="Categorías de patrones"
          >
            {groupTabs.map(({ id, label }) => {
              const isActive = activeGroupId === id;
              const count = selectedCountByGroup.get(id) ?? 0;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`mdd-patterns-tab-${id}`}
                  aria-selected={isActive}
                  aria-controls={`mdd-patterns-panel-${id}`}
                  onClick={() => setActiveGroupId(id)}
                  className={cn(
                    "rounded-md px-2.5 py-2 text-left text-xs leading-snug transition-colors sm:text-[13px]",
                    isActive
                      ? "border-l-2 border-primary bg-primary/10 font-semibold text-foreground pl-[calc(0.625rem-2px)]"
                      : "border-l-2 border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <span className="flex items-start gap-1.5">
                    <span className="min-w-0 flex-1">{label}</span>
                    {count > 0 ? (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary tabular-nums">
                        {count}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col min-h-0">
            <div
              className="flex-1 overflow-y-auto px-4 py-3 sm:px-5 min-h-0"
              role="tabpanel"
              id={`mdd-patterns-panel-${activeGroupId}`}
              aria-labelledby={`mdd-patterns-tab-${activeGroupId}`}
            >
              {activeGroup ? (
                <PatternOptionList items={activeGroup.items} selected={selected} onToggle={toggle} />
              ) : null}
            </div>
            <p className="px-4 pb-2 text-xs text-muted-foreground shrink-0 sm:px-5">
              {selected.size === 0
                ? "Ningún patrón seleccionado."
                : `${selected.size} patrón${selected.size === 1 ? "" : "es"} seleccionado${selected.size === 1 ? "" : "s"} en total.`}
            </p>
          </div>
        </div>
        <DialogFooter className="px-6 py-4 shrink-0 border-t border-border/60">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading || selected.size === 0}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : isEdit ? (
              "Guardar patrones"
            ) : (
              "Continuar y generar MDD"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

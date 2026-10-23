/**
 * @fileoverview Modal stepper to create a project: choose origin (new / TheForge project or repo),
 * then name for new projects or hand off to the TheForge picker for legacy paths.
 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronDown, FolderGit2, GitBranch, Layers, Loader2, Palette, Plus, Sparkles } from "lucide-react";
import type { ProjectApproach } from "@theforge/shared-types";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { ProjectGroupOption } from "./ProjectSettingsDialog";

export type CreateProjectOrigin = "NEW" | "LEGACY_PROJECT" | "LEGACY_REPO";

export interface CreateProjectWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  groups: ProjectGroupOption[];
  canCreateGroup: boolean;
  pendingSelectedGroupId?: string | null;
  onPendingGroupConsumed?: () => void;
  onCreateGroup?: () => void;
  onCreateNew: (
    name: string,
    groupId: string,
    approach?: ProjectApproach,
    uxDesignSource?: string,
  ) => Promise<void>;
  onContinueLegacy: (tab: "projects" | "repos") => void;
}

const ORIGINS: {
  id: CreateProjectOrigin;
  title: string;
  description: string;
  icon: typeof Sparkles;
}[] = [
  {
    id: "NEW",
    title: "Proyecto nuevo",
    description: "Desde cero en TheForge (tipo Nuevo).",
    icon: Sparkles,
  },
  {
    id: "LEGACY_PROJECT",
    title: "Proyecto existente",
    description: "Importa un proyecto ya indexado en TheForge.",
    icon: FolderGit2,
  },
  {
    id: "LEGACY_REPO",
    title: "Repositorio existente",
    description: "Usa un repo indexado como base legacy.",
    icon: GitBranch,
  },
];

function resolveDefaultGroupId(groups: ProjectGroupOption[]): string {
  const byDefault = groups.find((g) => g.isDefault);
  return byDefault?.id ?? groups[0]?.id ?? "";
}

export function CreateProjectWizardDialog({
  open,
  onOpenChange,
  loading,
  groups,
  canCreateGroup,
  pendingSelectedGroupId,
  onPendingGroupConsumed,
  onCreateGroup,
  onCreateNew,
  onContinueLegacy,
}: CreateProjectWizardDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [approach, setApproach] = useState<ProjectApproach>("DOMAIN_FIRST");
  const [uxDesignSource, setUxDesignSource] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep(1);
    setName("");
    setGroupId("");
    setApproach("DOMAIN_FIRST");
    setUxDesignSource("");
    setLocalError(null);
  }, []);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => {
    if (step === 2 && groups.length > 0 && !groupId) {
      setGroupId(resolveDefaultGroupId(groups));
    }
  }, [step, groups, groupId]);

  useEffect(() => {
    if (!pendingSelectedGroupId) return;
    setGroupId(pendingSelectedGroupId);
    onPendingGroupConsumed?.();
  }, [pendingSelectedGroupId, onPendingGroupConsumed]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleSelectOrigin = useCallback((o: CreateProjectOrigin) => {
    setLocalError(null);
    if (o === "NEW") setStep(2);
    else {
      onContinueLegacy(o === "LEGACY_PROJECT" ? "projects" : "repos");
      handleClose();
    }
  }, [onContinueLegacy, handleClose]);

  const handleBack = useCallback(() => {
    setLocalError(null);
    setStep(1);
    setName("");
    setGroupId("");
    setApproach("DOMAIN_FIRST");
    setUxDesignSource("");
  }, []);

  const handleSubmitNew = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError("Escribe un nombre para el proyecto.");
      return;
    }
    if (!groupId) {
      setLocalError("Selecciona un grupo para el proyecto.");
      return;
    }
    setLocalError(null);
    try {
      await onCreateNew(
        trimmed,
        groupId,
        approach,
        uxDesignSource.trim() || undefined,
      );
      handleClose();
    } catch {
      setLocalError("No se pudo crear el proyecto. Revisa la consola o inténtalo de nuevo.");
    }
  }, [name, groupId, approach, uxDesignSource, onCreateNew, handleClose]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-xl">
        <div className="border-b border-[var(--border)] bg-[var(--muted)]/30 px-6 py-4">
          <DialogHeader className="space-y-1 text-left">
            <DialogTitle className="text-lg font-semibold text-[var(--foreground)]">
              Crear proyecto
            </DialogTitle>
            <DialogDescription className="text-sm text-[var(--foreground-muted)]">
              {step === 1
                ? "Paso 1 de 2 — Elige cómo quieres empezar."
                : "Paso 2 de 2 — Nombre del proyecto nuevo."}
            </DialogDescription>
          </DialogHeader>
          <ol className="mt-4 flex items-center gap-2" aria-label="Progreso">
            <li
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                step >= 1
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]",
              )}
              aria-current={step === 1 ? "step" : undefined}
            >
              1
            </li>
            <li className="h-px flex-1 bg-[var(--border)]" aria-hidden />
            <li
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold",
                step === 2
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "bg-[var(--muted)] text-[var(--muted-foreground)]",
              )}
              aria-current={step === 2 ? "step" : undefined}
            >
              2
            </li>
          </ol>
        </div>

        <div className="px-6 py-5">
          {step === 1 ? (
            <div className="grid gap-3 sm:grid-cols-1">
              <p id="origin-hint" className="text-sm text-[var(--foreground-muted)]">
                Selecciona una opción. Si eliges TheForge, se abrirá el selector de proyectos o repositorios.
              </p>
              <div
                className="grid gap-3 sm:grid-cols-3"
                role="group"
                aria-label="Opciones para crear proyecto"
              >
                {ORIGINS.map(({ id, title, description, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handleSelectOrigin(id)}
                      disabled={loading}
                      className={cn(
                        "flex flex-col items-start gap-2 rounded-[var(--radius-lg)] border p-4 text-left transition-colors",
                        "min-h-[120px] touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--card)]",
                        "border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/45 hover:bg-[color-mix(in_oklch,var(--primary)_8%,var(--card))]",
                      )}
                    >
                      <Icon className="h-5 w-5 shrink-0 text-[var(--primary)]" aria-hidden />
                      <span className="text-sm font-semibold text-[var(--foreground)]">{title}</span>
                      <span className="text-xs leading-snug text-[var(--foreground-muted)]">{description}</span>
                    </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <button
                type="button"
                onClick={handleBack}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                Volver al tipo de proyecto
              </button>
              <div>
                <label htmlFor="create-project-name" className="mb-1.5 block text-sm font-medium text-[var(--foreground)]">
                  Nombre del proyecto
                </label>
                <Input
                  id="create-project-name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setLocalError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSubmitNew();
                  }}
                  placeholder="Ej. Mi producto digital"
                  autoComplete="off"
                  className="min-h-11 w-full"
                  aria-invalid={!!localError}
                  aria-describedby={localError ? "create-project-error" : undefined}
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-[var(--foreground)]">
                  Enfoque metodológico
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setApproach("DOMAIN_FIRST")}
                    disabled={loading}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      approach === "DOMAIN_FIRST"
                        ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] ring-1 ring-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)]/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                      <Layers className="h-3.5 w-3.5 text-[var(--primary)]" />
                      Domain-First (Clásico)
                    </div>
                    <span className="text-[11px] leading-tight text-[var(--foreground-muted)]">
                      Idea → BD y endpoints en MDD → UI y tareas
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setApproach("UX_FIRST")}
                    disabled={loading}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                      approach === "UX_FIRST"
                        ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))] ring-1 ring-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--card)] hover:bg-[var(--muted)]/40",
                    )}
                  >
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--foreground)]">
                      <Palette className="h-3.5 w-3.5 text-pink-500" />
                      UX-First (Traducción)
                    </div>
                    <span className="text-[11px] leading-tight text-[var(--foreground-muted)]">
                      Pantallas → Contratos OpenAPI → Entidades → NestJS
                    </span>
                  </button>
                </div>
              </div>

              {approach === "UX_FIRST" ? (
                <div className="space-y-1.5 rounded-lg border border-pink-500/20 bg-pink-500/5 p-3">
                  <label htmlFor="create-project-ux-source" className="block text-xs font-medium text-[var(--foreground)]">
                    Enlace de Figma o spec visual inicial (opcional)
                  </label>
                  <Input
                    id="create-project-ux-source"
                    value={uxDesignSource}
                    onChange={(e) => setUxDesignSource(e.target.value)}
                    placeholder="https://figma.com/file/... o wireframes"
                    className="h-9 text-xs"
                    disabled={loading}
                  />
                  <p className="text-[11px] text-[var(--foreground-muted)]">
                    TheForge priorizará la traducción técnica: las pantallas dictarán los contratos OpenAPI antes de codificar la lógica.
                  </p>
                </div>
              ) : null}
              {groups.length > 0 ? (
                <div className="space-y-2">
                  <label htmlFor="create-project-group" className="text-sm font-medium text-[var(--foreground)]">
                    Grupo
                  </label>
                  <div className="flex items-stretch gap-2">
                    <div className="relative flex-1">
                      <select
                        id="create-project-group"
                        className="min-h-11 w-full appearance-none rounded-md border border-[var(--border)] bg-[var(--card)] py-2 pl-3 pr-10 text-sm"
                        value={groupId}
                        onChange={(e) => {
                          setGroupId(e.target.value);
                          setLocalError(null);
                        }}
                        disabled={loading}
                      >
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
                        aria-hidden
                      />
                    </div>
                    {canCreateGroup && onCreateGroup ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-11 shrink-0"
                        onClick={onCreateGroup}
                        disabled={loading}
                        aria-label="Crear nuevo grupo"
                        title="Crear nuevo grupo"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {localError ? (
                <p id="create-project-error" className="text-sm text-[var(--destructive)]" role="alert">
                  {localError}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {step === 2 ? (
          <DialogFooter className="border-t border-[var(--border)] bg-[var(--muted)]/20 px-6 py-4 sm:justify-end">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading}>
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void handleSubmitNew()}
              disabled={loading || !name.trim() || !groupId}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Crear proyecto
            </Button>
          </DialogFooter>
        ) : (
          <DialogFooter className="border-t border-[var(--border)] px-6 py-4 sm:justify-end">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cerrar
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { ImagePlus, Loader2, MonitorSmartphone, Upload } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { useWorkshopStore } from "@/store/workshopStore";
import { DesignProposalDiffDialog } from "./DesignProposalDiffDialog";

export function WorkshopDesignScreensPanel({ projectId }: { projectId: string }) {
  const designLoading = useWorkshopStore((s) => s.designLoading);
  const designSaving = useWorkshopStore((s) => s.designSaving);
  const designSpec = useWorkshopStore((s) => s.designSpec);
  const designRevision = useWorkshopStore((s) => s.designRevision);
  const designPanelError = useWorkshopStore((s) => s.designPanelError);
  const pendingProposal = useWorkshopStore((s) => s.pendingDesignProposal);
  const fetchDesign = useWorkshopStore((s) => s.fetchDesign);
  const saveDesignScreens = useWorkshopStore((s) => s.saveDesignScreens);
  const importDesignImagesAction = useWorkshopStore((s) => s.importDesignImagesAction);
  const importDesignFigmaAction = useWorkshopStore((s) => s.importDesignFigmaAction);
  const acceptDesignProposalAction = useWorkshopStore((s) => s.acceptDesignProposalAction);
  const rejectDesignProposalAction = useWorkshopStore((s) => s.rejectDesignProposalAction);
  const setPendingDesignProposal = useWorkshopStore((s) => s.setPendingDesignProposal);

  const [figmaUrl, setFigmaUrl] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newRoute, setNewRoute] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (pendingProposal) setDialogOpen(true);
  }, [pendingProposal]);

  useEffect(() => {
    if (!designSpec && !designLoading) void fetchDesign(projectId);
  }, [designSpec, designLoading, fetchDesign, projectId]);

  const screens = designSpec?.screens ?? [];
  const navigation = designSpec?.navigation ?? [];

  const handleAddScreen = useCallback(async () => {
    if (designRevision == null || !newTitle.trim() || !newRoute.trim()) return;
    const id = `screen-${Date.now().toString(36).slice(-6)}`;
    await saveDesignScreens(projectId, {
      revision: designRevision,
      screens: [
        ...screens,
        {
          id,
          name: newTitle.trim(),
          route: newRoute.trim(),
          components: [],
          origin: { kind: "manual" },
          roles: [],
          states: [],
        },
      ],
      navigation,
    });
    setNewTitle("");
    setNewRoute("");
  }, [designRevision, navigation, newRoute, newTitle, projectId, saveDesignScreens, screens]);

  const handleImages = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length) return;
      const images = await Promise.all(
        Array.from(fileList).slice(0, 8).map(async (file) => {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(new Error("No se pudo leer la imagen"));
            reader.readAsDataURL(file);
          });
          const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;
          return {
            mimeType: file.type || "image/png",
            base64,
          };
        }),
      );
      await importDesignImagesAction(projectId, { images });
    },
    [importDesignImagesAction, projectId],
  );

  const handleFigmaImport = useCallback(async () => {
    if (!figmaUrl.trim()) return;
    await importDesignFigmaAction(projectId, { fileUrl: figmaUrl.trim() });
  }, [figmaUrl, importDesignFigmaAction, projectId]);

  const busy = designLoading || designSaving;
  const empty = !busy && screens.length === 0;

  const listSummary = useMemo(
    () =>
      screens.map((s) => (
        <li
          key={s.id}
          className="flex items-start gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
        >
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium text-[var(--foreground)]">{s.name || s.id}</p>
            <p className="text-xs text-[var(--foreground-muted)]">{s.route}</p>
            <p className="text-[11px] text-[var(--foreground-muted)]">
              {s.components.length} componente(s)
              {s.static ? " · contenido estático" : ""}
            </p>
          </div>
        </li>
      )),
    [screens],
  );

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div>
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Pantallas</h2>
        <p className="text-sm text-[var(--foreground-muted)]">
          Edita pantallas y navegación, importa imágenes o un archivo de Figma (propuesta diff).
        </p>
      </div>

      {designPanelError ? (
        <p className="rounded-lg border border-[color-mix(in_oklch,var(--destructive)_35%,var(--border))] bg-[color-mix(in_oklch,var(--destructive)_8%,var(--card))] px-3 py-2 text-sm text-[color-mix(in_oklch,var(--destructive)_90%,var(--foreground))]">
          {designPanelError}
        </p>
      ) : null}

      {busy && !screens.length ? (
        <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando diseño…
        </div>
      ) : null}

      {empty ? (
        <p className="rounded-lg border border-dashed border-[var(--border)] px-4 py-6 text-center text-sm text-[var(--foreground-muted)]">
          Aún no hay pantallas. Añade una manualmente o importa imágenes / Figma.
        </p>
      ) : (
        <ul className="space-y-2">{listSummary}</ul>
      )}

      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)]/15 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--foreground-muted)]">
          Añadir pantalla
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título"
            disabled={busy || designRevision == null}
          />
          <Input
            value={newRoute}
            onChange={(e) => setNewRoute(e.target.value)}
            placeholder="/ruta"
            disabled={busy || designRevision == null}
          />
        </div>
        <Button type="button" size="sm" disabled={busy || designRevision == null} onClick={() => void handleAddScreen()}>
          Guardar pantalla
        </Button>
      </div>

      <div className="grid gap-3 rounded-xl border border-[var(--border)] p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--foreground-muted)]">Importar imágenes</p>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--primary)]">
            <ImagePlus className="h-4 w-4" aria-hidden />
            Seleccionar archivos
            <input
              type="file"
              accept="image/*"
              multiple
              className="sr-only"
              disabled={busy}
              onChange={(e) => void handleImages(e.target.files)}
            />
          </label>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-[var(--foreground-muted)]">Importar Figma</p>
          <Input
            value={figmaUrl}
            onChange={(e) => setFigmaUrl(e.target.value)}
            placeholder="https://www.figma.com/file/…"
            disabled={busy}
          />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void handleFigmaImport()}>
            <Upload className="mr-1 h-3.5 w-3.5" aria-hidden />
            Importar
          </Button>
        </div>
      </div>

      <DesignProposalDiffDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setPendingDesignProposal(null);
        }}
        proposal={pendingProposal}
        busy={designSaving}
        onAccept={() => {
          if (!pendingProposal || designRevision == null) return;
          void acceptDesignProposalAction(projectId, pendingProposal.proposalId, designRevision).then(() =>
            setDialogOpen(false),
          );
        }}
        onReject={() => {
          if (!pendingProposal) return;
          void rejectDesignProposalAction(projectId, pendingProposal.proposalId).then(() => setDialogOpen(false));
        }}
      />
    </div>
  );
}

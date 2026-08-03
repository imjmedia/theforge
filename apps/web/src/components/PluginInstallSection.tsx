import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import {
  CheckCircle2,
  Circle,
  Loader2,
  Package,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import type { PluginInstalledListResponse } from "@theforge/shared-types";
import { getStoredUser } from "@/utils/apiClient";
import {
  clearPluginArtifactsCache,
  fetchInstalledPlugins,
  installPluginFromFile,
  reloadPlugins,
  uninstallPlugin,
} from "@/utils/pluginApi";
import { reloadPluginWorkshopUi } from "@/plugin-ui/bootstrap";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  PluginInstanceRecoveryForm,
  pluginNeedsInstanceRecovery,
} from "@/components/PluginInstanceRecoveryForm";

function isValidPluginFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".tfplugin") || name.endsWith(".zip");
}

function canManagePlugins(role: string | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

type PluginInstallSectionProps = {
  /** Tras instalar, desinstalar o recargar — p. ej. refrescar paneles de ajustes. */
  onChanged?: () => void;
};

/** Instalación y estado de plugins (.tfplugin) — solo administradores gestionan. */
export function PluginInstallSection({ onChanged }: PluginInstallSectionProps) {
  const role = getStoredUser()?.role;
  const isManager = canManagePlugins(role);

  const [status, setStatus] = useState<PluginInstalledListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchInstalledPlugins();
      setStatus(data);
    } catch {
      setError("No se pudo cargar el estado de plugins");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const flashSuccess = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(""), 4000);
  };

  const notifyChanged = () => {
    clearPluginArtifactsCache();
    void reloadPluginWorkshopUi();
    onChanged?.();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file || !isManager) return;
    setBusy(true);
    setError("");
    try {
      const result = await installPluginFromFile(file);
      if (!result.reloaded) {
        await reloadPlugins();
      }
      await refresh();
      notifyChanged();
      flashSuccess(
        result.reloaded
          ? `${result.name} v${result.version} instalado. Revisa los ajustes del plugin si requiere licencia u otra configuración.`
          : `${result.name} v${result.version} instalado en disco. Pulsa Recargar si no aparece cargado.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al instalar");
    } finally {
      setBusy(false);
    }
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isManager || busy) return;
    dragDepthRef.current += 1;
    if (dragDepthRef.current === 1) setDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isManager || busy) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    if (!isManager || busy) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isValidPluginFile(file)) {
      setError("Solo se aceptan archivos .tfplugin o .zip");
      return;
    }
    void handleFile(file);
  };

  const handleReload = async () => {
    if (!isManager) return;
    setBusy(true);
    setError("");
    try {
      const result = await reloadPlugins();
      await refresh();
      notifyChanged();
      if (result.loadErrors && Object.keys(result.loadErrors).length > 0) {
        const summary = Object.entries(result.loadErrors)
          .map(([id, msg]) => `${id}: ${msg}`)
          .join(" · ");
        setError(`Recarga incompleta — ${summary}`);
      } else {
        flashSuccess(
          result.loaded > 0
            ? `Plugins recargados (${result.loaded} activo(s))`
            : "Recarga completada",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al recargar plugins");
    } finally {
      setBusy(false);
    }
  };

  const handleUninstall = async (id: string) => {
    if (!isManager) return;
    if (!window.confirm(`¿Desinstalar ${id}?`)) return;
    setBusy(true);
    setError("");
    try {
      await uninstallPlugin(id);
      await refresh();
      notifyChanged();
      flashSuccess("Plugin desinstalado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al desinstalar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-[var(--border)] bg-[var(--card)]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Package className="h-5 w-5 text-[var(--primary)]" />
          Instalación de plugins
        </CardTitle>
        <CardDescription>
          Sube paquetes <code className="text-xs">.tfplugin</code> (ZIP + manifest). Core{" "}
          {status?.coreVersion ?? "…"} —{" "}
          <span className="font-mono text-xs">{status?.pluginsDirectory ?? "…"}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div
          className={cn(
            "space-y-6 transition-colors",
            isManager &&
              dragActive &&
              "rounded-lg bg-[color-mix(in_oklch,var(--primary)_6%,var(--card))] ring-2 ring-inset ring-[var(--primary)]",
          )}
          onDragEnter={isManager ? handleDragEnter : undefined}
          onDragLeave={isManager ? handleDragLeave : undefined}
          onDragOver={isManager ? handleDragOver : undefined}
          onDrop={isManager ? handleDrop : undefined}
        >
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando estado…
          </div>
        ) : null}

        {status ? (
          <div className="rounded-md border border-[var(--border)] bg-[var(--muted)]/30 p-3 text-sm">
            <p>
              <strong>{status.health.loaded}</strong> cargado(s) ·{" "}
              <strong>{status.installed.length}</strong> en disco ·{" "}
              <strong>{status.health.artifactCount}</strong> artifact(s)
            </p>
          </div>
        ) : null}

        {status?.installed.length ? (
          <ul className="space-y-2">
            {status.installed.map((p) => (
              <Fragment key={p.id}>
              <li
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 items-center gap-2">
                  {p.degraded ? (
                    <Circle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                  ) : p.loaded ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="font-mono text-xs text-[var(--foreground-muted)]">
                      {p.id} · v{p.version}
                      {p.degraded
                        ? " · modo degradado (ajusta y guarda licencia)"
                        : p.loaded
                          ? " · cargado"
                          : " · en disco, no cargado"}
                    </p>
                  </div>
                </div>
                {isManager ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleUninstall(p.id)}
                  >
                    <Trash2 className="mr-1 h-3.5 w-3.5" />
                    Quitar
                  </Button>
                ) : null}
              </li>
              {isManager && pluginNeedsInstanceRecovery(p) ? (
                <li className="list-none px-1 pb-2">
                  <PluginInstanceRecoveryForm plugin={p} onSaved={notifyChanged} />
                </li>
              ) : null}
              </Fragment>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--foreground-muted)]">
            No hay plugins instalados. Arrastra un paquete <code className="text-xs">.tfplugin</code>{" "}
            a esta tarjeta o pulsa <strong>Subir .tfplugin</strong>.
            Si el plugin requiere licencia u otros datos, aparecerán los ajustes correspondientes
            debajo una vez cargado.
          </p>
        )}

        {isManager ? (
          <div
            className={cn(
              "flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors",
              dragActive
                ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_10%,var(--card))]"
                : "border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--card))]",
              busy && "pointer-events-none opacity-60",
            )}
            role="region"
            aria-label="Zona para arrastrar archivos .tfplugin"
          >
            <Upload
              className={cn(
                "h-8 w-8",
                dragActive ? "text-[var(--primary)]" : "text-[var(--foreground-muted)]",
              )}
            />
            <p className="text-sm font-medium text-[var(--foreground)]">
              {dragActive ? "Suelta el archivo aquí" : "Arrastra un .tfplugin aquí"}
            </p>
            <p className="text-xs text-[var(--foreground-muted)]">También puedes usar el botón Subir .tfplugin</p>
          </div>
        ) : null}

        {isManager ? (
          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4">
            <input
              id="plugin-tfplugin-upload"
              type="file"
              accept=".tfplugin,.zip,application/zip"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void handleFile(f);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => document.getElementById("plugin-tfplugin-upload")?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Subir .tfplugin
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void handleReload()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Recargar
            </Button>
          </div>
        ) : (
          <p className="text-xs text-[var(--foreground-muted)]">
            Solo administradores pueden instalar o desinstalar plugins.
          </p>
        )}

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-400">{success}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}

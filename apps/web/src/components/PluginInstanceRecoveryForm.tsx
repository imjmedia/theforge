import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import type { InstalledPluginRecord } from "@theforge/shared-types";
import {
  fetchPluginInstanceSettings,
  patchPluginInstanceSettings,
} from "@/utils/pluginApi";
import { Button, Input } from "@/components/ui";

function supportsInstanceRecovery(plugin: InstalledPluginRecord): boolean {
  return Boolean(
    plugin.manifest?.instanceSettingsPath?.trim() ||
      plugin.id === "com.kreodevs.evd",
  );
}

type PluginInstanceRecoveryFormProps = {
  plugin: InstalledPluginRecord;
  onSaved: () => void;
};

/**
 * Formulario de emergencia — edita JSON de instancia en disco sin que el plugin esté cargado.
 */
export function PluginInstanceRecoveryForm({
  plugin,
  onSaved,
}: PluginInstanceRecoveryFormProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [portalUrl, setPortalUrl] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [licenseKey, setLicenseKey] = useState("");
  const [hint, setHint] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchPluginInstanceSettings(plugin.id);
      if (!data) {
        setError("Este plugin no expone ajustes de instancia editables");
        return;
      }
      setPortalUrl(String(data.settings.licensePortalUrl ?? ""));
      setHint(String(data.settings.licenseKeyHint ?? ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar");
    } finally {
      setLoading(false);
    }
  }, [plugin.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const patch: Record<string, unknown> = {
        licensePortalUrl: portalUrl.trim(),
      };
      if (signingSecret.trim()) patch.signingSecret = signingSecret.trim();
      if (licenseKey.trim()) patch.licenseKey = licenseKey.trim();

      const result = await patchPluginInstanceSettings(plugin.id, patch);
      setSigningSecret("");
      setLicenseKey("");
      setPortalUrl(String(result.settings.licensePortalUrl ?? ""));
      setHint(String(result.settings.licenseKeyHint ?? ""));
      setSuccess(
        result.loaded
          ? "Guardado y plugin recargado correctamente"
          : result.degraded
            ? "Guardado — plugin en modo degradado; revisa licencia y recarga"
            : "Guardado — pulsa Recargar plugins si no aparece cargado",
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-[var(--foreground-muted)]">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando licencia de instancia…
      </div>
    );
  }

  if (error && !hint && !portalUrl) {
    return <p className="text-xs text-red-400">{error}</p>;
  }

  return (
    <div className="mt-3 space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
      <div className="flex items-start gap-2 text-xs text-amber-200/90">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <p>
          Recuperación de licencia (servidor). Borra la URL del portal si aún no tienes HMAC;
          deja vacío y guarda para forzar modo offline.
        </p>
      </div>

      {hint ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Clave registrada: <span className="font-mono">{hint}</span>
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label className="block text-xs font-medium" htmlFor={`${plugin.id}-portal`}>
          URL del portal (vacío = offline)
        </label>
        <Input
          id={`${plugin.id}-portal`}
          value={portalUrl}
          onChange={(e) => setPortalUrl(e.target.value)}
          placeholder="https://licenses.theforge.dev/api/v1"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium" htmlFor={`${plugin.id}-hmac`}>
          Secreto HMAC (solo si cambias)
        </label>
        <Input
          id={`${plugin.id}-hmac`}
          type="password"
          value={signingSecret}
          onChange={(e) => setSigningSecret(e.target.value)}
          placeholder="ls_…"
          className="h-8 text-xs"
        />
      </div>

      <div className="space-y-1.5">
        <label className="block text-xs font-medium" htmlFor={`${plugin.id}-key`}>
          Clave de licencia (solo si cambias)
        </label>
        <Input
          id={`${plugin.id}-key`}
          type="password"
          value={licenseKey}
          onChange={(e) => setLicenseKey(e.target.value)}
          placeholder="fk_… o tk_…"
          className="h-8 text-xs"
        />
      </div>

      {error ? <p className="text-xs text-red-400">{error}</p> : null}
      {success ? (
        <p className="inline-flex items-center gap-1 text-xs text-emerald-400">
          <Check className="h-3.5 w-3.5" />
          {success}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={saving}
        onClick={() => void handleSave()}
      >
        {saving ? (
          <>
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            Guardando…
          </>
        ) : (
          "Guardar licencia de instancia"
        )}
      </Button>
    </div>
  );
}

export function pluginNeedsInstanceRecovery(plugin: InstalledPluginRecord): boolean {
  return (!plugin.loaded || plugin.degraded === true) && supportsInstanceRecovery(plugin);
}

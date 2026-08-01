import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Puzzle } from "lucide-react";
import type {
  InstalledPluginRecord,
  PluginSettingsFieldDefinition,
  PluginSettingsPanelDefinition,
} from "@theforge/shared-types";
import {
  fetchInstalledPlugins,
  fetchPluginSettingsPanels,
  fetchPluginUserSettings,
  savePluginUserSettings,
} from "@/utils/pluginApi";
import { PluginInstallSection } from "@/components/PluginInstallSection";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import { cn } from "@/lib/utils";

type PluginSettingsGroup = {
  pluginId: string;
  label: string;
  panels: PluginSettingsPanelDefinition[];
};

function resolvePluginDisplayName(
  pluginId: string,
  installed: InstalledPluginRecord[],
  panels: PluginSettingsPanelDefinition[],
): string {
  const fromInstalled = installed.find((p) => p.id === pluginId)?.name;
  if (fromInstalled?.trim()) return fromInstalled.trim();

  const firstPanel = panels.find((p) => p.pluginId === pluginId);
  if (firstPanel?.label) {
    return firstPanel.label.replace(/\s·\sv[\d.]+$/, "").trim();
  }

  const tail = pluginId.split(".").pop();
  return tail?.trim() || pluginId;
}

/** Etiqueta del panel con versión del manifest en disco (lista instalados). */
function resolvePanelDisplayLabel(
  panel: PluginSettingsPanelDefinition,
  installed: InstalledPluginRecord[],
): string {
  const record = installed.find((p) => p.id === panel.pluginId);
  const base = panel.label.replace(/\s·\sv[\d.]+$/, "").trim();
  const version = record?.version?.trim();
  if (version && version !== "unknown") {
    return `${base} · v${version}`;
  }
  return panel.label;
}

function groupPanelsByPlugin(
  panels: PluginSettingsPanelDefinition[],
  installed: InstalledPluginRecord[],
): PluginSettingsGroup[] {
  const byPlugin = new Map<string, PluginSettingsPanelDefinition[]>();
  for (const panel of panels) {
    const list = byPlugin.get(panel.pluginId) ?? [];
    list.push(panel);
    byPlugin.set(panel.pluginId, list);
  }

  return Array.from(byPlugin.entries()).map(([pluginId, pluginPanels]) => ({
    pluginId,
    label: resolvePluginDisplayName(pluginId, installed, panels),
    panels: pluginPanels.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
  }));
}

function fieldValue(settings: Record<string, unknown>, key: string): string {
  const v = settings[key];
  return typeof v === "string" ? v : v != null ? String(v) : "";
}

function PluginSettingsPanelCard({
  panel,
  installed,
}: {
  panel: PluginSettingsPanelDefinition;
  installed: InstalledPluginRecord[];
}) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [initial, setInitial] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const displayLabel = useMemo(
    () => resolvePanelDisplayLabel(panel, installed),
    [panel, installed],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void fetchPluginUserSettings(panel.pluginId)
      .then((data) => {
        if (cancelled) return;
        setValues(data);
        setInitial(data);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudieron cargar los ajustes");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [panel.pluginId]);

  const dirty = useMemo(
    () => JSON.stringify(values) !== JSON.stringify(initial),
    [values, initial],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError("");
    setSuccess(false);
    try {
      const saved = await savePluginUserSettings(panel.pluginId, values);
      setValues(saved);
      setInitial(saved);
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }, [panel.pluginId, values]);

  const renderField = (field: PluginSettingsFieldDefinition) => {
    const id = `${panel.pluginId}-${panel.id}-${field.key}`;
    const value = fieldValue(values, field.key);

    if (field.type === "select" && field.options?.length) {
      return (
        <div key={field.key} className="space-y-1.5">
          <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <select
            id={id}
            value={value}
            disabled={field.readOnly}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
            }
            className="flex h-9 w-full rounded-md border border-[var(--input-border)] bg-[var(--input)] px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            <option value="">—</option>
            {field.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {field.hint ? (
            <p className="text-xs text-[var(--foreground-muted)]">{field.hint}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div key={field.key} className="space-y-1.5">
        <label htmlFor={id} className="block text-sm font-medium text-[var(--foreground)]">
          {field.label}
          {field.required ? " *" : ""}
        </label>
        <Input
          id={id}
          type={field.type === "password" ? "password" : "text"}
          value={value}
          placeholder={field.placeholder}
          readOnly={field.readOnly}
          disabled={field.readOnly}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, [field.key]: e.target.value }))
          }
          className={cn(
            field.type !== "password" && "font-mono text-xs",
            field.readOnly && "cursor-default opacity-90",
          )}
        />
        {field.hint ? (
          <p className="text-xs text-[var(--foreground-muted)]">{field.hint}</p>
        ) : null}
      </div>
    );
  };

  return (
    <Card className="border-[var(--border)] bg-[var(--card)]">
      <CardHeader>
        <CardTitle className="text-lg">{displayLabel}</CardTitle>
        {panel.description ? (
          <CardDescription>{panel.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando…
          </div>
        ) : (
          <>
            {panel.fields.map(renderField)}
            {error ? <p className="text-sm text-red-400">{error}</p> : null}
            <div className="flex items-center gap-3 pt-2">
              <Button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  "Guardar"
                )}
              </Button>
              {success ? (
                <span className="inline-flex items-center gap-1 text-sm text-emerald-400">
                  <Check className="h-4 w-4" />
                  Guardado
                </span>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PluginSettingsGroupSelector({
  groups,
  value,
  onValueChange,
}: {
  groups: PluginSettingsGroup[];
  value: string;
  onValueChange: (pluginId: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="tablist"
      aria-label="Plugins con ajustes"
    >
      {groups.map((group) => {
        const selected = value === group.pluginId;
        return (
          <button
            key={group.pluginId}
            type="button"
            role="tab"
            id={`plugin-settings-tab-${group.pluginId}`}
            aria-selected={selected}
            aria-controls={`plugin-settings-panel-${group.pluginId}`}
            onClick={() => onValueChange(group.pluginId)}
            className={cn(
              "min-h-[36px] touch-manipulation rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              selected
                ? "border-[var(--primary)] bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]"
                : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground-muted)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]",
            )}
          >
            {group.label}
            {group.panels.length > 1 ? (
              <span className="ml-1.5 text-xs font-normal opacity-80">
                ({group.panels.length})
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Paneles de ajustes declarados por plugins cargados (enganchados en Ajustes). */
export function PluginSettingsSection() {
  const [panels, setPanels] = useState<PluginSettingsPanelDefinition[]>([]);
  const [installed, setInstalled] = useState<InstalledPluginRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsRefreshKey, setSettingsRefreshKey] = useState(0);
  const [activePluginId, setActivePluginId] = useState("");

  const pluginGroups = useMemo(
    () => groupPanelsByPlugin(panels, installed),
    [panels, installed],
  );

  const activeGroup = useMemo(
    () => pluginGroups.find((group) => group.pluginId === activePluginId) ?? pluginGroups[0],
    [pluginGroups, activePluginId],
  );

  useEffect(() => {
    if (pluginGroups.length === 0) {
      setActivePluginId("");
      return;
    }
    if (!pluginGroups.some((group) => group.pluginId === activePluginId)) {
      const firstGroup = pluginGroups[0];
      if (firstGroup) setActivePluginId(firstGroup.pluginId);
    }
  }, [pluginGroups, activePluginId]);

  const reloadPanels = useCallback(() => {
    setLoading(true);
    void Promise.all([
      fetchPluginSettingsPanels(),
      fetchInstalledPlugins().catch(() => ({ installed: [] as InstalledPluginRecord[] })),
    ])
      .then(([nextPanels, installedStatus]) => {
        setPanels(nextPanels);
        setInstalled(installedStatus.installed);
      })
      .finally(() => setLoading(false));
  }, []);

  const handlePluginsChanged = useCallback(() => {
    setSettingsRefreshKey((key) => key + 1);
    reloadPanels();
  }, [reloadPanels]);

  useEffect(() => {
    reloadPanels();
  }, [reloadPanels]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PluginInstallSection onChanged={handlePluginsChanged} />
        <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Buscando plugins…
        </div>
      </div>
    );
  }

  if (panels.length === 0) {
    return (
      <div className="space-y-6">
        <PluginInstallSection onChanged={handlePluginsChanged} />
        <Card className="border-[var(--border)] bg-[var(--card)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Puzzle className="h-5 w-5 text-[var(--primary)]" />
            Ajustes por plugin
          </CardTitle>
          <CardDescription>
            Tras instalar y cargar un plugin, sus paneles de configuración (licencia, modelos,
            preferencias, etc.) aparecen aquí. Cada plugin declara los campos que necesita.
          </CardDescription>
        </CardHeader>
        </Card>
      </div>
    );
  }

  const visiblePanels = activeGroup?.panels ?? [];

  return (
    <div className="space-y-6">
      <PluginInstallSection onChanged={handlePluginsChanged} />

      <Card className="border-[var(--border)] bg-[var(--card)]">
        <CardHeader className="space-y-4 pb-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Puzzle className="h-5 w-5 text-[var(--primary)]" />
              Ajustes por plugin
            </CardTitle>
            <CardDescription className="mt-1.5">
              {pluginGroups.length > 1
                ? "Elige un plugin para ver sus paneles de licencia, modelos y preferencias."
                : "Configura licencia, modelos y preferencias del plugin cargado."}
            </CardDescription>
          </div>
          <PluginSettingsGroupSelector
            groups={pluginGroups}
            value={activeGroup?.pluginId ?? ""}
            onValueChange={setActivePluginId}
          />
        </CardHeader>
        <CardContent className="border-t border-[var(--border)] pt-6">
          <div
            role="tabpanel"
            id={activeGroup ? `plugin-settings-panel-${activeGroup.pluginId}` : undefined}
            aria-labelledby={
              activeGroup ? `plugin-settings-tab-${activeGroup.pluginId}` : undefined
            }
            className="space-y-6"
          >
            {visiblePanels.map((panel) => (
              <PluginSettingsPanelCard
                key={`${panel.pluginId}:${panel.id}:${settingsRefreshKey}`}
                panel={panel}
                installed={installed}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

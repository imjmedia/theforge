import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { SYSTEM_CONFIG_SECRET_MASK, type SystemConfigCategory, type SystemConfigSnapshot } from "@theforge/shared-types";
import { UnderlineTabs, type UnderlineTabItem } from "./ui/UnderlineTabs";
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "./ui";
import { ListRowIconButton } from "./ListRowIconButton";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const SOURCE_LABELS = {
  database: "Guardado",
  env: "Env",
  default: "Default",
} as const;

const CATEGORY_ORDER: SystemConfigCategory[] = [
  "integrations",
  "auth",
  "llm",
  "queues",
  "mcp",
  "legacy",
  "cost",
  "debug",
];

const CATEGORY_SHORT_LABELS: Partial<Record<SystemConfigCategory, string>> = {
  integrations: "Integ.",
  auth: "Correo",
  llm: "LLM",
  queues: "Colas",
  mcp: "MCP",
  legacy: "Legacy",
  cost: "Coste",
  debug: "Debug",
};

type SystemConfigSettingRow = SystemConfigSnapshot["settings"][number];

function isTruthy(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isMaskedSecretValue(value: string): boolean {
  return value === SYSTEM_CONFIG_SECRET_MASK;
}

function resolveForgeOpsProvisionWebhookUrl(webDomain: string): string {
  const raw = webDomain.trim();
  if (raw) {
    const host = raw.replace(/^https?:\/\//i, "").split("/")[0]?.split(":")[0] ?? "";
    if (host) return `https://${host}/api/auth/forgeops/provision-user`;
  }
  if (typeof window !== "undefined" && window.location.origin) {
    return `${window.location.origin}/api/auth/forgeops/provision-user`;
  }
  return "/api/auth/forgeops/provision-user";
}

function buildForgeOpsProvisionExampleBody(webDomain: string): string {
  const loginUrl = (() => {
    const raw = webDomain.trim();
    if (!raw) {
      return typeof window !== "undefined" ? window.location.origin : "https://theforge.ejemplo.com";
    }
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
    const host = raw.replace(/^https?:\/\//i, "").split("/")[0]?.split(":")[0] ?? raw;
    return `https://${host}`;
  })();

  return JSON.stringify(
    {
      email: "dev@cliente.com",
      name: "Nombre Apellido",
      role: "developer",
      loginUrl,
      resendIfExists: true,
    },
    null,
    2,
  );
}

function CopyableMonoBlock({
  label,
  text,
  multiline = false,
}: {
  label: string;
  text: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-[var(--foreground-muted)]">{label}</p>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={() => void handleCopy()}>
          {copied ? <Check className="h-3.5 w-3.5 text-[var(--success)]" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <pre
        className={cn(
          "overflow-x-auto rounded-lg border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_18%,var(--card))] p-3 font-mono text-xs leading-relaxed text-[var(--foreground)]",
          multiline ? "whitespace-pre-wrap break-all" : "whitespace-nowrap",
        )}
      >
        {text}
      </pre>
    </div>
  );
}

function ForgeOpsProvisionWebhookHelp({ webDomain }: { webDomain: string }) {
  const webhookUrl = useMemo(() => resolveForgeOpsProvisionWebhookUrl(webDomain), [webDomain]);
  const exampleBody = useMemo(() => buildForgeOpsProvisionExampleBody(webDomain), [webDomain]);
  const authHeader = "Authorization: Bearer <forgeops_provision_secret>";

  return (
    <div className="w-full rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_12%,var(--card))] p-4">
      <p className="mb-3 text-sm font-medium text-[var(--foreground)]">Webhook ForgeOps (provision-user)</p>
      <div className="space-y-4">
        <CopyableMonoBlock label="POST" text={webhookUrl} />
        <CopyableMonoBlock label="Header" text={authHeader} />
        <CopyableMonoBlock label="Body (JSON)" text={exampleBody} multiline />
      </div>
      <p className="mt-3 text-xs text-[var(--foreground-muted)]">
        Crea o reactiva usuarios en instancias compartidas y envía acceso por correo (OTP + magic link).
        Campos opcionales: <code className="font-mono">name</code>, <code className="font-mono">role</code> (
        <code className="font-mono">developer</code> | <code className="font-mono">admin</code>),{" "}
        <code className="font-mono">loginUrl</code>, <code className="font-mono">resendIfExists</code>.
      </p>
    </div>
  );
}

function SystemConfigSettingField({
  setting,
  value,
  changed,
  onChange,
}: {
  setting: SystemConfigSettingRow;
  value: string;
  changed: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const [visible, setVisible] = useState(false);
  const [revealedPlain, setRevealedPlain] = useState<string | null>(null);
  const [revealLoading, setRevealLoading] = useState(false);
  const [revealError, setRevealError] = useState("");
  const [copied, setCopied] = useState(false);

  const isSecret = setting.secret || setting.type === "secret";
  const displayValue =
    isSecret && visible && revealedPlain !== null && isMaskedSecretValue(value)
      ? revealedPlain
      : value;

  const handleToggleVisible = async () => {
    if (!visible && isSecret && isMaskedSecretValue(value) && revealedPlain === null) {
      setRevealLoading(true);
      setRevealError("");
      try {
        const res = await api.get(`/api/admin/system-config/reveal/${encodeURIComponent(setting.key)}`);
        if (!res.ok) throw new Error("No se pudo revelar el valor");
        const data = (await res.json()) as { value?: string };
        setRevealedPlain(data.value ?? "");
      } catch {
        setRevealError("No se pudo cargar el valor");
        return;
      } finally {
        setRevealLoading(false);
      }
    }
    setVisible((v) => !v);
  };

  const handleCopy = async () => {
    if (!displayValue.trim()) return;
    try {
      await navigator.clipboard.writeText(displayValue);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      className="grid gap-2 border-b border-[var(--border)] pb-5 last:border-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:gap-4"
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-[var(--foreground)]">{setting.label}</p>
          <Badge variant="outline">{SOURCE_LABELS[setting.source]}</Badge>
          {setting.restartRequired ? <Badge variant="secondary">Reinicio worker</Badge> : null}
        </div>
        <p className="text-sm text-[var(--foreground-muted)]">{setting.description}</p>
        <p className="font-mono text-xs text-[var(--foreground-muted)]">
          {setting.envKey} · default: {setting.defaultValue || "∅"}
        </p>
      </div>

      <div className="min-w-0 space-y-1">
        {setting.type === "boolean" ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-[var(--border)]"
              checked={isTruthy(value)}
              onChange={(e) => onChange(setting.key, e.target.checked ? "1" : "0")}
            />
            {isTruthy(value) ? "Activado" : "Desactivado"}
          </label>
        ) : isSecret ? (
          <div className="relative">
            <Input
              type={visible ? "text" : "password"}
              value={displayValue}
              placeholder={setting.defaultValue || setting.envKey}
              autoComplete="off"
              onChange={(e) => onChange(setting.key, e.target.value)}
              className={cn("pr-[5.5rem] font-mono text-sm", changed && "ring-1 ring-[var(--primary)]")}
            />
            <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
              <ListRowIconButton
                tooltip={visible ? "Ocultar" : "Mostrar"}
                variant="ghost"
                className="h-8 w-8 border-0 bg-transparent shadow-none hover:bg-[var(--muted)]"
                disabled={revealLoading || (!value && !setting.defaultValue)}
                onClick={() => void handleToggleVisible()}
              >
                {revealLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : visible ? (
                  <EyeOff className="h-4 w-4" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden />
                )}
              </ListRowIconButton>
              <ListRowIconButton
                tooltip={copied ? "Copiado" : "Copiar"}
                variant="ghost"
                className="h-8 w-8 border-0 bg-transparent shadow-none hover:bg-[var(--muted)]"
                disabled={!displayValue.trim() || revealLoading}
                onClick={() => void handleCopy()}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-[var(--success)]" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
              </ListRowIconButton>
            </div>
          </div>
        ) : (
          <Input
            type={setting.type === "number" ? "number" : "text"}
            value={value}
            placeholder={setting.defaultValue || setting.envKey}
            min={setting.min}
            max={setting.max}
            onChange={(e) => onChange(setting.key, e.target.value)}
            className={cn(changed && "ring-1 ring-[var(--primary)]")}
          />
        )}
        {revealError ? <p className="text-xs text-red-500">{revealError}</p> : null}
      </div>
    </div>
  );
}

export function SystemConfigCard() {
  const [snapshot, setSnapshot] = useState<SystemConfigSnapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [activeCategory, setActiveCategory] = useState<SystemConfigCategory>("integrations");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const fetchSnapshot = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.get("/api/admin/system-config");
      if (!res.ok) {
        if (res.status === 403) throw new Error("Se requiere rol super_admin");
        throw new Error("No se pudo cargar la configuración");
      }
      const data = (await res.json()) as SystemConfigSnapshot;
      setSnapshot(data);
      setDraft(Object.fromEntries(data.settings.map((s) => [s.key, s.value])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const categories = useMemo(() => {
    if (!snapshot) return [];
    const labelById = new Map(snapshot.categories.map((c) => [c.id, c.label]));
    const descriptionById = new Map(snapshot.categories.map((c) => [c.id, c.description]));
    return CATEGORY_ORDER.filter((id) =>
      snapshot.settings.some((s) => s.category === id),
    ).map((id) => ({
      id,
      label: labelById.get(id) ?? id,
      description: descriptionById.get(id) ?? "",
      settings: snapshot.settings.filter((s) => s.category === id),
    }));
  }, [snapshot]);

  const categoryTabs = useMemo((): UnderlineTabItem<SystemConfigCategory>[] => {
    return categories.map(({ id, label }) => ({
      id,
      label,
      shortLabel: CATEGORY_SHORT_LABELS[id] ?? label,
    }));
  }, [categories]);

  const activeCategoryData = useMemo(
    () => categories.find((c) => c.id === activeCategory) ?? categories[0] ?? null,
    [activeCategory, categories],
  );

  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.some((c) => c.id === activeCategory)) {
      setActiveCategory(categories[0]!.id);
    }
  }, [activeCategory, categories]);

  const changedKeys = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.settings
      .filter((s) => draft[s.key] !== s.value)
      .map((s) => s.key);
  }, [draft, snapshot]);

  const handleSave = async () => {
    if (!snapshot || changedKeys.length === 0) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const settings: Record<string, string | null> = {};
      for (const key of changedKeys) {
        const value = draft[key]?.trim() ?? "";
        settings[key] = value === "" ? null : value;
      }
      const res = await api.patch("/api/admin/system-config", { settings });
      if (!res.ok) throw new Error("Error al guardar");
      const data = (await res.json()) as SystemConfigSnapshot;
      setSnapshot(data);
      setDraft(Object.fromEntries(data.settings.map((s) => [s.key, s.value])));
      setSuccess("Configuración guardada");
      window.setTimeout(() => setSuccess(""), 3200);
    } catch {
      setError("Error al guardar configuración");
    } finally {
      setSaving(false);
    }
  };

  const handleResetDraft = () => {
    if (!snapshot) return;
    setDraft(Object.fromEntries(snapshot.settings.map((s) => [s.key, s.value])));
  };

  const handleDraftChange = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-12 text-[var(--foreground-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
          Cargando configuración del sistema…
        </CardContent>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-red-500">{error || "Sin datos"}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-[var(--primary)]" />
            Configuración del sistema
          </CardTitle>
          <CardDescription>
            Valores de plataforma persistidos en base de datos. Prioridad:{" "}
            <strong>UI/BD → env → default</strong>. Versión {snapshot.version}.
            Los ajustes de colas BullMQ requieren reiniciar el worker para aplicarse.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void fetchSnapshot()} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Recargar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleResetDraft}
            disabled={changedKeys.length === 0}
          >
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Descartar cambios
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || changedKeys.length === 0}
          >
            {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Guardar
          </Button>
          {success ? (
            <span className="inline-flex items-center gap-1 text-sm text-emerald-600">
              <Check className="h-4 w-4" />
              {success}
            </span>
          ) : null}
          {error ? <span className="text-sm text-red-500">{error}</span> : null}
        </CardContent>
      </Card>

      {categoryTabs.length > 0 ? (
        <UnderlineTabs
          tabs={categoryTabs}
          value={activeCategoryData?.id ?? categoryTabs[0]!.id}
          onValueChange={setActiveCategory}
          ariaLabel="Categorías de configuración del sistema"
          idPrefix="system-config"
        />
      ) : null}

      {activeCategoryData ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{activeCategoryData.label}</CardTitle>
            {activeCategoryData.description ? (
              <CardDescription>{activeCategoryData.description}</CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-5">
            {activeCategoryData.settings.map((setting) => (
              <div key={setting.key} className="space-y-3">
                <SystemConfigSettingField
                  setting={setting}
                  value={draft[setting.key] ?? ""}
                  changed={changedKeys.includes(setting.key)}
                  onChange={handleDraftChange}
                />
                {setting.key === "forgeops_provision_secret" ? (
                  <ForgeOpsProvisionWebhookHelp webDomain={draft.web_domain ?? ""} />
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

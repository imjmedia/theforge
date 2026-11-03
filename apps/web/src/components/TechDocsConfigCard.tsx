import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import { Button, Input } from "./ui";
import { api } from "@/utils/apiClient";
import { cn } from "@/lib/utils";

const DEFAULT_CONTEXT7_MCP_URL = "https://mcp.context7.com/mcp";

interface TechDocsConfig {
  url: string;
  token: string;
}

const FEATURES = [
  {
    icon: BookOpen,
    title: "Docs oficiales",
    desc: "NestJS, Prisma, React y más",
  },
  {
    icon: KeyRound,
    title: "API key tuya",
    desc: "Context7 por usuario, no plataforma",
  },
  {
    icon: PlugZap,
    title: "Enriquece SDD",
    desc: "Architecture, API y Tasks",
  },
] as const;

export function TechDocsConfigCard() {
  const [config, setConfig] = useState<TechDocsConfig>({ url: DEFAULT_CONTEXT7_MCP_URL, token: "" });
  const [initial, setInitial] = useState<TechDocsConfig>({ url: DEFAULT_CONTEXT7_MCP_URL, token: "" });
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [tokenVisible, setTokenVisible] = useState(false);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.get("/api/auth/tech-docs-config");
      if (!res.ok) throw new Error("No se pudo obtener la configuración");
      const data: TechDocsConfig = await res.json();
      const normalized = {
        url: data.url?.trim() || DEFAULT_CONTEXT7_MCP_URL,
        token: data.token ?? "",
      };
      setConfig(normalized);
      setInitial(normalized);
    } catch {
      setError("Error al cargar configuración de documentación técnica");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const hasChanges =
    config.url !== initial.url || config.token !== initial.token;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.put("/api/auth/tech-docs-config", {
        url: config.url || undefined,
        token: config.token || undefined,
      });
      if (!res.ok) throw new Error("Error al guardar");
      setInitial({ ...config });
      setSuccess("Configuración guardada");
      window.setTimeout(() => setSuccess(""), 3200);
    } catch {
      setError("Error al guardar configuración");
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setError("");
    setSuccess("");
    try {
      const res = await api.post("/api/admin/tech-docs-config/test", {
        url: config.url,
        token: config.token,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Conexión fallida");
      setSuccess("Conexión exitosa con Context7 MCP");
      window.setTimeout(() => setSuccess(""), 4000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al probar conexión");
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
            Documentación técnica (Context7)
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
            Enlaza tu API key de Context7 para enriquecer Architecture, Contratos API, Tasks y
            **Fase 0 / Benchmark** (tokens API, OAuth, webhooks) con documentación oficial.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 shrink-0 gap-2 rounded-xl max-sm:w-full"
          disabled={loading}
          onClick={() => void fetchConfig()}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
          Recargar
        </Button>
      </div>

      {!loading ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
          {FEATURES.map(({ icon: Icon, title, desc }) => (
            <div
              key={title}
              className="flex items-start gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-3 sm:rounded-xl"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]">
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-[var(--foreground)]">{title}</span>
                <span className="block text-[11px] leading-snug text-[var(--foreground-muted)]">
                  {desc}
                </span>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      {success ? (
        <p className="rounded-2xl border border-[var(--success)]/30 bg-[color-mix(in_oklch,var(--success)_12%,var(--card))] px-4 py-3 text-sm text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]">
          {success}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] py-14 text-sm text-[var(--foreground-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Cargando configuración…
        </div>
      ) : (
        <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
          <div className="border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] px-4 py-4 sm:px-5 sm:py-5">
            <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
              MCP Context7
            </h3>
            <p className="mt-0.5 text-sm text-[var(--foreground-muted)]">
              URL del servidor remoto y tu API key (header CONTEXT7_API_KEY).
            </p>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            <div className="space-y-2">
              <label
                htmlFor="tech-docs-url"
                className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"
              >
                <Globe className="h-4 w-4 text-[var(--foreground-muted)]" aria-hidden />
                URL del MCP
              </label>
              <Input
                id="tech-docs-url"
                className="h-11 rounded-xl border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--input))] font-mono text-sm"
                placeholder={DEFAULT_CONTEXT7_MCP_URL}
                value={config.url}
                onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
                autoComplete="url"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="tech-docs-token"
                className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"
              >
                <KeyRound className="h-4 w-4 text-[var(--foreground-muted)]" aria-hidden />
                API key Context7
              </label>
              <div className="relative">
                <Input
                  id="tech-docs-token"
                  type={tokenVisible ? "text" : "password"}
                  className="h-11 rounded-xl border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--input))] pr-11 font-mono text-sm"
                  placeholder="ctx7sk_…"
                  value={config.token}
                  onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() => setTokenVisible((v) => !v)}
                  aria-label={tokenVisible ? "Ocultar API key" : "Mostrar API key"}
                >
                  {tokenVisible ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                type="button"
                size="sm"
                className="h-11 w-full gap-2 rounded-xl sm:w-auto"
                onClick={() => void handleSave()}
                loading={saving}
                disabled={saving || !hasChanges}
              >
                {!saving ? <Check className="h-4 w-4" aria-hidden /> : null}
                {hasChanges ? "Guardar cambios" : "Sin cambios"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-11 w-full gap-2 rounded-xl sm:w-auto"
                onClick={() => void handleTestConnection()}
                loading={testing}
                disabled={testing || !config.token}
              >
                {!testing ? <PlugZap className="h-4 w-4" aria-hidden /> : null}
                Probar conexión
              </Button>
            </div>
          </div>
        </article>
      )}

      <div className="rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_18%,var(--card))] px-4 py-3.5 sm:px-5">
        <p className="text-xs leading-relaxed text-[var(--foreground-muted)]">
          <span className="font-medium text-[var(--foreground)]">Opcional:</span> sin API key la
          generación SDD sigue igual. No sustituye Ariadne (código indexado) ni MCP gráfico
          (componentes UI).
        </p>
      </div>
    </section>
  );
}

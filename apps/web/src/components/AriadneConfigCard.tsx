import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  PlugZap,
  RefreshCw,
} from "lucide-react";
import GithubMono from "@lobehub/icons/es/Github/components/Mono";
import { Button, Input } from "./ui";
import { AriadneLogo } from "@/components/AriadneLogo";
import { api } from "@/utils/apiClient";
import { cn } from "@/lib/utils";

const ARIADNE_REPO_URL = "https://github.com/kreodevs/ariadne";

interface AriadneConfig {
  url: string;
  token: string;
}

const FEATURES = [
  {
    icon: BookOpen,
    title: "Base de conocimiento",
    desc: "Proyectos importados como contexto",
  },
  {
    icon: PlugZap,
    title: "MCP HTTPS",
    desc: "Protocolo estándar de herramientas",
  },
  {
    icon: Globe,
    title: "Multi-tenant",
    desc: "Token por usuario en Ariadne",
  },
] as const;

export function AriadneConfigCard() {
  const [config, setConfig] = useState<AriadneConfig>({ url: "", token: "" });
  const [initial, setInitial] = useState<AriadneConfig>({ url: "", token: "" });
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
      const res = await api.get("/api/auth/ariadne-config");
      if (!res.ok) throw new Error("No se pudo obtener la configuración");
      const data: AriadneConfig = await res.json();
      setConfig(data);
      setInitial(data);
    } catch {
      setError("Error al cargar configuración de Ariadne");
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
      const res = await api.put("/api/auth/ariadne-config", {
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
      const res = await api.post("/api/admin/ariadne-config/test", {
        url: config.url,
        token: config.token,
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Conexión fallida");
      setSuccess("Conexión exitosa con Ariadne MCP");
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
            Conexión MCP
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
            Enlaza TheForge con Ariadne para importar proyectos existentes como base de
            conocimiento en el taller.
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

      <a
        href={ARIADNE_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group flex items-center gap-3.5 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3.5 transition-all sm:rounded-xl sm:px-5",
          "hover:border-[color-mix(in_oklch,var(--primary)_35%,var(--border))]",
          "hover:bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] hover:shadow-[0_6px_24px_rgba(0,0,0,0.08)]",
          "active:scale-[0.99]",
        )}
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_30%,var(--card))] text-[var(--foreground)]">
          <GithubMono size={22} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--foreground)] group-hover:text-[var(--primary)]">
            Repositorio en GitHub
          </span>
          <span className="mt-0.5 block font-mono text-xs text-[var(--foreground-muted)]">
            kreodevs/ariadne
          </span>
          <span className="mt-1 block text-[11px] leading-snug text-[var(--foreground-muted)]">
            README, MCP, despliegue y cómo funciona la integración con TheForge
          </span>
        </span>
        <ExternalLink
          className="h-4 w-4 shrink-0 text-[var(--foreground-muted)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--foreground)]"
          aria-hidden
        />
      </a>

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
                <span className="block text-xs font-semibold text-[var(--foreground)]">
                  {title}
                </span>
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
            <div className="flex flex-wrap items-center gap-3">
              <AriadneLogo size="md" className="shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
                  Endpoint MCP
                </h3>
                <p className="mt-0.5 text-sm text-[var(--foreground-muted)]">
                  URL y token del usuario en Ariadne (no el Secret MCP de TheForge).
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-5 p-4 sm:p-5">
            <div className="space-y-2">
              <label
                htmlFor="ariadne-url"
                className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"
              >
                <Globe className="h-4 w-4 text-[var(--foreground-muted)]" aria-hidden />
                URL del MCP
              </label>
              <Input
                id="ariadne-url"
                className="h-11 rounded-xl border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--input))] font-mono text-sm"
                placeholder="https://tu-instancia.ejemplo.com/mcp"
                value={config.url}
                onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
                autoComplete="url"
              />
            </div>

            <div className="space-y-2">
              <label
                htmlFor="ariadne-token"
                className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"
              >
                <KeyRound className="h-4 w-4 text-[var(--foreground-muted)]" aria-hidden />
                Token MCP de Ariadne
              </label>
              <div className="relative">
                <Input
                  id="ariadne-token"
                  type={tokenVisible ? "text" : "password"}
                  className="h-11 rounded-xl border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--input))] pr-11 font-mono text-sm"
                  placeholder="mcp_secret_del_usuario_en_ariadne"
                  value={config.token}
                  onChange={(e) => setConfig((c) => ({ ...c, token: e.target.value }))}
                  autoComplete="off"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--foreground-muted)] transition-colors hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                  onClick={() => setTokenVisible((v) => !v)}
                  aria-label={tokenVisible ? "Ocultar token" : "Mostrar token"}
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
                disabled={testing || !config.url}
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
          <span className="font-medium text-[var(--foreground)]">Importante:</span> el token es
          el MCP Secret del usuario en Ariadne con permiso sobre los proyectos que quieras
          consultar. No uses el Secret MCP de TheForge (pestaña Cuenta).
        </p>
      </div>
    </section>
  );
}

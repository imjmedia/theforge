import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  RefreshCw,
  Shield,
} from "lucide-react";
import { Button, Input } from "./ui";
import { ListRowIconButton } from "@/components/ListRowIconButton";
import { api, setAccessToken } from "@/utils/apiClient";
import { cn } from "@/lib/utils";

const ACCOUNT_FEATURES = [
  {
    icon: Shield,
    title: "Autenticación M2M",
    desc: "El MCP server actúa como tu usuario",
  },
  {
    icon: RefreshCw,
    title: "Secret rotable",
    desc: "Regenerar invalida el anterior al instante",
  },
] as const;

export interface AccountConfigCardProps {
  showIaCost: boolean;
  onToggleIaCost: () => void;
}

/**
 * Settings → Cuenta: secret MCP del usuario y preferencias de interfaz.
 */
export function AccountConfigCard({ showIaCost, onToggleIaCost }: AccountConfigCardProps) {
  const [mcpSecret, setMcpSecret] = useState("");
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const fetchSecret = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api.get("/api/auth/mcp-secret");
      if (!res.ok) throw new Error("No se pudo obtener el secret");
      const data = await res.json();
      setMcpSecret(data.mcpSecret ?? "");
      if (data.message) setMessage(data.message);
    } catch {
      setError("Error al obtener el secret MCP");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSecret();
  }, [fetchSecret]);

  const handleRegenerate = async () => {
    if (!mcpSecret && !window.confirm("¿Estás seguro? Esto invalidará el secret actual.")) {
      return;
    }
    if (
      mcpSecret &&
      !window.confirm(
        "¿Regenerar el secret MCP? El secret anterior dejará de funcionar inmediatamente.",
      )
    ) {
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");
    try {
      const res = await api.post("/api/auth/mcp-secret/regenerate");
      if (!res.ok) throw new Error("No se pudo regenerar el secret");
      const data = await res.json();
      // La rotación revoca los JWT anteriores: guarda el token nuevo antes de cualquier otra petición.
      if (typeof data.accessToken === "string" && data.accessToken) setAccessToken(data.accessToken);
      setMcpSecret(data.mcpSecret ?? "");
      setMessage("Secret regenerado. Guárdalo de inmediato.");
      window.setTimeout(() => setMessage(""), 4000);
    } catch {
      setError("Error al regenerar el secret MCP");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!mcpSecret) return;
    try {
      await navigator.clipboard.writeText(mcpSecret);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = mcpSecret;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const secretDisplay = mcpSecret
    ? visible
      ? mcpSecret
      : "•".repeat(Math.min(mcpSecret.length, 48))
    : "";

  return (
    <section className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight text-[var(--foreground)] sm:text-lg">
            Tu cuenta
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[var(--foreground-muted)]">
            Credencial MCP para integraciones y preferencias del taller en esta sesión.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-10 shrink-0 gap-2 rounded-xl max-sm:w-full"
          disabled={loading}
          onClick={() => void fetchSecret()}
        >
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden />
          Recargar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
        {ACCOUNT_FEATURES.map(({ icon: Icon, title, desc }) => (
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

      {message ? (
        <p className="rounded-2xl border border-[var(--success)]/30 bg-[color-mix(in_oklch,var(--success)_12%,var(--card))] px-4 py-3 text-sm text-[color-mix(in_oklch,var(--success)_88%,var(--foreground))]">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/10 px-4 py-3 text-sm text-[var(--destructive)]">
          {error}
        </p>
      ) : null}

      <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_8px_32px_rgba(0,0,0,0.08)]">
        <div className="border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] px-4 py-4 sm:px-5 sm:py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]">
              <Shield className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-semibold tracking-tight text-[var(--foreground)]">
                Secret MCP
              </h3>
              <p className="mt-0.5 text-sm text-[var(--foreground-muted)]">
                Token para que el MCP server de TheForge se autentique como tu usuario.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="space-y-2">
            <label
              htmlFor="mcp-secret"
              className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]"
            >
              <KeyRound className="h-4 w-4 text-[var(--foreground-muted)]" aria-hidden />
              Tu secret
            </label>
            <div className="relative">
              <Input
                id="mcp-secret"
                readOnly
                className="h-11 rounded-xl border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_15%,var(--input))] pr-[5.5rem] font-mono text-sm"
                value={loading && !mcpSecret ? "Cargando…" : secretDisplay}
                placeholder={loading ? undefined : "Sin secret disponible"}
              />
              <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
                <ListRowIconButton
                  tooltip={visible ? "Ocultar" : "Mostrar"}
                  variant="ghost"
                  className="h-8 w-8 border-0 bg-transparent shadow-none hover:bg-[var(--muted)]"
                  disabled={!mcpSecret || loading}
                  onClick={() => setVisible((v) => !v)}
                >
                  {visible ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </ListRowIconButton>
                <ListRowIconButton
                  tooltip={copied ? "Copiado" : "Copiar"}
                  variant="ghost"
                  className="h-8 w-8 border-0 bg-transparent shadow-none hover:bg-[var(--muted)]"
                  disabled={!mcpSecret || loading}
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
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-11 w-full gap-2 rounded-xl sm:w-auto"
              onClick={() => void handleRegenerate()}
              loading={loading}
              disabled={loading}
            >
              {!loading ? <RefreshCw className="h-4 w-4" aria-hidden /> : null}
              Regenerar secret
            </Button>
          </div>
        </div>
      </article>

      <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
        <div className="border-b border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_22%,var(--card))] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklch,var(--primary)_12%,var(--card))] text-[var(--primary)]">
              <Gauge className="h-4 w-4" aria-hidden />
            </span>
            <h3 className="text-sm font-semibold text-[var(--foreground)]">Preferencias del taller</h3>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Mostrar costo de IA en semáforo
            </p>
            <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
              Muestra el desglose de coste en la columna de métricas del workshop.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showIaCost}
            aria-label="Mostrar costo de IA en semáforo"
            onClick={onToggleIaCost}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors",
              showIaCost
                ? "bg-[var(--primary)]"
                : "bg-[color-mix(in_oklch,var(--muted-foreground)_25%,var(--border))]",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
                showIaCost ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      </article>

      <div className="rounded-2xl border border-[var(--border)] bg-[color-mix(in_oklch,var(--muted)_18%,var(--card))] px-4 py-3.5 sm:px-5">
        <p className="text-xs leading-relaxed text-[var(--foreground-muted)]">
          <span className="font-medium text-[var(--foreground)]">Seguridad:</span> este secret
          permite que el MCP actúe en tu nombre. Si lo comprometes, regenéralo para invalidar el
          anterior. No lo confundas con el token MCP de Ariadne (pestaña Ariadne).
        </p>
      </div>
    </section>
  );
}

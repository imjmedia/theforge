import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, Trash2 } from "lucide-react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input } from "@/components/ui";
import {
  deleteFigmaIntegration,
  fetchFigmaIntegrationStatus,
  upsertFigmaIntegrationToken,
  type FigmaCredentialStatus,
} from "@/lib/design-first-api";

function formatValidatedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("es-MX");
  } catch {
    return iso;
  }
}

/** Ajustes de usuario: token personal de Figma (BYOK). El token nunca se vuelve a mostrar. */
export function FigmaCredentialSettings() {
  const [status, setStatus] = useState<FigmaCredentialStatus | null>(null);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await fetchFigmaIntegrationStatus());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el estado de Figma");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Escribe un token de Figma.");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const next = await upsertFigmaIntegrationToken(trimmed);
      setStatus(next);
      setToken("");
      setSuccess("Figma conectado correctamente.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar el token";
      setError(
        /inválido|expiró|401|403/i.test(msg)
          ? "El token de Figma es inválido o expiró; vuelve a conectar tu cuenta."
          : msg,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await deleteFigmaIntegration();
      setStatus({ connected: false, figmaHandle: null, lastValidatedAt: null });
      setSuccess("Figma desconectado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo desconectar");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="h-5 w-5 text-[var(--primary)]" aria-hidden />
          Figma (personal)
        </CardTitle>
        <CardDescription>
          Token personal para importar frames en proyectos Design-First. Tras guardar, el token se borra del
          formulario y no se vuelve a mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando…
          </div>
        ) : (
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-[var(--foreground-muted)]">Estado</dt>
              <dd>{status?.connected ? "Conectado" : "Sin conectar"}</dd>
            </div>
            {status?.connected ? (
              <>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--foreground-muted)]">Usuario Figma</dt>
                  <dd>{status.figmaHandle ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--foreground-muted)]">Última validación</dt>
                  <dd>{formatValidatedAt(status.lastValidatedAt)}</dd>
                </div>
              </>
            ) : null}
          </dl>
        )}

        <div className="space-y-2">
          <label htmlFor="figma-token" className="text-sm font-medium text-[var(--foreground)]">
            Token personal de Figma
          </label>
          <Input
            id="figma-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="figd_…"
            disabled={saving}
          />
        </div>

        {error ? <p className="text-sm text-[color-mix(in_oklch,var(--destructive)_90%,var(--foreground))]">{error}</p> : null}
        {success ? <p className="text-sm text-[color-mix(in_oklch,var(--success)_85%,var(--foreground))]">{success}</p> : null}

        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Conectar"}
          </Button>
          {status?.connected ? (
            <Button type="button" variant="outline" disabled={saving} onClick={() => void handleDisconnect()}>
              <Trash2 className="mr-1 h-4 w-4" aria-hidden />
              Desconectar
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

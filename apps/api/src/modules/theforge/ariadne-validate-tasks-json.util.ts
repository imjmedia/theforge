/**
 * Optional Ariadne Gate 2 validate-tasks-json (warn-only on import).
 */
import { resolveAriadneIngestApiConfig } from "./ariadne-ingest-api.util.js";

export type AriadneValidateTasksJsonResult = {
  ok: boolean;
  warnings: string[];
  skippedReason?: string;
};

export async function validateTasksJsonWithAriadneGate2(input: {
  projectId: string;
  tasksJson: unknown;
  mcpUrl?: string | null;
  mcpToken?: string | null;
  explicitIngestUrl?: string | null;
}): Promise<AriadneValidateTasksJsonResult> {
  const config = resolveAriadneIngestApiConfig({
    mcpUrl: input.mcpUrl,
    userMcpToken: input.mcpToken,
    explicitIngestUrl: input.explicitIngestUrl,
  });
  if (!config) {
    return { ok: true, warnings: [], skippedReason: "ariadne_api_not_configured" };
  }

  const url = `${config.baseUrl}/projects/${encodeURIComponent(input.projectId.trim())}/validate-tasks-json`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tasksJson: input.tasksJson }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: true,
        warnings: [`Ariadne validate-tasks-json HTTP ${res.status}: ${text.slice(0, 240)}`],
      };
    }
    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      warnings?: string[];
      errors?: string[];
    };
    const warnings = [
      ...(Array.isArray(body.warnings) ? body.warnings.map(String) : []),
      ...(Array.isArray(body.errors) ? body.errors.map((e) => `error: ${e}`) : []),
    ];
    return { ok: body.ok !== false, warnings };
  } catch (e) {
    return {
      ok: true,
      warnings: [`Ariadne validate-tasks-json unreachable: ${e instanceof Error ? e.message : String(e)}`],
    };
  }
}

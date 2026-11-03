import { API_BASE, apiFetch } from "@/utils/apiClient";

export interface RegenerateMermaidInput {
  /** Diagrama que falló (el original, no una reparación). */
  content: string;
  /** Mensaje real del parser de Mermaid. El backend aún lo ignora; F2 lo usará en el prompt. */
  error?: string;
}

export async function regenerateMermaidDiagram(input: RegenerateMermaidInput): Promise<string> {
  const { content, error } = input;
  const res = await apiFetch(`${API_BASE}/ai/mermaid/regenerate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(error ? { content, error } : { content }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Error al regenerar diagrama (${res.status})`);
  }
  const data = (await res.json()) as { content?: string };
  if (typeof data.content !== "string" || !data.content.trim()) {
    throw new Error("La IA no devolvió un diagrama válido");
  }
  return data.content.trim();
}

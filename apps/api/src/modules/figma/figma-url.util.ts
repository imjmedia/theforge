/** Figma file keys are alphanumeric (API file key segment). */
export const FIGMA_FILE_KEY_REGEX = /^[0-9A-Za-z]{10,128}$/;

export type ParsedFigmaFileUrl = {
  fileKey: string;
  nodeIdFromUrl?: string;
};

export function parseFigmaFileUrl(fileUrl: string): ParsedFigmaFileUrl | null {
  const trimmed = fileUrl.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "www.figma.com" && host !== "figma.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const kind = parts[0];
  const fileKey = parts[1];
  if ((kind !== "file" && kind !== "design") || !fileKey || !FIGMA_FILE_KEY_REGEX.test(fileKey)) {
    return null;
  }

  const nodeParam = url.searchParams.get("node-id") ?? url.searchParams.get("node_id");
  const nodeIdFromUrl = nodeParam ? decodeFigmaNodeIdParam(nodeParam) : undefined;
  return { fileKey, nodeIdFromUrl };
}

/** Converts `1-2` or `1%3A2` style query params to Figma node id `1:2`. */
export function decodeFigmaNodeIdParam(raw: string): string {
  const decoded = decodeURIComponent(raw.trim());
  return decoded.includes(":") ? decoded : decoded.replace(/-/g, ":");
}

export function encodeFigmaNodeIdsForApi(nodeIds: string[]): string {
  return nodeIds.map((id) => encodeURIComponent(id.trim())).join(",");
}

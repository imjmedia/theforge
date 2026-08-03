/** Stub enviado por GET /projects/:id cuando hay datos persistidos sin el payload. */
export function isPluginDataPresenceStub(value: unknown): value is true {
  return value === true;
}

/** Fusiona pluginData del fetch inicial preservando objetos ya cargados en el store. */
export function mergePluginDataFromFetch(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const next = { ...existing };
  for (const [pluginId, value] of Object.entries(incoming ?? {})) {
    if (isPluginDataPresenceStub(value)) {
      if (next[pluginId] === undefined || isPluginDataPresenceStub(next[pluginId])) {
        next[pluginId] = true;
      }
    } else {
      next[pluginId] = value;
    }
  }
  return next;
}

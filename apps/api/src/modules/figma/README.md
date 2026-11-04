# FigmaModule

Importación Design-First desde Figma con token personal BYOK (`UserFigmaCredential`).

- **API pública:** solo `FigmaImportService` (exportado).
- **Credencial:** `GET|PUT|DELETE /me/integrations/figma` — el token nunca se devuelve.
- **Import:** `POST /projects/:id/design/import/figma` (nivel `contribute`) delega en `FigmaImportService` → propuesta diff HITL.

Errores: `ERR_FIGMA_NOT_CONNECTED`, `ERR_FIGMA_URL`, `ERR_FIGMA_NO_FRAMES`, `ERR_FIGMA_TOKEN_INVALID`, `ERR_FIGMA_RATE_LIMIT`, `ERR_FIGMA_TOO_MANY_NODES`.

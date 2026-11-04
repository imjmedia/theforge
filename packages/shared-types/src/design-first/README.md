# Design-First (`shared-types`)

Contratos y compiladores del modo **Design-First** (`ProjectType.DESIGN_FIRST`).

## Módulos

| Archivo | Paso | Descripción |
|---------|------|-------------|
| `design-spec.ts` | 6 | Esquema zod `designSpec`, invariantes I1–I3, adaptadores ScreenSpec v1 |
| `design-spec-hash.node.ts` | 6 | `hashDesignSpec` (Node/API; subpath `@theforge/shared-types/design-spec-hash.node`) |
| `compile-data-needs-to-pag.ts` | 7 | Compilador determinista DataNeeds → PAG (I4–I6) |
| `design-first-gates.ts` | 7 | Puertas `phase1` / `phase2` / `phase3` (I9) |
| `__fixtures__/three-screens.pag.json` | 7 | Golden del PAG |
| `__fixtures__/three-screens.json` | 6 | Golden de entrada (3 pantallas) |
| `export-pag-to-msw.ts` | 8 | Handlers MSW v2 emitidos como string (`handlers.ts`, `browser.ts`) |
| `build-pag-fixtures.ts` | 8 | Fixtures JSON con semilla fija e integridad FK (I8) |
| `render-design-markdown.ts` | 8 | `pantallas.md` y `datos.md` deterministas |
| `design-first-api.ts` | 10 | DTOs zod (`PUT` pantallas/datos, `compile-contract`) |
| `design-first-gates-api.ts` | 10 | Helpers de respuesta de puertas para la API |
| `__fixtures__/three-screens.*` | 8 | Goldens OpenAPI, MSW, fixtures y markdown |

Export público: `@theforge/shared-types` vía `./design-first/index.js`.

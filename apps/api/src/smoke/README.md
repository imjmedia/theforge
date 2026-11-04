# Smoke tests (API)

Pruebas ligeras que validan wiring entre módulos o flujos de punta a punta sin levantar el servidor HTTP completo.

| Spec | Qué cubre |
|------|-----------|
| `cross-module-imports.smoke.spec.ts` | Imports rotos entre áreas del API |
| `design-first.smoke.spec.ts` | Flujo Design-First golden → contrato → MDD simulado → cascada → handoff (paso 26 / RF-16) |

```bash
pnpm --filter @theforge/api test --test-path-pattern=design-first.smoke
```

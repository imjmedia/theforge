# FX Rate

Tipo de cambio MXN/USD para estimaciones de costo. Lee de `AppConfig` con caché en memoria (TTL 1h).

## Capa

- **`fx-rate.service.ts`** — `getMxnUsdRate()` — resuelve de BD → env `MXN_USD_RATE` → default 17.0.
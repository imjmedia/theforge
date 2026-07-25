# Crypto

Cifrado AES-256-GCM para tokens BYOK de proveedores IA. Las API keys se almacenan cifradas en BD; solo se desencriptan en runtime.

## Configuración

- `MASTER_ENCRYPTION_KEY` — clave maestra de 32 bytes en hex (64 chars). Obligatoria en producción.
- `MASTER_ENCRYPTION_KEY_PREV` — clave anterior para rotación sin downtime.

## Capa

- **`token-crypto.service.ts`** — `encryptToken` / `decryptToken` con AES-256-GCM + IV aleatorio.
- **`crypto.config.ts`** — carga y valida claves desde env.
- **`crypto.module.ts`** — módulo global NestJS.
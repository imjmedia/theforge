# Crypto

Cifrado AES-256-GCM para tokens BYOK (proveedores IA, MCP gráfico, Figma personal). Las credenciales se almacenan cifradas en BD; solo se desencriptan en runtime dentro del servicio que las consume.

## Configuración

- **`TOKEN_MASTER_KEYS`** — JSON `{ "1": "<base64 32 bytes>", "2": "..." }`. Obligatorio en producción. Cada valor debe decodificar a **32 bytes**.
- **`TOKEN_ACTIVE_KEY_VERSION`** — Entero ≥ 1; versión usada al **cifrar** tokens nuevos. Debe existir en `TOKEN_MASTER_KEYS`.

La carga y validación viven en `crypto.config.ts` (`parseTokenMasterKeys`, `getActiveKeyVersion`).

Rotación sin downtime: añadir una nueva versión en `TOKEN_MASTER_KEYS`, migrar ciphertexts con `scripts/rotate-master-key.ts` (incluye `UserProviderConfig`, `UiMcpInstance`, `UserFigmaCredential`) y subir `TOKEN_ACTIVE_KEY_VERSION`.

> **Nota histórica:** documentación antigua mencionaba `MASTER_ENCRYPTION_KEY`; el código actual usa solo `TOKEN_MASTER_KEYS` / `TOKEN_ACTIVE_KEY_VERSION`.

## Capa

- **`token-crypto.service.ts`** — `encryptToken` / `decryptToken` con AES-256-GCM + IV aleatorio; etiqueta `tokenKeyVersion` por fila.
- **`crypto.config.ts`** — carga y valida claves desde env.
- **`crypto.module.ts`** — módulo global NestJS.

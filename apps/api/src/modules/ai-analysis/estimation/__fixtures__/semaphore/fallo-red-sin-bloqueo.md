## 1. Contexto

App interna.

## 2. Arquitectura

NestJS.

## 3. Modelo de Datos

```sql
CREATE TABLE users (id UUID PRIMARY KEY, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ);
```

## 4. Contratos de API

GET /api/health

## 5. Lógica y Edge Cases

Ante un fallo de red en el cliente móvil se reintenta la petición con backoff exponencial sin bloquear la cuenta del usuario.

## 6. Seguridad

Contraseñas con hash Argon2; no se define política de bloqueo por intentos fallidos de login.

## 7. Infraestructura

Dockerfile Node.

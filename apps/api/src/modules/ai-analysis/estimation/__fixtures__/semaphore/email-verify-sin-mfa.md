## 1. Contexto y alcance

Se exige MFA con segundo factor para todos los usuarios administradores.

## 2. Arquitectura

NestJS + React.

## 3. Modelo de Datos

```sql
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT);
```

## 4. Contratos de API

POST /email/verify para confirmar correo en el registro.

## 5. Lógica

Registro estándar.

## 6. Seguridad

Hash de contraseñas con Argon2; sesiones con JWT de corta duración.

## 7. Infraestructura

Compose local.

## 1. Contexto y alcance

Tienda en línea.

## 2. Arquitectura y Stack

Backend NestJS con PostgreSQL como motor relacional principal.

## 3. Modelo de Datos

```sql
CREATE TABLE products (id UUID PRIMARY KEY, name TEXT);
```

## 4. Contratos de API

El stack usa PostgreSQL 16; aún no hay contratos HTTP publicados en esta iteración.

## 5. Lógica y Edge Cases

Flujos estándar de catálogo.

## 6. Seguridad

Hash Argon2 para contraseñas y tokens de sesión.

## 7. Infraestructura

Docker Compose con servicio de base de datos PostgreSQL en contenedor dedicado.

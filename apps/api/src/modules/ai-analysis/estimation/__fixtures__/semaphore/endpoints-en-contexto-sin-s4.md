## 1. Contexto y alcance

El documento describe los endpoints REST previstos a nivel de negocio, sin contratos formales aún.

## 2. Arquitectura y Stack

Monolito modular.

## 3. Modelo de Datos

```sql
CREATE TABLE orders (id UUID PRIMARY KEY);
```

## 5. Lógica y Edge Cases

Reglas de inventario.

## 6. Seguridad

RBAC básico.

## 7. Infraestructura

Dockerfile Node 20.
